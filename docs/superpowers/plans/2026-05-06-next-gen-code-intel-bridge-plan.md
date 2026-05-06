# aify-project-graph next-generation plan: code-intel engine + bridge app

> **Status:** Draft v1, branch `plan/next-gen-code-intel-bridge`.
> **Date:** 2026-05-06.
> **Goal:** rebuild APG into a precision-backed agent work substrate for C++ projects
> like Echoes and Sand Castle, while keeping Claude Code, Codex, OpenCode,
> oh-my-pi / Pi-style Linux installs, and marketplace packaging viable.
>
> **For agentic workers:** use the same execution discipline as prior
> superpowers plans: brainstorm before implementation, then execute
> milestone-by-milestone with tests and evidence at each gate.

## Executive decision

Do **not** replace `aify-project-graph` with a C++ code-intel tool.

Instead:

- `aify-project-graph` remains the **local per-repo agent graph engine**:
  `.aify-graph/`, SQLite, briefs, packets, MCP verbs, dashboard data.
- A new optional **code-intel backend layer** feeds APG precise language
  facts, starting with C++ via `compile_commands.json` + clangd/LSP.
- `aify-agents-bridge` becomes the **workspace application**:
  folders, agents, sessions, tasks, human editing UI, multi-repo graph views,
  telemetry, marketplace install orchestration.

This preserves the part that already works: local briefs and packets with no
server round trip. It also fixes the part that is weakest on Echoes/Sand
Castle: tree-sitter-only C++ call/reference accuracy.

## Brainstorm outcome

Options considered:

1. **Replace APG with a C++ code-intel tool.** Rejected. It improves C++
   precision but loses briefs, tasks, features, dashboards, packets, and
   runtime integrations.
2. **Merge APG into bridge.** Rejected. APG is Node + SQLite + tree-sitter;
   bridge is a workspace control plane. Merging creates runtime and packaging
   friction without improving agent results.
3. **Make APG multi-repo natively.** Rejected for now. Per-repo truth keeps
   freshness and local file artifacts simple; bridge can fan out across repos.
4. **Add code-intel as an optional APG precision backend.** Chosen. This gives
   C++ projects compiler-aware references while preserving the universal
   tree-sitter baseline and the current brief-first workflow.

## Product target

The target user experience is:

1. User opens a workspace folder in the bridge app.
2. The folder has projects.
3. Each project has graph status, tasks, features, docs, and indexed code facts.
4. Each folder/project can have agents and sessions attached.
5. Agents receive small task-shaped packets, not raw graph dumps.
6. Humans can edit feature/task maps in UI; agents can edit them through skills.
7. APG remains installable directly into Claude Code, Codex, OpenCode, and
   Pi-style Linux environments without requiring the bridge app.

## Non-goals

- No Python rewrite of APG.
- No monolithic merge of APG into bridge.
- No mandatory clang/LLVM dependency for every install.
- No cloud service requirement.
- No LLM-written graph truth.
- No broad new verb explosion. New surfaces must reduce agent work, not just
  expose more internals.

## Design principles

1. **Local file artifacts first.** Agents win when context is already on disk:
   briefs, packets, manifests, dashboard JSON.
2. **Compiler facts override syntax guesses.** When code-intel facts exist,
   APG should prefer them over tree-sitter inferred edges.
3. **Optional precision.** The universal tree-sitter baseline must work on Pi,
   small Linux boxes, and repos without compile databases.
4. **Bridge wraps, APG owns.** Bridge reads/writes APG schemas and launches APG
   actions; APG does not import bridge.
5. **Every claim is testable.** Each milestone has unit tests, fixture tests,
   and at least one agent-task benchmark.

## Architecture

```text
Claude Code / Codex / OpenCode / Pi agent
        |
        v
APG MCP stdio server
        |
        +-- tree-sitter baseline extractor
        +-- code-intel import layer
        |       +-- cpp-clangd backend (first)
        |       +-- SCIP/LSIF import backend (later)
        |       +-- external agent-code-intel import (adapter)
        |
        +-- SQLite graph + manifest + briefs + packets
        |
        v
.aify-graph/
  graph.sqlite
  manifest.json
  brief.*.md/json
  functionality.json
  tasks.json
  code-intel/*.json

aify-agents-bridge
        |
        +-- workspace/folder/project model
        +-- agents and sessions
        +-- task tracker sync
        +-- feature/task editor UI
        +-- graph dashboard embedding
        +-- multi-repo search over APG artifacts
```

## Contract between APG and bridge

