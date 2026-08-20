// ⛔ THE DECISION THE GUARD MAKES, EXECUTED — not read out of its source.
//
// The previous test for this could only assert SOURCE ORDER, because the decision lived inside a
// `main()` that ran at import: importing the module executed the whole 61-entry corpus and exited
// the process. graph-senior-dev's ruling was exact — *"source-order assertions do not prove the CLI
// routes through the predicate; the test itself admits this."*
//
// ⇒ `guardVerdict` takes a context object and returns a verdict object, so every branch that
// decides whether a run may attribute its outputs is reachable from here.
import { describe, it, expect } from 'vitest';
import { guardVerdict, VERDICT, REFUSAL } from '../../../scripts/lib/guard-verdict.mjs';

const CARRIER = { graphSha256: 'aaa', indexedCommit: 'c0ffee', nodes: 100, edges: 200 };

/** One corpus entry. `sha256` is what changes when behaviour changes. */
const entry = (over = {}) => ({
  target: 'estimateTokens', mode: 'plan', outcome: 'ok', sha256: 'h1', bytes: 500,
  volatileLines: 1, volatileShapeOk: true, route: 'feature-body', routeExecuted: true, ...over,
});

// ⛔ THE BASELINE IS PINNED, NOT DERIVED FROM THE INPUT. My first version computed
// `corpusSize: results.length`, so baseline and current could never disagree and the corpus-size
// refusal was UNREACHABLE — an inert route in the fixture, which the branch test caught by
// returning FAIL instead. A fixture that derives the expectation from the input agrees with
// whatever it is given.
const BASELINE_SIZE = 1;
const ctx = (over = {}) => {
  const results = over.results ?? [entry()];
  return {
    baseline: { carrier: { ...CARRIER }, corpusSize: BASELINE_SIZE, results: [entry()] },
    before: { ...CARRIER },
    after: { ...CARRIER },
    routeCount: 1,
    ...over,
    results,
  };
};

