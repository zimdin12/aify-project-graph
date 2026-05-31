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
- graph_packet {target, mode} — one packet of everything about a feature/symbol.
- graph_onboard — guided tour for a repo you have not seen (callable; not in the default list).

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
- Structured verbs (graph_consequences, graph_pull, graph_find, graph_explain_diff, code_intel_*) return JSON; narrative verbs (graph_callers/callees/trace/explore/digest, graph_packet, …) return markdown. Parse JSON shapes by field; read markdown shapes as text — do not assume one shape for all verbs.`;
