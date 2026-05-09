# APG + Agent Code Intel Merge Plan Draft

> **Author:** graph-senior-dev
> **Date:** 2026-05-09
> **Status:** independent draft for merge with graph-tech-lead's superplan
> **Reference delta checked:** `reference/agent-code-intel` at `9cf2f94` vs the older snapshot baseline used by `docs/superpowers/plans/2026-05-06-next-gen-code-intel-bridge-plan.md`.

## Short Answer

The new `agent-code-intel` commits do not invalidate the APG plan, but they do change the coupling target.

My recommendation: **do not vendor `agent-code-intel` wholesale into APG, and do not keep it as a loose optional afterthought.** Treat code-intel as a **first-class APG subsystem behind a stable evidence-provider boundary**:

- APG remains the product brain: graph, overlays, tasks, briefs, packets, trust, dirty seams, dashboard data, marketplace install shape.
- Code-intel becomes APG's precision evidence plane: definitions, references, diagnostics, hovers, symbols, compiler/LSP/analyzer facts.
- The bridge app remains the workspace/team shell: folders, projects, agents, sessions, task UI, graph cards, evaluation history.
- `agent-code-intel` is the design/reference implementation for the LSP/MCP wrapper pattern. Reuse ideas aggressively; copy code only deliberately after license/ownership and packaging constraints are clear.

In product terms: APG should become **graph + overlay + packet + code-intel evidence**, not just tree-sitter graph with an optional importer bolted on.

## Evidence Checked

Files and changes reviewed:

- `docs/superpowers/plans/2026-05-06-next-gen-code-intel-bridge-plan.md`
- `reference/agent-code-intel` log from `1235a5a` to `9cf2f94`
- `reference/agent-code-intel/.claude-plugin/plugin.json`
- `reference/agent-code-intel/.codex-plugin/plugin.json`
- `reference/agent-code-intel/.lsp.json`
- `reference/agent-code-intel/.mcp.json`
- `reference/agent-code-intel/README.md`
- `reference/agent-code-intel/docs/ARCHITECTURE.md`
- `reference/agent-code-intel/docs/TESTING.md`
- `reference/agent-code-intel/skills/agent-code-intel/SKILL.md`
- `reference/agent-code-intel/src/mcp-server.js`
- APG commits `d7bf17a` (`feat: add code-intel import foundation`) and `8f2923d` (`feat: add workflow modes to graph_packet`)

Relevant reference commits:

- `3c3315a` routes Claude LSP through `agent-code-intel serve-lsp <language>` instead of direct language-server binaries.
- `fed897b` exposes code-intel MCP tools to Claude subagents through `.mcp.json`.
- `ed785c6` updates guidance after host retest.
- `9cf2f94` warms same-language diagnostic batches before collection.

## What Changed Since The Original Plan

### 1. Wrapper routing is now the real host boundary

The older plan could still read like "APG starts clangd or imports a JSONL produced by something else." The updated reference shows a stronger pattern:

```text
host runtime -> stable wrapper command -> language adapter -> language server/analyzer
```

For Claude, `.lsp.json` now points at:

```json
{"command": "agent-code-intel", "args": ["serve-lsp", "php"]}
```

and `.mcp.json` points at:

```json
{"command": "agent-code-intel", "args": ["mcp-server", "php"]}
```

That wrapper pattern matters for APG because it solves three problems we would otherwise rediscover:

- Host manifests stay stable even when underlying tools differ per project.
- The wrapper can prefer project-local, bundled, then global tools.
- Claude main sessions and Claude subagents can reach the same evidence layer through different surfaces.

### 2. Claude subagent MCP exposure is now a first-class requirement

The original APG plan focused on Claude Code full MCP surface and skills. The reference update proves Claude plugins can expose both native LSP and MCP tools in the same package:

- main Claude session gets native IDE-style LSP facts;
- Claude subagents get explicit bounded MCP tools when native LSP is unavailable or not selected.

