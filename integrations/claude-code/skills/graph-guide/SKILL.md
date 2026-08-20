---
name: graph-guide
description: Use when the user asks how to use aify-project-graph well, wants a recommended workflow loop, or wants optional examples for orienting, planning, debugging, reviewing, or rebuilding with the graph. This is a workflow guide, not a required command sequence.
---

# graph-guide

Optional workflow guide for using aify-project-graph well.

Use this when the user wants:
- a recommended graph-first workflow
- examples of when to use briefs vs live verbs
- a repeatable loop for planning / debug / review sessions

These are examples, not mandatory sequences. Adapt to the repo and trust level.

## Default loop

**0. Start with `graph_health()` and read `nextActions` + `refreshMechanism`.**

`refreshMechanism` answers a question the rest of the payload cannot: not "is this
graph stale" but "will it STAY stale". `ok` means git hooks refresh it on every
HEAD move. `unconfigured` means nothing does — the repo was never set up, and the
drift compounds from here. `degraded` means hooks exist but are not demonstrably
working, and `consequence` names why. Two repos ran 20 and 130 commits behind
because refreshing was nobody's job and no field said so.

This is the single highest-value call and it is the one field-testers reach for
unprompted. It answers *"can I trust what I am about to be told"* — compile DB
usable? index behind HEAD? trust spine populated? — and nothing else derives those.

`nextActions` is a ranked list of at most 3 concrete next calls, computed from THIS
repo's measured state, and it is empty on a healthy repo. It exists because a field
tester used 2 verbs out of 15 and never found `graph_packet` on a repo where
orientation was literally his problem: documentation does not pull you toward the
right verb, a suggestion at the moment of use does. Trust problems are ranked above
orientation shortcuts, because a shortcut over an untrustworthy graph is worse than
no shortcut.

Also read the `GENERATED:` line at the top of any brief. Briefs state their own age;
one that says `STALE` describes a previous state of the code.

1. Read the right brief.
- orient: `.aify-graph/brief.agent.md`
- planning: `.aify-graph/brief.plan.md`
- new repo you don't know yet: `graph_tour({steps, focus})` — an ordered walk (entrypoints → named subsystems like Physics/Rendering → hotspots → cross-subsystem flows). Read top-to-bottom, then drill with `graph_packet`. `focus` narrows to one subsystem. **Callable by name only where the host allows unlisted tools — in a managed session it may not resolve. If a tool-search finds nothing, use `graph_packet({mode:"orient"})` instead of retrying.**

2. Check map quality quickly.
- use `graph_health()`
- pay attention to:
  - `TRUST`
  - `OVERLAY` / `OVERLAY GAPS`
  - `DIRTY` / `DIRTY SEAMS`

3. Pick one live verb by question shape.
- one-shot context: `graph_packet(target="...", mode="orient|plan|debug|review|audit")`
- locate a symbol by name: `graph_search(query="...")` (default `mode="lexical"`)
- locate code by MEANING when you don't know the name: `graph_search(query="...", mode="semantic")` — opt-in embeddings; degrades to lexical + a hint if no sidecar
- narrow cross-layer context: `graph_pull(node="...")`
- change plan: `graph_change_plan(symbol="...")`
- broad blast radius: `graph_consequences(target="...")`
- execution trace: `graph_path(symbol="...")`

4. Read source as proof.
- use the graph to narrow the read set
- use files / diff as truth

## Verb choice by trust

### TRUST weak

Prefer:
- briefs
- `graph_pull`
- `graph_change_plan`
- source / grep / diff

Treat as advisory:
- `graph_consequences`

### TRUST ok or strong

Use the full live layer more aggressively.
- `graph_pull`
- `graph_consequences`
- `graph_path`
- `graph_impact`

Still verify code before changing it.

### Heuristic vs compiler-backed — do not mix them up

`graph_callers` / `graph_callees` read the STORED graph, extracted by tree-sitter.
They **undercount C++ virtual and cross-TU dispatch** — on one measured project
`graph_callers` found half the calling files. Use them as a **lead**, never as
evidence of completeness. Their `file:line` is the **caller function's declaration**,
not the call site (edges are function-granular), so do not read it as a callsite
number.

For a delete/rename decision use `code_intel_references` and gate on
`evidence.exhaustive === true`. Where a code-intel collection has verified an edge,
the stored verbs render it as `[lsp✓]` — that marker is the difference.

## Reading an answer's evidence

Three fields decide how much a result is worth. None of them are optional reading.

**1. `evidence.exhaustive` — the only field that licenses an absence claim.**
On `code_intel_references` / `code_intel_hierarchy`, only `exhaustive: true` supports
"no callers / safe to delete". `degraded: true` with a `cause` means *the index could
not answer* — a statement about the index, never about the code. On a cold session
pass `waitForReadyMs` (e.g. `25000`): a cold call can return the **right** answer with
`exhaustive: false`, which is correct but not actionable.

**2. `field_provenance` on `graph_consequences` — observed vs inferred.**
Every field is labelled. `observed` comes from graph structure (callers, importers,
`documents_mentioning`). `inferred` comes from the curated feature/task overlay and is
exactly as fresh as `overlay_age_days` says. **An absent INFERRED entry is not evidence
of absence.** Derived fields (`risk_flags`) inherit the weakest provenance of their
inputs.

