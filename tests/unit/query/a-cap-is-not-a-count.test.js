// ⛔ THE DEFECT AN A/B FOUND, 2026-09-07.
//
// Four agents were asked how many callers `has` has. The graph told the two graph-armed ones
// `CONFIDENCE: 100 callers`. The real answer is 10 call sites in one function, and one of them wrote
// back unprompted: *"the headline number the verb prints is still 100 callers, and 100 is wrong by a
// factor of 100."*
//
// ⭐ AND 100 WAS NEVER A COUNT. `EDGE_FETCH_CAP` is 100, so `mapped.length` saturates there. The verb
// already KNOWS it saturated — `edgesTruncated` is computed from a deliberate `LIMIT CAP + 1` — and
// that flag reaches the trust banner while never reaching the line that prints the number. Computed
// and not consumed, the same shape as the unwired claims this repository keeps finding.
//
// ⛔ `graph_impact` is worse: it uses `LIMIT 100` with no `+ 1`, so it caps SILENTLY and cannot even
// detect that it did. A number it reports as a count may be a cap and nothing in the code can tell.
//
// ⇒ A capped result is a FLOOR. Saying "100" states a fact the query did not establish, and the
// caveat that rescued those agents sits below the number rather than on it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';
import { describeResultCount } from '../../../mcp/stdio/query/overcount-risk.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('a capped result is a floor, and says so', () => {
  it('★★★ THE REAL CASE: a truncated result reads as AT LEAST, never as a count', () => {
    const r = describeResultCount({ resultCount: 100, truncated: true });
    expect(r.isFloor).toBe(true);
    expect(r.text).toMatch(/at least 100/i);
    // ⛔ The bare number must not stand alone anywhere in the phrase, or a reader skimming for a
    // figure takes the cap as the answer — which is exactly what happened to a live agent.
    expect(r.text).not.toBe('100');
  });

  it('★★★ THE POSITIVE CONTROL: an untruncated result is reported plainly', () => {
    // A qualifier on every answer is decoration, and this repository has torn out an always-on
    // caveat before. The floor language must appear only when the query actually saturated.
    const r = describeResultCount({ resultCount: 12, truncated: false });
    expect(r.isFloor).toBe(false);
    expect(r.text).toBe('12');
  });

  it('★★ zero is a real answer and is never dressed as a floor', () => {
    expect(describeResultCount({ resultCount: 0, truncated: false }))
      .toMatchObject({ isFloor: false, text: '0' });
  });

  it('★★★ THE WIRING: graph_callers puts the truncation on the NUMBER, not only the banner', () => {
    // The flag existed and reached `buildTrustLine` while the confidence line printed a bare count.
    // Fixing the helper without wiring it would leave the exact defect the A/B measured.
    const src = read('../../../mcp/stdio/query/verbs/callers.js');
    expect(src, 'the confidence line must consult the helper').toContain('describeResultCount');
    // Live control: the identifier does exist in the module that owns it, so its absence would be a
    // measured result rather than a misspelling that can never match.
    expect(read('../../../mcp/stdio/query/overcount-risk.js')).toContain('describeResultCount');
  });

  it('★★★ graph_impact must be ABLE to detect its own cap — LIMIT 100 cannot', () => {
    // ⛔ It fetched exactly the cap, so a full page and a saturated page are indistinguishable. The
    // fix is the same one callers.js already uses: ask for one more than you will keep.
    const src = read('../../../mcp/stdio/query/verbs/impact.js');
    // ⛔ ASSERT AGAINST CODE, NOT PROSE — and this took two attempts, which is the lesson.
    // v1 was `/LIMIT 100\b/` and matched the COMMENT explaining the fix. v2 added a backtick to
    // "pin it to the query literal" and matched the same comment, because the comment writes the
    // phrase as `LIMIT 100` in backticks. A check that cannot tell code from a mention of code is
    // the mention-not-use bug — here inside the very test written to catch it.
    // ⇒ Strip line comments first. Then the assertion is about the program.
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    // ⛔ AND THE THIRD ATTEMPT IS THE ONE THAT NEEDED THE HELPER. v3 was a bare `not.toMatch`,
    // which the negative-assertion ratchet caught the moment it ran — count 155 against a
    // baseline of 154. A prohibition whose matcher has never been watched to fire is the exact
    // thing this file was written about, so it now proves the matcher both ways before trusting
    // its silence. `LIMIT 101` is what the fixed query emits, so it is the discriminating canary.
    expectAbsentWithLiveMatcher(
      /LIMIT 100/,
      { forbidden: 'ORDER BY e.id LIMIT 100', allowed: 'ORDER BY e.id LIMIT 101' },
      code,
      'a bare LIMIT 100 cannot tell a full page from a truncated one',
    );
    // Live control: the stripped source is still the real file, not an empty string.
    expect(code).toContain('export async function graphImpact');
    expect(src, 'it must fetch one extra to detect saturation').toMatch(/IMPACT_FETCH_CAP \+ 1/);
    expect(src, 'and report the floor').toContain('describeResultCount');
  });
});
