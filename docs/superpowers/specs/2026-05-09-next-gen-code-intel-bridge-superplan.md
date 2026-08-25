# aify-project-graph + agent-code-intel: unified C++ agent surface — superplan

> **Status:** Draft v1 (merged superplan).
> **Date:** 2026-05-09.
> **Branch:** `plan/next-gen-code-intel-bridge`.
> **Supersedes:** `docs/superpowers/plans/2026-05-06-next-gen-code-intel-bridge-plan.md` (Draft v1).
> **Inputs:** `docs/superpowers/specs/2026-05-09-review-merge-plan-draft.md`; brainstorming convergence (this project ↔ the reviewer) on six open items O1-O6; Steven's product steer on coupling, surface shape, and C++ priority.
> **Reference repo state:** `reference/agent-code-intel` at `00da467` (origin `https://gitlab.com/baltic-lei/agent-code-intel.git`, branch `main`).

## Executive thesis

The next-generation product is **a unified C++-focused agent code surface**: APG's graph/overlay/packet/brief substrate **fused with a precision evidence layer** that delivers compiler-backed defs, refs, hover, diagnostics, and symbols to agents through a single agent-facing entry point.

Code-intel is **not** an optional bolt-on. It is a **first-class evidence subsystem behind a stable provider boundary**, surfaced through APG's existing high-level verbs, with C++ as the headline language and Echoes / Sand Castle as the validation targets.

The packet *is* the unified LSP for agents. Raw LSP-like operations exist as a secondary, back-door MCP for subagents and edge-case tooling, never as the marketed front door.

## What changed since the 2026-05-06 plan

The original plan framed code-intel as an **optional precision backend** layered behind APG. Three things moved that framing:

1. **Reference-repo evidence (`reference/agent-code-intel` 1235a5a → 00da467).** Seven new commits demonstrated a stronger pattern than the old plan assumed: stable wrapper command (`agent-code-intel serve-lsp <lang>` and `mcp-server <lang>`), dual native-LSP + MCP exposure for hosts, batch warmup as correctness scaffolding, parent-session subagent evidence pattern, symbol-aware references guidance, and Pi `.pi-lsp.json` opt-in. The wrapper/provider lifecycle is not incidental — it is the host abstraction.

2. **Review draft (`2026-05-09-review-merge-plan-draft.md`).** Reframed coupling as "first-class subsystem behind a provider boundary," added milestones M0.5 (provider boundary spec), M2.5 (host wrapper strategy), M3.5 (freshness model), M7.5 (cross-runtime install lab).

3. **Steven's product steer.** Confirmed the merge target is "graph + that LSP, like a unified LSP but for C++." Code-intel is no longer a polish layer; it is the differentiation.

## Reference repo state at superplan time

`reference/agent-code-intel` HEAD = `00da467`. Commits since the 2026-04-30 baseline planned against:

- `00da467` Clarify symbol-aware reference guidance — symbol-aware `references` preferred over raw text search; warm-and-retry before relying on absence; do not treat text-search hit counts as authoritative for common method names.
- `a3f0fde` Document parent-session evidence for Claude subagents — subagent native-LSP/MCP availability is host-controlled and varies; default pattern is **collect in parent, pass facts into subagent prompts**. Direct subagent use is opportunistic.
- `2be8df4` Document Pi native LSP timeout behavior — Pi native LSP is host-owned and separate from the package tool; `.pi-lsp.json` lets projects route Pi native LSP through the wrapper.
- `9cf2f94` Warm code-intel diagnostic batches before collection.
- `ed785c6` Update code-intel guidance after host retest.
- `fed897b` Expose code-intel MCP tools to Claude subagents (`.mcp.json`).
- `3c3315a` Route Claude LSP through code-intel wrapper (`.lsp.json`).

These commits are **additive but strategically load-bearing** — they prove the wrapper/provider abstraction and inform our own provider contract and host-integration strategy.

## Non-negotiable invariants

These are write-once, change-only-with-Steven-sign-off:

