---
name: cpp-inner-loop
description: Use when working on C++ code — editing, refactor blast-radius, build-error diagnosis. Bounded code_intel_* verbs return PRECISE compiler-resolved locations. NOT a basis for "no callers" / "dead code" / "safe to delete" — the exhaustiveness contract is currently unreachable (see the reachability section); use rg for absence claims.
---

# cpp-inner-loop

For C++ inner-loop work, prefer **bounded live verbs** over `graph_packet` or `graph_collect_code_intel`. They drive clangd live, no collect/import round-trip, and carry a structured **evidence contract**. ⚠ As of 2026-08-19 that contract works in the NEGATIVE direction only: it tells you when an answer is degraded, and it can no longer certify a complete set. Use these verbs for PRECISE locations, not for absence.

## The claim this skill USED to make, and what replaced it

This skill was written around **trustworthy absence claims** on C++ symbols:

- "Is this method dead code?"
- "What breaks if I delete this?"
- "Are there any callers past the indirection chain?"
- "Is this interface still implemented anywhere?"

These claims are dangerous because text search has no exhaustiveness guarantee — a single missed caller through a vtable, template instantiation, or include-graph fork causes a real bug.

⛔ **AND THIS SKILL CANNOT CURRENTLY MAKE THEM.** The rule used to be "trust an empty refs list when `evidence.exhaustive === true`". That gate is withheld as of 2026-08-19 and, for the empty case, was never reachable at all. Read the next section before planning around any absence claim.

⛔ **AND AS OF 2026-08-19 THAT CONDITION IS NOT CURRENTLY REACHABLE. Read this before planning
around it.**

Two things were established by execution against real clangd, not by argument:

1. **The empty case never had the grant anyway.** `callsiteCount === 0` returns
   `definition_only` / `exhaustive:false`. So the flag could only ever certify *"here are N
   callers and that is all of them"* — it could never certify *"there are none"*, which is the
   exact shape a deletion needs. The advice above has been unreachable for its stated purpose
   the whole time.
2. **The non-empty grant was false too.** Two sources, both in `compile_commands.json`,
   coverage ratio 1 — one carrying a command with a missing include path, so clangd could not
   compile it. Its caller was absent from the result and the verb returned `exhaustive:true`,
   `cause:null`, `confidence:'high'`. clangd's background queue counts a task *completed*
   regardless of outcome, so "indexing idle" never meant "indexing succeeded".

⇒ `exhaustive` is now **withheld** with cause `index_population_unattested` until an attested
index generation exists. **What you still get, and should use:**

- `precision: 'compiler_resolved'` — every returned location is real. Do not re-verify these.
- `completeness: 'floor'` — the SET may be missing callers. Treat it as a lead set.
- `indexPopulation: 'unattested'` — we observe which files the build system SELECTED for
  indexing, never which the language server actually indexed.

