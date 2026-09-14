# Results: APG query results added nothing to grep and reading on two real change briefs

Graded 2026-09-14 against the protocol in `PROTOCOL.md` (commits 1467db0e, addendum 166893aa), before
any of this was written. Sealed files re-checked after the runs: every hash in `manifest.sha256` still
matches, both corpora have a clean git status, and the baseline clone has no `.aify-graph`.

## The registered result

**The abandon rule did not fire.** Criterion 2 passed for task A as registered.

- **Criterion 1, an extra correct fact traceable to an APG result:** not met in either task. Three of
  the four APG-route runs never called APG. The fourth made one call, and it returned a wrong zero (below).
- **Criterion 2, at least 25% fewer operations at equal quality:**
  - Task A: **met** (tool calls 21 against 30, 30% fewer; required facts 4/4 in all four runs; no
    forbidden claims).
  - Task B: not met (24.5 against 26, 6%).
- **Forbidden claims from an APG result:** none.

## The investment judgement, separate from the registered result

**Freeze incremental APG integration.** Keep standalone APG where it is, and keep dashboard knowledge
independent of it. This is a funding decision made on top of the registered result, not something the
rule produced. It was corrected on review by graph-senior-dev, who proposed the rule; an earlier wording
of this file presented it as the rule's verdict.

- **Task A's operation difference is unattributed to APG query use.** Neither APG-route run on task A
  called APG, so no APG result produced it.
- **The count of programs chained inside those calls is supplementary, not a replacement endpoint.**
  It differs by 3% (54.5 against 56), which is consistent with the tool-call gap being a difference in
  how runners batched commands. It does not replace the registered measure.
- **Zero APG calls does not rule out an effect of offering APG.** It excludes a mechanism running
  through APG query results. It does not logically exclude an effect of the changed prompt or tool
  list, and these runs cannot identify one either way. A future protocol should separate the benefit of
  the offered bundle from the benefit traceable to query use before measuring. This one did not; that
  hole is mine.
- **This is not a failure of every map job.** No overlay existed, so the curated-knowledge join was not
  tested (see limits below). The grep-and-read success is also no reason to make Graft mandatory.

## What happened

| Run | Tool calls | Programs inside | APG calls | Required facts | Forbidden claims |
|---|---|---|---|---|---|
| A baseline 1 | 30 | 53 | - | 4/4 | 0 |
| A baseline 2 | 30 | 59 | - | 4/4 | 0 |
| A APG 1 | 18 | 52 | 0 | 4/4 | 0 |
| A APG 2 | 24 | 57 | 0 | 4/4 | 0 |
| B baseline 1 | 28 | 69 | - | 5/5 | 0 |
| B baseline 2 | 24 | 57 | - | 5/5 | 0 |
| B APG 1 | 28 | 60 | 0 | 5/5 | 0 |
| B APG 2 | 21 | 49 | 1 | 5/5 | 0 |
| *A APG forced (exploratory)* | 28 | 64 | 4 | 4/4 | 0 |
| *B APG forced (exploratory)* | 23 | 52 | 6 | 5/5 | 0 |

"Tool calls" is the registered measure and excludes ToolSearch. "Programs inside" is a heuristic count
of read/search programs chained inside shell calls (`runs/commands.mjs`); it is reported beside the
registered measure, never instead of it.

**The baseline that matched APG was grep and reading, not Graft.** Across the eight registered runs,
Graft was called zero times and the language server once. Every run found every required fact with
plain rg, sed, git and file reads, inside the budget. This check says nothing in Graft's favour either.

**Every run beat my answer key somewhere.** All of these were checked against source and found correct:

- `defaultSessionHandleForRuntime` (`mcp/stdio/runtimes.js:386-391`) reads session env vars raw into
  `comms_register`. That is a second bypass for task A, and my oracle missed it.
- `isUsableSessionId` accepts `undefined`, so a poisoned hermes marker persists.
- `KNOWN_ISSUES.md` is gated against line-number pointers.
- A spawn's `envVars` may set `CLAUDE_CODE_CHILD_SESSION`, because only the `AIFY_` prefix is refused.

Extras were graded against source, as registered. No brief was marked down for a fact the oracle
lacked.

## The APG results that did arrive

- **`graph_callers terminalChildEnv` answered "NO CALLERS in 1646 indexed files"** in B APG 2 and in
  B forced. Two test files call it at module level
  (`mcp/stdio/tests/terminal-env.test.js`, `every-identity-source-is-neutralised.test.js`).
  - The answer carried a not-exhaustive caveat, and the registered runner checked it with rg.
  - The forced runner cited it as agreeing with rg that there is no production caller. The
    conclusion is right; the evidence is a wrong zero agreeing by accident.
- **Forced runs, [APG]-marked facts:** ten APG calls produced one correct fact absent from both
  baseline runs of its task: `test_api_v2_regressions.py:14169` is unaffected because it tests the
  `${VAR}` regex. That is a low-value "unaffected" entry. Every other [APG] fact also appears in a
  baseline brief.
- **What the forced A runner said APG missed:** `graph_consequences normalize_session_handle` did not
  surface the server sanitizer path, the JS tests, the unnormalised discovery paths, or the hermes test.
- **Warning noise:** each APG answer after my docs-only commits opened with about 2.3 KB of
  stale-server warning, printed twice, while stating that the process was behaviourally current.

## What this cannot support

- n = 2 per registered cell, one repository, two tasks, graded by the author of the oracle. This is a
  smoke test that can change a decision, not an efficacy estimate.
- APG was measured as a code map. aify-comms has no functionality or tasks overlay, so APG's
  curated-knowledge join was not exercised.
- The dominant finding is non-use. On these tasks, a strong model offered APG did not reach for it.
  That is consistent with the earlier reach findings. It does not say what an agent would gain on a
  task where grep is weak, such as C++ overloads, duplicate names, or a repo too large to read.
- One model for every runner.

## Incidental findings in aify-comms (not graded; for its owner)

1. **The environment-stripping fix from 2026-08-25 is no longer on the live managed launch path.**
   - `terminalChildEnv` is the only production user of `NEVER_INHERITED`, and it has had no production
     caller since 779099d7.
   - The service overlay (`service/api_core/launch_env.py`) can only set values, and does not name
     `CLAUDE_CODE_CHILD_SESSION` or `AIFY_COMMS_AGENT_ROLE`.
   - aify-env at 634e5e4 merges `{ ...process.env, ...launch.env }` in
     `lib/plugins/aify-comms/terminal-controls.mjs:366` and never mentions either name.
   - That was read and not run: no live worker was inspected.
   - All six task-B briefs reached the in-repo half independently.
2. **Adding `undefined` to `HANDLE_PLACEHOLDERS` would not close its issue.**
   - The raw paths (claude discovery, `defaultSessionHandleForRuntime`, the hermes explicit handle and
     marker, and the server sanitizer) still accept it.
   - They already accept `none` today. The mutation run shows exactly one existing test failing
     (`test_base.py::test_placeholder_sets`).

## Files

Everything below is copied into this directory from the study dir; the oracle is unsealed here.

- `oracle/task-a.md`, `oracle/task-b.md`
- `briefs/*.md`: the ten final briefs.
- `audits/*.audit.json`: per-run tool counts and outside-corpus checks, all empty.
- `grading-notes.md`
- `commands.tsv`
- `B-apg-r2.graph_callers.txt`: the wrong-zero APG answer.
