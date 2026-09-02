# REFUTED: "the delete-decision verb hangs without a compile DB"

**Date:** 2026-09-02. **Status: my own alarm, not reproduced. No defect filed.**

## The alarm

The default-surface census showed `code_intel_references` returning
`ERROR […]: LSP server exited (code null) before responding`. Investigating, I drove it with correct
`file`/`line`/`col` on a C++ fixture with **no** `compile_commands.json` through a spawned server, and
it did not return in **~18 minutes**, with a live `clangd` process throughout.

That is the verb the product's own text calls *"the only verb whose answer can support a delete or
rename decision"*, so a hang there would matter.

## What ruled itself out, in order

1. **The census row was MY bad arguments.** I passed `{repo, symbol}`; the verb requires
   `file`/`line`/`col`. That ERROR was an argument rejection, not a product failure. Corrected before
   it reached a finding.
2. **The documented wait is not the cause.** `code_intel_live.js` deliberately keeps the readiness
   wait when there is no compile DB — an earlier attempt to skip it *"was rejected by its own
   experiment: without the wait, reference resolution becomes a race (refs=0, refs=0, refs=1 on
   identical bytes)"*. But that wait is **capped at 30 s** and defaults to 0 (`line 643`:
   `Math.min(…, 30000)`), so an 18-minute non-return is not it.
3. **⭐ THE CONTRAST REFUTES THE ALARM.** Calling the verb directly, bounded at 90 s, on a fresh
   fixture with no compile DB:

   | target | returned | time |
   |---|---|---|
   | `src/a.js` (no clangd involved) | yes | **692 ms** |
   | `src/b.cpp` (clangd, no compile DB) | yes | **703 ms** |

   Both answered `status: ok`, `result_state: found`. The C++/no-DB path is **sub-second**.

## Conclusion

**No defect.** The hang did not reproduce, and the one hypothesis that would have explained it (an
unbounded wait on the no-compile-DB path) is contradicted by both the 30 s cap and the 703 ms
measurement.

The most likely explanation is environmental: that run went through a spawned server in a session
where I had been starting and killing `clangd` processes, and stale processes have caused contention
in this project before. I did not isolate it further, and **I am not claiming that explanation** —
only that the alarming reading is not a property of the verb.

## Why this is written down

A refuted alarm is worth recording precisely so the next reader does not re-chase it from the same
census output. What would change this verdict: a reproduction through the **server path**, bounded and
repeated, with the process table captured at the time. That was not done here.

⚠ Cost of the episode: one observation, taken seriously, that turned out to be about my environment.
The check that resolved it was a **contrast** — two targets, one bounded probe — not more waiting.
