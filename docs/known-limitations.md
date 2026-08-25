# Known limitations

The current graph has genuine architectural limits worth stating up front
so agents can choose the right tool and consumers can plan around them.
These are NOT regressions — they're baseline constraints that future work
may relax.

## `graph_callers` is function-granular, not line-granular

`graph_callers(symbol="X")` returns one edge per calling function. If
function `foo()` calls `X` three times on three different lines, you get
one edge from `foo`, not three.

**Why.** Edges are keyed on `(from_id, to_id, relation)` and the `from_id`
is the enclosing function's node id. Keeping per-line positions on edges
would require a schema change (`edges.positions: [{line, col}, ...]`)
and materially larger indexes.

**Impact.** For questions where "which line" matters — contract audits,
per-callsite bug hunts, reviewing every usage in a hot function — Grep
wins by schema. The graph collapses those sites.

**Workaround.** Use `graph_callers` to find the *set of functions* that
reach the symbol, then Grep within each for the specific lines.
Measured on the 2026-04-22 echoes bench: mixed-mode (graph for the set,
Grep for lines) produced the best results on this class of question.

## Brief TRUST can drift from live `graph_health` between regens

`brief.json` captures the manifest's `dirtyEdgeCount` at the moment briefs were generated. `graph_health()` reads the same field live. If a reindex happens between brief regen and the health call, both surfaces use the same threshold function but different input counts — they'll disagree on the TRUST label ("weak" in brief vs "strong" in health or vice versa).

**Why.** Briefs are file-backed snapshots; the verb is live. Not a threshold bug, not a bug in either reader — a cache-vs-live mismatch by design.

**Impact.** Agents reading both surfaces in the same session may see contradictory TRUST verdicts.

**Workaround.** As of 2026-04-22 `graph_health` checks `brief.json.graph_indexed_at` against `manifest.indexedAt` and adds `brief-stale: regenerate with graph-brief.mjs` to its summary string + a `briefStaleVsManifest: true` structured field when they diverge. Run `node scripts/graph-brief.mjs <repo>` to bring the brief back in sync.

## Incremental indexing: residual drift from `graph_index(force=true)`

Fixed 2026-04-21 (commit f3ebee1): the main source of
incremental-vs-force divergence was a 500-row cap on
`manifest.dirtyEdges` that silently dropped unresolved edges past row
500 each run. A full sidecar (`.aify-graph/dirty-edges.full.json`) now
carries the complete unresolved list forward. Incremental should
converge with force for that mechanism.

Residual drift possible in theory — incremental resolution sees only
the currently-extracted files, so cross-file refs the full pass would
have resolved may stay dirty until a global pass re-sees them — but
no longer compounds via state loss.

**Workaround (still).** Run `graph_index(force=true)` after large
refactors or long-running incremental sessions if unresolved counts
look stale.

## Keeping the graph fresh on a high-commit-velocity repo

