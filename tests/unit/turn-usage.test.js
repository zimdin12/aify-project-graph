// THE INSTRUMENT THAT JUDGES EVERY OTHER CLAIM WAS READING ONE TURN OUT OF N.
//
// ⛔ Found by a reference audit, 2026-08-19, in OUR code: `ab-runner.mjs:417` reversed the
// transcript and took the first `turn.completed` it found; `bench-a1-live.mjs:308` overwrote
// its accumulator on every event and kept the last. Both are last-turn-only. Meanwhile
// `docs/v0.3-hardening-plan.md:486` has said since v0.3: sum per-turn usage, not the result
// total. The rule was written and the code did not follow — the same shape as every fail-open
// default in this repo, sitting in the harness that judges everything else.
//
// ★ THE ERROR IS ONE-SIDED, which is what makes it worth a test file. Reading one turn
// under-counts whichever arm took MORE turns, and arms do not take equal turns — that is
// usually the thing under test. It does not add noise, it adds a slope.
//
// ⚠ AND THE FIX IS NOT "SUM IT". Summing is right only if usage is PER-TURN; taking the last is
// right only if it is CUMULATIVE. Nothing asserted either, and a reference project had a host
// change that field silently and published rewritten numbers before catching it. So the reader
// below decides from the DATA and REFUSES when the data cannot tell the two apart. An ambiguous
// total that looks like a number is worse than no number, because the number is what gets
// quoted.
import { describe, it, expect } from 'vitest';
import { reconcileTurnUsage, collectTurnUsage } from '../../scripts/lib/turn-usage.mjs';

const u = (n) => ({ input_tokens: n, output_tokens: 0 });

describe('turn usage reconciliation', () => {
  it('★★★ a DECREASE proves per-turn, so the values are summed', () => {
    const r = reconcileTurnUsage([u(100), u(40), u(70)]);
    expect(r.basis).toBe('per_turn_sum');
    expect(r.total).toBe(210);
  });

  it('★★★ a GROWING series is ambiguous too — this is the fix the reviewer forced', () => {
    // ⛔ My first version called this cumulative and returned 400. They executed it: a PER-TURN
    // series naturally grows as context grows, so the true total may be 750. My own comment
    // conceded both readings fit and then picked one — the same inference-from-shape I had
    // spent the week removing from everything else, committed inside the fix for it.
    // ⇒ EVERY non-decreasing multi-turn series is ambiguous from values alone, not only a
    // constant one. Only a DECREASE proves anything.
    const r = reconcileTurnUsage([u(100), u(250), u(400)]);
    expect(r.basis).toBe('ambiguous');
    expect(r.total).toBeNull();
  });

  it('★★★ a DECLARED contract resolves it, in either direction', () => {
    // The reading is a property of the HOST, not of the numbers, so an adapter states it.
    const series = [u(100), u(250), u(400)];
    expect(reconcileTurnUsage(series, { semantics: 'per_turn' }).total).toBe(750);
    expect(reconcileTurnUsage(series, { semantics: 'cumulative' }).total).toBe(400);
  });

  it('★★★ a declared contract that the DATA contradicts is refused, not obeyed', () => {
    // A declaration is evidence, not authority. A cumulative counter cannot go down, so if the
    // adapter says cumulative and the series decreases, one of them is wrong and neither total
    // may be published.
    const r = reconcileTurnUsage([u(100), u(40), u(70)], { semantics: 'cumulative' });
    expect(r.basis).toBe('contradiction');
    expect(r.total).toBeNull();
  });

  it('★★★ a constant series is ambiguous — the narrow case I originally caught', () => {
    const r = reconcileTurnUsage([u(100), u(100), u(100)]);
    expect(r.basis).toBe('ambiguous');
    expect(r.total, 'a guessed total is the number that gets quoted').toBeNull();
    expect(r.reason).toMatch(/both fit|usageSemantics/);
  });

  it('★★★ one turn is unambiguous by construction', () => {
    const r = reconcileTurnUsage([u(100)]);
    expect(r.basis).toBe('single_turn');
    expect(r.total).toBe(100);
  });

  it('★★★ no usage is reported as no usage, never as zero', () => {
    // Zero is a measurement. Absence is not, and the difference decides whether an arm looks
    // free or looks unmeasured.
    const r = reconcileTurnUsage([]);
    expect(r.basis).toBe('no_usage');
    expect(r.total).toBeNull();
  });

  it('★★★ the OLD last-turn reading is demonstrably wrong on a per-turn series', () => {
    // The regression this file exists for, stated as a number: the old code would have reported
    // 70 for an arm that actually spent 210 — a 3x under-count, pointing at whichever arm did
    // more work.
    const series = [u(100), u(40), u(70)];
    const oldReading = series[series.length - 1].input_tokens;
    const now = reconcileTurnUsage(series);
    expect(oldReading).toBe(70);
    expect(now.total).toBe(210);
  });
});

