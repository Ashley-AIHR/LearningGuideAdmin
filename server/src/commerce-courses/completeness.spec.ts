import {
  computeCompleteness,
  type CompletenessInput,
  type CompletenessIssue,
  type ContentLesson,
  type ContentLocalization,
} from './completeness';

function courseInfo(language: string): ContentLocalization {
  return {
    language,
    title: `Course ${language}`,
    shortDescription: 'Short',
    overview: 'Overview',
    whatYouLearn: ['a', 'b', 'c', 'd'],
    provides: ['1', '2', '3', '4'],
  };
}

function lessonOne(): ContentLesson {
  return {
    id: 'lesson-1',
    code: 'L001',
    sortOrder: 1,
    localizations: [
      {
        language: 'en-GB',
        title: 'Lesson 1',
        description: 'Description',
        videoAssetId: 'video-1',
        videoDurationSeconds: 600,
        textHtml: '<h1 data-lp="T1">Heading</h1><p>Body</p>',
      },
      { language: 'zh-CN', title: '第一课', description: '说明' },
    ],
    learningPoints: [
      {
        language: 'en-GB',
        source: 'VIDEO',
        code: 'V1',
        title: 'Intro',
        timeSeconds: 30,
      },
      { language: 'en-GB', source: 'TEXT', code: 'T1', title: 'Heading' },
    ],
    triggers: [],
    questions: [{ question: 'Q', referenceAnswer: 'A' }],
    applicationTest: { scenario: 'S', referenceAnswer: 'A', enabled: true },
  };
}

function baseInput(
  overrides: Partial<CompletenessInput> = {},
): CompletenessInput {
  return {
    categoryId: 'cat-1',
    coverAssetId: 'cover-1',
    learningMode: 'VIDEO_AND_TEXT',
    learningLanguages: ['en-GB'],
    localizations: [courseInfo('en-GB'), courseInfo('zh-CN')],
    lessons: [lessonOne()],
    trialEnabled: true,
    trialRows: [
      {
        lessonId: 'lesson-1',
        status: 'READY',
        videoCutoffSeconds: 60,
        textCutoffLearningPointId: 'lp-1',
      },
    ],
    ...overrides,
  };
}

/** The first lesson of the base input with one localization or list changed. */
function withLesson(change: (lesson: ContentLesson) => void): ContentLesson[] {
  const lesson = lessonOne();
  change(lesson);
  return [lesson];
}

function find(
  issues: CompletenessIssue[],
  match: Partial<CompletenessIssue>,
): CompletenessIssue | undefined {
  return issues.find((issue) =>
    Object.entries(match).every(
      ([key, value]) => issue[key as keyof CompletenessIssue] === value,
    ),
  );
}