1. **The packet is the agent UX.** Code-intel facts ride inside `graph_packet` / brief output via provenance tags. A raw LSP MCP exists, but it is never the recommended surface. Marketplace docs, dashboards, and skill prompts always lead with packet.
2. **Compiler facts override syntax guesses.** When code-intel evidence exists, packet/brief rendering must prefer it over tree-sitter inferences for the same symbol — and must say so via provenance.
3. **Pi/baseline keeps working without a provider.** No clangd, no LSP, no compile DB required for tree-sitter graph + briefs + packets. Unavailability is reported explicitly, never silently.
4. **Three-state result distinction: `found` / `not_found_after_retry` / `not_collected`.** Every surface that consumes code-intel results (`graph_change_plan`, `verify`, `audit`, packet rendering) must distinguish (a) the provider found results, (b) the provider looked, came back empty, was warmed-and-retried per the symbol-aware retry gate, and still saw nothing, and (c) the provider was not asked or could not run. Silence is never permitted to read as zero.
5. **Fact budget caps with explicit ranking.** Every packet/brief section that can carry code-intel evidence has a hard cap and a ranking order: `changed_files → task_anchors → code_intel_confidence → recency`. Codex-token tax is a release gate.
6. **APG owns artifacts; bridge triggers and displays.** Bridge calls public APG verbs to start collection; only APG writes to `.aify-graph/` artifacts.
7. **Parent-session evidence is the default subagent pattern.** APG packets emitted by a parent session must be self-sufficient enough to feed into subagent prompts without the subagent needing to call code-intel directly. Direct subagent code-intel access is supported but not required for correctness.

## Product target

A senior agent working on Echoes (C++) sees:

1. `graph_packet({mode:"plan", task:"refactor X"})` returns a packet with: change-anchored summary, `READ FIRST` files ranked by code-intel ref-count and recency, `EVIDENCE:` block listing definitions, top references with caller files, hover/signature for the focal symbol, recent diagnostics for changed files, and a `TRUST:` line that separates graph trust from code-intel freshness.
2. After editing, `graph_packet({mode:"verify", since:<ref-or-files>})` returns a decision packet: changed files, post-edit diagnostics, affected symbol fan-out from compiler refs, likely tests touching the change, freshness verdict, `SOURCE_REQUIRED` warnings.
3. `graph_change_plan(symbol)` ranks affected files by compiler-backed ref counts; tree-sitter occurrences appear only as fallback or supplementary evidence, with provenance.
4. If the agent asks for raw evidence: `code_intel_references(symbol)` on the secondary MCP returns symbol-aware refs (preferred over text search per `00da467`), with `not_found` vs `not_collected` distinction.
5. On Pi or any host without a provider: the same packet works, but the `EVIDENCE:` block reads `tree-sitter+overlay only; code_intel unavailable (provider_missing: clangd/compile_commands not configured)`. No silent absence.

## Surface architecture (option C: hybrid, one front door)

```text
                 ┌────────────────────────────────────────────────┐
   Agent ──►     │   APG MCP (agent-facing primary)               │
                 │   graph_packet / graph_pull / graph_health     │
                 │   graph_consequences / graph_change_plan       │
                 │   graph_collect_code_intel (action verb)       │
                 └─────────────┬──────────────────────────────────┘
                               │ folds evidence into packets/briefs
                               ▼
                 ┌────────────────────────────────────────────────┐
                 │   Code-intel evidence layer                     │
                 │   (provider_runner + JSONL + freshness model)   │
                 └─────────────┬──────────────────────────────────┘
                               │ stable provider boundary
                               ▼
                 ┌────────────────────────────────────────────────┐
                 │   Provider(s)                                   │
                 │   - cpp-clangd (APG-owned, v1)                  │
                 │   - agent-code-intel adapter (optional)         │
                 │   - SCIP/LSIF importer (future)                 │
                 │   - other-language analyzers (future)           │
                 └────────────────────────────────────────────────┘

   Subagent ──►  ┌────────────────────────────────────────────────┐
                 │   Code-intel raw MCP (back door)                │
                 │   code_intel_definitions / references / hover   │
                 │   code_intel_diagnostics / symbols              │
                 └────────────────────────────────────────────────┘
                  (only used when parent-session packet is insufficient)
```