APG owns:

- `.aify-graph/graph.sqlite`
- `.aify-graph/manifest.json`
- `.aify-graph/brief.*`
- code extraction and code-intel import
- MCP verbs and runtime skills
- per-repo dashboard data endpoints

Bridge owns:

- workspace/folder/project registry
- agent/session lifecycle
- tracker integrations
- task and feature editing UI
- multi-repo graph views
- telemetry and evaluation history
- marketplace install orchestration

Shared file schemas:

- Bridge writes `.aify-graph/tasks.json`.
- Bridge writes `.aify-graph/functionality.json`.
- APG validates and consumes both.
- APG writes `.aify-graph/brief.json`, `manifest.json`, and dashboard JSON.
- Bridge reads those files for fast UI cards without launching live verbs.

## Code-intel backend strategy

### Why not LSP-only?

LSP is useful, but it is an interactive protocol. Batch indexing through
`textDocument/*` calls can be slow, stateful, and hard to reproduce.

For v1, we use LSP/clangd pragmatically because it is already available in C++
developer environments and understands `compile_commands.json`. We hide it
behind an import format so we can later swap to SCIP/LSIF/libclang without
changing APG's graph schema.

### Code-intel import format

New file family:

```text
.aify-graph/code-intel/
  code-intel.manifest.json
  cpp-clangd.symbols.jsonl
  cpp-clangd.refs.jsonl
  cpp-clangd.includes.jsonl
  cpp-clangd.diagnostics.jsonl
```

Minimum records:

```json
{"kind":"symbol","id":"...","language":"cpp","qname":"ChunkManager::setVoxel","type":"Method","file":"engine/voxel/ChunkManager.cpp","line":474,"usr":"clang-usr"}
{"kind":"reference","from":"file:line:col","to":"clang-usr","relation":"REFERENCES","role":"read|write|call|definition"}
{"kind":"call","from":"clang-usr","to":"clang-usr","dispatch":"direct|virtual|template|unknown"}
{"kind":"type","from":"clang-usr","to":"clang-usr","relation":"EXTENDS|IMPLEMENTS|USES_TYPE"}
{"kind":"include","from":"src.cpp","to":"header.h","system":false}
{"kind":"diagnostic","file":"...","line":1,"severity":"warning","code":"...","message":"..."}
```

APG maps these into SQLite with:

- `provenance = CODE_INTEL`
- `confidence = 0.95` for direct compiler/language-server facts
- `confidence = 0.75` for virtual/template/unknown dispatch edges
- source metadata in `edges.extra` / `nodes.extra`: backend, clangd version,
  compile command hash, translation unit, role

## Marketplace and runtime compatibility

The repo should ship as a marketplace-ready plugin with the same core shape
for all runtimes:

```text
.claude-plugin/plugin.json
.codex-plugin/plugin.json
.agents/plugins/marketplace.json
integrations/claude-code/
integrations/codex/
integrations/opencode/
install.claude.md
install.codex.md
install.opencode.md
install.pi.md
```

Compatibility rules:

- **Claude Code:** full toolset by default, skills copied to
  `~/.claude/skills/`.
- **Codex:** lean profile by default, compact skill card copied to
  `~/.codex/skills/`.
- **OpenCode:** lean profile by default, no skills unless OpenCode gains
  native skill loading.
- **oh-my-pi / Pi Linux:** no required native heavy backend beyond Node,
  SQLite, and tree-sitter. C++ code-intel is optional and skipped unless
  `clangd` and `compile_commands.json` are present.
- **Marketplace:** install metadata must declare runtime support, required
  Node version, optional clangd capability, default toolset, skill paths, and
  uninstall behavior.

Pi-compatible means the base install works on a low-resource Linux/ARM box.
It does not mean clang indexing large C++ repos must be fast there. The
precision backend reports `codeIntel.available=false` when unavailable.

## Milestone plan

### M0 - Repo and packaging audit

Deliverables:

- Confirm whether `agent-code-intel` is accessible and extract concrete install
  / marketplace conventions from it.
- Add marketplace manifests for Claude Code, Codex, and generic `.agents`.
- Add `install.pi.md` for low-resource Linux / ARM installs.
- Add a compatibility matrix to `README.md`.

Acceptance:

- Fresh clone install works for Claude Code, Codex, OpenCode, and Pi base mode.
- Package metadata validates with a local script.
- `npm test` remains green.

Testing:

- `scripts/validate-marketplace-package.mjs`
- install-doc smoke tests that check referenced paths exist
- CI matrix entry for Node 20/22 on Linux

