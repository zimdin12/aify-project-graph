// MCP `initialize` server-instructions — P1-1.
//
// MCP clients (Claude Code, Hermes, Cursor) inject a server's `instructions`
// string into the agent's system prompt ONCE per session. It is the one
// channel that reaches every host identically — the canonical home for the
// trust-spine guidance that would otherwise be stuck in skill files some
// hosts never load.
//
// Budget discipline: this lives in the system prompt. Keep it tight
// (~30-50 lines). Author it for OUR actual tools, intent-routed. This is the
// single source of truth — imported by the initialize handler.
export const SERVER_INSTRUCTIONS = `aify-project-graph — symbol-aware code intelligence for this repo.

TOOL SURFACE: tools/list shows a FOCUSED default (17 verbs). Long-tail verbs named
below (graph_onboard, graph_shader, graph_callees, graph_overview, …) are callable
only where a host allows calling an UNLISTED tool. In a managed session that defers
MCP tools behind a search step, they are NOT reachable — the deferred index holds
listed tools only. If a tool-search for one returns nothing, do NOT retry: use a
listed verb, or start the server with --toolset=full.

DISCOVERABILITY: if you see no graph_* / code_intel_* tools, they are NOT missing —
run ToolSearch with query "graph" to load them. Any repo with .aify-graph/ has this
server; reach for it before falling back to grep.

ORIENT FIRST (cheap, often saves 2-5 shell calls):
- graph_packet {target, mode} — first move WHEN STILL ORIENTING ("what is X / how does Y work");
  one call instead of graph_search + a node verb. ★ ALREADY HAVE A PRECISE QUESTION? Use the verb
  that names it (breaks-if-I-change -> graph_consequences; who-calls -> code_intel_references).
- Read .aify-graph/brief.* (brief.agent.md / brief.onboard.md / brief.plan.md) to orient before grepping.
- graph_health — run ONCE at session start. The only call that answers "can I trust what I am
  about to be told" (compile-DB usable? index stale? trust spine present?); nothing else derives
  it. Field-rated the highest-value call here: it surfaced a wrong-toolchain compile DB that the
  user would never have thought to test for.
- graph_onboard / graph_tour walk an unfamiliar repo, but MAY NOT BE CALLABLE in your runtime
  (see TOOL SURFACE). If a tool-search finds neither, do not retry — graph_packet mode:orient is
  listed and answers the same question.

TOOL SELECTION BY INTENT:
- who calls X / is it safe to delete → code_intel_references or graph_callers (read the evidence banner).
- who calls X transitively / who overrides this virtual → code_intel_hierarchy.
- what breaks if I change X → graph_consequences / graph_impact. HIGH VALUE EVEN ON CODE YOU KNOW WELL: the blast radius across subsystems/contracts is the thing memory can't hold — reach for these before a rename/signature/behavior change, not just when orienting.
- what build target builds / links / tests X → graph_callers/graph_neighbors on the BuildTarget/BuildTest node (CMake graph: LINKS = target_link_libraries, RUNS = add_test).
- everything about X across code+features+tasks+docs → graph_pull.
- C++ ↔ GLSL shader bindings → graph_shader.
- locate a symbol → graph_search / graph_whereis.

TRUST RULES (this server's differentiator):
- Edges marked [lsp✓] (provenance LSP_VERIFIED) are clangd ground truth. Do NOT re-grep them.
- A "TRUST: lsp-verified (index-ready, N callers)" banner means the caller set is EXHAUSTIVE — safe basis for "no callers / dead code / safe to delete". It is granted ONLY when EVERY edge in the result is LSP_VERIFIED and the index covers the symbol; a mix of verified + heuristic edges reads as lsp-partial (a FLOOR), never exhaustive. The single source of truth is the structured evidence.exhaustive flag — prefer it over the banner text when they could disagree.
- "lsp-partial" / "heuristic only" means the set may be incomplete — verify before any "no callers / safe to delete" claim.
- evidence.exhaustive:false carries a cause naming WHY it is not a complete set. EVERY cause the server can emit: coverage_unknown (coverage for this query could not be PROVEN — the default is fail-closed, so silence is never read as proof), partial_compile_db_coverage (C++ foreign/unity compile DB, or a DB that covers none of your first-party code — see below), partial_tsconfig_scope (the TS file is outside its nearest tsconfig's project, so tsserver ran it in a loose inferred project), python_dynamic_dispatch (Python is never provably exhaustive), truncated_to_caps (a call-hierarchy tree hit the breadth/total caps or only the first root of an overload set was walked — raise breadthCap/totalCap or verify), cold_index (clangd's background index was not warm — pass warmupFiles[] or wait_for_ready, then RETRY; this is a retry signal, not an answer), stale_index (the index is behind the working tree — retry after it settles), timeout (waiting for readiness expired — raise waitForReadyMs), definition_only (references returned the definition but no callsites — never read that as "no callers"), no_incoming_unconfirmed (an index-ready hierarchy came back EMPTY, which is the false-exhaustive trap: a caller TU may simply not be confirmably resolved), bounded_mode (a bounded call that never claims exhaustiveness by design), and unknown (the server answered but gave no readiness signal). In every case the set is a FLOOR; confirm with code_intel_references / rg before any absence claim.
- A compile DB that exists, is native, and is non-unity still proves NOTHING if it contains no entries for YOUR sources. Measured in the field: a project whose CMake exported compile commands only for its dependencies had 441 DB entries and ZERO first-party ones, so clangd had no compile command for any project file and silently returned 3 of 8 real call sites. That now reports exhaustive:false. Fix by exporting compile commands for your own targets (-DCMAKE_EXPORT_COMPILE_COMMANDS=ON on a build that actually compiles them) and confirm your sources appear in compile_commands.json.
- graph_callers prints the CALLER FUNCTION's declaration line, not the call site — edges are function-granular, so one caller may contain several call sites. For exact call-site lines use code_intel_references or rg.
- cause=partial_compile_db_coverage (degraded, exhaustive:false) means the index is silently PARTIAL even though clangd reported "fresh": the compile DB is either a foreign (Linux/WSL) toolchain run against host clangd, or a CMake unity/jumbo build whose per-source TUs are absent. Some real callers are invisible and will NOT be flagged individually — never treat such a result as "no callers / dead code / safe to delete"; confirm with rg first. Fix a foreign DB by generating a NATIVE Windows compile DB so host clangd matches it (MSBuild won't emit one — use Ninja+clang-cl: cmake -B build-win-clangd -G Ninja -DCMAKE_CXX_COMPILER=clang-cl -DCMAKE_EXPORT_COMPILE_COMMANDS=ON; APG auto-discovers it); APG_CLANGD_WSL=1 is the WSL fallback. Fix unity by expanding the build.
- OVERRIDDEN_BY and INFERRED edges are static guesses, not ground truth — confirm with code_intel_hierarchy kind=subtypes on the OWNING CLASS (returns derived overriders), or kind=callers on the virtual method (kind=subtypes on a METHOD resolves to its return type, not its overrides).
- Results tagged generated:true are codegen stubs (.pb.*, moc_*, *_generated.h); prefer the hand-written symbol of the same name.

ANTI-PATTERNS (avoid):
- Do NOT grep to re-verify an lsp-verified result — the banner already certifies it.
- Do NOT chain graph_search + a node verb when one graph_pull / graph_packet answers it.
- A verb that returns inlined source is Read-equivalent — do NOT re-Read those lines.
- The first cold graph_collect_code_intel returns partial (index warming) — call it again to complete.

OUTPUT CONTRACTS:
- Structured verbs (graph_consequences, graph_pull, graph_find, graph_explain_diff, code_intel_*) return JSON; narrative verbs (graph_callers/callees/trace/explore/digest, graph_packet, …) return markdown. Parse JSON shapes by field; read markdown shapes as text — do not assume one shape for all verbs.

LANGUAGES (LSP trust spine): code_intel_* + graph_collect_code_intel work on C++ (clangd),
TypeScript/JavaScript (typescript-language-server), and Python (pyright). Language is inferred
from the file extension — you do NOT need to pass language. The servers are bundled with the
plugin; the host needs no LSP config. Honesty per language: C++ gated on compile-DB coverage;
TS exhaustive only when the queried file is INSIDE its nearest tsconfig/jsconfig project (a root
tsconfig merely existing is not enough — a file outside its include scope returns
partial_tsconfig_scope); Python is NEVER provably exhaustive (duck typing
/ getattr / dynamic dispatch) → references/hierarchy return exhaustive:false — a FLOOR, verify
with rg before any delete/rename. Other languages remain tree-sitter structural-only.

KNOWN LIMITS (don't burn calls on these — read the code instead):
- The static graph does NOT synthesize dynamic dispatch: function-pointer / std::function / script
  (Lua) callbacks, and registry/DI indirection. Verify those by reading.
- Cross-language links beyond the C++↔GLSL shader bridge (graph_shader) are not resolved.
- An absence claim ("no callers / dead code") is only trustworthy when the evidence banner says
  exhaustive (see TRUST RULES). Otherwise verify before deleting.

ORIENTATION (3 shapes, they compose): graph_packet mode:orient = one symbol/feature deep; graph_onboard = flat brief (entrypoints/key files/read order); graph_tour = ordered N-step walk of the whole repo. GROUPING terms: community = algorithmic cluster (leiden); archetype = its named purpose (Physics/Rendering — heuristic, orientation-only, never a trust basis); layer = curated overlay (truth when present).

FRESHNESS:
- If a response says "graph stale", run graph_index first (or set APG_AUTO_REINDEX=1 for auto-refresh).
- A stale "not found" is NOT proof a symbol is gone — re-run after indexing. The graph self-heals on
  read when APG_AUTO_REINDEX is set; otherwise refresh manually with graph_index.
- AFTER ANY FULL REBUILD, RE-COLLECT. graph_index(force=true) — and any rebuild triggered by a schema/extractor bump — DELETES the [lsp✓] trust spine. It is restored automatically only when the stored collection's commit still equals HEAD; once HEAD has moved it CANNOT be (re-stamping shifted line numbers as "verified" would be a lie). Measured on a real repo: a reindex left 0 verified edges of 17544 CALLS, so every caller answer silently became heuristic-only and nothing could attest exhaustiveness. When graph_index returns trustSpineDropped / nextAction, or graph_health says "trust spine EMPTY", run graph_collect_code_intel before trusting any absence claim.
- LSP-VERIFIED edges do NOT survive a full re-index. graph_collect_code_intel materializes [lsp✓]
  edges into the graph; a force rebuild (or an extractor-version bump) re-extracts from tree-sitter
  and DROPS them. If graph_health.codeIntel shows a collection but the LSP-verified % reads 0 (or
  [lsp✓] edges vanished), re-run graph_collect_code_intel to restore them. (code_intel_replay only
  QUERIES stored collection facts — it does not re-materialize graph edges.)`;
