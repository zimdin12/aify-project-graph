// ⛔ A DUPLICATE SITE ID IS REFUSED AT THE CALL SITE, NOT RECORDED AND FORGOTTEN.
//
// My first attempt at this guard pushed the duplicate onto an array returned by `extractFile` and
// carried on. Review searched the tree: that array had ZERO readers, and extraction still fell
// through to the old merge branch, so the duplicate was swallowed exactly as before. A returned
// field nobody consumes is not a report and not a refusal.
//
// ⚠ THESE ARE CALL-SITE TESTS ON `extractFile`, DELIBERATELY. Covering the id helper alone would
// reproduce the same defect one layer down: a correct helper whose caller ignores it.
//
// ⚠ WHY THE ID MODULE IS MOCKED. With the auto-slot repair removed, no natural source I could
// construct makes two symbols share one declarator span — measured across 782 tracked files, the
// count of undeclared duplicates is zero. So the collision is forced, which is the only way to
// exercise a branch that correctly never fires on real input.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../mcp/stdio/ingest/identity/code-symbol-site-id.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, codeSymbolSiteId: () => 'forced-collision-id' };
});

const load = async () => {
  const { extractFile } = await import('../../../mcp/stdio/ingest/extractors/generic.js');
  const { getLanguageConfig } = await import('../../../mcp/stdio/ingest/languages/index.js');
  return { extractFile, getLanguageConfig };
};

describe('an undeclared duplicate symbol site is REFUSED', () => {
  it('⛔ extractFile throws rather than merging the second occurrence', async () => {
    const { extractFile, getLanguageConfig } = await load();
    const source = 'function alpha() { return 1; }\nfunction beta() { return 2; }\n';
    expect(() => extractFile({ filePath: 'src/dup.js', source, config: getLanguageConfig('src/dup.js') }))
      .toThrow(/undeclared duplicate symbol site/i);
  });

  it('⛔ the refusal is TYPED, so a caller can tell it from a parse failure', async () => {
    // The orchestrator catches extraction errors and records a skipped file with its reason, which
    // is attested and counted. An untyped throw would be indistinguishable from a syntax error.
    const { extractFile, getLanguageConfig } = await load();
    const source = 'function alpha() { return 1; }\nfunction beta() { return 2; }\n';
    let caught;
    try {
      extractFile({ filePath: 'src/dup.js', source, config: getLanguageConfig('src/dup.js') });
    } catch (err) { caught = err; }
    expect(caught, 'the call must have thrown, or the assertions below prove nothing').toBeTruthy();
    expect(caught.code).toBe('APG_DUPLICATE_SYMBOL_SITE');
    expect(caught.duplicateSites?.length ?? 0).toBeGreaterThan(0);
    expect(caught.duplicateSites[0]).toHaveProperty('filePath', 'src/dup.js');
  });

  it('POSITIVE CONTROL: a single symbol never trips the guard', async () => {
    // Without this, a guard that threw unconditionally would pass both assertions above while
    // making the extractor useless — the failure mode of a check that cannot say "fine".
    const { extractFile, getLanguageConfig } = await load();
    const result = extractFile({
      filePath: 'src/one.js',
      source: 'function only() { return 1; }\n',
      config: getLanguageConfig('src/one.js'),
    });
    expect(result.nodes.some((n) => n.label === 'only')).toBe(true);
    expect(result.duplicateSites).toEqual([]);
  });
});
