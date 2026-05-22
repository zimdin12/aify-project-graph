---
name: cpp-inner-loop
description: Use when working on C++ code — editing, deletion-safety, refactor blast-radius, build-error diagnosis. Bounded code_intel_* verbs return symbol-aware facts with an exhaustiveness contract — the only safe basis for "no callers" / "dead code" / "safe to delete" claims.
---

# cpp-inner-loop

For C++ inner-loop work, prefer **bounded live verbs** over `graph_packet` or `graph_collect_code_intel`. They drive clangd live, no collect/import round-trip, and now carry a structured **evidence contract** that lets you separate trustworthy absence claims from cold/stale/degraded results.

## The load-bearing claim — and how to make it safely

The strongest value-add of this skill is **trustworthy absence claims** on C++ symbols:

- "Is this method dead code?"
- "What breaks if I delete this?"
- "Are there any callers past the indirection chain?"
- "Is this interface still implemented anywhere?"

These claims are dangerous because text search has no exhaustiveness guarantee — a single missed caller through a vtable, template instantiation, or include-graph fork causes a real bug. `code_intel_references` returns an `evidence` object; **only trust an empty refs list (or any "no callers" / "dead code" conclusion) when `evidence.exhaustive === true`.**

```js
// Plan #14 evidence contract on code_intel_references
{
  references: [...],          // compat: full LSP shape
  referenceLocations: [...],  // non-declaration callsites only
  definitionLocations: [...], // declaration entries split out
  evidence: {
    ready: true,              // ready signal + workspace warm
    degraded: false,          // any reason the answer isn't exhaustive
    cause: null,              // cold_index|timeout|unsupported|definition_only|stale_index|unknown
    confidence: 'high',       // high|medium|low
    fallback: null,           // recovery instruction string when degraded
    exhaustive: true,         // THE absence-claim gate
    warnings: [],             // human-readable caveats
    previouslyDegraded: null  // session recovered from a prior degraded state
  }
}
```

If `evidence.exhaustive` is false, **do not** state "no callers" or "safe to delete." Read `evidence.cause` and `evidence.fallback` for the recovery action (pass `warmupFiles[]`, raise `waitForReadyMs`, fall back to grep, etc.). `previouslyDegraded` means the session was degraded earlier and may have under-reported in an earlier call — re-verify before acting.

## The loop

1. **Orient** when you don't know the symbol shape of a file:

   ```
   code_intel_symbols({ file: "src/foo.cpp" })
   ```

2. **Trustworthy callers / deletion-safety** (the load-bearing use):

   ```
   code_intel_references({ file: "src/foo.cpp", line: 12, col: 6 })
   ```

   - Auto-prewarms a bounded set (≤15 same-dir + compile_commands siblings) when the session is cold and you didn't pass `warmupFiles[]`. Honest: this fixes the most common "no refs because clangd hadn't seen the callers yet" case without forcing you to think about warmup.
   - For deeper cross-TU coverage (cross-component, dynamic dispatch chains), pass `warmupFiles[]` explicitly — known callers, headers, vtable-bearing TUs. Caller-provided warmup wins over auto-prewarm.
   - Only `evidence.exhaustive === true` lets you make absence claims. `referenceLocations[]` gives callsites without the declaration mixed in.

3. **Multi-level absence walk** (the dead-code / blast-radius pattern):
   For "is X reachable from anywhere alive?", walk each indirection level: refs of X → refs of each of X's callers → … Treat `evidence.exhaustive` as the per-link contract. One non-exhaustive link breaks the chain — fall back to grep for that link rather than silently propagating uncertainty.

4. **Type / signature at a call site** without opening the header:

   ```
   code_intel_hover({ file: "src/bar.cpp", line: 5, col: 12 })
   ```

5. **Jump to definition** across TUs:

   ```
   code_intel_definitions({ file: "src/bar.cpp", line: 5, col: 12 })
   ```

   Same evidence contract applies — `evidence.exhaustive === true` means "this is THE definition" (no degraded cause masking a missing one).

6. **Post-edit diagnostics** without running a build:

   ```
   code_intel_diagnostics({ files: ["src/foo.cpp"] })
   ```

   Returns per-file errors with severity, message, range. Batch-warms requested files; cold sessions get one longer settle. `noValueAdded:true` on every file means freshness was `stale`/`timeout` — the answer isn't authoritative.

