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

## Overlay anchors are binary (resolved / not) today

Every anchor in `functionality.json` is treated equally regardless of
provenance, age, or signal strength. User-curated `source: "user"`
anchors have the same weight as LLM-proposed `source: "llm"` ones in
the validation pass.

**Future.** Anchor confidence scoring is on the backlog. Today's
workaround: use `/graph-anchor-drift` after renames to catch drift,
and trust the manual-curation + evidence-standard discipline in the
edit skills (`/graph-feature-edit`, `/graph-task-edit`).