describe('turn usage collection', () => {
  const line = (o) => JSON.stringify(o);

  it('★★★ collects every turn in order', () => {
    const got = collectTurnUsage([
      line({ type: 'turn.completed', id: 't1', usage: u(10) }),
      line({ type: 'item.completed' }),
      line({ type: 'turn.completed', id: 't2', usage: u(20) }),
    ]);
    expect(got.usages.map((x) => x.input_tokens)).toEqual([10, 20]);
    expect(got.coverage.completedSeen).toBe(2);
    expect(got.coverage.complete).toBe(true);
  });

  it('★★★ a repeated event id is counted ONCE', () => {
    // A host emitting one event per content block, each carrying the same usage, would inflate
    // the total by however many blocks the turn happened to have.
    const got = collectTurnUsage([
      line({ type: 'turn.completed', id: 't1', usage: u(10) }),
      line({ type: 'turn.completed', id: 't1', usage: u(10) }),
      line({ type: 'turn.completed', id: 't1', usage: u(10) }),
    ]);
    expect(got.usages.length, 'three blocks of one turn is one turn').toBe(1);
  });

  it('★★★ survives malformed lines without losing the good ones', () => {
    const got = collectTurnUsage([
      'not json at all',
      line({ type: 'turn.completed', id: 't1', usage: u(10) }),
      '{"type":"turn.completed" truncated',
      line({ type: 'turn.completed', id: 't2', usage: u(20) }),
    ]);
    // ⛔ AND THE COLLECTOR NOW HAS A DENOMINATOR. It used to skip unparseable lines and
    // usage-less turns silently, so a transcript that lost half its usage produced a confident
    // total over the surviving half — the census-with-no-population defect, inside the collector
    // feeding the reconciler that refuses for exactly that reason.
    expect(got.usages.length).toBe(2);
    expect(got.coverage.parseFailures, 'a dropped line must be counted, not forgotten').toBe(1);
    expect(got.coverage.complete, 'partial coverage cannot report itself as complete').toBe(false);
  });
});

describe('collector coverage', () => {
  const line = (o) => JSON.stringify(o);

  it('★★★ a turn with NO usage is counted as a gap, not skipped', () => {
    const got = collectTurnUsage([
      line({ type: 'turn.completed', id: 't1', usage: { input_tokens: 10, output_tokens: 0 } }),
      line({ type: 'turn.completed', id: 't2' }),
    ]);
    expect(got.coverage.completedSeen).toBe(2);
    expect(got.coverage.usageSeen).toBe(1);
    expect(got.coverage.missingUsage).toBe(1);
    expect(got.coverage.complete).toBe(false);
  });

  it('★★★ events with NO id are counted, not deduped by payload equality', () => {
    // Dropping a repeat by payload equality assumes two turns cannot legitimately report the
    // same usage. They can. Without an id the repeat is COUNTED and the ambiguity reported.
    const same = { input_tokens: 10, output_tokens: 0 };
    const got = collectTurnUsage([
      line({ type: 'turn.completed', usage: same }),
      line({ type: 'turn.completed', usage: same }),
    ]);
    expect(got.usages.length, 'identical usage is not proof of duplication').toBe(2);
    expect(got.coverage.unidentified).toBe(2);
  });
});
