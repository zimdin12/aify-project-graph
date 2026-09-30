// ⛔⛔ AN EXTRACTION MUST SAY WHETHER IT IS COMPLETE — BOTH WAYS IT COULD SILENTLY NOT BE.
//
// Two conditions in `extractFile` made a partial extraction indistinguishable from a whole one:
//
//   1. tree-sitter does not throw on bad syntax. It returns a partial tree, and the extractor walked it and
//      returned a confident result. MEASURED 2026-09-30: `fingerprint.js` cut at 55% gave 6 symbols instead of
//      9 and a different fingerprint, with no complaint and no field saying so.
//   2. `MAX_VISIT_DEPTH` bailed with a bare `return`, leaving no trace that anything below it was unread.
//
// Neither mattered much to the graph — re-extracting the same broken source gives the same partial result,
// and fixing the file moves the fingerprint and triggers re-extraction, so nothing gets STUCK. What they broke
// was any caller asking "is this extraction complete?", which the dashboard's watch seam now does: a partial
// instrument comparing to its own partial view reports `unchanged` while seeing nothing.
//
// ⚠ These arms run the REAL extractor. The resolver's arms use fakes and bound the DECISION; this file bounds
// the SIGNAL the decision depends on, which no fake can.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import { getLanguageConfig } from '../../../mcp/stdio/ingest/languages/index.js';
import { fileStructuralFingerprint } from '../../../mcp/stdio/ingest/fingerprint.js';

const REAL = 'mcp/stdio/ingest/fingerprint.js';
const js = getLanguageConfig('x.js');
const extract = (source, filePath = 'x.js') => extractFile({ filePath, source, config: js });

// Nested array literals: each level adds tree depth, and the file stays valid JavaScript so the ONLY thing
// that can flip is the depth flag, never the parse flag.
const nested = (levels) => `export const deep = ${'['.repeat(levels)}1${']'.repeat(levels)};\n`;

describe('extractFile reports its own coverage', () => {
  it('★★★ a clean file reports a COMPLETE extraction — the control that makes the other arms mean something', () => {
    // ⛔ POSITIVE CONTROL FIRST. Without it, the arms below cannot tell "the flag works" from "the flag is always
    // true", and an always-true flag would refuse every anchor while passing every test here.
    const source = readFileSync(REAL, 'utf8');
    const { coverage, nodes } = extract(source, REAL);
    expect(nodes.length, 'the fixture must actually extract something').toBeGreaterThan(2);
    expect(coverage).toEqual({ parseHadError: false, depthCapFired: false, depthCap: 80 });
  });

  it('★★★ a SYNTAX ERROR is reported, on the same file that was clean above', () => {
    const source = readFileSync(REAL, 'utf8');
    const cut = source.slice(0, Math.floor(source.length * 0.55));
    const whole = extract(source, REAL);
    const partial = extract(cut, REAL);
    expect(partial.coverage.parseHadError, 'a file cut mid-function must report the error').toBe(true);
    // ⚠ And the reason the flag is needed, stated as an assertion: the partial extraction still RETURNS symbols
    // and a fingerprint. Nothing else in the result would have told a caller it was incomplete.
    expect(partial.nodes.length).toBeGreaterThan(2);
    expect(partial.nodes.length).toBeLessThan(whole.nodes.length);
    expect(fileStructuralFingerprint(partial)).not.toBe(fileStructuralFingerprint(whole));
  });

  it('★★★ the DEPTH CAP firing is reported, and a shallow file does not report it', () => {
    // BOTH SIDES OF THE CAP IN ONE ARM, so neither "always fires" nor "never fires" can pass.
    const shallow = extract(nested(20));
    const deep = extract(nested(120));
    expect(shallow.coverage.parseHadError, 'the fixture must be valid JavaScript').toBe(false);
    expect(deep.coverage.parseHadError, 'the fixture must be valid JavaScript').toBe(false);
    expect(shallow.coverage.depthCapFired, 'twenty levels is well under the cap').toBe(false);
    expect(deep.coverage.depthCapFired, 'a hundred and twenty levels must reach it').toBe(true);
  });

  it('★★★ adding `coverage` CANNOT move a fingerprint — the blast-radius claim, bounded', () => {
    // ⛔ THE REASON THIS CHANGE WAS SAFE TO MAKE. Every consumer of `extractFile` was read before it landed and
    // all of them destructure specific fields; `fileStructuralFingerprint` reads only `nodes` and `refs`. If a
    // future fingerprint began hashing the whole object, every stored fingerprint in every graph would move at
    // once and force a full reindex everywhere. This arm fails first.
    const extracted = extract(readFileSync(REAL, 'utf8'), REAL);
    const withOtherCoverage = { ...extracted, coverage: { parseHadError: true, depthCapFired: true, depthCap: 1 } };
    const withoutCoverage = { ...extracted };
    delete withoutCoverage.coverage;
    const base = fileStructuralFingerprint(extracted);
    expect(fileStructuralFingerprint(withOtherCoverage)).toBe(base);
    expect(fileStructuralFingerprint(withoutCoverage)).toBe(base);
  });
});