**So: use `code_intel_references` to find callers precisely, and NEVER as the basis for an
absence claim. For "is this dead / safe to delete", verify with `rg` — that is not a fallback,
it is currently the only sound method.**

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
    exhaustive: false,        // WITHHELD — cause: index_population_unattested (see below)
    warnings: [],             // human-readable caveats
    previouslyDegraded: null  // session recovered from a prior degraded state
  }
}
```

If `evidence.exhaustive` is false, **do not** state "no callers" or "safe to delete." Read `evidence.cause` and `evidence.fallback` for the recovery action (pass `warmupFiles[]`, raise `waitForReadyMs`, fall back to grep, etc.). `previouslyDegraded` means the session was degraded earlier and may have under-reported in an earlier call — re-verify before acting.

**Honest note — SUPERSEDED 2026-08-19.** The 2026-05-22 note said `exhaustive === true` may not fire even when an answer is correct, and that the contract is most reliably enforced in the NEGATIVE direction. That was right and is now stronger than it knew: the positive direction is not merely unreliable, it is **withheld**, because a file present in the compile DB can still fail to compile while background indexing reports idle — so "indexed" was never observed, only "selected". Expect `exhaustive:false` with cause `index_population_unattested` as the steady state. What you get instead is per-location precision, which is genuinely useful and separately reported.

## ⛔ CHECK REACHABILITY BEFORE YOU PLAN AROUND THIS LOOP

**Listed ≠ callable, and most of the verbs below are NOT listed.** The server's default
`tools/list` profile is 17 names. This skill names 21 verbs, and **ten of them are outside that
profile**: `code_intel_definitions`, `code_intel_symbols`, `code_intel_hover`,
`code_intel_diagnostics`, `code_intel_replay`, `code_intel_analyze`, `graph_shader`,
`graph_path`, `graph_neighbors`, `graph_change_plan`.

In a host that defers MCP tools behind a search step — which includes managed Claude Code
sessions — an unlisted verb is **not reachable at all**, not merely undocumented. A tool-search
for one returns nothing. **The inner loop below cannot be executed past its first call in such a
session**, and retrying is wasted work.

⇒ Before planning around this loop: confirm the verbs you need are in your surface. If they are
not, either start the server with `--toolset=full`, or use the listed alternatives —
`code_intel_references` and `code_intel_hierarchy` are listed. ⚠ They carry the same `evidence`
contract — which, as of 2026-08-19, does NOT make an absence claim safe; nothing currently does
except reading the source. They are listed alternatives for FINDING things, not for proving
nothing is there.

⚠ This caveat existed in the parent skill (`integrations/*/skill/SKILL.md`, "Listed ≠ callable")
and not here — found in the field by ef-manager, 2026-08-19, from a session where six of these
verbs were confirmed unreachable by name. Same sibling-branch shape as every other fix in this
repo that reached one path: a capability claim about X lives in files that are not X.

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

## Trust-spine verbs beyond the bounded loop (Code-Intel v2)

The bounded `code_intel_*` verbs are the inner loop. The trust spine adds a few graph verbs for transitive / cross-cutting C++ questions. The rule across all of them: **`[lsp✓]` / `LSP_VERIFIED` = clangd ground truth — don't re-grep it; absence claims still gate on exhaustive evidence.**

- **Virtual dispatch / transitive callers → `code_intel_hierarchy({ symbol, kind })`.** Call hierarchy (who-calls-transitively) and type hierarchy (virtual overrides) in one call. This is the trustworthy transitive path — `graph_callers`/`graph_impact`/`graph_path` cross-link to it for "transitive + LSP-exhaustive". Per-node `[lsp✓]` only stamps when the index is ready; bounded/not-ready mode renders `lsp-partial`. For a `base*->virt()` callsite, clangd resolves to the *declared* type's method — use call hierarchy on the virtual (or hierarchy on the owning class), plus the static `OVERRIDDEN_BY` edges, to see runtime overrides.
- **Whole call path A→B → `graph_trace({ from, to })`.** Inlines each hop body (`cat -n`) with the call-site line; dynamic-dispatch bridges annotated. When there's no static path it inlines both endpoints + their callers/callees instead of returning 404.
- **Repo-wide `[lsp✓]` callers → `graph_collect_code_intel({ language:"cpp", scope:"all" })` then `graph_callers`.** The collection imports clangd refs as `LSP_VERIFIED` edges; `graph_callers` (and `graph_pull(layers:["code_intel"])`) then render the `[lsp✓]` marker + TRUST banner on real caller edges. Use this when you want a ranked repo-wide caller set rather than one bounded `code_intel_references` answer. (Collect is time-budgeted and may return `partial` on a cold index — the live verbs remain the unaffected fast path.) ★ **A COMPLETE collect DELETES the prior collection for that provider**; a partial one does not. If the current collection is the only copy of evidence you care about, back up `.aify-graph/` first — a successful refresh discards what came before it.
### Driving a repo-wide collect to completion (and reading its numbers)

A collect is time-budgeted, so on a large repo one call returns `partial`. **Call it
again — it CONTINUES rather than repeating.** Watch `index.resumedFrom` climb toward
`index.enumeratedTotal`; `filesProcessed` resets every call and cannot show
convergence. You are done when `index.filesTotal` is `0`.

- `index.resumeLedger: "active"` means continuation is in play. An explicit
  `files:[...]` scope deliberately does NOT resume — that is you stating what you
  want, and a re-run repeats those files. The envelope note says which you got.
- **`lspVerifiedPctOfCalls` is a FLOOR, not a rate.** Symbols whose identifier
  position could not be resolved are NOT ASKED — they sit in the denominator and can
  never reach the numerator. `graph_health` marks this explicitly when it applies.
  Always read the triple, never the percentage alone:
  `lspVerifiedPctOfCalls` · `positionGuessSkipped` · `refsTruncatedSymbols`.
  A skipped symbol is *not asked*, not *asked and found nothing* — only the second
  is evidence about the code.
- **`definitionLocations[]` vs `referenceLocations[]` are DISJOINT.** Do not add them when counting callers. `definitionSource` says where the definition came from: `definition_request` (resolved via textDocument/definition — the normal case, since references are requested with includeDeclaration=false) or `split_from_references`.
- **A trust-spine-empty verdict from `graph_health` scopes to GRAPH-backed answers only** (graph_callers, graph_impact, graph_pull, graph_consequences). It does NOT constrain the live verbs — they query the language server directly. For a delete decision read `evidence.exhaustive` on `code_intel_references`, not the health summary.
- **Resume works on TypeScript and Python too**, not just C++: a partial collect continues on re-run, keyed by the tsconfig/mtime freshness basis.
- **Completion is EXPLICIT — do not loop on a count.** A collect reports `index.complete` and `index.remaining`. When everything is already collected the response says `already_collected` with "re-running is a no-op", not "no files found". Do NOT poll until some count reaches zero; read `complete`.
- **If a collection is known-bad**, clearing the resume ledger is NOT enough: it
  removes the record of which files were collected, not the records themselves.
  Reset the layer with `node scripts/reset-code-intel.mjs <repoRoot> --dry-run`,
  check the counts, then `--yes`. It reverts promoted heuristic edges to their
  origin rather than deleting them, and leaves the structural graph untouched.

- **Shader binding seams → `graph_shader()`.** C++↔GLSL binding bridge (`DECLARES_BINDING` / `LOADS_SHADER`) — finds the CPU declarers/loaders of a shader binding, the seam no plain LSP crosses.
- **Build-graph queries (CMake) → `graph_callers` / `graph_neighbors` on a `BuildTarget` / `BuildTest` node.** `CMakeLists.txt` / `*.cmake` are now indexed: `add_executable`/`add_library` → `BuildTarget` nodes (kind + sources in `extra`), `add_test` → `BuildTest`, with `LINKS` edges (`target_link_libraries`, between known targets) and `RUNS` edges (`add_test … COMMAND <target>`). So "what does target X link / what links X / which test runs target Y / what does this target depend on" resolves on the graph — the target↔test mapping plain LSP can't see. Appears after a full `graph_index`; it is NOT gated on a version bump, so if your graph predates it run `graph_index(force=true)` once.

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