**Front door:** APG MCP. Agents call `graph_packet`, get evidence-enriched output. Discovery and recommended path always lead here.

**Back door:** code-intel raw MCP. Available, documented, but not the marketed surface. Subagents and edge-case tooling can call it. Default subagent pattern remains parent-session collection per `a3f0fde`.

**Wrapper command:** canonical implementation lives under `apg code-intel <subcommand>`; `aify-code-intel` is a thin PATH shim that forwards to `apg code-intel` for hosts that need a top-level binary on PATH (Claude `.lsp.json`, Pi `.pi-lsp.json`).

## Provider boundary contract (M0.5)

The boundary that APG, bridge, and any external provider (including `agent-code-intel`) share. v1 must specify:

### Provider capabilities

```jsonc
{
  "provider": "cpp-clangd",
  "version": "0.1.0",
  "languages": ["cpp"],
  "operations": ["definitions", "references", "hover", "diagnostics", "symbols"],
  "freshnessBasis": "compile_db_hash",   // git_commit | file_mtime | compile_db_hash | unknown
  "warmupRequired": true,
  "limits": { "maxBatchFiles": 256, "maxRequestMs": 30000 }
}
```

### Collection request

```jsonc
{
  "language": "cpp",
  "projectRoot": "/abs/path/to/repo",    // canonical anchor for path normalization
  "scope": "changed",                    // changed | files | all
  "files": ["src/foo.cpp", "src/bar.cpp"],   // repo-relative, forward-slash
  "since": "HEAD~1",                     // optional git ref
  "warmupBatch": ["include/foo.h"],
  "operations": ["definitions", "references", "diagnostics"]
}
```

### Collection response

```jsonc
{
  "collectionId": "ci-2026-05-09T12-34-56Z-abc123",   // unique per provider run
  "provider": "cpp-clangd",
  "providerVersion": "0.1.0",
  "projectRoot": "/abs/path/to/repo",
  "session": {
    "compileDbHash": "abc123",
    "warmedFiles": 18,
    "warmupMs": 1400,
    "collectedAt": "2026-05-09T12:34:56Z",
    "freshnessBasis": "compile_db_hash"
  },
  "operations": {
    "definitions": { "status": "ok",            "count": 42 },
    "references":  { "status": "partial",       "count": 318, "notCollectedFiles": ["src/baz.cpp", "src/qux.cpp"] },
    "diagnostics": { "status": "ok",            "count": 7 },
    "hover":       { "status": "not_collected", "reason": "not_requested" },
    "symbols":     { "status": "unsupported" }
  },
  "results": "<jsonl path or inline records>",
  "status": "ok"                         // ok | partial | error  (rolled up from operations)
}
```

**Path normalization rule:** every path emitted in the response, JSONL records, or error fields is **repo-relative and forward-slash normalized** against `projectRoot`. This rule is enforced on the provider side, not the consumer side. Cross-platform (Windows/WSL/Linux) consistency is a v1 acceptance criterion.

### Status taxonomy

**Roll-up status (response-level):**

- `ok` — every requested operation completed across every requested file.
- `partial` — at least one operation reported `partial` or per-file `not_collected`. Records present are valid; consumers must read per-operation status, never collapse `partial` into `ok` or `error`.
- `error` — collection failed before useful records could be produced. Must include `errors[].code` from a fixed set: `provider_missing`, `compile_db_missing`, `language_unsupported`, `wrapper_failed`, `language_server_missing`, `language_server_timeout`, `internal_error`.

**Per-operation status (`response.operations.<op>.status`):**