APG should mirror that. A future APG marketplace plugin should not assume Claude subagents can only consume static briefs or APG's normal graph MCP. They should also be able to call bounded code-intel tools or APG packet modes that include code-intel provenance.

### 3. Diagnostic warmup is not an optimization; it is correctness scaffolding

`files_diagnostics` now opens every same-language file in a batch before collecting diagnostics, then waits briefly. That closed transient false positives around newly added cross-file symbols.

For APG's C++ pipeline this means "ask clangd for facts" is not enough. Any LSP-backed importer must have an explicit warmup model:

- open the translation unit batch;
- include headers or changed files likely to participate in the same symbol set;
- wait a bounded warmup;
- then collect diagnostics/definitions/references.

This should become part of M2 acceptance, not a later performance polish item.

### 4. Host validation has become more concrete, but Codex/Pi remain open

The reference repo now has real Claude consumer-install validation:

- marketplace cache includes source files;
- wrapper doctor runs;
- Claude native LSP starts through `.lsp.json`;
- Claude subagents can load LSP when selected;
- Claude MCP tools are available through `.mcp.json`;
- PHP references and Laravel hovers work in real repos.

It still leaves Codex plugin loading and Pi package loading as explicit validation gaps. That aligns with APG's Pi/Linux caution: base graph must work without LSP, clang, PHP tooling, or analyzer dependencies.

## Coupling Decision

### Rejected: loose optional backend only

The current draft's "optional APG precision backend" framing is safe, but undersells the product. It risks making code-intel invisible to the packet/brief/dashboard workflows that agents actually use.

If code-intel only appears as a manual import command, agents will keep overusing tree-sitter graph output and then manually cross-check with `rg`. That loses the whole point.

### Rejected: vendored-in monolith

Vendoring all of `agent-code-intel` into APG would blur ownership and increase install friction:

- APG currently serves many languages through tree-sitter without requiring language-server stacks.
- Pi/base installs must remain light.
- `agent-code-intel` already has its own marketplace shape and runtime concerns.
- Code-intel tools evolve by language and analyzer; APG evolves by graph/agent workflow.

Copying everything into APG would make the base plugin heavier while not directly improving briefs or packets.

### Chosen: first-class subsystem behind a provider boundary

APG should define a **code-intel provider boundary** and ship at least one built-in provider path for C++.

Provider boundary:

```text
provider capabilities -> bounded collection request -> CODE_INTEL records -> APG merge -> packet/brief/query rendering
```

Provider examples:

- `cpp-clangd` built into APG or shipped as APG-owned optional tool.
- `agent-code-intel` adapter that shells out to a compatible wrapper when installed.
- future SCIP/LSIF importer.
- future analyzer providers for TypeScript, Python, PHP, or project-local static tools.

This gives APG a first-class code-intel story without forcing every install to carry every language stack.

## Surfaces That Should Change

### Packets

`graph_packet` should become the primary consumer of code-intel evidence.

Changes:

- Add `EVIDENCE:` or `CODE_INTEL:` section when imported facts exist.
- Show confidence/provenance per high-value fact: `CODE_INTEL`, `EXTRACTED`, `INFERRED`, `OVERLAY`.
- In `debug` and `review` modes, include diagnostics for `READ FIRST` files when available.
- In `plan` mode, use code-intel refs to improve caller/load/risk summaries.
- In `audit` mode, keep source verification mandatory even with code-intel; references improve starting points, not final authority.

Packet should stay overlay-first. Code-intel enriches the packet; it must not make packet unusable when unavailable.

### Briefs

Briefs should expose code-intel availability and age without dumping LSP data.

Changes:

- `SNAPSHOT:` line should include `code_intel=<none|fresh|stale|partial>`.
- `TRUST:` should separate graph trust from code-intel trust.
- Feature `load:` metrics should prefer code-intel reference edges when available.
- C++/LSP diagnostics should appear only as compact counts and top risks, not raw diagnostics.
- `brief.plan.md` should say which features have compiler-backed evidence.

### MCP verbs

