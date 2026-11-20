import {
  assertExportSelectorBody,
  encodeJobByteTotal,
  formatBytes,
  parseExportSelector,
} from './package-jobs.service';

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const KB = 1024;

describe('formatBytes', () => {
  it('prints whole configured limits the way users read them', () => {
    expect(formatBytes(8 * GB)).toBe('8 GB');
    expect(formatBytes(200 * MB)).toBe('200 MB');
    expect(formatBytes(5 * MB)).toBe('5 MB');
    expect(formatBytes(512 * KB)).toBe('512 KB');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(3)).toBe('3 B');
  });
});

describe('encodeJobByteTotal', () => {
  it('stores sizes within the Postgres INTEGER range directly', () => {
    expect(encodeJobByteTotal(1 * GB)).toEqual({
      bytesTotal: 1 * GB,
      requestId: null,
    });
    expect(encodeJobByteTotal(2_147_483_647)).toEqual({
      bytesTotal: 2_147_483_647,
      requestId: null,
    });
  });

  it('keeps 4 GiB–8 GiB declarations without overflowing the Int column', () => {
    // 4 GiB 超过 2^31-1：Int 列封顶，真实值进 requestId（不再 500）
    const four = encodeJobByteTotal(4 * GB);
    expect(four.bytesTotal).toBe(2_147_483_647);
    expect(four.requestId).toBe(`raw-bytes-total:${4 * GB}`);
    const eight = encodeJobByteTotal(8 * GB);
    expect(eight.bytesTotal).toBe(2_147_483_647);
    expect(eight.requestId).toBe(`raw-bytes-total:${8 * GB}`);
  });
});

describe('parseExportSelector', () => {
  it('defaults to the live version', () => {
    expect(parseExportSelector(undefined)).toEqual({ kind: 'live' });
    expect(parseExportSelector({})).toEqual({ kind: 'live' });
  });

  it('supports working/draft and live (case-insensitive, trimmed)', () => {
    expect(parseExportSelector({ version: 'working' })).toEqual({
      kind: 'draft',
    });
    expect(parseExportSelector({ version: ' draft ' })).toEqual({
      kind: 'draft',
    });
    expect(parseExportSelector({ version: 'LIVE' })).toEqual({ kind: 'live' });
  });

  it('resolves version:N by version number or by version label', () => {
    expect(parseExportSelector({ version: 'version:4' })).toEqual({
      kind: 'versionNo',
      versionNo: 4,
    });
    expect(parseExportSelector({ version: 'version:1.2' })).toEqual({
      kind: 'versionLabel',
      label: '1.2',
    });
    expect(parseExportSelector({ version: 'version:Version 3' })).toEqual({
      kind: 'versionLabel',
      label: 'Version 3',
    });
  });

  it('keeps the legacy versionId and sourceVersion fields working', () => {
    expect(
      parseExportSelector({
        version: 'working',
        versionId: '11111111-1111-1111-1111-111111111111',
      }),
    ).toEqual({
      kind: 'versionId',
      versionId: '11111111-1111-1111-1111-111111111111',
    });
    expect(parseExportSelector({ sourceVersion: 'live' })).toEqual({
      kind: 'live',
    });
    expect(parseExportSelector({ sourceVersion: 'version:2' })).toEqual({
      kind: 'versionNo',
      versionNo: 2,
    });
  });
});

describe('assertExportSelectorBody', () => {
  it('accepts absent or string selectors', () => {
    expect(() => assertExportSelectorBody(undefined)).not.toThrow();
    expect(() => assertExportSelectorBody({})).not.toThrow();
    expect(() =>
      assertExportSelectorBody({ version: 'live', versionId: '', sourceVersion: 'working' }),
    ).not.toThrow();
  });

  it('rejects non-string selectors instead of silently exporting live', () => {
    for (const body of [
      { version: 1 },
      { version: null },
      { versionId: 123 },
      { sourceVersion: ['live'] },
    ]) {
      let error: unknown;
      try {
        assertExportSelectorBody(body);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({
        code: 'VALIDATION_ERROR',
        httpStatus: 400,
      });
    }
  });
});