On a fast-moving repo the graph drifts behind HEAD between reindexes. A
stale index doesn't lie — every read verb prefixes a `graph snapshot is
stale (N commits behind HEAD) — run graph_index()…` warning, and a stale
`not found` is flagged as non-authoritative — but load-bearing questions
(caller enumeration before a signature change, blast radius before an
edit) want a fresh index. Three tiers, cheapest first:

1. **Auto-refresh on read (`APG_AUTO_REINDEX=1`).** Set this env var and
   the MCP self-heals a behind-HEAD graph with an *incremental* refresh
   before each read verb. Incremental is fast — a few seconds even for
   a couple hundred changed files. Cost: that latency is paid on the
   first read after commits land, and a full rebuild (schema/extractor
   bump) still drops `[lsp✓]` edges (see below). Best default for
   managed workers who can't call `graph_index` themselves.
2. **Proactive git hooks (the supported installer).** For teams that would
   rather pay refresh cost when HEAD moves than at read time, install the
   backgrounded reindex hooks:

   ```sh
   node /abs/path/to/aify-project-graph/scripts/install-graph-hook.mjs /abs/path/to/target-repo
   ```

   It writes an idempotent, aify-delimited block into **all four** of the
   target repo's HEAD-moving hooks — `post-commit`, `post-merge`,
   `post-checkout`, `post-rewrite` — preserving any existing hook content.
   Each runs `scripts/reindex.mjs` backgrounded (graph + briefs +
   unresolved categorization), so git operations stay instant and the next
   read sees a fresh graph. `post-commit` alone would miss pulls, branch
   switches and rebases. Re-running replaces the block rather than
   duplicating it. Hooks are per-clone: `git clone` does not carry them.
   Check `graph_health` → `refreshMechanism.state` to see whether the
   mechanism is actually running.
3. **Manual.** `graph_index()` on demand — fine for low-velocity repos
   or when you want explicit control.

After any FULL rebuild (force, or a schema/extractor bump — not
incremental), re-run `graph_collect_code_intel` to restore `[lsp✓]`
edges (see "LSP-verified edges do not survive a full re-index").

## Unresolved count can jump after a schema bump

After a schema-version bump that forces a full rebuild, `unresolvedEdges`
may appear to spike sharply. Example from the v3→v4 transition on apg:
`5424 → 10336`.

**Why.** This is not necessarily a new regression in extraction. The v4
sidecar fix (`f3ebee1`) stopped leaking unresolved state through the old
500-row manifest cap, so post-bump rebuilds can expose the honest full
count that earlier runs under-reported.

**Impact.** A one-time count jump after upgrade looks scary if you read it
as "quality got worse." Often it just means the count is finally truthful.

**Workaround.** Treat the first post-bump rebuild as a visibility reset, not
as comparative trend data. Compare subsequent runs on the same schema.

## `.aify-graph/` is per-WORKING-DIRECTORY, not per-agent

A recurring misconception on multi-agent teams: *"`.aify-graph/` is gitignored,
so it's per-machine — every agent needs to build their own index."* That is not
how it works, and believing it blocks people needlessly.

The index lives in the repo directory. **Every agent pointed at the same working
directory shares the same index** — if one teammate runs `graph_index`, all of
them see the result immediately, regardless of runtime (Claude, Codex, Hermes,
Cursor). Being gitignored only means the index does not travel through git; it
says nothing about who on the machine can read it.

You need a *separate* index only when you have a genuinely separate working
directory — a second clone, or a `git worktree`. In that case each directory
gets its own `.aify-graph/` and each needs its own `graph_index`.

**Practical rule.** One team, one checkout → one index, built once, shared by
everyone. If you are unsure which case you are in, compare the `repoRoot` each
agent's MCP server was launched from; identical path ⇒ shared index.

## Multi-repo live verbs require per-repo MCP registration

The MCP server binds to ONE `repoRoot` — the directory where the
runtime was launched. Live verbs (`graph_impact`, `graph_path`,
`graph_consequences`, …) query that graph only. Calling them while
working in a different repo returns `NO MATCH`.

**Why.** Server process has a single graph.sqlite open at a time. A
multi-repo design would need either a repo-switcher parameter or a
multi-project graph index.

**Impact.** Teams with multiple repos can't keep one MCP session for
all of them.

**Workaround.** Two paths that both work:
1. **Static briefs.** Agents that read `.aify-graph/brief.*.md`
   directly work for any repo that has a graph. The measured −36%
   tool-call orient-time win comes from the briefs, not live verbs,
   so this path covers most real use.
2. **Per-repo launch.** Launch the runtime FROM each target repo;
   the same MCP registration applies but verbs operate on the local
   cwd.

## Non-interactive `codex exec` cancels live MCP calls

Interactive Codex sessions reach live MCP verbs normally. Non-interactive
`codex exec` reproducibly cancels live MCP calls mid-flight.

**Why.** Codex-side behavior, not server-side — the stdio pipe gets
closed before the verb response lands.

**Impact.** `codex exec` scripts can't rely on live graph verbs.

**Workaround.** Pre-generate static briefs (`graph-brief.mjs`) and
reference them from the exec prompt. Brief-first workflow is the
documented safe path for Codex exec.

## Compound `graph_find` queries are tokenized (post 2026-04-22)

This was a limitation; it's now a documented behavior. `graph_find("A B C")`
used to return empty because the full string was one literal substring
match. Since 2026-04-22 the server splits on whitespace, runs each term,
and unions results. The full phrase is still tried first for exact-phrase
hits.

## `graph_impact` cannot introspect its own handler symbol

`graph_impact("graphImpact")` returns `NO IMPACT — no edges found for
"graphImpact"` even though the symbol exists and is the implementation
of the verb being invoked. Same shape applies to other verbs that try
to query their own handler.

**Why.** The handler is the entry point for the verb itself, so it has
no incoming CALLS edges from inside the indexed call graph — only the
MCP tool dispatcher reaches it from outside, and that hop isn't an
edge in the code graph.

**Impact.** Self-referential introspection queries return empty.
Surfaced in the 2026-04-25 token-cost bench's DEBUG task as the only
remaining residual quality gap (−0.25 of the −0.625 quality delta;
all other tasks now score 4-5/5).

**Workaround.** For "what does this verb do" questions, read the
handler file directly (the brief lists every verb's handler at the
top of `brief.agent.md`). For "what calls into this verb from
outside the graph," that's a server-tool-dispatch concern not a code
graph concern.

## clangd needs the MSVC environment on Windows, or C++ caller sets are silently EMPTY

**Measured 2026-08-25** (`scripts/probe-clangd-stdlib-env.mjs`), synthetic repo, clangd 22.1.6,
controls in the same pass:

    POSITIVE  plain TU, no stdlib include      2 references   status ok
    NEGATIVE  position naming no symbol        0 references   status ok
    MEASURE   TU with #include <cstddef>       0 references   status ok

    INCLUDE=false  VCINSTALLDIR=false  LIB=false

**Impact.** `clang-cl` locates the MSVC standard library through the `INCLUDE` environment
variable. A clangd spawned by the MCP server inherits whatever the server was launched with — on
a normal shell, none of it. Any translation unit that includes a standard header then fails to
compile, clangd builds no AST for it, and `code_intel_references` / `code_intel_hierarchy` return
an **empty set with `status: ok`**. Nearly every real C++ file includes a standard header, so the
blast radius is effectively the whole repository, and the failure is silent.

⚠ `--query-driver=*` does **not** cover this. It is a GCC-style mechanism: clangd executes the
driver named in the DB to extract its include paths. It does not supply the MSVC `INCLUDE` set.

⚠ Generating the compile DB and consuming it are **different steps with different requirements**.
The Ninja+clang-cl configure we recommend deliberately avoids needing a vcvars shell (it uses
`llvm-rc` and `clang-cl` as siblings). That is still correct — and it says nothing about the
environment the *query-time* clangd needs.

**Detection.** As of 2026-08-25 an empty result whose TU failed carries
`evidence.translationUnitFailed: true` plus `evidence.missingHeaders`, and a warning stating the
empty set is not evidence of absence. If you see that with standard headers named, this is the
cause.

**Fix.** Launch the MCP server from a Developer Command Prompt / `vcvars64` shell so `INCLUDE` is
inherited by the clangd child.

**Not established.** Whether this is the cause of any particular repo's empty caller sets. The
mechanism is reproducible on demand; attributing a specific repo's symptom to it requires running
the relaunch there and comparing.

## LSP-verified edges do not survive a full re-index

`graph_collect_code_intel` materializes `LSP_VERIFIED` / `[lsp✓]` edges (clangd /
tsserver / pyright ground truth) into the graph. A **full rebuild** —
`graph_index(force=true)`, or the automatic one-time rebuild after an
**extractor-version bump** — re-extracts from tree-sitter and replaces edges,
**dropping the verified ones**. The stored collection rows
(`code_intel_collections` / records) survive, but the graph EDGES don't.

**Symptom.** After a reindex, `graph_health.codeIntel` shows a collection but the
dashboard / banners read **LSP-verified 0%**, and `[lsp✓]` edges have vanished.

**Why.** The importer's nodes/edges are keyed by file; a rebuild that re-extracts
those files deletes them along with the tree-sitter ones. Re-import only happens
during a collection, not during indexing.

**Workaround.** Re-run `graph_collect_code_intel` after a force rebuild / version
bump to restore the verified edges. Note `code_intel_replay` does NOT help here —
it only queries stored collection facts, it does not re-materialize graph edges.

## Overlay anchors are binary (resolved / not) today

Every anchor in `functionality.json` is treated equally regardless of
provenance, age, or signal strength. User-curated `source: "user"`
anchors have the same weight as LLM-proposed `source: "llm"` ones in
the validation pass.

**Future.** Anchor confidence scoring is on the backlog. Today's
workaround: use `/graph-anchor-drift` after renames to catch drift,
and trust the manual-curation + evidence-standard discipline in the
edit skills (`/graph-feature-edit`, `/graph-task-edit`).

## ★ Cross-TU reference resolution is incomplete — and it is the biggest one

**Measured 2026-08-02 on a 122-file C++ project**, twice, by two verbs that know
nothing about each other:

- Of **1599 symbols** queried for references, **766 resolved (47.9%)** and **833 did
  not**. Of those 833, **833 were `definition_only`** — clangd knew the declaration
  and nothing else. **Zero were true absences.**
- Ground truth for a failing case: `SaveManager::saveGame` is in that 833 and has 4
  call sites; `WorldBuffer::removeChunk` has 11 across 6 files.
- ★ **But the failure is PER-SYMBOL, not systemic.** `cylindricalLatBandsForBody`
  returns all 6 of its hand-verified callsites with `exhaustive: true`,
  `degraded: false` — including two files the heuristic `graph_callers` misses.
  So the verb is usable for delete/rename decisions **gated on
  `evidence.exhaustive === true`**; it is not usable as a blanket answer.

> ⚠ **Two measurement errors were made here and both are worth avoiding.** "Near-zero
> recall" came from reading `833/833` — a breakdown *of the failures* — as if it were
> the whole population. "79% recall" came from dividing reference *locations* (3164)
> by symbol *queries*, a unit mix. The correct statement is **47.9% of queried
> symbols resolve; of those that do not, 100% are degraded and none are clean
> absences.**

**Why.** clangd resolves references from its background index. When a symbol's
callers live in translation units the index has not fully cross-linked, the query
returns only the declaration — which, with `includeDeclaration=false`, is an empty
result. This is a statement about the *index*, not about the code.

**What the tool does about it.** Both verbs report it rather than asserting the
absence:

```
evidence: { ready: false, degraded: true, cause: "definition_only",
            exhaustive: false, confidence: "low" }