Keep the lean graph surface, but make code-intel facts visible through existing APG verbs:

- `graph_health()` reports provider availability, backend, age, drift, and missing prerequisites.
- `graph_packet()` is the preferred high-level surface.
- `graph_pull()` shows code-intel definitions/references when present.
- `graph_consequences()` uses code-intel references for affected files and tests.
- `graph_change_plan()` uses code-intel caller/reference counts before falling back to tree-sitter/source occurrence.

Avoid adding a large number of low-level LSP verbs to APG's default surface. If direct LSP tools are needed, expose them through the provider or bridge, not as APG's main UX.

### Dashboard

Dashboard should show code-intel status as project health, not as a developer-only detail.

Project card additions:

- code-intel backend: `none`, `cpp-clangd`, `agent-code-intel`, `scip`, etc.
- compile database detected/missing.
- last code-intel collection time and commit.
- stale vs source/compile DB.
- diagnostics count by severity.
- provider errors with fix hints.

Dashboard should let a human trigger "collect code-intel for this project" without knowing the CLI command.

### Install paths and marketplace manifests

Install docs need to adopt the wrapper lesson.

APG should provide:

- base install: Node + SQLite + tree-sitter, no clang/LSP required;
- optional code-intel capability: wrapper command or provider tool installed on demand;
- Claude plugin metadata that can expose both APG MCP and code-intel wrapper surfaces where supported;
- Codex MCP path that remains lean by default;
- Pi base mode that reports code-intel unavailable rather than failing.

If APG ships its own wrapper, use an APG-owned command name such as:

```text
aify-code-intel serve-lsp cpp
aify-code-intel collect cpp --repo <repo>
```

If APG delegates to `agent-code-intel`, install docs should say that explicitly and make it optional.

## Milestone Rework

### Survives mostly as-is: M0 - Repo and packaging audit

Keep it, but add:

- audit `.lsp.json` + `.mcp.json` manifest behavior from `agent-code-intel`;
- decide whether APG ships its own wrapper or adapts to the external wrapper;
- add marketplace validation for Claude dual LSP/MCP exposure;
- add host validation checklist based on reference `docs/TESTING.md`.

### Survives: M1 - Code-intel neutral schema

This remains correct and is already partially implemented by `d7bf17a`.

Small rework:

- record provider identity and collection mode more explicitly;
- support batch/session metadata such as warmed files, wait time, compile DB hash, and provider version;
- keep schema provider-neutral so `agent-code-intel`, `clangd`, SCIP, and analyzers can all feed the same import path.

### Needs rework: M2 - C++ clangd backend v1

Current wording says "starts clangd or uses clangd-index-compatible output." After the reference update, M2 should become:

**M2 - Code-intel provider runner + C++ clangd provider**

Deliverables:

- provider runner with wrapper-style resolution;
- C++ clangd provider using `compile_commands.json`;
- batch warmup before diagnostics/reference collection;
- JSONL output into APG's neutral schema;
- graceful missing-tool/missing-compile-db status;
- optional integration with external `agent-code-intel` if it grows C++ support.

The key change is that wrapper/provider lifecycle is not incidental. It is the milestone.

### Survives with stronger requirements: M3 - APG graph merge and query upgrade

Keep M3, but make code-intel evidence first-class in user-visible outputs:

- merge precedence prefers direct code-intel facts;
- trust model separates syntax graph, overlay map, and code-intel freshness;
- verbs explain when code-intel is unavailable or stale;
- weak tree-sitter C++ references cannot silently override stronger compiler facts.

### Survives: M4 - Agent packet v2

`8f2923d` already adds workflow modes. The next packet work should not invent new workflow modes; it should teach existing modes to consume code-intel.

Mode implications:

- `orient`: show whether code-intel exists and which files are compiler-backed.
- `plan`: use references/load/risk from code-intel where present.
- `debug`: include diagnostics and likely failing files.
- `review`: include changed-file diagnostics and reference blast radius.
- `audit`: include `SOURCE_REQUIRED` even when code-intel looks strong.