- `ok` — operation completed for every targeted file.
- `partial` — operation completed for some targeted files; `notCollectedFiles[]` lists the rest.
- `not_collected` — operation was not run (e.g., not requested, or short-circuited by warmup failure). Includes `reason`.
- `unsupported` — provider does not support this operation for this language.

### JSONL output schema

Records normalized to APG's neutral schema (extends `d7bf17a` foundation). Every record carries `collectionId` so imported facts trace back to the provider run that produced them, and identity fields strong enough to disambiguate C++ overloads.

```jsonc
{
  "kind": "definition",
  "collectionId": "ci-2026-05-09T12-34-56Z-abc123",
  "language": "cpp",
  "symbolId": "c:@N@ns@F@foo#I#",         // provider-stable USR / symbol id
  "qname": "ns::foo(int)",                // fully qualified including signature where relevant
  "signature": "void(int)",
  "container": "ns",                      // namespace/class/etc, may be empty
  "file": "src/foo.cpp",                  // repo-relative
  "range": { "start": {"line": 12, "col": 5}, "end": {"line": 12, "col": 8} },
  "confidence": "high",                   // high | medium | low — derived deterministically per kind/context/provider
  "provenance": "cpp-clangd@0.1.0",
  "freshness": "compile_db_hash:abc123"
}
{
  "kind": "reference",
  "collectionId": "ci-2026-05-09T12-34-56Z-abc123",
  "language": "cpp",
  "symbolId": "c:@N@ns@F@foo#I#",
  "qname": "ns::foo(int)",
  "container": "ns",
  "file": "src/bar.cpp",
  "range": {...},
  "context": "call_expr",                 // call_expr | virtual_call | template_inst | macro_expansion | other
  "confidence": "medium",                 // virtual_call/template_inst/macro_expansion lower than direct call_expr
  "provenance": "cpp-clangd@0.1.0"
}
{
  "kind": "diagnostic",
  "collectionId": "ci-2026-05-09T12-34-56Z-abc123",
  "language": "cpp",
  "file": "src/foo.cpp",
  "severity": "error",
  "message": "...",
  "range": {...},
  "provenance": "cpp-clangd@0.1.0"
}
```

**Confidence derivation rule:** providers either emit `confidence` directly or APG derives it from `(kind, context, provider)` using a deterministic table. Direct call references and definitions are `high`; virtual/template/macro contexts are at most `medium`; text-search-derived inferences are `low` and tagged provenance `INFERRED`, never `CODE_INTEL`.

### Wrapper expectations

- Wrapper command resolves project-local → bundled → global tool (lesson from `agent-code-intel` `3c3315a`).
- Wrapper exits with explicit error rather than silently downgrading when the language server is missing.
- Wrapper supports a `doctor` subcommand reporting tool versions and prerequisite state.
- Wrapper batch-warms same-language files before diagnostic collection (per `9cf2f94`).

### Out of v1 scope (defer to v2)

- Cross-provider deduplication (same fact from clangd + SCIP).
- Incremental collection deltas.
- Multi-language session in one provider call.
- Streaming partial results during a long collection.

## Wave 1 — Trust, density, verify mode (highest dogfood-grounded value)

Senior-dev's evidence (2026-04-20 A/B run, Phase 2 APG dogfood) shows the biggest agent gaps are **trace/cross-symbol context, inline trust/provenance, test/blast-radius, and post-edit feedback**. These are the v1 user-visible payoff.

### W1.1 — Inline provenance and trust

**Change:** every code-intel-derived fact in packets/briefs carries a provenance tag: `CODE_INTEL | EXTRACTED | INFERRED | OVERLAY`. `TRUST:` line in briefs separates graph-trust from code-intel-trust. `SNAPSHOT:` line includes `code_intel=<none|fresh|stale|partial>`.

**Acceptance:** packet rendering tests assert tags appear on every relevant section; brief rendering tests assert separated trust + snapshot fields.

### W1.2 — Cross-symbol context bundle

