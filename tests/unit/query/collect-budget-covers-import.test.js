// THE BUDGET IS FOR THE VERB, NOT FOR ONE PHASE OF IT.
//
// `budgetMs` was threaded to runCollection only. The IMPORT that follows is
// unbounded and O(records) — on a 1.35M-record collection it dominates the wall
// clock. The observable failure: the collect phase honestly reported
// `budgetExhausted: false` while the verb ran for half an hour, and the summary had
// no field attributing the time to a phase. Sand Castle's full collect blew an
// 1800s host abort with the collect phase reporting itself well inside budget —
// a green signal over an operation that did not fit, which is the same shape of
// lie the exhaustiveness work removed.
import { describe, it, expect } from 'vitest';
import { splitCollectBudget } from '../../../mcp/stdio/query/verbs/collect_code_intel.js';

describe('splitCollectBudget', () => {
  it('holds back a share of the budget for the import', () => {
    const { collectBudgetMs, importReserveMs } = splitCollectBudget(100_000);
    expect(collectBudgetMs).toBe(65_000);
    expect(importReserveMs).toBe(35_000);
    // The whole budget is accounted for — no silently unbudgeted remainder.
    expect(collectBudgetMs + importReserveMs).toBe(100_000);
  });

  it('does not starve the collect phase on a tiny budget', () => {
    // Below the floor, splitting produces two useless halves: not enough to warm
    // clangd AND not enough to import. Spend it all on the collect and let the
    // overrun be REPORTED rather than engineered into a guaranteed failure.
    const { collectBudgetMs, importReserveMs } = splitCollectBudget(6000);
    expect(collectBudgetMs).toBe(6000);
    expect(importReserveMs).toBe(0);
  });

  it('passes through no budget as no budget (provider default applies)', () => {
    for (const v of [undefined, null, 0, -1, NaN, 'abc']) {
      expect(splitCollectBudget(v)).toEqual({ collectBudgetMs: null, importReserveMs: 0 });
    }
  });

  it('the floor boundary keeps the split once the collect share clears it', () => {
    // 5000 / 0.65 ≈ 7693 — just above the boundary the split must engage.
    const { collectBudgetMs, importReserveMs } = splitCollectBudget(7700);
    expect(collectBudgetMs).toBeGreaterThanOrEqual(5000);
    expect(importReserveMs).toBeGreaterThan(0);
  });
});