### Needs expansion: M5 - Bridge integration contract

Bridge contract should include code-intel state.

Add project card fields:

- `codeIntel.available`
- `codeIntel.provider`
- `codeIntel.status`
- `codeIntel.indexedCommit`
- `codeIntel.compileDbHash`
- `codeIntel.diagnosticsSummary`
- `codeIntel.lastError`

Add bridge actions:

- trigger APG graph rebuild;
- trigger code-intel collection;
- regenerate briefs/packets;
- show stale/missing provider fix hints.

### Survives but belongs mostly in bridge: M6 - Human UI paths

Keep this as bridge-owned, but add UI for code-intel:

- project setup wizard detects `compile_commands.json`;
- shows "compiler-backed refs available" vs "syntax-only graph";
- lets user run/re-run code-intel collection;
- shows stale/missing diagnostics without blocking base graph use.

### Needs expansion: M7 - Evaluation and release gate

Add explicit host/runtime tests inspired by `agent-code-intel`:

- Claude main-session LSP wrapper smoke.
- Claude subagent MCP smoke.
- Codex MCP install/load smoke.
- Pi base install with no code-intel dependencies.
- Pi optional provider status check.
- C++ fixture with warmed diagnostic batch.

Bench matrix should compare:

- no graph/no LSP;
- APG tree-sitter only;
- APG + code-intel import;
- APG packet with code-intel;
- direct code-intel evidence without APG packet, to prove APG adds agent workflow value.

## New Milestones I Would Add

### M0.5 - Provider Boundary Spec

Before more C++ implementation, write the exact provider contract.

Deliverables:

- `docs/integrations/code-intel-provider-contract.md`
- provider capability JSON shape;
- collection request/response shape;
- status/error taxonomy;
- mapping from provider output to `.aify-graph/code-intel/*.jsonl`;
- wrapper command expectations.

Acceptance:

- APG can describe an unavailable provider without failing.
- APG can import a fixture provider output.
- Bridge can display provider status from manifest JSON.

### M2.5 - Host Wrapper And Manifest Strategy

Decide and implement one of two strategies:

1. APG ships `aify-code-intel` wrapper for C++ and later providers.
2. APG can call external `agent-code-intel` where installed, and ships only C++ provider tooling itself.

My lean: **APG should ship an APG-owned C++ provider wrapper, while keeping an adapter path for external `agent-code-intel`.**

Reason: C++/Echoes is APG's urgent need, while `agent-code-intel` currently focuses PHP/TS/Python/YAML. We should not block C++ precision on another repo's language roadmap.

### M3.5 - Code-Intel Freshness Model

Tree graph freshness and code-intel freshness are related but not identical.

Track:

- repo commit indexed by APG;
- commit/file state collected by code-intel;
- `compile_commands.json` hash/time;
- provider version;
- dirty files included/excluded from collection;
- stale reason.

This prevents a dangerous state where APG graph is fresh but code-intel facts are stale.

### M7.5 - Cross-Runtime Install Lab

Turn the reference repo's host validation pattern into an APG release gate:

- Claude plugin cache install;
- Claude `.mcp.json` exposure;
- Codex plugin install;
- OpenCode lean MCP install;
- Pi base install;
- optional C++ provider missing-tool path;
- optional C++ provider available path.

This should be scripted where possible and documented where manual host checks are unavoidable.

## Runtime And Install Risks

### Pi/Linux baseline

Risk: code-intel makes the base install heavy or brittle.

Position: Pi/base APG must never require clangd, compile DB, language servers, PHPStan, Pyright, or TypeScript language server. It should install and serve packets/briefs using tree-sitter and overlays only.

Required behavior:

```text
codeIntel.available=false
codeIntel.reason="provider_missing"
baseGraph.available=true
```

### Windows/WSL native modules

APG already has `better-sqlite3` native-module self-healing. Code-intel providers should not destabilize that.

Provider binaries should be separate optional capabilities, not hidden install-time requirements for the APG MCP server.

### Claude PATH wrapper dependence