**Change:** `graph_pull(symbol)` and packet `EVIDENCE:` section return one bundle: definition(s), top references (compiler-backed when available, ranked), hover/signature, callers/callees with file context, recent diagnostics for owning files, tests likely touching the symbol. No fan-out across grep + read + graph required.

**Acceptance:** trace-A/B re-run shows non-regression on baseline trace tasks; cross-symbol bundle reduces median tool-calls-per-task on a fixture set; fact budget caps respected.

### W1.3 — Test / blast-radius mapping

**Change:** packets include "tests likely affected" derived from overlay test maps + (when available) compiler-backed refs from test source files into changed symbols. `graph_change_plan(symbol)` ranks affected files by compiler-backed ref count, with tree-sitter occurrences as supplementary evidence.

**Acceptance:** Phase 2 `pre-delete-impact` dogfood task re-run shows non-regression vs the brief-only baseline and improvement when compiler facts are present.

### W1.4 — `verify` mode (post-edit decision packet)

**Change:** new `graph_packet({mode:"verify", since:<git-ref>, files?:string[]})` mode. Returns: changed files, post-edit diagnostics, affected symbol fan-out (compiler refs preferred), likely tests touching the change, freshness verdict, `SOURCE_REQUIRED` warnings for safety-critical paths. Agent-pulled in v1; bridge file-watcher auto-emit deferred.

**Acceptance:** `verify` mode fixture tests cover (a) clean edit + fresh provider, (b) edit + stale provider (must surface stale warning), (c) edit + provider unavailable (must surface explicit unavailable + tree-sitter-only output), (d) edit touching audited code (must surface `SOURCE_REQUIRED`), and (e) edit + **partial** provider state — must render the partial status distinctly without collapsing it into either `unavailable` or `trusted`. Required surface text shape: `CODE_INTEL partial: diagnostics collected, references not_collected for N files`. At least one fixture exercises an untracked/new file via the `files[]` argument before a clean git ref exists.

### W1.5 — Fact budget policy and ranking

**Change:** every section that can carry code-intel records has explicit caps and the ranking order `changed_files → task_anchors → code_intel_confidence → recency`. Fact-budget unit tests gate every packet mode.

**Acceptance:** packet token-size benchmarks for `orient | plan | debug | review | audit | verify` stay within target budgets on Echoes, Sand Castle, and APG-self fixtures. Codex non-regression: trace/mem0 do not regress vs current `8f2923d` baseline.

### W1.6 — Three-state result rendering: `found` / `not_found_after_retry` / `not_collected`

**Change:** every consumer of code-intel results (`graph_change_plan`, `graph_pull`, `verify`, `audit`, packet rendering) renders the three states explicitly. Provenance includes whether the answer is grounded in actual collection, a confirmed empty result after warm-and-retry, or absence of collection.

**Acceptance:** unit tests cover all three states for each consumer; rendering tests assert no consumer ever silently returns "zero callers" without specifying which state it is in; partial-state acceptance from W1.4(e) is consistent with the three-state model.

## Wave 2 — Compiler facts where syntax fails (C++ provider)

Wave 2 builds the C++ provider that backs Wave 1's evidence-enriched output.

### W2.1 — Provider runner with wrapper-style resolution

**Change:** APG ships a provider runner that resolves wrappers project-local → bundled → global. Implements the boundary contract from M0.5. Doctor subcommand reports prerequisite state.

**Acceptance:** runner invokes a fixture provider, parses output, writes JSONL; doctor reports missing-tool/missing-DB states distinctly; wrapper-failed exit code maps to `wrapper_failed` status.

### W2.2 — C++ clangd provider v1

**Change:** APG-owned C++ provider using `compile_commands.json` + clangd. Implements definitions, references, hover, diagnostics, symbols. Batch-warms same-translation-unit files before collection per `9cf2f94`.

**Acceptance:** Echoes fixture (read-only) and Sand Castle fixture produce expected refs/diagnostics; warmup test asserts transient unresolved-symbol noise is absent vs un-warmed baseline; missing-compile-DB test produces `compile_db_missing` status with fix hint.

