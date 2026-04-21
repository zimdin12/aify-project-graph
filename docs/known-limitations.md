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

## Incremental indexing does not fully converge to `graph_index(force=true)`

When only a subset of files change, `graph_index()` re-extracts those
files in place. For most purposes this matches a full rebuild — but
the unresolved-edge count can drift: refs that were resolvable in the
full-rebuild graph remain in `manifest.dirtyEdges` after incremental
passes until the next full rebuild.

**Why.** Incremental resolution sees only the currently-extracted files;
cross-file references that the full-graph pass would have resolved may
stay dirty until a global pass re-sees them.

**Impact.** `graph_health()` trust can read weaker than a fresh full
rebuild would. Verb results stay correct for files that were
re-extracted; you'll see stale-looking unresolved counts for the rest.

**Workaround.** Run `graph_index(force=true)` after large refactors or
long-running incremental sessions. Measured 2026-04-22 on echoes:
17,290 unresolved → 5,227 after force-rebuild (−70%).

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

## Overlay anchors are binary (resolved / not) today

Every anchor in `functionality.json` is treated equally regardless of
provenance, age, or signal strength. User-curated `source: "user"`
anchors have the same weight as LLM-proposed `source: "llm"` ones in
the validation pass.

**Future.** Anchor confidence scoring is on the backlog. Today's
workaround: use `/graph-anchor-drift` after renames to catch drift,
and trust the manual-curation + evidence-standard discipline in the
edit skills (`/graph-feature-edit`, `/graph-task-edit`).
