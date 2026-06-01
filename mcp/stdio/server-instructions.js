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

TOOL SURFACE: tools/list shows a FOCUSED default (~15 intent verbs). Long-tail
verbs named below (graph_onboard, graph_shader, graph_callees, graph_overview,
…) are still CALLABLE by name even when not listed — invoke them directly. Run
with --toolset=full to list the whole API.

ORIENT FIRST (cheap, often saves 2-5 shell calls):
- Read .aify-graph/brief.* (brief.agent.md / brief.onboard.md / brief.plan.md) to orient before grepping.
- graph_packet {target, mode} — the FIRST move. Most "what is X / how does Y work / understand
  area Z" questions resolve in ONE graph_packet call; prefer it over chaining graph_search + a node verb.
- graph_onboard — orientation brief for a repo you have not seen (callable; not in the default list).
- graph_tour {steps, focus} — an ORDERED "explore in N steps" walk (entrypoints → named subsystems → hotspots). Best first read on an unfamiliar repo; callable, not listed.

TOOL SELECTION BY INTENT:
- who calls X / is it safe to delete → code_intel_references or graph_callers (read the evidence banner).
- who calls X transitively / who overrides this virtual → code_intel_hierarchy.
- what breaks if I change X → graph_consequences / graph_impact.
- everything about X across code+features+tasks+docs → graph_pull.
- C++ ↔ GLSL shader bindings → graph_shader.
- locate a symbol → graph_search / graph_whereis.

TRUST RULES (this server's differentiator):
- Edges marked [lsp✓] (provenance LSP_VERIFIED) are clangd ground truth. Do NOT re-grep them.
- A "TRUST: lsp-verified (index-ready, N callers)" banner means the caller set is EXHAUSTIVE — safe basis for "no callers / dead code / safe to delete".
- "lsp-partial" / "heuristic only" means the set may be incomplete — verify before any "no callers / safe to delete" claim.
- OVERRIDDEN_BY and INFERRED edges are static guesses, not ground truth — confirm with code_intel_hierarchy kind=subtypes on the OWNING CLASS (returns derived overriders), or kind=callers on the virtual method (kind=subtypes on a METHOD resolves to its return type, not its overrides).
- Results tagged generated:true are codegen stubs (.pb.*, moc_*, *_generated.h); prefer the hand-written symbol of the same name.

ANTI-PATTERNS (avoid):
- Do NOT grep to re-verify an lsp-verified result — the banner already certifies it.
- Do NOT chain graph_search + a node verb when one graph_pull / graph_packet answers it.
- A verb that returns inlined source is Read-equivalent — do NOT re-Read those lines.
- The first cold graph_collect_code_intel returns partial (index warming) — call it again to complete.

OUTPUT CONTRACTS:
- Structured verbs (graph_consequences, graph_pull, graph_find, graph_explain_diff, code_intel_*) return JSON; narrative verbs (graph_callers/callees/trace/explore/digest, graph_packet, …) return markdown. Parse JSON shapes by field; read markdown shapes as text — do not assume one shape for all verbs.

KNOWN LIMITS (don't burn calls on these — read the code instead):
- C++-first; JS/TS resolution is best-effort, other languages structural-only.
- The static graph does NOT synthesize dynamic dispatch: function-pointer / std::function / script
  (Lua) callbacks, and registry/DI indirection. Verify those by reading.
- Cross-language links beyond the C++↔GLSL shader bridge (graph_shader) are not resolved.
- An absence claim ("no callers / dead code") is only trustworthy when the evidence banner says
  exhaustive (see TRUST RULES). Otherwise verify before deleting.

ORIENTATION (3 shapes, they compose): graph_packet mode:orient = one symbol/feature deep; graph_onboard = flat brief (entrypoints/key files/read order); graph_tour = ordered N-step walk of the whole repo. GROUPING terms: community = algorithmic cluster (leiden); archetype = its named purpose (Physics/Rendering — heuristic, orientation-only, never a trust basis); layer = curated overlay (truth when present).

FRESHNESS:
- If a response says "graph stale", run graph_index first (or set APG_AUTO_REINDEX=1 for auto-refresh).
- A stale "not found" is NOT proof a symbol is gone — re-run after indexing. The graph self-heals on
  read when APG_AUTO_REINDEX is set; otherwise refresh manually with graph_index.`;