### W2.3 — Symbol-aware reference behavior

**Change:** `graph_pull(symbol)` and packet evidence prefer symbol-aware `references` over text-search hits (per `00da467`). Text-search refs appear only as `INFERRED` provenance, never as `CODE_INTEL`.

**Retry-and-record rule.** An empty symbol-aware result triggers warm-and-retry **only when** the provider reports the target as capable (provider available, language supported, prerequisites met, the queried file is in the warmup batch). Empty results on a non-capable target short-circuit to `not_collected` with reason; they do not enter the retry loop.

**Three-state record.** The persisted result distinguishes:
- `found` — symbol-aware refs returned at least one record.
- `not_found_after_retry` — capable-target empty result confirmed by a warm-and-retry pass.
- `not_collected` — provider was not asked, was not capable, or short-circuited (with `reason`).

**Acceptance:**
1. A method name shared across two unrelated classes returns only the queried class's refs via the symbol-aware path; text-search-only path returns the superset and is tagged `INFERRED`.
2. Capable-target empty result triggers exactly one warm-and-retry pass and persists `not_found_after_retry`.
3. Non-capable target persists `not_collected` and never enters the retry loop.
4. Consumer renders the three states distinctly; no consumer ever collapses `not_found_after_retry` into `not_collected` or vice versa.

### W2.4 — Diagnostics on changed files folded into packets

**Change:** `verify` and `debug` modes surface diagnostics for changed files (and dependent files in the warmup batch) automatically, ranked by severity and recency.

**Acceptance:** `verify` packet shows post-edit diagnostics without a separate build invocation; debug packet ranks "READ FIRST" files by diagnostic count + recency.

### W2.5 — External `agent-code-intel` adapter (optional)

**Change:** when external `agent-code-intel` is on PATH, APG can route compatible languages (PHP, TypeScript, Python, YAML) through it via the same provider boundary. Adapter implements provider capabilities by introspecting the wrapper.

**Acceptance:** adapter reports `agent-code-intel` languages as available; APG packet on a PHP fixture uses adapter-supplied evidence; adapter-missing falls back to tree-sitter cleanly.

**Explicit non-dependency.** APG's C++ provider (W2.2) does **not** wait on `agent-code-intel` adding C++ support. APG owns the C++ provider implementation. `agent-code-intel` is the design/reference for wrapper-and-host patterns and the optional adapter for non-C++ languages. Schedule, scope, and acceptance for the C++ provider are independent of the external repo's roadmap.

### W2.6 — Code-intel freshness model (M3.5)

**Change:** APG tracks per-snapshot: repo commit indexed by APG, commit/file state collected by code-intel, `compile_commands.json` hash/time, provider version, dirty files included/excluded, stale reason. `graph_health` reports both axes.

**Acceptance:** "graph fresh, facts stale" state is detected and surfaced as `code_intel=stale` in briefs and `TRUST:` lines.

## Wave 3 — Plumbing that prevents regression

These items are required support, not user-visible features. Without them, Wave 1/2 regress agent behavior.

### W3.1 — Codex token-tax control

**Change:** `graph_packet` remains the Codex-first surface. Code-intel facts collapse into existing modes; no low-level LSP verbs added to APG MCP. Any new MCP tool added to APG primary surface requires a packet-token benchmark gate.

**Acceptance:** Codex A/B non-regression on trace, search, orient, mem0 fixtures vs `8f2923d` baseline.

### W3.2 — Subagent reach (parent-session pattern)

**Change:** APG plugin manifests for Claude expose both APG primary MCP and the secondary code-intel MCP (mirrors ACI `fed897b`). **Default workflow:** parent session collects code-intel into a packet; packet is passed into subagent prompts (per `a3f0fde`). Direct subagent code-intel use is supported but not required.

**Acceptance:** marketplace install validation includes a Claude subagent smoke test that reads a parent-collected packet without calling code-intel directly; a separate test confirms direct subagent code-intel works when host permits.

