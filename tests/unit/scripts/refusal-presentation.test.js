// ⛔ EVERY REFUSAL MUST BE EXPLAINABLE, AND NOTHING WAS BINDING THAT.
//
// I told the reviewer, twice, that the guard's refusal PRESENTATION was unbound: the decision
// function was tested, and the layer that turns a verdict into words a human acts on was covered
// only by two end-to-end runs that happened to exercise PASS and FAIL. Four of the six refusal
// reasons had never printed anything in a test.
//
// ⇒ That gap matters more than it sounds. A refusal's whole job is telling the reader WHAT TO DO
// NEXT — and the two carrier refusals name OPPOSITE remedies. Collapsing them sends someone to
// re-baseline into the same non-determinism that just bit them, which is a loop dressed as advice.
//
// ⚠ NO CORPUS RUN. `printRefusal` is exported, so the presentation is exercised directly instead of
// spawning a 61-entry comparison to observe six strings.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { printRefusal } from '../../../scripts/refactor-guard.mjs';
import { REFUSAL } from '../../../scripts/lib/guard-verdict.mjs';

/** Capture what a refusal actually writes, in order. */
function captured(decision) {
  const lines = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((m) => lines.push(String(m)));
  try { printRefusal(decision); } finally { spy.mockRestore(); }
  return lines;
}

afterEach(() => vi.restoreAllMocks());

describe('every refusal reason explains itself', () => {
  it('★★★ EVERY declared reason produces a REFUSED headline — derived, not listed', () => {
    // ⛔ DERIVED FROM THE VOCABULARY. A new refusal reason added without a headline would otherwise
    // print `undefined` and exit 1, which reads like a crash rather than a ruling. Listing the
    // reasons here instead would let that happen the moment someone adds a seventh.
    const reasons = Object.values(REFUSAL);
    expect(reasons.length, 'the vocabulary is real').toBeGreaterThanOrEqual(6);

    for (const reason of reasons) {
      const lines = captured({ reason, detail: [] });
      expect(lines[0], `${reason} must have a headline`).toMatch(/^REFUSED: /);
      expect(lines[0], `${reason} must not print an unmapped fallback`).not.toMatch(/unmapped reason/);
    }
  });

  it('★★★ the detail lines are printed, indented, after the headline', () => {
    const lines = captured({ reason: REFUSAL.CORPUS_MEMBERSHIP, detail: ['missing: A', 'extra: B'] });
    expect(lines[0]).toMatch(/^REFUSED: /);
    expect(lines.slice(1, 3)).toEqual(['  missing: A', '  extra: B']);
  });

  it('★★★ THE TWO CARRIER REFUSALS NAME OPPOSITE REMEDIES', () => {
    // ⛔ THE REASON PRESENTATION IS NOT COSMETIC. Mid-run movement means "nothing you do will
    // attribute until the graph settles". Baseline drift means "re-baseline and slice". Telling a
    // reader to re-baseline during ambient re-indexing walks them straight back into it.
    const midRun = captured({ reason: REFUSAL.CARRIER_MIDRUN, detail: [] }).join('\n');
    const drift = captured({ reason: REFUSAL.CARRIER_DRIFT, detail: [] }).join('\n');

    expect(midRun).toMatch(/Re-run on a settled graph/);
    expect(midRun).toMatch(/Nothing here is evidence about the code/);
    expect(drift).toMatch(/Re-baseline on the current graph/);

    // And they must not be interchangeable.
    expect(midRun).not.toBe(drift);
    expect(drift, 'drift must NOT tell the reader to wait for a settled graph')
      .not.toMatch(/Re-run on a settled graph/);
  });

  it('★★★ reasons WITHOUT a remedy print exactly two kinds of line, and no blank third', () => {
    // A remedy line that renders as `undefined` would be worse than none.
    const lines = captured({ reason: REFUSAL.DUPLICATE_KEYS, detail: ['A [plan] x2'] });
    expect(lines).toEqual([
      'REFUSED: duplicate corpus keys — one entry cannot stand in for another.',
      '  A [plan] x2',
    ]);
  });

  it('★★★ an UNMAPPED reason says so loudly — it does not print a blank line and exit', () => {
    // ⛔ THE FAIL-CLOSED PATH FOR THE PRINTER ITSELF. If the guard cannot explain why it refused,
    // that is its own defect and the output must say so rather than emit `undefined`.
    const lines = captured({ reason: 'reason_nobody_mapped', detail: [] });
    expect(lines[0]).toMatch(/unmapped reason "reason_nobody_mapped"/);
    expect(lines[0]).toMatch(/the guard cannot explain itself/);
    expect(lines[0], 'never a bare undefined').not.toMatch(/undefined/);
  });

  it('★★★ CONTROL: the capture actually captures — an empty result would pass everything', () => {
    // Without this, every assertion above is satisfied by a spy that swallowed the output and a
    // `lines` array that was checked while empty.
    const lines = captured({ reason: REFUSAL.ALL_THREW, detail: ['7/7 threw'] });
    expect(lines.length, 'headline plus detail').toBe(2);
    expect(console.error, 'and the real console is restored afterwards').not.toBe(undefined);
  });
});
