# Does APG add anything to a Graft + grep + language-server baseline on real change work?

Pre-registered 2026-09-14, before any route ran. Written so a result cannot be fitted to it afterwards.

## Why this exists

Steven asked for a realistic reassessment of APG (2026-09-14) and approved graph-senior-dev's cheapest
check that could change the decision: two real upcoming changes, outside the APG corpus, with the same
knowledge given to both routes. He approved running Graft locally and freezing APG engine growth while
it runs. He did NOT approve passing dashboard recommendations to dashboard-manager; that is untouched.

**Engine freeze.** No APG source change lands until this check is graded and reported. The MCP server
answering the APG route is the one serving HEAD a74a2488.

## Corpus

aify-comms @ 7678acf35964b8149e686f0d06431da074785303, two separate clones (origin removed) under
`C:/Users/Administrator/projects/apg-baseline-check-20260914/corpora/{baseline,apg}/aify-comms`, so an
APG index cannot leak into the baseline. APG indexed the `apg` clone only (forced: 21216 nodes,
92831 edges; graph_health trust weak, no code-intel collection, no overlay). Graft @3a85a2f4 (the
source build from the 2026-09-10 study) built an external graph for each clone
(15841 nodes, 41547 edges, 1679 files each).

## The two tasks (verbatim prompts in the study dir, hashed below)

- **A.** KNOWN_ISSUES.md "`undefined` is not a placeholder session handle": a developer proposes adding
  `undefined` to the handle placeholder set. Brief: what must change together, which tests fail / need
  updating / are unaffected, whether it closes the symptom, recorded constraints. Needs cross-file,
  cross-language identity.
- **B.** KNOWN_ISSUES.md "Managed spawns inherit whatever launched the bridge": a developer is about to
  add a stated list of what a worker may inherit. Brief: where worker env is composed now, what strips
  inherited variables and where it runs, recorded constraints, pinning tests, can this repo alone close
  it. Needs a governing decision plus tests.

## Routes

Both get the same preamble, the same 40-operation search/read budget, the same corpus contents, and:
shell (rg, git, sed), Read/Grep/Glob, Graft (ask, callers, grep, skeleton, map), and a language-server
CLI (`lsp.mjs`: pyright and typescript-language-server; controls: JS references to
`normalizeSessionHandle` 3 without `--open`, 10 with importers opened, 0 for a made-up symbol; Python
references to `HANDLE_PLACEHOLDERS` 10, made-up symbol 0).

- **(i) baseline**: the above, and an explicit instruction not to use APG tools.
- **(ii) APG**: the above plus the APG MCP verbs with `repo=` the apg clone.

Runners are fresh general-purpose subagents (same model), given the rendered prompt only. They are told
to stay inside the corpus. **Two runs per cell** (A-i, A-ii, B-i, B-ii), four at a time.

## Oracle

Built by me before any run: exhaustive rg, reading, git history, a mutation run in a scratch clone
(Task A: which tests fail when the set is widened on one side and on both) and probes (Task A: which
paths still accept `undefined`; Task B: what the service launch overlay contains and what the old JS
path stripped). Each oracle lists REQUIRED facts, CREDIT facts and FORBIDDEN claims. Sealed until
grading; hashes:

```
a0471e58911d29a5f6117ff9cae107de5c531cafef6f0766de8a0c473ee6fbc0  tasks/rendered/a-apg.txt
86164408b65bab5fecd91a42d48d2b07988fb30eaa65f9d333f51c8604907a1a  tasks/rendered/a-baseline.txt
3c325c4ccfef06c1f367a7c8d6fa485e73fdc45b3945ef516e6df3d73eeac1a4  tasks/rendered/b-apg.txt
1526feb15894e8e55c67a3b7234e5a166e4fb6a893523897f1fca42dd5b5bdf2  tasks/rendered/b-baseline.txt
2322bfc6f3a7c1826aeee30bcf675b3ab578de081da265c5b2e0d246e89aa5fe  oracle/task-a.md
6d690933fffcc77de5540e81830adc13c6e2cb209bec4f02e9e8b088942f0fd2  oracle/task-b.md
5b1d566362fee8e77b6d75d97d01c2b8bd47fe796d07ad9673342b5f935b69b1  lsp.mjs
905ed8f402d859dd48faf51a34f6f8a8c09837b80e67037148580f740b3df1ab  graft.sh
```

## Scoring

Per brief: required facts hit (stated AND cited to a location that supports it), credit facts hit,
forbidden claims made, and every other substantive claim checked against source as a correct or wrong
extra. Operations are counted from the runner's transcript (tool calls that search or read), not from
its self-reported `OPS:` line. For each APG-route fact that the baseline runs lack, the transcript is
checked for whether an APG tool result supplied it or grep/Graft/LSP did.

## Decision rule (graph-senior-dev's, fixed here before the result)

**Abandon incremental APG integration** if neither task shows either of:

1. **An additional correct actionable fact**: in at least one APG run, absent from both baseline runs
   of that task, and traceable in the transcript to an APG tool result; or
2. **An avoided necessary search/read at equal evidence quality**: APG-route mean operations at least
   25% below baseline mean, with required-fact hits at least equal in BOTH runs and no more forbidden
   claims.

**Any forbidden claim traceable to an APG tool result fails the APG route for that task**, whatever else
it gained. A warning or caveat an APG tool prints does not count as a gain. If the baseline suffices:
freeze standalone APG, and keep dashboard knowledge independent of it. A positive result licenses only
the integration it demonstrated, never engine expansion.

## What this cannot support, recorded before the result

- n = 2 per cell, one repository, two tasks, graded by the person who built the oracle. A smoke test
  that can change a decision, not an efficacy estimate.
- One model for both routes. The runners know they are in a study only through the budget and rules.
- The corpus has no APG overlay (no functionality.json / tasks.json), so APG's contract/task join is not
  exercised. This measures APG as a code map, not as a curated-knowledge carrier.
- Task B's outside-the-corpus context (aify-env's launch merge) is not graded; the routes are told not
  to leave the corpus.
