// The live-lookup budget must come from configuration, and must fail CLOSED on a bad value.
//
// ⛔ WHY. A hard-wired 2000ms made the SUITE'S OWN VERDICT depend on machine load. Measured on one
// unchanged tree in a single session: the full suite ran 680s / 2120s / 2693s with 0 / 2 / 10
// failures — failures scaling with duration, every one of them budget-shaped. The bounded call is a
// symbol→feature lookup whose own measured cost is 601ms on a 3958-node repo and 4316ms on a
// 12126-node one (packet.js), so on a busy machine it crosses 2000ms, packet takes its timeout
// branch, and any test asserting on CONTENT fails.
//
// That is worse than a slow test. "Full suite green before push" is the gate this project leans on,
// and a load-dependent verdict makes a real regression indistinguishable from contention — three
// separate investigations in one session ended in "it was load", which is exactly the
// signal-destroying outcome the gate exists to prevent.
//
// ⚠ Raising the budget is NOT a fix for a slow lookup. It is a fix for a harness whose verdict must
// not depend on how busy the machine is. The DEFAULT IS UNCHANGED, so product behaviour is identical.
//
// ⚠ TESTED AS A PURE FUNCTION. A first version re-imported the module with a cache-busting query
// string to vary the env; the bundler rejects a variable dynamic import outright. Inputs in, value
// out is both testable and the shape the architecture rules ask for.
import { describe, it, expect } from 'vitest';
import { resolveLiveBudget, DEFAULT_LIVE_BUDGET_MS, LIVE_BUDGET_MS } from '../../../mcp/stdio/query/verbs/packet-live.js';

describe('the live lookup budget is configuration, not a constant', () => {
  it('POSITIVE CONTROL: an unset value keeps the shipped default', () => {
    // Without this, every fallback assertion below would pass on a function that always returned
    // the default regardless of input.
    expect(resolveLiveBudget(undefined)).toBe(2000);
    expect(DEFAULT_LIVE_BUDGET_MS, 'product behaviour must be unchanged').toBe(2000);
  });

  it('★ a numeric environment value is honoured', () => {
    expect(resolveLiveBudget('9000')).toBe(9000);
    expect(resolveLiveBudget(9000)).toBe(9000);
  });

  it('⛔ a non-numeric value falls back to the default, never to "no budget"', () => {
    // An unbounded lookup is the defect the budget exists to prevent; a typo must not create one.
    for (const bad of ['soon', '', 'NaN', '12ms']) {
      expect(resolveLiveBudget(bad), `${JSON.stringify(bad)} must not become the budget`).toBe(2000);
    }
  });

  it('⛔ zero and negative fall back too — a 0ms budget would time out instantly', () => {
    for (const bad of ['0', '-1', -5]) {
      expect(resolveLiveBudget(bad), `${bad} must not become the budget`).toBe(2000);
    }
  });

  it('the exported constant is derived from the resolver, not a second copy', () => {
    // A parallel implementation would let the constant and the tested function drift apart, which
    // is the defect this repo has already recorded for trust banners.
    expect(LIVE_BUDGET_MS).toBe(resolveLiveBudget(process.env.APG_LIVE_BUDGET_MS));
  });
});