warning:  "definition-only references are not safe evidence of no callers"
```

and `graph_health.refsNotFoundBreakdown` reports `{total, degraded, clean}` so a
"no references" count can never again be read as dead code.

**Impact.** On a repo in this state, the verbs are usable as an **evidence source**
and not as an **answer source**: an empty result means *the index could not answer*,
never *nothing calls this*. Any delete/rename decision needs `exhaustive: true`,
and if you do not have it, fall back to `rg` and read the result as a floor.

**Cold-path caveat.** On a cold session the verb prewarms candidate callers using
`graph_callers` (`prewarmSource: "graph_callers"`, `prewarmCap: 15`), so **cold
recall is bounded by the heuristic verb's top-15 ranking**. A warm/ready session
needs no prewarm and is not bounded that way. Pass `waitForReadyMs` on a cold
session — the first call may return the right answer with `exhaustive: false`, and
only the ready call is licensed to support a deletion.

**Status.** Open, and the highest-value item in the product — it is one root cause
beneath two independently measured symptoms. Everything else currently on the list
is polish beside it.

## Auto-reindex is a fallback, not the primary freshness mechanism

`APG_AUTO_REINDEX=1` and per-call `fresh:true` both refresh **on the read path**:
a stale read blocks until the index finishes, and behind any in-flight index too.
The cross-process retry budget is ~3 minutes, which a first index on a large C++
repo can exceed.

The primary mechanism is the git refresh hooks
(`node scripts/install-graph-hook.mjs <repoRoot>`), which refresh when HEAD moves
— off the critical path of any query, once per repo regardless of how many agent
processes are running. `graph_health.refreshMechanism` reports whether they are
installed and whether the last run succeeded.

Auto-reindex remains correct and coordinated (one process indexes, the rest
no-op behind the write lock) and is the right tool for the two cases the hooks
cannot cover:

- **uncommitted working-tree changes** — the hooks fire on git events, so edits
  that were never committed do not trigger one;
- **repos where the hooks are not installed**, including any machine that cloned
  the repo without running the installer (`git clone` does not carry hooks).
