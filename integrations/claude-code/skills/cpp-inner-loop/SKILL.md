---
name: cpp-inner-loop
description: Use when working on C++ code — editing, debugging build errors, or chasing a refactor. Walks through bounded code_intel_* verbs (diagnostics → refs → fix → re-diagnostics → verify packet) for fast atomic answers without collect/import cycles.
---

# cpp-inner-loop

For C++ inner-loop editing, prefer **bounded live verbs** over `graph_packet` or `graph_collect_code_intel`. They drive clangd live, no collect/import round-trip, ~5-12× less response data for atomic questions.

## The loop

1. **Before editing**, if you don't know the symbol structure of the file:

   ```
   code_intel_symbols({ file: "src/foo.cpp" })
   ```

   Returns a document outline. Faster than reading the whole file.

2. **Need callers of a symbol** before changing its signature?

   ```
   code_intel_references({ file: "src/foo.cpp", line: 12, col: 6,
                           warmupFiles: ["src/bar.cpp", "src/foo.h"] })
   ```

   Symbol-aware via clangd, NOT text search. Returns `result_state: "found" | "not_found_after_retry"`. **Replaces grep** — text search hits unrelated same-name methods on other classes.

   **Cross-TU note:** clangd starts with `--background-index=false` for determinism, so callers in *other* translation units must be opened explicitly via `warmupFiles[]`. Pass the known related files (callers, headers, includers). Same applies to `code_intel_definitions` and `code_intel_hover` when the target symbol is declared elsewhere.

3. **Need the type signature or docstring** at a call site without opening the header?

   ```
   code_intel_hover({ file: "src/bar.cpp", line: 5, col: 12 })
   ```

4. **Need to jump to definition** across translation units?

   ```
   code_intel_definitions({ file: "src/bar.cpp", line: 5, col: 12 })
   ```

5. **After editing**, check the file for build errors WITHOUT running a build:

   ```
   code_intel_diagnostics({ files: ["src/foo.cpp"] })
   ```

   Returns per-file errors with severity, message, range. Batch-warms requested files internally so transient unresolved-symbol noise is closed.

6. **Decision packet** after a non-trivial edit:

   ```
   graph_packet({ mode: "verify", files: ["src/foo.cpp", "src/bar.cpp"], audited: false })
   ```

   Returns post-edit diagnostics + freshness verdict + provider status. Pass `audited: true` for safety-critical code; the packet surfaces `SOURCE_REQUIRED` even when code-intel is fresh.

## Subagent needs evidence without spawning clangd

If you're a subagent (or any context where you cannot or should not start your own clangd), use **`code_intel_replay`** instead of the live verbs. Pattern (from reference repo `a3f0fde` parent-session evidence):

1. Parent session runs `graph_collect_code_intel({language:"cpp", scope:"all"})` once. v0.2 collection imports into the local DB.
2. Subagent later calls `code_intel_replay({collectionId:"latest", symbol:"Foo::bar", kind:"references"})` — reads the imported rows. No clangd, no LSP client started.

Replay returns the same `result_state` / `records[]` / `summary` shape as the live verbs, but every record carries `provenance: "CODE_INTEL_REPLAY"` (vs `clangd@live` for live verbs). That distinction matters: replayed evidence is only as fresh as the last collection. Run `graph_health` first to see `codeIntel.collectedAt`; if stale, ask the parent to re-collect.

Replay also accepts `file:`, `kind: 'references|definitions|hover|diagnostics|symbols|all'`, and `limit:` for bounded queries.

## When NOT to use this skill

- Whole-task planning / orientation / feature review → use `graph_packet({mode:"plan"|"orient"|"review"|"audit"})`.
- Repo-wide blast-radius / ranked affected files → use `graph_collect_code_intel` then `graph_change_plan`.
- Audit / safety claims → always verify against source even with code-intel evidence; treat live verbs as starting points, not authority.

## Prerequisites

- `clangd` on PATH (`apg code-intel doctor cpp` reports status with fix hints).
- A `compile_commands.json` at the project root (or `build/`) so clangd resolves cross-TU references. Bounded verbs *will* run without it, but references and definitions across files may degrade to `not_found_after_retry`.

## Why bounded vs collect

A/B comparison from `docs/dogfood/ab-2026-05-12-bounded-vs-collect.{txt,json}`:
- **Bounded path (3 atomic verbs):** ~196 ms, ~561 B response.
- **Collect+import+pull cycle:** ~301 ms, ~4617 B response.
- Ratios: **0.65× time, 0.12× bytes**, with provenance + three-state result rendering preserved.

The collect cycle is still the right answer when you need ranked graph integration (`graph_change_plan` blast radius). For atomic questions during editing, bounded wins on speed and tokens.
