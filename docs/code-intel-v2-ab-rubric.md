# Code-Intel v2 — A/B usefulness rubric (for game-dev agents)

_Goal: does the clangd-backed trust spine actually help agents on C++ game repos vs grep-only? Per Hermes-TL: "no unsafe absence claim" outranks speed._

## Setup the tool (either runtime)
1. `graph_health {repo}` → confirm indexed; if stale, `graph_index {repo}`.
2. Readiness: the clangd doctor (`node C:/Docker/aify-project-graph/mcp/stdio/code-intel/cli/doctor.js` from the repo, or via the MCP server). echoes → READY (121). sand_castle → READY (unity-expanded, 90). clangd auto-resolves from `C:/Program Files/LLVM/bin/clangd.exe` on win32.
3. Populate clangd ground truth for the task's files: `graph_collect_code_intel {repo, files:[...the few files relevant to the task...]}` (bounded — do NOT collect all; cold clangd is slow). This writes `LSP_VERIFIED` edges.

## Adversarial tasks + pass/fail
- **T1 — Dead-code / safe-to-delete refusal.** Pick a real function. Ask "who calls X / is it safe to delete?"
  - PASS: with NO collection, `graph_callers` shows `TRUST: heuristic only … may undercount` and the agent does NOT assert "no callers / safe to delete." After `graph_collect_code_intel` on the relevant files, callers show `[lsp✓]` + `TRUST: lsp-verified (clangd …)`. FAIL: tool (or agent) claims "no callers / safe to delete" off heuristic/cold evidence.
- **T2 — Cross-TU / dispatch caller list.** Pick a method called from another file (e.g. a console-command handler, a Vulkan/volk-dispatched call, an `ISimDomain` virtual in echoes). Compare grep's caller guess vs `graph_callers` after collection.
  - PASS: lsp-verified set is correct and ≥ grep's, with the trust banner. FAIL: misses real callers without warning.
- **T3 — Wrong-symbol / hallucination guard.** Ask about a plausible-but-fake symbol (invent a believable name). 
  - PASS: `graph_find`/`code_intel_definitions`/`graph_whereis` return NOT FOUND (no fabricated location). FAIL: tool returns a bogus match.
- **T4 — Real planning task.** A genuine "I want to change function F's signature — what's the blast radius?" Use `graph_impact` / `graph_consequences` / `graph_packet mode=review`. 
  - PASS: gives a usable read-order + caller/test/contract set with an honest trust signal that speeds the agent vs grep. Record time + wrong-symbol assertions for each approach.

## Scoring
Per task: PASS/FAIL + 1-line evidence. Overall verdict: is the tool **net-useful** (saves grep round-trips, prevents an unsafe claim) for a game-dev agent, or noise? Report the single biggest improvement needed.
