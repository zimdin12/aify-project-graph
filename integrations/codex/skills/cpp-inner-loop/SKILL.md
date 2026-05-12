---
name: cpp-inner-loop
description: Use when working on C++ code — editing, debugging build errors, or chasing a refactor. Walks through bounded code_intel_* verbs (diagnostics → refs → fix → re-diagnostics → verify packet) for fast atomic answers without collect/import cycles.
---

# cpp-inner-loop

For C++ inner-loop editing, prefer **bounded live verbs** over `graph_packet` or `graph_collect_code_intel`. They drive clangd live, no collect/import round-trip, ~5-12× less response data for atomic questions.

## The loop

1. `code_intel_symbols({file})` — document outline before editing
2. `code_intel_references({file, line, col})` — symbol-aware refs (NOT text search) before changing a signature
3. `code_intel_hover({file, line, col})` — type sig + docstring at a call site
4. `code_intel_definitions({file, line, col})` — jump to definition across TUs
5. `code_intel_diagnostics({files: [...]})` — per-file errors after editing (no build needed)
6. `graph_packet({mode: "verify", files: [...], audited: bool})` — post-edit decision packet with freshness + SOURCE_REQUIRED

## When NOT to use this skill

- Whole-task planning → `graph_packet({mode:"plan"|"orient"|"review"|"audit"})`
- Repo-wide blast-radius → `graph_collect_code_intel` then `graph_change_plan`
- Audit / safety claims → always source-verify

## Prerequisites

- `clangd` on PATH (`apg code-intel doctor cpp` reports status)
- `compile_commands.json` at project root or `build/` for cross-TU refs

## Why bounded vs collect

A/B comparison (see `docs/dogfood/ab-2026-05-12-bounded-vs-collect.{txt,json}`): bounded path is **0.65× time, 0.12× bytes** vs collect+import+pull cycle for atomic C++ questions, with provenance + three-state result rendering preserved.
