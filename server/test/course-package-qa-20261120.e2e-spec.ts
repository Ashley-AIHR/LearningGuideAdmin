import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import JSZip from 'jszip';
import { App } from 'supertest/types';
import type TestAgent from 'supertest/lib/agent';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/app-setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { PublishingService } from '../src/commerce-courses/publishing.service';
import { CourseFixtures } from './helpers/course-fixture';
import type { ErrorResponse, SuccessResponse } from './helpers/http-response';

// 直传上限按真实配置（默认 200MB）无法用内存文件验证，本套件把它调到 1MB；
// 分块会话的 8GB 上限仍走默认的 PACKAGE_MAX_BYTES。
const ORIGINAL_DIRECT_UPLOAD_BYTES = process.env.PACKAGE_DIRECT_UPLOAD_BYTES;
process.env.PACKAGE_DIRECT_UPLOAD_BYTES = String(1024 * 1024);
// 导出作业由 worker 轮询处理；缩短轮询间隔（只影响本进程的 e2e）。
process.env.PACKAGE_JOB_POLL_MS =
  process.env.PACKAGE_JOB_POLL_MS ??
  process.env.E2E_PACKAGE_JOB_POLL_MS ??
  '100';

interface JobView {
  jobId: string;
  kind: string;
  status: string;
  error: string | null;
  courseId: string | null;
  versionLabel?: string | null;
  fileLabel?: string | null;
  report: {
    errors: Array<{ code: string; message: string; path?: string }>;
    warnings: Array<{ code: string; message: string; path?: string }>;
  };
  conflict?: {
    existingCourseId: string;
    existingCourseCode: string;
    live: boolean;
  } | null;
}

interface ConfirmView {
  jobId: string;
  status: string;
  courseId?: string;
  refused?: string;
  requiresOverwrite?: boolean;
}

interface ExportStartView {
  jobId: string;
  status: string;
  versionId: string | null;
  versionLabel: string;
  fileName: string;
}

/** 24 字节的 ftyp 头 + 可带 mvhd 的 moov 片段（够 validateMediaFile 与 mvhd 解析用）。 */
function mp4Bytes(durationSeconds: number | null): Buffer {
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write('ftyp', 4, 'ascii');
  ftyp.write('isom', 8, 'ascii');
  if (durationSeconds === null) {
    // 有合法 ftyp 签名、但没有 mvhd：探测应失败
    return Buffer.concat([ftyp, Buffer.alloc(24)]);
  }
  const mvhd = Buffer.alloc(28);
  mvhd.write('mvhd', 0, 'ascii');
  mvhd.writeUInt8(0, 4); // version 0
  mvhd.writeUInt32BE(1000, 4 + 12); // timescale
  mvhd.writeUInt32BE(Math.round(durationSeconds * 1000), 4 + 16); // duration
  return Buffer.concat([ftyp, mvhd]);
}

function packageManifest(options: {
  code: string;
  slug: string;
  title?: string;
  /** undefined = 省略可选 durationSeconds（导入时探测）；null = 显式不写（用于探测失败包）。 */
  durationSeconds?: number;
  includeDuration: boolean;
}) {
  const video: Record<string, unknown> = {
    file: 'media/video/L001/en-GB.mp4',
    learningPoints: [{ code: 'V1', timeSeconds: 1, title: 'First point' }],
    exhibitTriggers: [],
  };
  if (options.includeDuration) {
    video.durationSeconds = options.durationSeconds ?? 3;
  }
  return {
    format: 'lg-course-package',
    formatVersion: 1,
    packageId: `pkg_${options.code}_${Date.now().toString(36)}`,
    exportedAt: new Date().toISOString(),
    source: {
      environment: 'E2E',
      courseCode: options.code,
      sourceVersion: 'working',
    },
    incomplete: false,
    course: {
      code: options.code,
      slug: options.slug,
      category: 'E2E Science',
      learningMode: 'VIDEO_ONLY',
      learningLanguages: ['en-GB'],
      defaultContentLanguage: 'en-GB',
      localized: {
        'en-GB': {
          title: options.title ?? `Package ${options.code}`,
          shortDescription: 'Short description',
          overview: 'Overview',
          whatYouLearn: ['one', 'two', 'three', 'four'],
          provides: [],
        },
      },
      lessons: [
        {
          code: 'L001',
          order: 1,
          exhibits: [],
          localized: {
            'en-GB': {
              title: 'Lesson one',
              description: 'Lesson description',
              video,
            },
          },
          recommendedReading: {},
          knowledgeTest: { enabled: false, questions: [] },
        },
      ],
      trial: { enabled: false, lessons: [] },
      pricing: [],
    },
  };
}