### M1 - Code-intel neutral schema

Deliverables:

- Define `mcp/stdio/ingest/code-intel/schema.js`.
- Add parser/validator for JSONL code-intel records.
- Add SQLite import path that creates/updates APG nodes and edges.
- Add `CODE_INTEL` provenance class while preserving existing
  `EXTRACTED`, `INFERRED`, and `AMBIGUOUS`.

Acceptance:

- APG can import a small synthetic code-intel fixture without clangd.
- Code-intel nodes merge with tree-sitter nodes by stable key:
  `language + usr` first, then `qname + file + line`.
- Briefs and verbs prefer `CODE_INTEL` edges when duplicates exist.

Testing:

- unit tests for schema validation
- ingest fixture with overloaded methods, header/implementation split,
  namespace-qualified methods, and an include edge
- regression test that `Class::method` lookup chooses the code-intel symbol

### M2 - C++ clangd backend v1

Deliverables:

- New optional backend under `tools/code-intel/cpp-clangd/`.
- Reads `compile_commands.json`.
- Starts clangd or uses clangd-index-compatible output where available.
- Emits symbols, definitions, references, includes, diagnostics.
- Initial call graph can be conservative: direct calls only, with virtual
  dispatch marked as unresolved/unknown.

Acceptance:

- Works on Sand Castle.
- Works on Echoes enough to improve class-qualified lookup and references.
- Fails gracefully when `clangd` or `compile_commands.json` is missing.
- Does not run by default on Pi/base install unless explicitly enabled.

Testing:

- synthetic C++ fixture with templates, overloads, namespace, header/cpp split
- Sand Castle smoke profile: count symbols, refs, includes, diagnostics
- Echoes read-only profile: compare `ChunkManager::setVoxel` callers vs grep
- performance budget: 10k C++ files can be chunked/resumed; no single
  unbounded memory load

### M3 - APG graph merge and query upgrade

Deliverables:

- Merge code-intel facts into `graph_index`.
- `graph_health` reports code-intel availability, backend, age, and drift.
- `graph_packet`, `graph_pull`, `graph_impact`, `graph_callers`,
  `graph_change_plan` show code-intel confidence when present.
- Add stale warnings when code-intel compile DB is older than source changes.

Acceptance:

- On a C++ fixture, `graph_callers` and `graph_impact` use code-intel refs.
- On missing code-intel, existing tree-sitter behavior remains unchanged.
- On stale code-intel, verbs warn instead of silently trusting old facts.

Testing:

- unit tests for merge precedence
- fixture tests for stale compile database detection
- token-output snapshot tests for confidence/provenance rendering
- full suite

### M4 - Agent packet v2

Deliverables:

- Add `graph_packet(mode="orient|plan|debug|review|audit")`.
- Each mode has different evidence requirements:
  `audit` requires grep/source verification prompts;
  `review` includes dirty files and tests;
  `plan` includes features/tasks/contracts;
  `debug` includes recent changes and likely owners.
- Packet exposes `source_required` section explicitly.

Acceptance:

- Agents receive smaller, task-shaped packets instead of generic context.
- Audit mode never implies graph completeness on weak trust.
- Packet remains useful without live code-intel.

Testing:

- packet schema tests for all modes
- A/B prompt fixture comparing packet v1 vs packet v2 on plan/debug/audit
- token budget enforcement tests

### M5 - Bridge integration contract

Deliverables:

- Add bridge-facing API spec:
  `docs/integrations/aify-agents-bridge-contract.md`.
- Define workspace project card fields read from `brief.json` and
  `manifest.json`.
- Define write contract for bridge-owned `tasks.json` and
  `functionality.json`.
- Add static dashboard data endpoint export for embedding in bridge.

Acceptance:

- Bridge can show a project card without launching an APG MCP server.
- Bridge can edit a feature/task and trigger a brief rebuild through APG.
- APG does not import bridge code.

Testing:

- schema tests for bridge contract files
- fixture that simulates bridge writing tasks/features, then APG regenerating
  briefs
- dashboard data endpoint snapshot test

### M6 - Human UI paths in bridge

This milestone likely lands in `aify-agents-bridge`, but APG owns the file
schemas and validation helpers.

Deliverables:

- Feature editor UI writes APG-compatible `functionality.json`.
- Task editor UI writes APG-compatible `tasks.json`.
- Workspace graph panel embeds APG dashboard/tree view.
- Cross-repo brief search searches every project's `brief.json`.

