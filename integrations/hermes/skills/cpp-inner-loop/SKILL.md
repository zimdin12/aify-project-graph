---
name: cpp-inner-loop
description: Use when working on C++ code — editing, debugging build errors, or chasing a refactor. Walks through bounded code_intel_* verbs (diagnostics → refs → fix → re-diagnostics → verify packet) for fast atomic answers without collect/import cycles.
---

# cpp-inner-loop

For C++ inner-loop editing, prefer **bounded live verbs** over `graph_packet` or `graph_collect_code_intel`. They drive clangd live, no collect/import round-trip, ~5-12× less response data for atomic questions.

## The loop

1. `code_intel_symbols({file})` — document outline before editing
2. `code_intel_references({file, line, col, warmupFiles:[...]})` — symbol-aware refs (NOT text search) before changing a signature. Pass `warmupFiles` (callers/headers) when refs may live in other TUs; clangd uses `--background-index=false` so it won't auto-discover them.
3. `code_intel_hover({file, line, col, warmupFiles:[...]})` — type sig + docstring at a call site
4. `code_intel_definitions({file, line, col, warmupFiles:[...]})` — jump to definition across TUs
5. `code_intel_diagnostics({files: [...]})` — per-file LSP diagnostics after editing; batch-warms internally
6. `code_intel_analyze({files: [...], mode: "clang-tidy"|"compile"})` — bounded analyzer/build evidence when LSP diagnostics are not enough. Use `clang-tidy` for style/static checks and `compile` for compile-command syntax checks. Explicit files only; never broad-scan by default. `partial` / `not_collected` means analyzer evidence was unavailable for that file, not that it ran clean.
7. `graph_packet({mode: "verify", files: [...], audited: bool})` — post-edit decision packet with freshness + SOURCE_REQUIRED

## Subagent without clangd: code_intel_replay

If you can't spawn your own clangd (subagent context, host with no clangd, parent already collected), use `code_intel_replay({collectionId:"latest", symbol:"X", kind:"references"})`. Reads parent-imported v0.2 collection rows from the local DB. Same `result_state`/`records[]`/`summary` shape but `provenance: "CODE_INTEL_REPLAY"`. Per reference `a3f0fde` parent-session pattern. Check `graph_health.codeIntel.collectedAt` to see how stale the replay is.

## When NOT to use this skill

- Whole-task planning → `graph_packet({mode:"plan"|"orient"|"review"|"audit"})`
- Repo-wide blast-radius → `graph_collect_code_intel` then `graph_change_plan`
- Audit / safety claims → always source-verify

## Prerequisites

- `clangd` on PATH (`apg code-intel doctor cpp` reports status)
- `compile_commands.json` at project root or `build/` for cross-TU refs

## Why bounded vs collect

A/B comparison (see `docs/dogfood/ab-2026-05-12-bounded-vs-collect.{txt,json}`): bounded path is **0.65× time, 0.12× bytes** vs collect+import+pull cycle for atomic C++ questions, with provenance + three-state result rendering preserved.