The reference repo now depends on `agent-code-intel` being on `PATH` for Claude LSP. That is valid, but APG docs must make failure modes obvious:

- wrapper missing;
- wrapper present but clangd missing;
- compile DB missing;
- provider starts but target repo unsupported.

Agents need fix hints, not just "tool failed."

### Codex effective-token tax

Codex was sensitive to varied MCP call sequences and skill verbosity. Merging code-intel must not reintroduce a large instruction or tool-output tax.

Rule: `graph_packet` remains the Codex-first surface. Low-level code-intel evidence must be summarized into packets/briefs unless the user asks for raw facts.

### Overconfidence risk

Compiler-backed facts are stronger than tree-sitter facts, but still not omniscient:

- virtual dispatch can be incomplete;
- generated code may be missing;
- compile DB can omit files;
- stale provider output can look precise.

APG must render confidence and freshness in packets, briefs, and safety decisions.

## My Proposed Superplan Shape

1. **Update plan thesis.**
   Replace "optional code-intel backend" with "first-class precision evidence subsystem behind a provider boundary."

2. **Write provider contract.**
   Do this before more implementation so APG, bridge, and possible `agent-code-intel` adapters share one boundary.

3. **Keep APG graph/packet ownership.**
   Code-intel never becomes the user-facing planning brain. It feeds APG.

4. **Implement C++ provider in APG lane.**
   Do not wait for `agent-code-intel` to add C++. Use the wrapper/provider lessons from it.

5. **Mirror dual-surface host integration.**
   Claude can have native LSP and MCP; Codex gets MCP; Pi gets proxy/base status. Marketplace manifests should reflect this explicitly.

6. **Promote code-intel to briefs/packets/dashboard.**
   If users only see it through raw import commands, it will not change agent behavior.

7. **Validate with real C++ tasks.**
   Sand Castle for fast smoke, Echoes read-only for real C++ pain, APG self for regression.

## Suggested Edits To The Existing Plan

Concrete patch targets later:

- Rename "Code-intel backend strategy" to "Code-intel provider subsystem."
- Add `M0.5 - Provider Boundary Spec`.
- Reframe M2 as "Provider runner + C++ clangd provider."
- Add batch warmup to M2 testing and acceptance.
- Add code-intel status fields to M5 bridge contract.
- Add Claude `.mcp.json` subagent path to marketplace/runtime compatibility.
- Add host-wrapper validation from reference `docs/TESTING.md` to M7.
- Move "Is `agent-code-intel` available for direct reuse?" from open question to decision: design/reference now, code reuse only after ownership/package review.

## Open Questions For The Superplan

1. Should APG ship an APG-owned wrapper command, or should it depend on `agent-code-intel` for wrapper behavior?
   My answer: APG-owned wrapper for C++ v1, external adapter optional.

2. Should Claude APG plugin expose a separate code-intel MCP server, or should APG MCP own code-intel collection/query verbs?
   My answer: APG MCP owns packet/query integration; a separate provider MCP can exist for low-level evidence, but should not be the primary APG surface.

3. Should code-intel collection happen during `graph_index`, `graph-build-all`, or as an explicit follow-up?
   My answer: explicit follow-up in v1, with `graph-build-all` allowed to recommend/run it when prerequisites are present. Avoid surprising first-index latency.

4. Should bridge write code-intel artifacts?
   My answer: no. Bridge should trigger APG/provider actions and display status. APG owns artifacts.

## Final Position

The new reference commits are additive but strategically important. They prove the right abstraction is not "direct LSP server in every host"; it is a stable wrapper/provider layer that normalizes host differences and feeds bounded evidence to agents.

For APG, the next-generation version should be:

```text
APG = graph + overlays + tasks + briefs + packets + trust + code-intel evidence
Bridge = workspace/team/application shell over APG projects
Code-intel provider = precise language/compiler/analyzer facts, optional per runtime
```

That is stronger than the current draft's optional-backend framing and safer than vendoring the whole LSP project into APG.