**3. `graph_health.refsNotFoundBreakdown` — before reading a "not found" count as dead code.**
It reports `{total, degraded, clean}`. Only `clean` is an observed absence; `degraded`
means the index could not answer. On one measured C++ project every not-found result
was degraded and none were true absences — check your own repo rather than assuming
either way.

## Handing a claim to another agent — receipts

`graph_pull` and `graph_consequences` return a portable `receipt`: the claim plus its
**invalidation conditions** (repo / indexed / server commit, compile-DB hash, overlay
content hash, worktree state), a `claims_digest`, and a named cheapest disconfirming
test.

- To check a teammate's claim, **replay** `receipt.replay.verb` with
  `receipt.replay.args` — do not read the stored values.
- If any pinned input drifted it **refuses to validate**. That is the point: serving
  the old answer would make it a cache.
- Pins match but `claims_digest` differs → **the difference is the finding**, and is
  worth more than the original claim.
- The head is the default; pass `receipt: "full"` only when you need per-claim
  provenance (roughly doubles the response).

## Overlay target forms

For overlay-native targets, prefer explicit node forms:

```text
graph_pull(node="feature:terrain-generation")
graph_pull(node="feature/terrain-generation")
graph_pull(node="task:CU-123")
graph_pull(node="task/CU-123")
```

Raw ids still work when unambiguous, but explicit forms are clearer.

## Ignore files

Do not blur these together:

- `.gitignore`
  - add `.aify-graph/` here so derived graph state is not committed
- `.aifyignore`
  - add extra dirs or path/glob patterns here when local scratch/build trees should be excluded from indexing
  - examples: `build-linux-techlead`, `scratch`, `tmp-local`, `generated/**`, `*.tmp.cpp`
- `.aifyinclude`
  - use this to opt a default-ignored dir back in when it really contains source
  - examples: `build`, `vendor`

If a rebuild gets polluted by local build output, the fix is usually `.aifyignore`, not a graph verb.

## Optional workflow examples

### New session

Use when you just opened a repo:
1. read `brief.agent.md`
2. call `graph_health()`
3. if the map is thin, stop expecting dominance from live verbs

### Planning a change

1. read `brief.plan.md`
2. if target is feature/task scoped, start with `graph_packet(..., mode="plan")`
3. if target is file/symbol scoped, start with `graph_pull`
4. if you need a code-edit sequence, call `graph_change_plan`
5. read the 1-3 files it points to

### Debugging a dirty seam

1. read `brief.agent.md` or `brief.plan.md`
2. check `DIRTY SEAMS`
3. if the target overlaps a dirty seam, trust current source + diff over cached structure
4. use `graph_packet(..., mode="debug")` or `graph_pull` for nearby features/tasks/docs, not as proof

### Reviewing or auditing

1. read the relevant brief
2. use `graph_packet(..., mode="review")` for PR/change review context or `mode="audit"` for contract/test/task-link checks
3. verify every cited file and line in source
4. for audit-shaped tasks, do targeted Grep + Read passes; the graph narrows context but does not enumerate every line-level hit

### Rebuild / refresh

1. if the graph is stale or incomplete, run `graph_index(force=true)`
2. regenerate briefs
3. if local build/scratch dirs or generated files polluted the graph, add them to `.aifyignore`
4. only then compare graph-vs-source quality

Freshness self-heal: `graph_index` is in the default tool surface now, so a worker can refresh its own graph. A read verb's **"graph stale"** warning means run `graph_index()` (or set `APG_AUTO_REINDEX=1` to auto-refresh on stale reads); line numbers may have drifted until you do. A stale **"not found"** is not proof a symbol is gone — re-index before concluding it was deleted.

### Map enrichment

If the graph feels thin, improve the overlay before blaming the engine:
- add `tests[]`
- add `anchors.docs`
- add `depends_on`
- add `related_to`
- tighten broad task links with better `evidence` and `link_strength`

### Optional compiler-backed code-intel import

The graph's tree-sitter edges are heuristic. To upgrade them to compiler-verified
(`LSP_VERIFIED` / `[lsp✓]`) edges, run `graph_collect_code_intel` — it now drives a
real language server for **C++ (clangd), TypeScript/JavaScript (typescript-language-server),
and Python (pyright)**, auto-selected by file extension / repo markers. The servers are
bundled with the plugin (no host LSP setup). Honesty: C++ gated on compile-DB coverage; TS
exhaustive only when the file is inside its nearest tsconfig project (not just present at the root); Python is never provably exhaustive (dynamic dispatch) → a
verified floor, not "safe to delete".

Legacy C++-only manual path (when a C++ repo has `compile_commands.json` and you want the raw scripts):

```bash
node <AIFY_GRAPH_CLONE>/tools/code-intel/cpp-clangd/extract.mjs <TARGET_REPO>
node <AIFY_GRAPH_CLONE>/scripts/import-code-intel.mjs <TARGET_REPO> <TARGET_REPO>/.aify-graph/code-intel/cpp-clangd.jsonl
node <AIFY_GRAPH_CLONE>/scripts/graph-brief.mjs <TARGET_REPO>
```

Imported edges show `prov=CODE_INTEL`. They improve routing precision but still need source verification before edits.

## Do not

- do not call many live verbs “because graph exists”
- do not treat `graph_consequences` as proof under `TRUST weak`
- do not skip brief regeneration after changing `functionality.json` or `tasks.json`
- do not expect bounded grep-style tasks to show the biggest graph win
