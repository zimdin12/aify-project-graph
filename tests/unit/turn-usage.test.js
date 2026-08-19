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

  it('★★★ a growing series is cumulative, so the LAST value is the total', () => {
    const r = reconcileTurnUsage([u(100), u(250), u(400)]);
    expect(r.basis).toBe('cumulative_last');
    expect(r.total).toBe(400);
  });

  it('★★★ REFUSES when the two readings cannot be told apart', () => {
    // [100,100,100] is a cumulative counter that did not move AND three identical per-turn
    // values. Nothing in the data separates them, so neither total may be published.
    const r = reconcileTurnUsage([u(100), u(100), u(100)]);
    expect(r.basis).toBe('ambiguous');
    expect(r.total, 'a guessed total is the number that gets quoted').toBeNull();
    expect(r.reason).toMatch(/indistinguishable/);
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
    expect(got.map((x) => x.input_tokens)).toEqual([10, 20]);
  });

  it('★★★ a repeated event id is counted ONCE', () => {
    // A host emitting one event per content block, each carrying the same usage, would inflate
    // the total by however many blocks the turn happened to have.
    const got = collectTurnUsage([
      line({ type: 'turn.completed', id: 't1', usage: u(10) }),
      line({ type: 'turn.completed', id: 't1', usage: u(10) }),
      line({ type: 'turn.completed', id: 't1', usage: u(10) }),
    ]);
    expect(got.length, 'three blocks of one turn is one turn').toBe(1);
  });

  it('★★★ survives malformed lines without losing the good ones', () => {
    const got = collectTurnUsage([
      'not json at all',
      line({ type: 'turn.completed', id: 't1', usage: u(10) }),
      '{"type":"turn.completed" truncated',
      line({ type: 'turn.completed', id: 't2', usage: u(20) }),
    ]);
    expect(got.length).toBe(2);
  });
});
