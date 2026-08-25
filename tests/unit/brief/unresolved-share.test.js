// ⛔ THE BRIEF ASSERTED A QUANTIFIER ITS OWN NUMBERS CONTRADICTED.
//
// brief.agent.md read "2150 unresolved edges (mostly CALLS 199, REFERENCES 196)". 199+196 is
// 395, which is 18% of 2150 — so "mostly" was false on the two figures printed beside it, and
// the other 1755 edges were never named. the field test measured it worse in the field on echoes:
// 473 of 4392, 11%, with 3919 unnamed. Their words: at 11% it is not a rounding problem, it is
// backwards.
//
// ★ The word was HARDCODED while the numbers were COMPUTED, so it could only ever be right by
// accident. Same defect as every capped list that called itself a total — in the artifact
// agents read FIRST to orient, before any verb call.
import { describe, it, expect } from 'vitest';
import { describeUnresolvedBreakdown } from '../../../mcp/stdio/brief/generator.js';

describe('the unresolved-edge breakdown states its own share', () => {
  it('★★★ a top-2 MINORITY does not read as a majority', () => {
    // The reported case: CALLS 199 and REFERENCES 196 were the top two of 2146, so the other
    // ~1751 must be spread across many SMALLER relations or they would have been the top two.
    // ⚠ My first fixture lumped the remainder into ONE bucket, which then became the largest
    // relation and made the top-2 a 91% majority. The fixture was wrong, not the code — and a
    // fixture that misrepresents the shape proves nothing about it.
    const spread = { CALLS: 199, REFERENCES: 196 };
    for (let i = 0; i < 18; i += 1) spread[`REL_${i}`] = 97;
    const line = describeUnresolvedBreakdown(spread);
    expect(line).toMatch(/CALLS 199, REFERENCES 196/);
    expect(line, 'the share must be stated and must be a minority').toMatch(/— 18% of /);
    expect(line, 'and the unnamed remainder must be named').toMatch(/across 18 other relation\(s\)/);
    expect(line, 'the false quantifier must be gone').not.toMatch(/mostly/);
  });

  it('★★★ the echoes shape, where "mostly" was 11% true', () => {
    // the field test measured 473 of 4392 on echoes, with 3919 unnamed.
    const spread = { CALLS: 326, IMPORTS: 147 };
    for (let i = 0; i < 40; i += 1) spread[`REL_${i}`] = Math.round(3919 / 40);
    const line = describeUnresolvedBreakdown(spread);
    const pct = Number(/— (\d+)% of/.exec(line)[1]);
    expect(pct, 'at ~11% a "mostly" claim is not a rounding problem, it is backwards')
      .toBeLessThan(20);
  });

  it('★★ a genuine majority still reads as one — the negative half', () => {
    // Without this the check could be satisfied by always reporting a small number.
    const line = describeUnresolvedBreakdown({ CALLS: 900, IMPORTS: 80, OTHER: 20 });
    expect(Number(/— (\d+)% of/.exec(line)[1])).toBeGreaterThan(90);
  });

  it('★★ nothing to describe yields nothing, rather than an empty claim', () => {
    expect(describeUnresolvedBreakdown(null)).toBe('');
    expect(describeUnresolvedBreakdown({})).toBe('');
  });
});
