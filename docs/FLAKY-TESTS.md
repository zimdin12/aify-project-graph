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
| **Observed** | One red, eight green historically, then RED again at `335306d8` (2026-09-20, 2 failed of 4138: both caller sets came back EMPTY). GREEN 5 of 5 run alone immediately after. |
| **Mechanism** | **A reindex WAS alive during the run this time.** The standing hypothesis below was finally testable, and the timestamps meet it: the commit landed 00:34:25 +0300 (21:34:25Z), its post-commit hook reindexed for 15.5s (`.aify-graph/hook.log`, 21:35:21.574Z entry, so it ran to ~21:35:37Z), and the suite started 00:35:12 local (21:35:12Z). The reindex and the suite's first ~25 seconds overlap. |
| **⛔ NOT established** | That the overlap CAUSED it. The test indexes its own temp repo, and apg's write lock is per repository, so no lock is shared; the plausible path is CPU contention during this test's own `graphIndex`, and nobody has instrumented that. One overlap observed once is a correlation. |
| **What would close it** | Run the suite twice with a reindex deliberately running alongside, and twice without, and compare. If the failure only appears under an overlapping reindex, either the suite runner must refuse to start while one is alive, or this test must not index under load. |

## 3. `tests/integration/code-intel/scoped-collect-survives-real.test.js`

*"a one-file scoped collect does NOT wipe the repo-wide trust spine"*

⚠ **This entry is weaker than the two above and says so.** It reproduced, but never on a quiet machine,
so it is not yet established as a flake OR as a defect. It is filed to stop the observation living only
in a session.

| | |
|---|---|
| **Observed** | RED in a full 514-file run at `877943ca` (2026-09-25), `afterScoped` 2 against `afterFull` 1. RED again run alone immediately after, but at a DIFFERENT assertion in the same test: the non-vacuity guard, `expected 1 to be greater than 1`. Both runs agree on the underlying number: **the full collect produced 1 verified edge.** |
| **Run was valid** | Yes. Exit 1, not the integrity guard's exit 3, so the tree held still and the verdict belongs to the commit it names. |
| **Causal path from that commit** | **None, and this one is measured rather than argued.** `git diff 4597755c..HEAD` — from the last commit whose suite was GREEN to the RED tip — is four markdown files, the suite log, and one new script. The script is imported by nothing: a search for it finds only the two evidence files that name it, and the same search shape finds 16 real importers of `ingest/resolver.js` as its positive control. **The code under test is byte-identical to the commit that ran green four hours earlier.** |
| **⛔ NOT established, and this is the important row** | That it is load. **No quiet-machine run has been observed.** During both runs the host carried ~154 `node` processes from other agents' sessions (65 aify, 82 unclassified, 7 apg, zero vitest — so not leftover workers of mine). The full suite took **2147s against 758s for byte-identical code earlier the same day, 2.8×**, which is evidence of contention and not of a cause. |
| **⛔ Also not established** | That it is a defect. The failing quantity is how much a REAL clangd collected, and a short collect under contention is indistinguishable here from a collect that is wrong. |
| **What would close it** | Run it alone when the host is quiet — no other agent sessions — and read the verified-edge count from the FULL collect, which is the number both failures turn on. If a quiet full collect still yields 1, the test's premise or the collect is wrong and this is a defect, not a flake. If it yields more, the entry becomes the same load story as entries 1 and 2 and the fix is the same question: these real-language-server tests may not belong in a shared run. |

---

## What a new entry needs

Not "it failed once". An entry is worth having only if it records: whether the run was valid, whether
the failure reproduced in isolation, whether any causal path from the change exists, and what would
actually close it. Anything less is a rumour with a filename.