### W3.3 — Provider failure fix hints

**Change:** every provider error status emits a structured fix hint:

```jsonc
{
  "code": "compile_db_missing",
  "message": "compile_commands.json not found at <project root>",
  "hint": "run `cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON ...` or set --no-code-intel to silence"
}
```

**Acceptance:** all `errors[].code` values from the M0.5 taxonomy have associated hint text; hint text appears in packet `EVIDENCE:` block when relevant mode is active (`debug | verify | audit`).

### W3.4 — Pi graceful-unavailable contract

**Change:** Pi base install never requires a provider. `graph_health` reports `codeIntel.available=false reason="provider_missing"`. Packets include compact negative evidence: `EVIDENCE: tree-sitter+overlay only; code_intel unavailable (provider_missing: clangd/compile_commands not configured).` Install hint included only in `debug | verify | audit` modes. Optional: project ships `.pi-lsp.json` pointing Pi native LSP at `aify-code-intel serve-lsp <lang>` (mirrors `2be8df4`).

**Acceptance:** Pi install test produces useful packets with no clang/LSP installed; Pi install + `.pi-lsp.json` opt-in test routes Pi native LSP through wrapper.

### W3.5 — Bridge integration contract

**Change:** bridge consumes APG's public verbs only. Bridge does not write `.aify-graph/` artifacts. Project card surfaces `codeIntel.available | provider | status | indexedCommit | compileDbHash | diagnosticsSummary | lastError`. Bridge actions ("rebuild graph", "collect code-intel", "regenerate briefs/packets") call the same public verbs agents call.

**Acceptance:** bridge contract tests assert no direct artifact writes; trigger UI calls `graph_collect_code_intel({language, scope})` and renders status updates.

## Milestone roadmap

Synthesizes the original M0-M7 with senior-dev's M0.5/M2.5/M3.5/M7.5 and Wave priorities.

| Milestone | Title | Wave | Notes |
|-----------|-------|------|-------|
| M0 | Repo and packaging audit | — | + audit `.lsp.json`/`.mcp.json` patterns; decide APG-owned wrapper vs external; add Claude dual-surface validation. |
| **M0.5** | **Provider boundary spec** | — | Write contract before more C++ code. Adopt fields + status taxonomy from this superplan. |
| M1 | Code-intel neutral schema | W1/W2 | Already partially landed (`d7bf17a`). Add `provenance`, `freshness`, `freshnessBasis`, `not_found` vs `not_collected` markers. |
| **M2** | **Provider runner + C++ clangd provider** | W2 | Renamed from "C++ clangd backend." Wrapper-style resolution + batch warmup are acceptance criteria, not polish. |
| **M2.5** | **Host wrapper + manifest strategy** | W2/W3 | Implement `apg code-intel` canonical + `aify-code-intel` PATH shim. Claude `.lsp.json`, `.mcp.json`, Codex MCP, Pi `.pi-lsp.json` opt-in. |
| M3 | APG graph merge and query upgrade | W1/W2 | Compiler-backed refs override syntax for same symbol; provenance preserved through merge; trust separation. |
| **M3.5** | **Code-intel freshness model** | W2 | Per-snapshot freshness tracking; `graph_health` reports both axes. |
| **M4** | **Agent packet v2 + verify mode + fact budget** | W1 | `verify` mode lands; provenance tags universal; fact budget caps + ranking enforced; `not_found` vs `not_collected` rendered. |
| M5 | Bridge integration contract | W3 | Adds code-intel project card fields + public action verbs. |
| M6 | Human UI paths (bridge-owned) | W3 | Project setup wizard detects compile DB; "compiler-backed refs available" status; collection triggers. |
| **M7** | **Evaluation and release gate** | All | Bench matrix: no-graph, tree-sitter only, +code-intel import, +packet, +verify. C++ fixture with warmed batch. |
| **M7.5** | **Cross-runtime install lab** | W3 | Scripted host validation: Claude plugin cache, `.mcp.json`, Codex install, OpenCode lean MCP, Pi base, Pi `.pi-lsp.json`. |