Acceptance:

- A user can curate the map without asking an agent.
- Agents and humans see the same feature/task state.
- Multi-repo search works without making APG multi-root.

Testing:

- bridge API contract tests
- Playwright dashboard/editor tests
- multi-project fixture with two APG repos

### M7 - Evaluation and release gate

Deliverables:

- `scripts/ab-runner` gains C++ code-intel variants:
  baseline grep/read, APG tree-sitter, APG + code-intel, APG + bridge packet.
- Bench fixtures:
  Sand Castle small C++ game.
  Echoes larger C++ game.
  APG self.
  One Laravel repo.
- Metrics:
  answer quality, raw tokens, effective tokens, wall-clock, graph calls,
  source reads, false-safe decisions, stale warning correctness.

Acceptance:

- On C++ plan/debug/review tasks, APG + code-intel beats APG tree-sitter on
  quality without increasing effective tokens materially.
- No weak-trust output may produce an unqualified `SAFE` decision on known
  high-fan-in C++ symbols.
- Install tests pass for Claude Code, Codex, OpenCode, and Pi base mode.
- Marketplace metadata validates.

## First implementation slices

1. **Package and contract slice.**
   Add marketplace manifests, `install.pi.md`, and the bridge contract doc.
   This is low-risk and makes the future app boundary explicit.

2. **Code-intel schema slice.**
   Add neutral JSONL schema, validators, and synthetic import tests. No clangd
   dependency yet.

3. **C++ clangd prototype slice.**
   Index Sand Castle from `compile_commands.json`, emit code-intel JSONL, and
   prove APG can ingest it. Then try Echoes read-only.

4. **Query upgrade slice.**
   Teach `graph_callers`, `graph_impact`, and `graph_change_plan` to prefer
   code-intel edges and show confidence honestly.

5. **Bridge app slice.**
   Implement project cards and feature/task editor against APG schemas in
   `aify-agents-bridge`, with APG remaining a separate engine.

## Risk register

| Risk | Mitigation |
|---|---|
| clangd is slow or unavailable | optional backend; base tree-sitter mode remains |
| LSP batch indexing is flaky | neutral schema lets us replace backend with SCIP/libclang later |
| C++ virtual dispatch overclaims | mark dispatch type and lower confidence; never hide uncertainty |
| Pi installs fail on native dependencies | no mandatory clangd; keep Node/better-sqlite3 preflight; document base mode |
| Bridge and APG schemas drift | schema validators shared in APG and used by bridge tests |
| Agents over-trust graph output | packet modes include `source_required`; weak trust blocks unqualified safety decisions |
| Marketplace package gets stale | validation script checks manifests, install docs, skill paths, tool surface |

## Testing strategy

Testing is part of the product, not a final pass.

Required layers:

- **Unit:** schema validation, import merge, provenance rendering, packet modes.
- **Fixture:** synthetic C++ cases for overloads, templates, namespaces,
  inheritance, include graph, header/cpp split.
- **Repo smoke:** Sand Castle and Echoes read-only profiles.
- **Install:** Claude Code, Codex, OpenCode, Pi base install docs and metadata.
- **Bridge contract:** tasks/features round-trip and project-card rendering.
- **Bench:** repeated A/B on plan/debug/review/audit tasks with confidence
  checks, not just token counts.
- **Regression:** known weak C++ symbols like `ChunkManager::setVoxel` cannot
  regress to silent undercount without a failing test.

## Success criteria

- Agents get smaller and more accurate packets for C++ work.
- C++ caller/reference results improve materially on Echoes and Sand Castle.
- Weak C++ graphs produce honest uncertainty, not false safety.
- Base install still works on Claude Code, Codex, OpenCode, and Pi-style Linux.
- Marketplace metadata can install the plugin without hand-reading install docs.
- Bridge can show folders/projects/agents/sessions/tasks/graphs without merging
  APG's Node engine into its Python/web control plane.

## Open questions

- Is `agent-code-intel` available for direct reuse, or only as a design model?
- Does oh-my-pi expect a specific plugin manifest schema beyond generic
  `.agents/plugins/marketplace.json`?
- Should clangd output be captured through JSON-RPC, a clangd index file, or an
  external SCIP generator for the first real backend?
- Should code-intel artifacts live inside `.aify-graph/code-intel/` permanently,
  or be treated as cache-only sidecars?
- Which bridge repo will own the first UI implementation, given
  `/mnt/c/Docker/aify-agents-bridge` is empty in this session?