7. **Analyzer / build evidence beyond plain LSP:**

   ```
   code_intel_analyze({ files: ["src/foo.cpp"], mode: "clang-tidy" })
   code_intel_analyze({ files: ["src/foo.cpp"], mode: "compile" })
   ```

   Explicit files only; do not broad-scan. `partial` / `not_collected` means evidence was unavailable for that file, **not** that it ran clean — the verify packet renders this explicitly.

8. **Post-edit decision packet** for non-trivial changes:

   ```
   graph_packet({ mode: "verify", files: ["src/foo.cpp", "src/bar.cpp"], audited: false })
   ```

   Pass `audited: true` for safety-critical code; the packet surfaces `SOURCE_REQUIRED` even when code-intel is fresh. Pass `analyze: true, analyzeMode: "clang-tidy"|"compile"` to fold analyzer evidence into the packet.

## Freshness states

`navigationFreshness` is now a 4-state model (Plan #14 Step B):

- `cold` — no workspace file opened in this session yet. Auto-prewarm fires before the first navigation call. Empty results in this state are NEVER exhaustive.
- `stale` — the LSP is actively indexing right now. Wait or pass `waitForReadyMs`.
- `fresh` — the LSP signalled ready AND we have workspace-warm evidence. Required for `evidence.exhaustive === true`.
- `unknown` — older adapter can't classify. Result is usable but not exhaustive.

## Subagent needs evidence without spawning clangd

If you're a subagent (or any context where you cannot or should not start your own clangd), use **`code_intel_replay`** instead of the live verbs. Pattern (from reference repo `a3f0fde` parent-session evidence):

1. Parent session runs `graph_collect_code_intel({language:"cpp", scope:"all"})` once. v0.2 collection imports into the local DB.
2. Subagent later calls `code_intel_replay({collectionId:"latest", symbol:"Foo::bar", kind:"references"})` — reads the imported rows. No clangd, no LSP client started.

Replay records carry `provenance: "CODE_INTEL_REPLAY"` (vs `clangd@live` for live verbs). Replayed evidence is only as fresh as the last collection. Run `graph_health` first to see `codeIntel.collectedAt`; if stale, ask the parent to re-collect. Note: replay doesn't carry the Plan #14 evidence contract — collected rows are point-in-time facts; absence claims still need a live `code_intel_references` round-trip against fresh state.

## When NOT to use this skill

- Whole-task planning / orientation / feature review → use `graph_packet({mode:"plan"|"orient"|"review"|"audit"})`.
- Repo-wide blast-radius / ranked affected files → use `graph_collect_code_intel` then `graph_change_plan`.
- Grep-solvable string sweeps (renaming a string literal, finding TODO comments) → use Grep directly; symbol-aware lookups are wasted overhead there.
- Audit / safety claims → always verify against source. Even `evidence.exhaustive === true` is "clangd's best symbol-aware view"; treat live verbs as the strongest pre-source signal, not as final authority.

## Prerequisites

- `clangd` on PATH (`apg code-intel doctor cpp` reports status with fix hints).
- A `compile_commands.json` at the project root (or `build/`) so clangd resolves cross-TU references. Bounded verbs *will* run without it, but cross-TU references will degrade to `cause:cold_index` (auto-prewarm only sees on-disk siblings).

## Measurement caveats — read this before quoting numbers

A single-fixture A/B at `docs/dogfood/ab-2026-05-12-bounded-vs-collect.{txt,json}` shows:
- Bounded path (3 atomic verbs): ~341 ms, ~1097 B response.
- Collect+import+pull cycle: ~328 ms, ~4617 B response.
- Ratios: **~1.1× time, ~0.24× bytes** (76% byte reduction).

**The byte reduction is real and mechanically reproducible.** The wall-clock parity is a fixture artifact (the cold-server safety waits from Plan #11 are bypassed in the demo to measure tool-surface latency — see the demo source). On real clangd against a real repo, bounded verbs pay a real cold-warmup cost on first use; subsequent calls in the same session are fast.

**What is NOT yet measured:** per-task value-add on real coding tasks. The agent-code-intel reference repo ran a 9-task T1-T9 A/B that drove their scope-honest doc rewrite ("load-bearing on multi-level absence claims; marginal on grep-solvable cases"). APG has not yet done that pass on cpp. Treat the load-bearing-on-absence-claims framing above as the contract-supported intent — pending empirical validation.
