# A 9,000 ms collect budget gives the clangd index wait 2,450 ms

**Date:** 2026-08-30
**Status:** cause attributed, no fix applied — the test and the reserves are a separate lane
**Trigger:** `tests/integration/code-intel/scoped-collect-survives-real.test.js` went red on the
full suite while an unrelated attestation change was in flight.

## What failed

    Test Files  1 failed | 390 passed (391)

    × collect resume actually resumes (real clangd)
        > a budget-limited scope=all run CONTINUES on re-run instead of repeating
    × resumed slices do not claim repo-wide authority
        > a resumed call scopes its authority to the files it walked

Both assert `expected 0 to be greater than 0` — the first collect walked no files, so there was
nothing to resume from and no verified edge to preserve. Both use `budgetMs: 9000`.

## It is not the change that was in flight

`storage/unresolved-refs.js` has **zero production importers** (`grep` across `mcp/` and
`scripts/`: only `scripts/attest-frozen-carrier.mjs` and its own test). The failing file references
neither it nor `publication-schema.js`. Running the failing file in isolation loads none of the
in-flight work and still fails, 2 of 2.

## The chain, measured

`APG_VERBOSE_CODE_INTEL=1` on a standalone reproduction of the test's own fixture:

    index readiness: ready=false waitMs=2500 reason=index_wait_timeout   → 0 files, status partial
    index readiness: ready=false waitMs=2645 reason=index_wait_timeout   → 0 files, status partial
    index readiness: ready=true  waitMs=2422 reason=index_drained        → 3 files, 4 verified edges

The index drains in **~2.2–2.6 s**. The wait is capped at **~2.45 s**. It is a coin flip, and the
same fixture lands on both sides within one process.

### It is a load-dependent race, not a deterministic failure

I first described this to the reviewer as *deterministic* on the strength of 2-of-2 isolated
reproductions plus 3-of-3 in a probe loop, and he reasoned from that word. A later full-suite run on
the same tree **passed all six tests in the file**:

    ✓ a budget-limited scope=all run CONTINUES on re-run      11963 ms   (2999 ms when failing)
    ✓ a resumed call scopes its authority to the files it walked  9247 ms   (3175 ms when failing)

Same commit, opposite outcome, and the passing runs take 3–4× longer because the index actually
drained. The correct term is **load-dependent race**. This does not weaken the model above — it is
what a sub-100 ms margin predicts, and a deterministic failure would have been harder to square with
the arithmetic than this is.

The same run surfaced a second instance of the class: `incremental-equals-rebuild.test.js` timed out
at 30 s under suite contention and passes in **2.1 s** in isolation. Two load-sensitive tests, and
*which one* fails varies by run — that variation is itself the signature.

Where the cap comes from — two independent reserves that compound, neither aware of the other:

| Step | Constant | Left for the next step |
|---|---|---|
| caller asks | `budgetMs: 9000` | 9,000 |
| import reserve, `collect_code_intel.js:158` | `IMPORT_BUDGET_SHARE = 0.35` | 5,850 |
| clangd setup before the wait | measured | ~5,450 |
| tail reserve, `cpp-clangd.js:36` | `BUDGET_TAIL_RESERVE_MS = 3000` | **~2,450** |

`indexWaitBudget = min(resolveIndexWaitMs() /* 90,000 */, remaining − 3,000)`, so the 90 s default
never binds: the budget path always wins, and **73% of the requested budget is withheld before the
index wait begins**. Predicted cap ~2,450 ms against measured timeouts at 2,500 and 2,645 ms.

## Classification

Reviewer offered four candidates. It is the first, with a mechanism:

1. **✅ Typed zero-progress because warm-up consumed the budget.** Confirmed by the arithmetic above.
2. ❌ *Budget propagation defect.* The reduction is deliberate and documented at
   `collect_code_intel.js:142-160` — a collect that reported `budgetExhausted: false` while the
   unbounded import ran for half an hour. The reserve is a fix for a real prior defect.
3. ❌ *clangd startup failure.* clangd works: the same fixture reaches `index_drained` and produces
   verified edges in the same process.
4. ❌ *Progress reported while the ledger stays empty.* The ledger honestly records `collected: []`
   and `filesProcessed: 0`.

The two failing tests share one first-call precondition, so they are **one cause, not two
corroborating observations**.

### A wrong turn worth recording

I suspected `index_wait_timeout` was a catch-all label — that `waitForReady` could resolve early
non-fresh and still be reported as a timeout, which would have made the envelope name a cause that
never happened. It does not: `_resolveReadyWaiters` (`lsp-client.js:580`) resolves waiters **only**
when freshness is `fresh`, so the timer is the sole non-fresh path. The timeout is real. Recorded
because the arithmetic, not the hypothesis, is what settled it.

## What the test assumes and cannot see

`scoped-collect-survives-real.test.js:209` states the premise directly:

> A budget small enough to stop partway through 3 TUs, but not so small the index wait eats it
> entirely.

The premise is about a quantity the test never controls. `budgetMs` does not size the index wait;
after two reserves it sizes it to ~27% of itself, and the margin against this machine's drain time
is under 100 ms. The test passed on faster hardware and on a warmer index cache, which is why it
was green earlier the same day.

Raising `budgetMs` would paper over it: at 9,000 the wait is 2,450, at 40,000 it is 23,000 — the
number that has to be reasoned about is never the one written in the test.

## Not fixed here, deliberately

Both plausible repairs — raising the test budget, or making the index wait a declared precondition
rather than a residue of two reserves — change a production or test budget that other callers share.
That is its own lane with its own blast radius. This document exists so the next person to see the
red does not re-derive it, and does not reach for the budget knob first.

Reproduction: three C++ TUs, a `compile_commands.json`, one `graphCollectCodeIntel` call with
`scope: 'all'` and an explicit `budgetMs`, run with `APG_VERBOSE_CODE_INTEL=1`.