### Critical path

M0.5 → M1 → M2 → M3 → M4 → M7. M2.5/M3.5 parallel with M2/M3. M5/M6 parallel with M4. M7.5 gates release.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Codex token tax from added evidence | Fact budget policy (W1.5); benchmark gate in M7. |
| Agents over-trust silent absence | `not_found` vs `not_collected` invariant (W1.6); explicit Pi unavailable EVIDENCE block (W3.4). |
| Pi/baseline regression | Provider unavailable contract (W3.4); CI lane that runs without provider. |
| Windows/WSL native module instability | `better-sqlite3` self-heal stays; provider binaries are separate optional capabilities. |
| Wrapper PATH dependence | Doctor subcommand + structured fix hints (W3.3); explicit error exits (no silent downgrade). |
| Compiler-backed overconfidence (virtual dispatch, generated code) | Provenance + confidence tags (W1.1); audit-mode `SOURCE_REQUIRED` (W1.4). |
| Subagent code-intel availability varies by host | Parent-session evidence pattern is default (W3.2); direct subagent use is opportunistic per `a3f0fde`. |
| Generated/codegen visibility (#3 from gap list) | Deferred from Wave 1; revisit when Echoes/Sand Castle dogfood justifies. |

## Open questions deferred to implementation

- Cross-provider deduplication (clangd + SCIP for the same fact). Defer to v2 of provider boundary.
- Streaming partial results during long collections. Defer.
- Multi-language session in one provider call. Defer.
- Bridge file-watcher auto-emission of `verify` packets. Defer to bridge milestone after agent-pulled v1 lands.
- Codegen visibility. Defer pending dogfood evidence.
- TypeScript/Python first-party providers (vs external `agent-code-intel` adapter). Defer; C++ is v1 target.

## Validation plan

Three loops, all required for release:

1. **Unit + fixture tests** — every milestone has acceptance tests in this document; PRs cannot merge without them.
2. **Dogfood A/B re-run** — re-run the 2026-04-20 the reviewer tasks after M4 lands. Trace, search, orient, mem0 must non-regress; trust assessment and pre-delete-impact must show non-regression and improve when code-intel is present.
3. **Cross-runtime install lab (M7.5)** — Claude plugin cache, Claude `.mcp.json`, Codex plugin install, OpenCode lean MCP, Pi base (no provider), Pi opt-in (`.pi-lsp.json`). Scripted where possible; documented where manual host checks remain.

## Decision log

| Decision | Resolution | Source |
|----------|-----------|--------|
| Coupling | First-class subsystem behind provider boundary | senior-dev draft + Steven |
| Surface | Option C — one front door (packet), back-door raw MCP | brainstorm convergence |
| Headline language | C++ | Steven |
| Wrapper naming | `apg code-intel ...` canonical + `aify-code-intel` PATH shim | O2 |
| Pi unavailable UX | Compact explicit negative evidence in packet | O3 |
| Public collection verb | `graph_collect_code_intel({language, scope, files[]})` | O4 |
| Provider contract scope | v1 fields locked above; v2 deferrals listed | O5 |
| Decision-after-edit mode | `verify`, agent-pulled in v1, watcher-emit deferred | O1 |
| Fact budget ranking | `changed_files → task_anchors → code_intel_confidence → recency` | O6 |
| Three-state results | `found` / `not_found_after_retry` / `not_collected` required everywhere | O6 + senior-dev review |
| Provider contract identity + traceability | `collectionId`, `projectRoot`, repo-relative paths, `symbolId`/`qname`/`signature`/`container`/`language`, per-operation status, `confidence` | senior-dev review |
| External ACI adapter coupling | C++ v1 explicitly does not wait on ACI; APG owns C++ provider | senior-dev review |

## Next step

After Steven's review, invoke `superpowers:writing-plans` to produce the implementation plan with TDD-shaped milestones, test fixtures, and review gates per the milestone roadmap above.