async function zipPackage(
  manifest: unknown,
  video: Buffer = mp4Bytes(3),
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('media/video/L001/en-GB.mp4', video);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

describe('Course package QA fixes 2026-11-20 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fixtures: CourseFixtures;
  let agent: TestAgent;
  const createdJobIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    fixtures = new CourseFixtures(app, prisma);
    agent = await fixtures.admin();
  });

  afterAll(async () => {
    await prisma.coursePackageJob.deleteMany({
      where: { id: { in: createdJobIds } },
    });
    await fixtures.removeCourses();
    await app.close();
    if (ORIGINAL_DIRECT_UPLOAD_BYTES === undefined) {
      delete process.env.PACKAGE_DIRECT_UPLOAD_BYTES;
    } else {
      process.env.PACKAGE_DIRECT_UPLOAD_BYTES = ORIGINAL_DIRECT_UPLOAD_BYTES;
    }
  });

  async function uploadPackage(zip: Buffer): Promise<JobView> {
    const response: SuccessResponse<JobView> = await agent
      .post('/api/backoffice/courses/import')
      .attach('file', zip, 'qa.lgcourse.zip')
      .expect(201);
    createdJobIds.push(response.body.data.jobId);
    return response.body.data;
  }

  async function confirm(
    jobId: string,
    body: Record<string, unknown>,
  ): Promise<{
    status: number;
    body: { data?: ConfirmView; error?: { code: string; message: string } };
  }> {
    const response = await agent
      .post(`/api/backoffice/courses/import/${jobId}/confirm`)
      .send(body);
    return {
      status: response.status,
      body: response.body as {
        data?: ConfirmView;
        error?: { code: string; message: string };
      },
    };
  }

  async function importPackage(
    zip: Buffer,
    confirmBody: Record<string, unknown> = { onConflict: 'ABORT' },
  ): Promise<{ job: JobView; courseId: string }> {
    const uploaded = await uploadPackage(zip);
    expect(uploaded.status).toBe('AWAITING_CONFIRM');
    expect(uploaded.report.errors).toEqual([]);
    const confirmed = await confirm(uploaded.jobId, confirmBody);
    expect(confirmed.status).toBe(200);
    const courseId = confirmed.body.data?.courseId as string;
    fixtures.track(courseId);
    return { job: uploaded, courseId };
  }

  // ===== MED-1: 省略 durationSeconds 时按真实文件探测 =====

  describe('MED-1 video duration probing', () => {
    it('probes mvhd when the manifest omits durationSeconds and stores the real length', async () => {
      const suffix = randomUUID().slice(0, 8);
      const code = `E2E-DUR-${suffix.toUpperCase()}`;
      const zip = await zipPackage(
        packageManifest({
          code,
          slug: `e2e-dur-${suffix}`,
          includeDuration: false,
        }),
        mp4Bytes(3),
      );
      const { job, courseId } = await importPackage(zip);

      // 探测值落库：3 秒的 mvhd → videoDurationSeconds = 3
      const lesson = await prisma.lesson.findFirstOrThrow({
        where: { courseId, code: 'L001' },
      });
      const loc = await prisma.lessonLocalization.findFirstOrThrow({
        where: { lessonId: lesson.id, language: 'en-GB' },
      });
      expect(loc.videoDurationSeconds).toBe(3);

      // 导入报告没有"时长读不出"的 warning
      const status: SuccessResponse<JobView> = await agent
        .get(`/api/backoffice/courses/import/${job.jobId}`)
        .expect(200);
      expect(
        status.body.data.report.warnings.filter(
          (warning) => warning.code === 'VIDEO_DURATION_UNREADABLE',
        ),
      ).toEqual([]);

      // completeness 不再因为时长缺失而阻断该语言
      const detail: SuccessResponse<{
        completeness: {
          issues: Array<{ field: string; language?: string; code: string }>;
        };
      }> = await agent.get(`/api/backoffice/courses/${courseId}`).expect(200);
      expect(
        detail.body.data.completeness.issues.filter(
          (issue) =>
            issue.field === 'video.duration' &&
            issue.language === 'en-GB' &&
            issue.code === 'DURATION_UNREADABLE',
        ),
      ).toEqual([]);
    }, 60_000);

    it('keeps duration null and reports a warning when the file has no readable mvhd', async () => {
      const suffix = randomUUID().slice(0, 8);
      const code = `E2E-DURX-${suffix.toUpperCase()}`;
      const zip = await zipPackage(
        packageManifest({
          code,
          slug: `e2e-durx-${suffix}`,
          includeDuration: false,
        }),
        mp4Bytes(null),
      );
      const { job, courseId } = await importPackage(zip);

      const lesson = await prisma.lesson.findFirstOrThrow({
        where: { courseId, code: 'L001' },
      });
      const loc = await prisma.lessonLocalization.findFirstOrThrow({
        where: { lessonId: lesson.id, language: 'en-GB' },
      });
      expect(loc.videoDurationSeconds).toBeNull();

      const status: SuccessResponse<JobView> = await agent
        .get(`/api/backoffice/courses/import/${job.jobId}`)
        .expect(200);
      expect(
        status.body.data.report.warnings.some(
          (warning) => warning.code === 'VIDEO_DURATION_UNREADABLE',
        ),
      ).toBe(true);

      // 探测失败仍为 null：completeness 明确给出 DURATION_UNREADABLE
      const detail: SuccessResponse<{
        completeness: {
          issues: Array<{ field: string; language?: string; code: string }>;
        };
      }> = await agent.get(`/api/backoffice/courses/${courseId}`).expect(200);
      expect(
        detail.body.data.completeness.issues.some(
          (issue) =>
            issue.field === 'video.duration' &&
            issue.language === 'en-GB' &&
            issue.code === 'DURATION_UNREADABLE',
        ),
      ).toBe(true);
    }, 60_000);

    it('keeps an explicit durationSeconds instead of the probed value', async () => {
      const suffix = randomUUID().slice(0, 8);
      const code = `E2E-DURM-${suffix.toUpperCase()}`;
      const zip = await zipPackage(
        packageManifest({
          code,
          slug: `e2e-durm-${suffix}`,
          includeDuration: true,
          durationSeconds: 42,
        }),
        mp4Bytes(3),
      );
      const { courseId } = await importPackage(zip);
      const lesson = await prisma.lesson.findFirstOrThrow({
        where: { courseId, code: 'L001' },
      });
      const loc = await prisma.lessonLocalization.findFirstOrThrow({
        where: { lessonId: lesson.id, language: 'en-GB' },
      });
      expect(loc.videoDurationSeconds).toBe(42);
    }, 60_000);
  });

  // ===== MED-4: 冲突策略 =====

  describe('MED-4 conflict strategies', () => {
    it('returns 409 PACKAGE_CONFLICT for ABORT, 422 for unimplemented strategies, and keeps overwriteDraft', async () => {
      const suffix = randomUUID().slice(0, 8);
      const code = `E2E-CONF-${suffix.toUpperCase()}`;
      const slug = `e2e-conf-${suffix}`;
      const first = await importPackage(
        await zipPackage(
          packageManifest({
            code,
            slug,
            title: 'Original draft',
            includeDuration: true,
          }),
        ),
      );

      const conflictingJob = await uploadPackage(
        await zipPackage(
          packageManifest({
            code,
            slug: `${slug}-again`,
            title: 'Replacement draft',
            includeDuration: true,
          }),
        ),
      );
      expect(conflictingJob.status).toBe('AWAITING_CONFIRM');
      const preflight: SuccessResponse<JobView> = await agent
        .get(`/api/backoffice/courses/import/${conflictingJob.jobId}`)
        .expect(200);
      expect(preflight.body.data.conflict).toMatchObject({
        existingCourseId: first.courseId,
        existingCourseCode: code,
        live: false,
      });

      // ABORT：409 PACKAGE_CONFLICT，作业回到 AWAITING_CONFIRM 等待换策略/覆盖
      const abort = await confirm(conflictingJob.jobId, {
        onConflict: 'ABORT',
      });
      expect(abort.status).toBe(409);
      expect(abort.body.error?.code).toBe('PACKAGE_CONFLICT');
      expect(abort.body.data).toBeNull();
      const afterAbort = await prisma.coursePackageJob.findUniqueOrThrow({
        where: { id: conflictingJob.jobId },
      });
      expect(afterAbort.status).toBe('AWAITING_CONFIRM');

      // 未实现的策略不再静默返回 requiresOverwrite：明确 4xx
      const createNew = await confirm(conflictingJob.jobId, {
        onConflict: 'CREATE_NEW_COURSE',
      });
      expect(createNew.status).toBe(422);
      expect(createNew.body.error?.code).toBe(
        'PACKAGE_CONFLICT_STRATEGY_UNSUPPORTED',
      );
      const newVersion = await confirm(conflictingJob.jobId, {
        onConflict: 'NEW_VERSION',
      });
      expect(newVersion.status).toBe(422);
      expect(newVersion.body.error?.code).toBe(
        'PACKAGE_CONFLICT_STRATEGY_UNSUPPORTED',
      );

      // 未发生静默覆盖：原课程仍是原内容，且没有多出第二门课
      const beforeOverwrite = await prisma.courseLocalization.findFirstOrThrow({
        where: { courseId: first.courseId, language: 'en-GB' },
      });
      expect(beforeOverwrite.title).toBe('Original draft');
      expect(await prisma.commerceCourse.count({ where: { code } })).toBe(1);

      // overwriteDraft=true：保留覆盖既有草稿的行为
      const overwrite = await confirm(conflictingJob.jobId, {
        onConflict: 'ABORT',
        overwriteDraft: true,
      });
      expect(overwrite.status).toBe(200);
      expect(overwrite.body.data?.status).toBe('READY');
      expect(overwrite.body.data?.courseId).toBe(first.courseId);
      const afterOverwrite = await prisma.courseLocalization.findFirstOrThrow({
        where: { courseId: first.courseId, language: 'en-GB' },
      });
      expect(afterOverwrite.title).toBe('Replacement draft');
      expect(await prisma.commerceCourse.count({ where: { code } })).toBe(1);
    }, 60_000);

    it('refuses to overwrite a live course instead of silently replacing it', async () => {
      const suffix = randomUUID().slice(0, 8);
      const code = `E2E-LIVE-${suffix.toUpperCase()}`;
      const first = await importPackage(
        await zipPackage(
          packageManifest({
            code,
            slug: `e2e-live-${suffix}`,
            title: 'Live course',
            includeDuration: true,
          }),
        ),
      );
      const version = await prisma.courseVersion.create({
        data: {
          courseId: first.courseId,
          versionNo: 1,
          versionLabel: '1.1',
          snapshotData: {},
        },
      });
      await prisma.commerceCourse.update({
        where: { id: first.courseId },
        data: { liveVersionId: version.id },
      });

      const conflictingJob = await uploadPackage(
        await zipPackage(
          packageManifest({
            code,
            slug: `e2e-live-${suffix}-again`,
            title: 'Should not replace',
            includeDuration: true,
          }),
        ),
      );
      const outcome = await confirm(conflictingJob.jobId, {
        onConflict: 'ABORT',
        overwriteDraft: true,
      });
      expect(outcome.status).toBe(200);
      expect(outcome.body.data?.refused).toBe('COURSE_ALREADY_LIVE');
      const loc = await prisma.courseLocalization.findFirstOrThrow({
        where: { courseId: first.courseId, language: 'en-GB' },
      });
      expect(loc.title).toBe('Live course');
    }, 60_000);
  });

  // ===== MED-2: 导出参数 =====

  describe('MED-2 export version selectors', () => {
    async function waitForExport(jobId: string): Promise<void> {
      const deadline = Date.now() + 15_000;
      for (;;) {
        const response: SuccessResponse<JobView> = await agent
          .get(`/api/backoffice/courses/export/${jobId}`)
          .expect(200);
        const status = response.body.data.status;
        if (status === 'READY' || status === 'FAILED') return;
        if (Date.now() > deadline) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    async function startExport(
      courseId: string,
      body: Record<string, unknown>,
    ): Promise<ExportStartView> {
      const response: SuccessResponse<ExportStartView> = await agent
        .post(`/api/backoffice/courses/${courseId}/export`)
        .send(body)
        .expect(202);
      createdJobIds.push(response.body.data.jobId);
      await waitForExport(response.body.data.jobId);
      return response.body.data;
    }

    it('resolves working/live/version:N, versionId and sourceVersion; 404 when the version does not exist', async () => {
      const course = await fixtures.createCourse(agent, {
        title: 'Export selectors',
      });
      const v1 = await prisma.courseVersion.create({
        data: {
          courseId: course.id,
          versionNo: 1,
          versionLabel: '1.1',
          versionSeries: 1,
          versionMinor: 1,
          snapshotData: {},
        },
      });
      const v2 = await prisma.courseVersion.create({
        data: {
          courseId: course.id,
          versionNo: 2,
          versionLabel: '1.2',
          versionSeries: 1,
          versionMinor: 2,
          snapshotData: {},
        },
      });

      // version:N —— N 按版本号解析
      const byNo = await startExport(course.id, { version: 'version:1' });
      expect(byNo.versionId).toBe(v1.id);
      expect(byNo.versionLabel).toBe('1.1');
      expect(byNo.fileName).toBe(`${course.code}_1.1.zip`);

      // version:N —— N 按版本标签解析
      const byLabel = await startExport(course.id, { version: 'version:1.2' });
      expect(byLabel.versionId).toBe(v2.id);
      expect(byLabel.versionLabel).toBe('1.2');

      // 现有 versionId 兼容
      const byId = await startExport(course.id, { versionId: v1.id });
      expect(byId.versionId).toBe(v1.id);

      // 现有 sourceVersion 兼容（与 version 同语法）
      const bySourceVersion = await startExport(course.id, {
        sourceVersion: 'version:2',
      });
      expect(bySourceVersion.versionId).toBe(v2.id);

      // working 仍导出草稿
      const working = await startExport(course.id, { version: 'working' });
      expect(working.versionLabel).toBe('draft');
      expect(working.versionId).toBeNull();

      // live：没有线上版本时应走发布校验（409），而不是把 'live' 当标签查版本（404）
      const liveMissing: ErrorResponse = await agent
        .post(`/api/backoffice/courses/${course.id}/export`)
        .send({ version: 'live' });
      expect(liveMissing.status).toBe(409);
      expect(liveMissing.body.error.code).toBe('EXPORT_REQUIRES_LIVE_VERSION');

      // 解析不到版本 → 404 PACKAGE_VERSION_NOT_FOUND
      const missingNo: ErrorResponse = await agent
        .post(`/api/backoffice/courses/${course.id}/export`)
        .send({ version: 'version:99' });
      expect(missingNo.status).toBe(404);
      expect(missingNo.body.error.code).toBe('PACKAGE_VERSION_NOT_FOUND');

      const missingId: ErrorResponse = await agent
        .post(`/api/backoffice/courses/${course.id}/export`)
        .send({ versionId: randomUUID() });
      expect(missingId.status).toBe(404);
      expect(missingId.body.error.code).toBe('PACKAGE_VERSION_NOT_FOUND');

      // live：有线上版本时导出 liveVersionId 指向的快照
      await prisma.commerceCourse.update({
        where: { id: course.id },
        data: { liveVersionId: v1.id },
      });
      const publishing = app.get(PublishingService);
      const spy = jest
        .spyOn(publishing, 'assertExportable')
        .mockResolvedValue({ versionId: v1.id, versionLabel: '1.1' });
      try {
        const live = await startExport(course.id, { version: 'live' });
        expect(live.versionId).toBe(v1.id);
        expect(live.versionLabel).toBe('1.1');

        const defaultLive = await startExport(course.id, {});
        expect(defaultLive.versionId).toBe(v1.id);

        const legacyLive = await startExport(course.id, {
          sourceVersion: 'live',
        });
        expect(legacyLive.versionId).toBe(v1.id);
      } finally {
        spy.mockRestore();
        await prisma.commerceCourse.update({
          where: { id: course.id },
          data: { liveVersionId: null },
        });
      }
    }, 60_000);
  });

  // ===== MED-3 / LOW-1: 上传上限与文案 =====

  describe('MED-3/LOW-1 upload limits', () => {
    const GIB = 1024 * 1024 * 1024;

    async function rawSession(body: Record<string, unknown>): Promise<{
      status: number;
      body: {
        data?: { jobId: string; chunkSize: number };
        error?: { code: string; message: string };
      };
    }> {
      const response = await agent
        .post('/api/backoffice/courses/import/raw/session')
        .send(body);
      const parsed = response.body as {
        data?: { jobId: string; chunkSize: number };
        error?: { code: string; message: string };
      };
      if (parsed.data?.jobId) {
        createdJobIds.push(parsed.data.jobId);
      }
      return { status: response.status, body: parsed };
    }

    it('accepts raw sessions up to PACKAGE_MAX_BYTES without a 500 at 4 GiB', async () => {
      const fourGiB = await rawSession({
        fileName: 'raw.zip',
        bytesTotal: 4 * GIB,
      });
      expect(fourGiB.status).toBe(200);
      expect(fourGiB.body.data?.chunkSize).toBe(5 * 1024 * 1024);

      const atLimit = await rawSession({
        fileName: 'raw.zip',
        bytesTotal: 8 * GIB,
      });
      expect(atLimit.status).toBe(200);
    }, 30_000);

    it('rejects raw sessions above PACKAGE_MAX_BYTES with 400 VALIDATION_ERROR and the real limit', async () => {
      const over = await rawSession({
        fileName: 'raw.zip',
        bytesTotal: 8 * GIB + 1,
      });
      expect(over.status).toBe(400);
      expect(over.body.error?.code).toBe('VALIDATION_ERROR');
      expect(over.body.error?.message).toContain('8 GB');
      expect(over.body.error?.message).not.toContain('15MB');
    }, 30_000);

    it('pre-validates the raw session file extension at session creation', async () => {
      for (const fileName of ['raw.exe', 'raw.7z']) {
        const rejected = await rawSession({ fileName, bytesTotal: 1024 });
        expect(rejected.status).toBe(400);
        expect(rejected.body.error?.code).toBe('PACKAGE_INVALID_ZIP');
        expect(rejected.body.error?.message).toContain('.zip');
      }
      const accepted = await rawSession({
        fileName: 'raw.zip',
        bytesTotal: 1024,
      });
      expect(accepted.status).toBe(200);
    }, 30_000);

    it('rejects direct uploads above PACKAGE_DIRECT_UPLOAD_BYTES with the configured limit, not 15MB', async () => {
      const tooBig = Buffer.alloc(1024 * 1024 + 1, 0x41);
      const response: ErrorResponse = await agent
        .post('/api/backoffice/courses/import')
        .attach('file', tooBig, 'too-big.zip');
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('1 MB');
      expect(response.body.error.message).not.toContain('15MB');
      expect(response.body.error.message.toLowerCase()).toContain('chunked');

      // 原始素材直传超过 PACKAGE_MAX_BYTES 的文案走同一套 formatBytes；内存里造不出
      // 8GB 文件，这里只断言 1MB 直传包不再落到"15MB 限制"文案。
    }, 60_000);
  });
});
