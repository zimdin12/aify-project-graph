# Tests that fail without a defect behind them

**Started 2026-09-06.** Two of these were being carried in a loop prompt and nowhere else, which is
the same shape as the gate count `n` that lived in prose until it read wrong for two cycles: a fact
that decides behaviour, held only where nothing can contradict it.

## The rule this file exists to enforce

⛔ **A FLAKY TEST IS NOT A PASSING TEST.** Re-running until green is not a fix, and a green run after
a red one proves only that the failure is not deterministic. Every entry below states what was
actually observed, what would close it, and what has NOT been established.

⛔ **DIAGNOSE BEFORE RE-RUNNING.** The first question is whether the tree was quiet — `run-suite`
exits 3 with VOID when it was not, so an exit 1 means the verdict belongs to the commit it names.
The second is whether the failure reproduces in isolation.

---

## 1. `tests/integration/code-intel/live-verbs-real.test.js`

*"references at foo definition surfaces bar.cpp call site"*

| | |
|---|---|
| **Observed** | RED once in a full 499-file run at `09383800` (1 failed of 4063). GREEN 6 of 6 run alone, immediately after. |
| **Run was valid** | Yes. Exit 1, not the integrity guard's exit 3, so the tree held still for the whole run. |
| **Causal path from that commit** | **None.** The commit touched `dashboard/server.js`, `dashboard/static/index.html` and a dashboard test. This file imports `code-intel/live.js`, `backends.js` and `clangd-gate.js` and nothing from the dashboard. The import search was positive-controlled: it finds 8 imports in the file, so the absence of a dashboard import is a measured result. |
| **Mechanism, suspected** | Timing against a REAL language server. Three call sites pass `waitForReadyMs: 15000`, and under a full run clangd competes with the rest of the suite. This repository has already recorded clangd announcing readiness at 2125ms against a 1500ms window. |
| **⛔ NOT established** | That the timeout is the cause. Nobody has instrumented what clangd was doing when it failed. "It passed alone" is a diagnosis, not a cure. |
| **What would close it** | Capture the LSP readiness timestamp on failure and compare it to the wait window. If readiness genuinely arrives late under load, either the window is wrong or the test must not share a run with 498 other files. |

## 2. `tests/integration/m1-caller-sets-do-not-merge.test.js`

| | |
|---|---|
| **Observed** | One red, eight green historically. Passing in recent runs, including the `8d1288b1` pre-commit run. |
| **Mechanism** | **UNKNOWN.** Never reproduced. |
| **⛔ NOT established** | Anything. There is no diagnosis here at all, only a count. |
| **What would close it** | Check whether a reindex is ALIVE during the run when it next fails. That is the standing hypothesis and it has never been tested, because the failure has not returned. |

---

## What a new entry needs

Not "it failed once". An entry is worth having only if it records: whether the run was valid, whether
the failure reproduced in isolation, whether any causal path from the change exists, and what would
actually close it. Anything less is a rumour with a filename.