describe('guardVerdict — PASS, FAIL and REFUSE are all reachable', () => {
  it('★★★ PASS: settled carrier, identical output, routes reached', () => {
    // ⛔ POSITIVE CONTROL FIRST. Every assertion below expects a non-PASS; if the function returned
    // a refusal unconditionally they would all pass while the guard refused every real slice.
    const d = guardVerdict(ctx());
    expect(d.verdict).toBe(VERDICT.PASS);
  });

  it('★★★ TRUE FAIL: settled carrier, CHANGED output — the outcome never before observed', () => {
    // ⛔⛔ THIS IS THE GAP I NAMED TO THE REVIEWER. Before today the only FAIL this guard had ever
    // emitted was the FALSE accusation against unchanged code. A guard that has never produced a
    // true FAIL has not been shown to detect anything.
    //
    // Carrier identical on every boundary; only the output hash moves. Nothing can be blamed on
    // the graph, so the FAIL is attributable to the code by construction.
    const d = guardVerdict(ctx({ results: [entry({ sha256: 'CHANGED', bytes: 640 })] }));
    expect(d.verdict, 'a real behaviour change with a settled carrier').toBe(VERDICT.FAIL);
    expect(d.detail[0]).toMatch(/output changed \(500 -> 640 stable bytes\)/);
  });

  it('★★★ FAIL is also reached by outcome, volatile-line count and pinned shape', () => {
    // Four distinct ways behaviour can move. Asserting only the hash would leave three branches
    // unexecuted while the test read as covering "behaviour changed".
    expect(guardVerdict(ctx({ results: [entry({ outcome: 'threw', error: 'boom' })] })).verdict).toBe(VERDICT.FAIL);
    expect(guardVerdict(ctx({ results: [entry({ volatileLines: 2 })] })).verdict).toBe(VERDICT.FAIL);
    expect(guardVerdict(ctx({ results: [entry({ volatileShapeOk: false })] })).verdict).toBe(VERDICT.FAIL);
    expect(guardVerdict(ctx({ results: [entry({ target: 'brandNew' })] })).detail[0]).toMatch(/NEW entry absent/);
  });

  it('★★★ REFUSE on mid-run movement, and it is checked BEFORE outputs are compared', () => {
    // ⛔ THE OBSERVED DEFECT. Output changed AND the carrier moved mid-run: the verdict must be
    // REFUSE, never FAIL. Attributing that difference to the code is the false accusation.
    const d = guardVerdict(ctx({
      after: { ...CARRIER, graphSha256: 'bbb' },
      results: [entry({ sha256: 'CHANGED' })],
    }));
    expect(d.verdict, 'a moved carrier outranks a changed output').toBe(VERDICT.REFUSE);
    expect(d.reason).toBe(REFUSAL.CARRIER_MIDRUN);
  });

  it('★★★ REFUSE on baseline drift — the boundary that used to FAIL OPEN', () => {
    // ⛔ graph-senior-dev's executed counterexample: baseline missing `edges`, current carrying
    // `edges: 2`. The old handwritten loop compared `undefined !== undefined` in its first
    // conjunct, never considered the real value, and reported NO drift.
    const d = guardVerdict(ctx({
      baseline: {
        carrier: { graphSha256: 'aaa', indexedCommit: 'c0ffee', nodes: 100 },  // edges ABSENT
        corpusSize: 1, results: [entry()],
      },
    }));
    expect(d.verdict, 'a key absent from the baseline is movement, not agreement').toBe(VERDICT.REFUSE);
    expect(d.reason).toBe(REFUSAL.CARRIER_DRIFT);
    expect(d.detail.join('|')).toMatch(/edges/);
  });

  it('★★★ REFUSE on every carrier field, at BOTH boundaries', () => {
    // Derived rather than listed: a field added to the carrier without being wired into either
    // comparison cannot sit there looking load-bearing.
    for (const key of Object.keys(CARRIER)) {
      const midRun = guardVerdict(ctx({ after: { ...CARRIER, [key]: 'MOVED' } }));
      expect(midRun.reason, `${key} mid-run`).toBe(REFUSAL.CARRIER_MIDRUN);

      const drift = guardVerdict(ctx({
        baseline: { carrier: { ...CARRIER, [key]: 'OTHER' }, corpusSize: 1, results: [entry()] },
      }));
      expect(drift.reason, `${key} baseline drift`).toBe(REFUSAL.CARRIER_DRIFT);
    }
  });

  it('★★★ REFUSE when the corpus population changed', () => {
    const d = guardVerdict(ctx({ results: [entry(), entry({ target: 'second' })] }));
    expect(d.verdict).toBe(VERDICT.REFUSE);
    expect(d.reason).toBe(REFUSAL.CORPUS_SIZE);
  });

  it('★★★ an identical output that never reached the route REFUSES — it does not PASS', () => {
    // ⛔ "55 of 55 unchanged" while no corpus cell executed the moved builder. More inputs is not
    // more coverage, and a clean comparison over code that never ran certifies nothing.
    const d = guardVerdict(ctx({ results: [entry({ routeExecuted: false })] }));
    expect(d.verdict, 'unreached routes must not read as success').toBe(VERDICT.REFUSE);
    expect(d.reason).toBe(REFUSAL.ROUTES_UNREACHED);
  });

  it('★★★ CONTROL: refusal ordering — a run that is wrong in several ways names the FIRST', () => {
    // If drift were reported when the carrier also moved mid-run, the reader would re-baseline and
    // walk straight back into the non-determinism. The order of refusals is itself a contract.
    const d = guardVerdict(ctx({
      baseline: { carrier: { ...CARRIER, nodes: 999 }, corpusSize: 5, results: [] },
      after: { ...CARRIER, graphSha256: 'moved' },
      results: [entry({ sha256: 'CHANGED' })],
    }));
    expect(d.reason, 'mid-run movement outranks drift, size and output').toBe(REFUSAL.CARRIER_MIDRUN);
  });
});