describe('computeCompleteness', () => {
  it('marks all 3 steps complete and reports no issue', () => {
    const result = computeCompleteness(baseInput());
    expect(result.steps.courseInformation.complete).toBe(true);
    expect(result.steps.content.complete).toBe(true);
    expect(result.steps.trial.complete).toBe(true);
    expect(result.completedSteps).toBe(3);
    expect(result.canPublish).toBe(true);
    expect(result.issues).toEqual([]);
  });

  describe('Course Information', () => {
    it('blocks publish when Course Information is incomplete', () => {
      const result = computeCompleteness(
        baseInput({
          localizations: [
            {
              language: 'en-GB',
              title: 'Course',
              shortDescription: '',
              overview: 'Overview',
              whatYouLearn: ['a'],
              provides: ['1'],
            },
            courseInfo('zh-CN'),
          ],
        }),
      );
      expect(result.steps.courseInformation.complete).toBe(false);
      expect(result.canPublish).toBe(false);
      expect(result.publishBlockers.join(' ')).toContain('Course Information');
    });

    it('is Incomplete when an English-only course has an empty zh-CN title', () => {
      const zh = { ...courseInfo('zh-CN'), title: '  ' };
      const result = computeCompleteness(
        baseInput({ localizations: [courseInfo('en-GB'), zh] }),
      );
      expect(result.steps.courseInformation.complete).toBe(false);
      expect(result.canPublish).toBe(false);
      expect(
        find(result.issues, {
          step: 'COURSE_INFORMATION',
          field: 'title',
          language: 'zh-CN',
          message: 'Required',
        }),
      ).toBeDefined();
      expect(
        find(result.issues, { field: 'title', language: 'en-GB' }),
      ).toBeUndefined();
    });

    it('flags every field of a language that has no Course Information row at all', () => {
      const result = computeCompleteness(
        baseInput({ localizations: [courseInfo('en-GB')] }),
      );
      const fields = result.issues
        .filter(
          (i) => i.step === 'COURSE_INFORMATION' && i.language === 'zh-CN',
        )
        .map((i) => i.field);
      expect(fields).toEqual(
        expect.arrayContaining(['title', 'shortDescription', 'overview']),
      );
    });

    it('is Incomplete without a cover', () => {
      const result = computeCompleteness(baseInput({ coverAssetId: null }));
      expect(result.steps.courseInformation.complete).toBe(false);
      expect(result.canPublish).toBe(false);
      expect(
        find(result.issues, {
          step: 'COURSE_INFORMATION',
          field: 'cover',
          message: 'Required',
        }),
      ).toBeDefined();
    });

    it('is Incomplete without a category', () => {
      const result = computeCompleteness(baseInput({ categoryId: null }));
      expect(find(result.issues, { field: 'category' })).toBeDefined();
    });

    it('flags learn[3] when English has 4 items and Chinese has 3', () => {
      const zh = { ...courseInfo('zh-CN'), whatYouLearn: ['一', '二', '三'] };
      const result = computeCompleteness(
        baseInput({ localizations: [courseInfo('en-GB'), zh] }),
      );
      expect(
        find(result.issues, {
          field: 'learn[3]',
          language: 'zh-CN',
          message: 'Required',
        }),
      ).toBeDefined();
      expect(
        find(result.issues, {
          field: 'learn',
          language: 'zh-CN',
          message: 'At least 4 items',
        }),
      ).toBeDefined();
      expect(find(result.issues, { language: 'en-GB' })).toBeUndefined();
    });

    it('flags a blank item inside a list of 4', () => {
      const en = { ...courseInfo('en-GB'), whatYouLearn: ['a', ' ', 'c', 'd'] };
      const result = computeCompleteness(
        baseInput({ localizations: [en, courseInfo('zh-CN')] }),
      );
      expect(
        find(result.issues, { field: 'learn[1]', language: 'en-GB' }),
      ).toBeDefined();
      expect(find(result.issues, { field: 'learn[0]' })).toBeUndefined();
    });

    it('counts a This course provides item by its title and flags fewer than 4 and more than 6', () => {
      const few = {
        ...courseInfo('en-GB'),
        provides: [{ title: 'x' }, { title: 'y' }, { title: 'z' }],
      };
      const result = computeCompleteness(
        baseInput({ localizations: [few, courseInfo('zh-CN')] }),
      );
      expect(
        find(result.issues, {
          field: 'provides',
          language: 'en-GB',
          message: 'At least 4 items',
        }),
      ).toBeDefined();

      const many = {
        ...courseInfo('en-GB'),
        provides: ['1', '2', '3', '4', '5', '6', '7'],
      };
      const tooMany = computeCompleteness(
        baseInput({ localizations: [many, courseInfo('zh-CN')] }),
      );
      expect(
        find(tooMany.issues, { field: 'provides', message: 'At most 6 items' }),
      ).toBeDefined();
    });

    it('derives the missing strings from the issues', () => {
      const result = computeCompleteness(baseInput({ coverAssetId: null }));
      expect(result.steps.courseInformation.missing).toHaveLength(
        result.issues.filter((i) => i.step === 'COURSE_INFORMATION').length,
      );
      expect(result.steps.courseInformation.missing.join(' ')).toContain(
        'cover',
      );
    });
  });

  describe('Lesson information', () => {
    it('is Incomplete when the Chinese lesson title is empty, even for an English-only course', () => {
      const result = computeCompleteness(
        baseInput({
          lessons: withLesson((lesson) => {
            lesson.localizations[1].title = '';
          }),
        }),
      );
      const issue = find(result.issues, {
        step: 'COURSE_CONTENT',
        part: 'LESSON_INFO',
        field: 'title',
        language: 'zh-CN',
      });
      expect(issue).toMatchObject({
        lessonId: 'lesson-1',
        lessonCode: 'L001',
        lessonPosition: 1,
        message: 'Required',
      });
      expect(result.steps.content.lessons[0].studyComplete).toBe(false);
      expect(result.canPublish).toBe(false);
    });

    it('is Incomplete when the lesson has no Chinese row at all', () => {
      const result = computeCompleteness(
        baseInput({
          lessons: withLesson((lesson) => {
            lesson.localizations = lesson.localizations.slice(0, 1);
          }),
        }),
      );
      const fields = result.issues
        .filter((i) => i.part === 'LESSON_INFO' && i.language === 'zh-CN')
        .map((i) => i.field);
      expect(fields.sort()).toEqual(['description', 'title']);
    });

    it('numbers lessons by their order among the lessons that are not removed', () => {
      const second = lessonOne();
      second.id = 'lesson-2';
      second.code = 'L002';
      second.sortOrder = 2;
      second.localizations[1].description = '';
      const removed = lessonOne();
      removed.id = 'lesson-0';
      removed.code = 'L000';
      removed.sortOrder = 0;
      removed.archivedAt = new Date();
      const result = computeCompleteness(
        baseInput({ lessons: [second, removed, lessonOne()] }),
      );
      expect(
        find(result.issues, { field: 'description', lessonCode: 'L002' }),
      ).toMatchObject({ lessonPosition: 2 });
      expect(find(result.issues, { lessonCode: 'L000' })).toBeUndefined();
    });
  });

  describe('Study, video', () => {
    it('flags a missing video and a video whose length cannot be read', () => {
      const noVideo = computeCompleteness(
        baseInput({
          lessons: withLesson((lesson) => {
            lesson.localizations[0].videoAssetId = null;
          }),
        }),
      );
      expect(
        find(noVideo.issues, {
          part: 'STUDY',
          field: 'video',
          language: 'en-GB',
          message: 'Video is required',
        }),
      ).toBeDefined();

      const unreadable = computeCompleteness(
        baseInput({
          lessons: withLesson((lesson) => {
            lesson.localizations[0].videoDurationSeconds = null;
          }),
        }),
      );
      expect(
        find(unreadable.issues, { code: 'DURATION_UNREADABLE' }),
      ).toMatchObject({ part: 'STUDY', field: 'video.duration' });
      // Without a length there is nothing to compare a time against.
      expect(
        find(unreadable.issues, { message: 'Beyond video length (00:00)' }),
      ).toBeUndefined();
    });

    it('wants at least 1 video learning point', () => {
      const result = computeCompleteness(
        baseInput({
          lessons: withLesson((lesson) => {
            lesson.learningPoints = lesson.learningPoints?.filter(
              (lp) => lp.source !== 'VIDEO',
            );
          }),
        }),
      );
      expect(
        find(result.issues, {
          field: 'videoLearningPoints',
          message: 'At least 1 learning point',
        }),
      ).toBeDefined();
    });

    it('flags a blank learning point title', () => {
      const result = computeCompleteness(
        baseInput({
          lessons: withLesson((lesson) => {
            lesson.learningPoints![0].title = '   ';
          }),
        }),
      );
      expect(
        find(result.issues, {
          part: 'STUDY',
          field: 'videoLearningPoints[V1].title',
          rowKey: 'V1',
          message: 'Required',
        }),
      ).toBeDefined();
    });

    it('flags a learning point with no time', () => {
      const result = computeCompleteness(
        baseInput({
          lessons: withLesson((lesson) => {
            lesson.learningPoints![0].timeSeconds = null;
          }),
        }),
      );
      expect(
        find(result.issues, {
          field: 'videoLearningPoints[V1].timeSeconds',
          message: 'Required',
        }),
      ).toBeDefined();
    });

    it('says Beyond video length (10:00) for a learning point at 700 s in a 600 s video', () => {
      const result = computeCompleteness(
        baseInput({
          lessons: withLesson((lesson) => {
            lesson.learningPoints![0].timeSeconds = 700;
          }),
        }),
      );
      expect(
        find(result.issues, {
          field: 'videoLearningPoints[V1].timeSeconds',
          message: 'Beyond video length (10:00)',
        }),
      ).toBeDefined();
      expect(result.steps.content.lessons[0].studyComplete).toBe(false);
    });

    it('accepts a learning point exactly at the end of the video', () => {
      const result = computeCompleteness(
        baseInput({
          lessons: withLesson((lesson) => {
            lesson.learningPoints![0].timeSeconds = 600;
          }),
        }),
      );
      expect(result.issues).toEqual([]);
    });

    it('flags a trigger with no exhibit, no time, or a time beyond the video', () => {
      const result = computeCompleteness(
        baseInput({
          lessons: withLesson((lesson) => {
            lesson.triggers = [
              { language: 'en-GB', exhibitCode: null, timeSeconds: 10 },
              { language: 'en-GB', exhibitCode: 'E001', timeSeconds: null },
              { language: 'en-GB', exhibitCode: 'E001', timeSeconds: 605 },
              { language: 'en-GB', exhibitCode: 'E002', timeSeconds: 20 },
            ];
          }),
        }),
      );
      expect(
        find(result.issues, {
          field: 'triggers[0].exhibitId',
          message: 'Choose an exhibit',
        }),
      ).toBeDefined();
      expect(
        find(result.issues, {
          field: 'triggers[1].timeSeconds',
          message: 'Required',
        }),
      ).toBeDefined();
      expect(
        find(result.issues, {
          field: 'triggers[2].timeSeconds',
          message: 'Beyond video length (10:00)',
        }),
      ).toBeDefined();
      expect(find(result.issues, { field: 'triggers[3].exhibitId' })).toBe(
        undefined,
      );
    });

    it('does not ask for video rules in a text-only course', () => {
      const result = computeCompleteness(
        baseInput({
          learningMode: 'TEXT_ONLY',
          lessons: withLesson((lesson) => {
            lesson.localizations[0].videoAssetId = null;
            lesson.localizations[0].videoDurationSeconds = null;
            lesson.learningPoints = lesson.learningPoints?.filter(
              (lp) => lp.source === 'TEXT',
            );
          }),
        }),
      );
      expect(result.issues).toEqual([]);
    });
  });

  describe('Study, text', () => {
    it('flags missing text', () => {
      const result = computeCompleteness(
        baseInput({
          lessons: withLesson((lesson) => {
            lesson.localizations[0].textHtml = '';
          }),
        }),
      );
      expect(
        find(result.issues, {
          part: 'STUDY',
          field: 'text',
          language: 'en-GB',
          message: 'Text is required',
        }),
      ).toBeDefined();
    });

    it('asks for Heading 1 when the text has none', () => {
      const result = computeCompleteness(
        baseInput({
          lessons: withLesson((lesson) => {
            lesson.localizations[0].textHtml = '<p>Only a paragraph</p>';
          }),
        }),
      );
      expect(
        find(result.issues, { field: 'textLearningPoints' }),
      ).toMatchObject({
        message:
          'No learning points found. Set each learning point title as Heading 1 (H1).',
      });
    });

    it('flags a heading with no body under it', () => {
      const result = computeCompleteness(
        baseInput({
          lessons: withLesson((lesson) => {
            lesson.localizations[0].textHtml =
              '<h1 data-lp="T1">One</h1><h1 data-lp="T2">Two</h1><p>Body</p>';
          }),
        }),
      );
      expect(
        find(result.issues, {
          field: 'textLearningPoints[T1].body',
          rowKey: 'T1',
          message: 'No text under this heading',
        }),
      ).toBeDefined();
      expect(find(result.issues, { rowKey: 'T2' })).toBeUndefined();
    });

    it('flags a heading with nothing but an exhibit card under it', () => {
      const result = computeCompleteness(
        baseInput({
          lessons: withLesson((lesson) => {
            lesson.localizations[0].textHtml =
              '<h1 data-lp="T1">One</h1><figure data-exhibit-code="E001"><strong>Map</strong> a description</figure>';
          }),
        }),
      );
      expect(
        find(result.issues, { field: 'textLearningPoints[T1].body' }),
      ).toBeDefined();
    });

    it("flags an empty heading as Title can't be empty", () => {
      const result = computeCompleteness(
        baseInput({
          lessons: withLesson((lesson) => {
            lesson.localizations[0].textHtml =
              '<h1 data-lp="T1">One</h1><p>a</p><h1> </h1><p>b</p>';
          }),
        }),
      );
      expect(
        find(result.issues, {
          field: 'textLearningPoints[#2].title',
          message: "Title can't be empty",
        }),
      ).toBeDefined();
      expect(result.steps.content.lessons[0].studyComplete).toBe(false);
    });
  });

  describe('Publish and steps', () => {
    it('allows publish with only one completed lesson study', () => {
      const result = computeCompleteness(
        baseInput({
          lessons: [
            lessonOne(),
            {
              id: 'lesson-2',
              code: 'L002',
              sortOrder: 2,
              localizations: [],
            },
          ],
        }),
      );
      expect(result.canPublish).toBe(true);
      expect(result.steps.content.complete).toBe(false);
      expect(
        result.issues.filter((i) => i.lessonCode === 'L002').length,
      ).toBeGreaterThan(0);
      expect(result.steps.content.missing).toContain(
        'Lesson L002: Study & Exploration is incomplete.',
      );
    });

    it('refuses to publish when no lesson is complete and says it in the PRD words', () => {
      const result = computeCompleteness(
        baseInput({
          lessons: withLesson((lesson) => {
            lesson.localizations[0].textHtml = '';
          }),
        }),
      );
      expect(result.canPublish).toBe(false);
      expect(result.publishBlockers).toEqual([
        'Complete at least 1 lesson first.',
      ]);
    });

    it('asks for a lesson when there is none', () => {
      const result = computeCompleteness(baseInput({ lessons: [] }));
      expect(result.steps.content.complete).toBe(false);
      expect(result.steps.content.missing).toContain('Add at least 1 lesson.');
      expect(find(result.issues, { step: 'COURSE_CONTENT' })).toBeDefined();
    });

    it('requires trial lessons to be consecutive', () => {
      const second = lessonOne();
      second.id = 'lesson-2';
      second.code = 'L002';
      second.sortOrder = 2;
      const result = computeCompleteness(
        baseInput({
          lessons: [lessonOne(), second],
          trialRows: [
            { lessonId: 'lesson-2', status: 'READY', videoCutoffSeconds: 60 },
          ],
        }),
      );
      expect(result.steps.trial.complete).toBe(false);
      expect(find(result.issues, { step: 'TRIAL' })).toBeDefined();
    });
  });
});
