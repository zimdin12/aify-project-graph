# Code-Intel v2 — delivery status, A/B findings, known issues, roadmap

_2026-05-08. Autonomous build round. Branch `plan/next-gen-code-intel-bridge`._

## Delivered & verified (commits L0–L5)
A cohesive C++-first code-intelligence trust spine for game-dev agents, installed on Hermes + Claude Code, A/B-validated on real sand_castle + echoes.

| Layer | What | Proof |
|---|---|---|
| L0 `9a00e6b` | win32 hygiene (windowsHide, git ls-files -z) | suite green |
| L1 `7cf0b96` | clangd foundation: compile-db discovery + WSL→host normalization + dep filter + doctor | echoes READY 121; sand_castle unity NOT-READY→fix-it |
| L2a `1b72d14` | clangd refs → `LSP_VERIFIED` graph edges (enclosing-caller resolution, invalidation) | real echoes: 12 verified CALLS edges |
| L2b+unity `4ea081b` | `[lsp✓]` marker + TRUST banner (shared helper); unity-build expansion | sand_castle 90 first-party, doctor READY (unity-expanded) |
| L3 `ff51bc9` | await background-index readiness → reliable cross-TU refs; honest lsp-verified vs lsp-partial; method-level callee | ChunkManager::setVoxel 0→3 verified cross-TU callers |
| L4 `2f3c669` | `code_intel_hierarchy` — call + type hierarchy (who-calls-transitively, virtual overrides) | echoes caller tree + ISimDomain→WorldBufferDomain |
| L5 `<this>` | C++↔GLSL shader-binding bridge (`graph_shader`) — the seam no tool crosses | echoes 212 bindings/86 loads; sand_castle 28/40 |

Full suite **761 pass, 0 failures**. Installed: Claude Code project `.mcp.json` (both games) + Hermes global `config.yaml` (APG_CLANGD set). Both runtimes confirmed reaching the tools by live testers.

## A/B findings (real games, both runtimes)
- **Safety spine works (headline).** Refuses unsafe "no callers / safe to delete" claims via the evidence contract (definition_only/degraded/not-exhaustive). Catches fabricated symbols (NOT FOUND, no hallucination). Type-aware disambiguation beats grep's noise on common method names. clangd `references` returned `exhaustive=true` on a real symbol via **Hermes**; managed **Claude Code** reached the tools via MCP.
- **Net-useful for safety + disambiguation**; NOT a strict raw-caller-completeness win over `rg` for uniquely-named symbols in these repos.

## Known issues (from live A/B — fix order)
1. **Cold `graph_collect_code_intel` drops the MCP stdio connection** (`-32000 Connection closed`). Root cause: the ~53s cold background-index exceeds the host's tool-call timeout. **Fix:** time-budget the collect (~40–45s) and return `partial` + a resume token instead of blocking for the full readiness wait; optionally a separate fast "warm-index" call. **Workaround today:** the live verbs (`code_intel_references`, `code_intel_hierarchy`) are the primary path and are unaffected; or warm the index once out-of-band (CLI) — clangd persists it (`.aify-graph/code-intel/.cache`), so subsequent collects are ~1.4s.
2. **Test unity TUs not expanded** → test→engine callers missing from `graph_callers` (engine unity TUs expand; test ones don't). **Fix:** include test-target unity TUs in `compile-db.js` expansion (gate first-party to include `tests/`).
3. **Windows clangd sysroot/includes** — `compile_commands.json` is WSL/Linux-built, so its sysroot/include paths (`cstddef` …) don't exist on Windows clangd → bogus diagnostics/hover; files absent from the DB give `compile_entry_missing`. References/hierarchy (which don't need the toolchain sysroot as hard) stay trustworthy where fresh/exhaustive. **Fix:** run clangd under WSL against the Linux DB, OR `--query-driver` + host include discovery, OR strip/translate the Linux sysroot in the normalizer.
4. **`graph_callers` surface parity** — confirm `[lsp✓]`+TRUST renders whenever LSP caller edges exist (verified on `GPU::is_valid`; tester's case simply had none post-collect because of #2).

## Roadmap (not yet built — P2/polish)
- **L6 dashboard cohesion**: provenance ribbon (lsp-verified vs heuristic), blast-radius overlay, shader-binding map (the L5 edges already feed the cross-layer model), expose hotspots/communities/architecture as verbs; collapse the overlapping context verbs into a clear primary + thin specializations (the dashboard audit's #1 cohesion ask).
- Overlay repair: sand_castle `functionality.json` anchors are broken (0/9) → `graph_packet` degraded there; re-anchor.
- The 4 known issues above.

Licensing: codegraph+graphify MIT (reused w/ attribution); agent-code-intel UNLICENSED (patterns only).
