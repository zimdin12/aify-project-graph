# aify-project-graph — design spec

**Status:** Draft v2 — revised after brainstorm (SQLite, broad taxonomy, multi-language, dashboard)
**Repo:** https://github.com/zimdin12/aify-project-graph
**Authors:** graph-tech-lead, graph-senior-dev
**Date:** 2026-04-16
**Inspired by:** [graphify](https://github.com/safishamsi/graphify) (MIT-licensed)

---

## 1. Purpose and non-goals

### Purpose

`aify-project-graph` is a local, on-demand **codebase graph map** designed to be consumed by coding agents (Codex, Claude Code) to **reduce token spend** and **improve precision** when navigating, modifying, or reasoning about unfamiliar code.

It auto-extracts a structural graph of the **entire project** — directories, files, documents, configs, routes, entry points, AND code symbols (functions, classes, methods, calls, references, type relations, test linkage) — from a repository using tree-sitter, persists it in a local **SQLite** database (`.aify-graph/graph.sqlite`) inside the repo, and exposes high-intent query verbs over MCP that return compact, citation-bearing responses bounded to a hard token budget.

The `.aify-graph/graph.sqlite` file IS the product. Like `.git/` is the product of `git init`.

It is *not* a memory system, *not* a wiki, *not* a semantic search engine, and *not* an alternative to LSPs. It is a structural project-map agents reach for instead of grepping or reading multiple files. It requires no backend container — everything runs locally inside the MCP stdio server process.

### Non-goals (v1)

- Embedding-based / semantic code search (deferred to v2; adds weight we explicitly don't want).
- Cross-repository graphs (graph is per-repo; multi-repo can come later via graph union).
- Live file watching / daemonized reindex (on-demand only; agent triggers builds/queries).
- Pre-injection of graph content into the agent's context (the agent must reach for the graph itself).
- Replacing or extending `aify-openmemory`. Different problem space.
- Hand-curated knowledge / human-edited wiki content.

### What "agent-first" means here

Every design decision is evaluated against one question: **does this reduce the tokens an agent spends to answer a code question with the same or better precision?** If a feature doesn't measurably reduce token spend or improve precision for an agent, it's deferred or dropped.

---

## 2. Background and inspiration

### graphify — what we keep

[safishamsi/graphify](https://github.com/safishamsi/graphify) (MIT) is the closest existing implementation of "structured code graph for LLM consumption." Senior dev's research established the patterns worth keeping:

- **Compact line-format outputs.** Responses are `NODE id type label file:line community` and `EDGE src→dst relation confidence` lines, not JSON, not raw source.
- **Top-K seed selection + bounded BFS depth + hard token-budget truncation.** Limits fan-out aggressively at the response layer.
- **Named query verbs**, not raw SQL exposure. Agents call `graph_callers(symbol)`, not "write me a SQL query."
- **Interface-first digest.** A single `GRAPH_REPORT.md`-style overview lets the agent skim the repo's shape before touching files.
- **Citation discipline.** Every fact carries `file:line` and a confidence score.

### What graphify gets wrong for our scale target

- In-process NetworkX graph assembly limits practical scale (Python memory pressure at high node counts).
- Label-based cross-file call resolution is a global post-pass that's expensive and slow to incrementally update.
- Text-oriented subgraph rendering instead of database-native traversal.
- Single-shot CLI/MCP server posture without a strong incremental-update story.

### Karpathy's LLM Wiki + the critique

From Karpathy's gist we keep the high-level idea: *a persistent, structured artifact between model and raw sources, with an index/schema that teaches the agent how to operate it.*

From [the medium critique](https://medium.com/data-science-in-your-pocket/andrej-karpathys-llm-wiki-is-a-bad-idea-8c7e8953c618) we explicitly avoid the failure modes:

- **Persistent model mistakes becoming system state** — we never let the LLM write to the graph. Auto-extraction only.
- **Loss of source traceability** — every node/edge keeps `file:line` and is regeneratable from source.
- **Ingestion/update complexity growing faster than value** — we lean on tree-sitter's deterministic AST + a minimal set of edge types instead of semantic inference.

### openmemory — what we deliberately don't do

`aify-openmemory` orchestrates multiple services (`openmemory-api`, UI, Qdrant, Neo4j) with a forked `mem0` subtree and a semantic-inference-centric ingest path. That model is too heavy for the on-demand, embedded, agent-callable shape we want. We take the **opposite** posture: one embedded DB, syntax-first extraction, explicit MCP verbs, no always-on containers, metadata-only status until the agent asks for actual graph slices.

---

## 3. Architecture

### Component map

```
┌─────────────────────────────────────────────────────────────┐
│  Coding agent (Claude Code / Codex)                         │
│    ↓ calls graph_*(...) verbs via MCP stdio                 │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  aify-project-graph MCP stdio server (per repo, on-demand)  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Query layer                                        │    │
│  │  - High-intent verbs                                │    │
│  │  - Top-K seed + bounded BFS                         │    │
│  │  - Token-budget enforcement                         │    │
│  │  - Compact NODE/EDGE renderer                       │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Freshness layer                                    │    │
│  │  - Compares manifest.commit vs git rev-parse HEAD   │    │
│  │  - Detects dirty / untracked files                  │    │
│  │  - Triggers incremental reindex inline              │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Ingest layer                                       │    │
│  │  - Tree-sitter parsers (Python, TS/JS in v1)        │    │
│  │  - Pluggable Extractor interface per language       │    │
│  │  - Cross-file resolver                              │    │
│  │  - Per-symbol fingerprint bookkeeping               │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Storage                                            │    │
│  │  SQLite embedded → <repo>/.aify-graph/graph.sqlite    │    │
│  │  + manifest.json (commit, schema_v, indexed_at,     │    │
│  │                   dirty_files, dirty_edges)         │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Runtime model

- **No daemon.** The MCP stdio server is launched by the agent runtime (Claude Code / Codex MCP config) when needed. When the agent isn't asking, nothing is running.
- **No containers at runtime.** Docker artifacts ship for CI/benchmarks/standalone use only.
- **Per-repo state.** All state lives in `<repo>/.aify-graph/`. Portable, throwaway, no global registry.
- **Single language for the server.** Node.js (matches the `aify-comms` `mcp/stdio/server.js` pattern). Tree-sitter has first-class Node bindings; SQLite has an official Node driver.

### Data layout on disk

```
<repo>/
  .aify-graph/
    graph.sqlite/                   # SQLite database files
    manifest.json                 # state metadata (see §4)
    extractor-cache/              # per-file parse caches (optional)
    rebuild.log                   # tail of recent index events
    schema-version                # plain text schema version stamp
```

### Why SQLite (better-sqlite3)

Original spec picked KuzuDB, but it was archived by its maintainers on 2025-10-10 (v0.11.3 is the final release). We pivoted to SQLite during implementation planning.

**Why SQLite is the right choice for this product:**
- **Forever-stable dependency.** SQLite is the most tested, most deployed database on Earth. It will be maintained after we are all dead.
- **Embedded, no server.** Just a file. No process to manage, no container, no port.
- **better-sqlite3 Node driver** is the gold standard — synchronous, fast, zero compilation surprises on Windows/Mac/Linux.
- **Performance is over-qualified.** 10k nodes indexes in <1 second of DB writes. 1M nodes in under a minute. Indexed queries return in <1ms. Recursive CTEs handle transitive graph traversal with depth caps. The bottleneck is always tree-sitter parsing, never the DB.
- **WAL mode** gives us readers-while-writer for free.
- **Zero lock-in.** If we ever want to swap storage, the query layer is a thin SQL wrapper.

Graph queries use SQL JOINs on `nodes`/`edges` tables with appropriate indexes. Transitive queries (callers-of-callers, impact analysis) use `WITH RECURSIVE` CTEs, a standard SQL feature SQLite fully supports.

### Multi-language support: config-driven generic extractor

Instead of writing a separate extractor for each programming language, we use **one generic walker** driven by per-language config files. Each config maps tree-sitter node type names to our schema:

```js
// Language config example (PHP)
{ language: 'php', extensions: ['.php'],
  nodeTypes: { function: ['function_definition'], class: ['class_declaration'],
               call: ['function_call_expression'], import: ['namespace_use_declaration'], ... } }
```

Adding a new language = writing a ~30-line config. No custom code.

v1 ships with configs for: **Python, JavaScript, TypeScript, PHP, C, C++, Go, Rust, Ruby, Java** — at varying confidence levels depending on how much tree-sitter can capture for each language.

Languages fall into tiers:
- **Tier 1 (90%+ accuracy):** Python, JS/TS, Go, Ruby, Java — explicit imports, clear function/class boundaries.
- **Tier 2 (70-80%):** PHP, C, Rust (macro-heavy), Kotlin — framework magic or preprocessor gaps.
- **Tier 3 (60%):** C++ — templates, ADL, SFINAE make reliable call resolution impossible without a real compiler. Ship with `confidence: 0.5` on inferred call edges and document the limitation.

### Framework plugin system

Pluggable per-framework enrichers run after base extraction. Plugins detect their framework (e.g. `composer.json` with `laravel/framework`) and add framework-aware edges at lower confidence (0.6-0.8). v1 ships the plugin interface + a **Laravel routes plugin** that parses `routes/*.php` to create Route → Controller INVOKES edges.

Post-v1 plugins: Laravel facades + Eloquent magic, Django urls/views, Rails routes, Express/Next.js route handlers, Spring annotations.

---

## 4. Schema

### Node types

| Node       | Used for |
|---|---|
| `Repository` | Root identity. One per `.aify-graph/`. Carries name, root path, primary languages. |
| `File`       | Source file. Path relative to repo root, language, line count, last_modified, content_hash. |
| `Module`     | Logical module / package / namespace. Parent of files + symbols. |
| `Function`   | Top-level function. |
| `Method`     | Function bound to a class. |
| `Class`      | Class definition. |
| `Interface`  | Interface / protocol / abstract base. |
| `Type`       | Type alias / TypeScript type / Python type alias. |
| `Variable`   | Module-level or class-level binding (not locals). |
| `Symbol`     | Generic catch-all for things that don't fit the above (used by extractors lacking deep support). |
| `Test`       | Test function or test case. Distinct from `Function` because impact-analysis depends on it. |
| `Directory`  | A folder in the repo. CONTAINS edges to child Files and sub-Directories. |
| `Document`   | A markdown / rst / txt / README file. Stores title + first-line summary only, never body content. |
| `Config`     | A JSON / YAML / TOML / .env / composer.json / package.json config file. Stores keys only, not values. |
| `Route`      | An HTTP / CLI / event / cron entry point. INVOKES edges to handler symbols. |
| `Entrypoint` | main(), bin/*, CLI commands, web server factories, long-running process starters. |
| `Schema`     | DB migrations, SQL files, Prisma/Drizzle/Eloquent model schemas. |

### Edge types

| Edge            | Direction | Meaning |
|---|---|---|
| `CONTAINS`      | parent → child | Repository→File, Module→Function, Class→Method, etc. Structural. |
| `DEFINES`       | container → symbol | File defines top-level Function/Class/Type/Variable. |
| `DECLARES`      | container → symbol | Forward declarations / interface contracts. |
| `IMPORTS`       | File → File / Module | Import statement edges. |
| `EXPORTS`       | File → Symbol | Module exports. |
| `CALLS`         | caller → callee | Function/Method calls another. |
| `REFERENCES`    | source → target | Non-call references (variable reads, attribute accesses). |
| `EXTENDS`       | child → parent | Class inheritance. |
| `IMPLEMENTS`    | class → interface | Interface implementation. |
| `USES_TYPE`     | symbol → type | Type annotations / parameter types / return types. |
| `TESTS`         | Test → Symbol | A test exercises a target symbol. |
| `DEPENDS_ON`    | symbol → symbol | Generic semantic dependency where finer edges don't apply. |
| `MENTIONS`      | Document → Symbol | A doc body literally mentions a symbol name (cheap regex match, not semantic). |
| `INVOKES`       | Route/Entrypoint → Symbol | A route or entry point dispatches to a handler. |
| `CONFIGURES`    | Config → Symbol | A config file key matches a known symbol or framework convention. |

### Properties carried on every node

`id` (stable hash of fully-qualified name + file path), `label` (display name), `file_path`, `start_line`, `end_line`, `language`, `community_id` (optional, populated by graph analytics), `confidence` (extractor self-rated 0.0–1.0), `structural_fp`, `dependency_fp` (see §7 for the fingerprint split).

**Node identity rule:** `id` is stable across non-rename edits. A signature change, a body change, or a move to a new line does **not** allocate a new node id. Only a **rename**, a **file move**, or an **extractor reclassification** (e.g. `Function` → `Method` after refactor) allocates a new id. Fingerprints in §7 are version/change-detection metadata, **not** identity.

### Properties carried on every edge

`relation`, `source_file`, `source_line`, `confidence`, `extractor` (which language extractor produced it).

### Why a rich schema in v1

Senior dev's call: collapsing `Symbol`/`Type`/`Variable` saves day-one work but makes impact analysis weaker. In particular, `Test`+`TESTS` is non-negotiable from day one — impact analysis without test linkage doesn't earn the agent's trust. Other "rich" types can degrade gracefully: an extractor that doesn't differentiate `Method` from `Function` falls back to `Function` with `confidence` lower.

---

## 5. Query surface (the verbs)

The query layer is where token efficiency is bought. **Query verbs** (the ones that return graph facts) return compact line-format output, hard-capped at the configured `token_budget` (default 2000), with file:line citations on every fact. **Administrative verbs** (`graph_status`, `graph_index`) return small JSON metadata responses — they are not graph queries and aren't token-budgeted the same way.

### Verbs

```
graph_status()                              [administrative; JSON]
  → {indexed: bool, nodes, edges, indexedAt, commit, dirtyFiles,
     unresolvedEdges, dirtyEdgeCount, schemaVersion, extractorVersion}
  → Used by the freshness layer + by skill to know if a graph exists AND
    to surface a trust/debug signal: unresolvedEdges + dirtyEdgeCount are
    the "is this graph currently trustworthy?" indicator. Non-zero values
    mean the last reconciliation left work behind.
  → ≤200 token response.

graph_index(paths?, force=false)             [administrative; JSON]
  → Build or incrementally rebuild.
  → Precedence rules:
      * no paths, force=false → normal repo freshness flow (same as any query)
      * paths provided, force=false → targeted reindex of those paths plus
        dependent edge reconciliation, regardless of git dirt
      * force=true (with or without paths) → full rebuild from scratch over
        the scope (paths if given, else the whole repo)
  → Returns: {indexed_files, new_nodes, new_edges, removed_nodes,
              invalidated_edges, duration_ms}.

graph_whereis(symbol)
  → Resolve a symbol name → node + file:line + one-line signature.
  → Disambiguates by community / proximity if multiple matches.
  → ≤80 tokens per match, top 5 matches max.

graph_callers(symbol, depth=1, top_k=10)
  → Incoming CALLS within depth.
  → v1 ranking (applied in order, ascending/descending where specified):
      1. depth ascending (closer callers first)
      2. edge confidence descending
      3. test proximity (callers that are Tests rank higher)
      4. local fan-in degree as tiebreaker
  → Community centrality is NOT required in v1. If implemented later, it
    is stored as a cached optional analytic and plugged into rule 4.
  → Compact NODE/EDGE format.

graph_callees(symbol, depth=1, top_k=10)
  → Outgoing CALLS within depth. Same ranking rules as graph_callers.

graph_neighbors(node, edge_types=[], depth=1)
  → Generic 1..N hop expansion, filterable by edge type.
  → edge_types is a subset of the schema edge names (§4). Empty = all.

graph_module_tree(path, depth=2)
  → Hierarchy under a path. Returns a compact tree of CONTAINS edges.
  → Useful for "what's in this directory."

graph_impact(symbol)
  → Transitive downstream of a symbol.
  → v1 traverses: CALLS (inbound), REFERENCES (inbound), USES_TYPE (inbound),
    TESTS (inbound) — i.e. "what will notice if I change this."
  → v1 does NOT traverse IMPORTS or DEPENDS_ON (too noisy for the agent
    edit-safety use case). May be added later under a flag.
  → The discipline rule (taught in the skill): call this before editing any
    symbol with >1 caller.

graph_summary(node)
  → Compact node digest: signature, top 5 incoming/outgoing edges, related Tests, file:line.
  → ≤80 tokens.

graph_path(from, direction="out", depth=5, top_k=3)
  → Directed call-chain traversal rendered as a readable story, not a flat list.
  → direction="out" follows outgoing CALLS; direction="in" follows incoming.
  → Returns indented PATH lines showing the execution sequence from entry to leaf.
  → Prunes by confidence, stops at leaves or depth cap.
  → Example output:
    PATH handleRequest depth=4
      → validateToken src/auth/token.ts:12 conf=0.95
        → Token.decode src/auth/token.ts:88 conf=0.93
      → User.findById src/models/user.ts:34 conf=0.90
        → db.query src/db.ts:12 conf=1.00
  → The verb graphify doesn't have. Agents read a story, not a scatter plot.

graph_dashboard(port?)                        [administrative; JSON]
  → Starts a local HTTP server (Cytoscape.js SPA) on the given port or auto-picks one.
  → Returns: {url: "http://localhost:48234", status: "running"}
  → Dashboard shows: interactive graph viz, node search/filter, click-to-inspect,
    module tree view, path tracer, stats panel. Reads from the same .aify-graph/graph.sqlite.
  → Server lives inside the MCP server process. Dies when MCP server stops.
  → No container, no separate backend.

graph_report()
  → Full project-orientation digest (richer than graphify's GRAPH_REPORT.md).
  → Includes: directory layout, languages detected, entry points, routes,
    doc summaries (title only), config files, hub symbols by fan-in,
    test coverage heuristic. Everything an agent needs to orient in one call.
  → Example output:
    REPO Laravel project — 1,247 files, 12,402 nodes
    LANGS php (78%), blade (12%), js (6%), md (4%)
    ENTRY routes/web.php 142 routes
    ENTRY public/index.php 1 web bootstrap
    DIR app/Http/Controllers/ 28 controllers
    DIR app/Models/ 14 models
    DOC README.md "Acme ERP — customer management system"
    HUB OrderController 23 incoming calls
    HUB User 47 incoming references
  → Participates in the same freshness flow as query verbs (§6). Cached on
    disk; cache invalidates on HEAD change AND when dirty files intersect
    the report's source set. ≤1500 tokens.
```

### Response format

Inspired directly by graphify's `serve.py` rendering. Example response from `graph_callers("parseFoo", depth=1)`:

```
NODE n_parseFoo function parseFoo src/parser/foo.ts:42 community=12
EDGE n_validateInput→n_parseFoo CALLS src/validate.ts:18 conf=0.95
EDGE n_handleRequest→n_parseFoo CALLS src/server/handler.ts:301 conf=0.93
EDGE n_test_parseFoo→n_parseFoo CALLS test/parser.test.ts:7 conf=1.00
TRUNCATED 4 more callers (use top_k=20)
```

That is ≈90 tokens for a result that would otherwise cost the agent ~2000 tokens of file reading.

### Token budget enforcement

- Each verb has a hard upper bound on output (default 2000, configurable).
- The renderer drops lowest-confidence / highest-depth edges first.
- A `TRUNCATED N more` line is always included when truncation happens, with the suggested tweak (`top_k=`, `depth=`) to retrieve more.
- No verb ever returns raw source bodies.

---

## 6. Freshness model

### The contract

The graph is **on-demand and git-diff-aware**. From the agent's perspective, the graph is always-fresh — but no daemon and no file watcher run between queries.

### How it works

1. Server starts (cold) when the agent first calls a `graph_*` verb.
2. Server reads `.aify-graph/manifest.json` to get the stored commit + dirty file list.
3. Server runs `git rev-parse HEAD` and `git status --porcelain` against the repo.
4. Decision tree:
   - **Same HEAD, clean tree** → serve from kuzu directly. Latency target: <200ms warm.
   - **Same HEAD, dirty files** → re-extract dirty files, reconcile cross-file edges, persist, serve. Latency: cold first query <2s for typical (≤10 dirty files).
   - **HEAD changed, no other dirt** → diff `manifest.commit..HEAD`, re-extract only changed files, reconcile, persist, serve.
   - **manifest missing / corrupt / schema_version mismatch** → fall back to full rebuild via `graph_index(force=true)`.
5. After serving, manifest is updated with new commit, indexed_at, and any leftover `dirty_files` for files the freshness layer chose not to reindex (e.g. ignored paths).

### Why no daemon

The user's hard requirement was "no pre-injection, on-demand only." A daemon would be the wrong shape — it's a persistent process the agent didn't ask for, and it makes the install/uninstall story messier. The cost of doing the diff+reindex inline at query time is real but bounded; we eat it because the alternative is worse.

---

## 7. Scale risk and mitigation

Senior dev identified the day-one risk: **incremental-update correctness for cross-file edges.** At 1M nodes, full rebuilds take long enough that incremental updates have to be the common path, and stale cross-file edges (a function pointing at a callee that's been renamed/removed) are the fastest way to lose agent trust.

### Mitigation: two-axis fingerprint bookkeeping

Identity is stable (§4) — fingerprints are change-detection metadata, not identity. Each symbol carries **two** fingerprints:

- **`structural_fp`** = `hash(qualified_name + signature + decorators + parent_class + node_type)`
  Changes when the symbol's public contract changes: signature, decorator set, class membership, type reclassification. Drives **incoming edge invalidation** — any edge pointing *at* this symbol.

- **`dependency_fp`** = `hash(sorted list of outgoing references: call targets, read references, type uses, raised exceptions, imported names)`
  Changes when the symbol's *body* changes in a way that affects what it depends on. A cosmetic body edit that doesn't change any call/reference leaves this unchanged. Drives **outgoing edge invalidation** — any edge pointing *from* this symbol.

Both fingerprints are stored on the symbol node in kuzu alongside `id` and other properties.

### Reindex protocol

When a file changes:

1. Re-extract → produce new `(structural_fp, dependency_fp)` for every symbol in the file.
2. Diff per symbol against stored fingerprints:
   - **`structural_fp` changed** → invalidate all **incoming** edges targeting this symbol's `id`. Re-run cross-file resolver so references from other files can find the new contract.
   - **`dependency_fp` changed** → delete all **outgoing** edges sourced from this symbol's `id`, then append new outgoing edges from the re-extracted body.
   - **Both unchanged** → no edge work; the node is touched only to update `indexed_at`.
3. Symbols present in the stored graph but not in the re-extracted file are **deleted** (removed symbol). Their incoming edges are invalidated; their outgoing edges are removed.
4. Symbols new in the re-extracted file but not in storage are **appended** with both fingerprints and their outgoing edges resolved.
5. The cross-file resolver runs only on:
   - Edges whose target was invalidated (any symbol whose `structural_fp` changed OR was deleted).
   - Newly-created outgoing edges from steps 2 and 4.
6. Any edge the resolver couldn't immediately reconcile (e.g. an unresolved import target, a forward declaration not yet scanned) is appended to `manifest.dirty_edges`. It is re-attempted at the next query time. If `dirty_edges` ever exceeds a configured threshold (default: 5% of total edges) or survives three reconciliation attempts, the freshness layer falls back to a full rebuild. `graph_status` surfaces `dirtyEdgeCount` so agents and operators can see this state directly.

### Why two fingerprints

Body-only edits are the most common thing that happens to a codebase. If we ignored them, a function could change its callees — the exact edge type we care about most — and the graph would silently lie to the agent. Splitting identity (stable) from structural state (incoming invalidation) from dependency state (outgoing invalidation) gives us correct incremental behavior without rebuilding the whole file every time.

### Other scale considerations

- **Storage size**: SQLite is columnar and compact. At 1M nodes / ~10M edges, expected on-disk size is in the low-hundreds-of-MB range. Acceptable.
- **Ingest throughput**: Tree-sitter is fast (hundreds of files/sec on a modern machine). The bottleneck is cross-file resolution, which we mitigate by indexing per-symbol from day one.
- **Query latency**: SQLite handles bounded BFS over property graphs efficiently. Our top_k + depth caps keep result sets small enough that latency is rarely an issue.

### Stretch goal: 1M nodes

A 1M-node ingest benchmark (`scripts/bench.js`) is in the v1 plan but is a **stretch goal, not a release blocker**. The release bar is "works on `aify-claude` repo end-to-end" (see §11).

---

## 8. The Claude Code skill (`aify-project-graph`)

A skill auto-loads when the current working directory contains `.aify-graph/`. The skill is short and teaches the agent **when** to reach for graph verbs and **how** to read the compact response format.

### What the skill enforces (rigid, not advisory)

- **MUST** call `graph_report()` on first interaction with an unfamiliar repo. This is the orientation step.
- **MUST** call `graph_impact(symbol)` before editing any symbol with >1 caller. Non-negotiable.
- **SHOULD** call `graph_whereis` instead of grepping for symbol definitions.
- **SHOULD** call `graph_module_tree` instead of reading directory contents to understand structure.
- **SHOULD** call `graph_path` to understand execution flow instead of reading multiple files sequentially.
- The compact `NODE`/`EDGE` line format and how to interpret `confidence` scores.
- Counts from `graph_status` are safe to rely on; node *content* is always fetched explicitly, never pre-injected into context.
- When the response says `TRUNCATED N more`, decide whether to refetch with a higher `top_k` or whether the top-K already answered the question.

### What the skill does NOT do

- It does NOT pre-fetch any graph content into the agent's context.
- It does NOT auto-call any verb on session start. The agent decides.
- It does NOT install the MCP server; it assumes the server is already configured.

---

## 9. Optional file-read hint hook

An **opt-in** `PostToolUse` hook for Claude Code. When the agent reads a source file, the hook injects a one-line metadata hint:

```
[graph: 3 callers, 1 test, 2 defs — graph_callers("parseFoo")]
```

### Hard discipline rules

- Hint cost ≤80 tokens. Enforced by the hook.
- **No** code content. Counts and tool-name pointers only.
- Off by default. Opt-in via skill config.
- A hint is "successful" iff it costs <80 tokens AND saves ≥2 file reads the agent would otherwise have done. We measure this in benchmarks before recommending it.

---

## 10. Repository layout

Mirrors `aify-comms` structurally so the install pattern is familiar.

```
aify-project-graph/
  README.md
  LICENSE                            # MIT
  ATTRIBUTION.md                     # credits graphify (MIT) for patterns we adapt
  Dockerfile                         # optional, for CI/benchmarks
  docker-compose.yml                 # optional, NOT required at runtime
  package.json
  install.sh
  setup.bat
  setup.sh
  install.claude.md                  # how to install as Claude Code MCP + skill
  install.codex.md
  install.opencode.md
  mcp/
    stdio/
      server.js                      # the MCP stdio server (the only thing that runs)
      verbs/
        index.js
        status.js
        whereis.js
        callers.js
        callees.js
        neighbors.js
        module-tree.js
        impact.js
        summary.js
        report.js
      extractors/
        base.js                      # Extractor interface
        python.js                    # tree-sitter-python
        typescript.js                # tree-sitter-typescript (covers TS + TSX + JS + JSX)
      schema/
        nodes.cypher                 # SQLite DDL
        edges.cypher
        migrations/                  # versioned schema bumps
      query/
        budget.js                    # token-budget enforcement + compact-line renderer
        rank.js                      # top-K seed + community centrality
      ingest/
        resolver.js                  # cross-file resolution
        fingerprint.js               # per-symbol fingerprint logic
      git/
        diff.js                      # git status + rev-parse helpers
  integrations/
    claude-code/
      skill/                         # the aify-project-graph skill (markdown)
      hooks/                         # opt-in PostToolUse hint hook
    codex/                           # mirror for codex
    opencode/                        # mirror for opencode
  docs/
    architecture.md                  # this design extracted into prose
    query-format.md                  # reference for the compact line format
    extractor-guide.md               # how to add a new language
    superpowers/specs/               # this doc lives here
  scripts/
    bench.js                         # 1M-node ingest benchmark (stretch goal)
    inspect-manifest.js              # debug helper
```

### Why no docker at runtime

User explicitly requested lightweight. The Dockerfile/compose ship for **CI runs**, **benchmarks**, and **standalone sandbox testing** only. Default install is `npm install` + register the MCP server in the agent's config.

---

## 11. v1 success criteria

v1 ships when ALL of the following are true:

1. **Dogfood works.** Running `aify-project-graph` against the `aify-claude` repo (mixed Python + Node + docs) produces a graph that answers `whereis`, `callers`, `callees`, `module_tree`, `impact`, and `report` correctly. "Correctly" = manual review of representative queries by both team members.
2. **Token efficiency holds.** All shipped verbs respect the default 2000-token budget on `aify-claude`-sized inputs without important information being truncated away.
3. **Latency targets.**
   - Warm query (clean tree, same HEAD): <200ms p95.
   - Cold first-query (triggers reindex of ≤10 dirty files): <2s p95.
4. **Incremental update correctness.** Edit a function signature in `aify-claude`, run a query that touches it, verify cross-file edges are up to date without a manual `force=true`.
5. **Install works for both runtimes.** A user can tell Claude Code or Codex "install aify-project-graph in this repo" and the agent successfully follows `install.claude.md` / `install.codex.md` end-to-end.

### Stretch goals (not blockers)

- 1M-node ingest benchmark passing under a defined time budget (TBD when we know real numbers from `aify-claude`-scale).
- A second language extractor beyond Python + TS/JS.
- The opt-in file-read hint hook with measured hint-savings ratio.
- Multi-repo graph union.

---

## 12. Open questions for implementation phase

These are NOT design questions — they're things the implementation plan needs to resolve, listed here so we don't lose them:

1. **Manifest format.** Decided: **JSON with atomic-rename writes.** Keeps the manifest inspectable and debuggable; atomic rename gives us crash safety without a DB dependency outside kuzu.
2. **Python entrypoint detection.** How do we identify "test functions" reliably across pytest, unittest, doctest? Per-extractor heuristic + opt-in config in `.aify-graph/config.json`.
3. **TypeScript module resolution.** We follow `tsconfig.json` paths if present, fall back to relative resolution. Do we shell out to a TS resolver or reimplement? Lean: small reimplementation; avoid TS-server dependency.
4. **Tree-sitter / extractor version drift.** Tracked **independently** of schema migration. A tree-sitter grammar upgrade can change extractor behavior (more accurate parses, new node labels) without changing the persisted DB layout. The manifest carries `extractorVersion` + `parserBundleVersion` alongside `schemaVersion`. A schema migration only runs when the persisted DB layout actually changes. On extractor-version drift without schema drift, the freshness layer marks affected files dirty and re-extracts them lazily on next query.
5. **Concurrency.** The MCP stdio server is single-process per repo as the common path. In-process locks guard the write phases (reindex, cross-file reconciliation). **However:** we cannot assume a single process, because two separate agent runtimes can spawn their own MCP servers against the same repo concurrently. v1 adds a **filesystem write lock** (`.aify-graph/.write.lock` via `flock`/`proper-lockfile`) around all write phases so two servers can't corrupt each other. Read-only query paths don't need the lock.
6. **Confidence score calibration.** What does `0.95` actually mean? Documented in `docs/query-format.md` per extractor.
7. **Skill auto-load mechanism.** Skill detection of `.aify-graph/` happens via Claude Code's project-skill discovery. Codex equivalent: TBD per Codex MCP integration model.

---

## 13. Out of scope (explicit list)

- Embedding-based similarity / semantic search.
- Cross-repo graph federation.
- A web UI / dashboard.
- Live file watching.
- Pre-injection of graph content into agent prompts.
- Any LLM in the ingest path. Tree-sitter only.
- Replacing or interoperating with `aify-openmemory`.
- Hand-curated content / human edits to the graph.
- A REST/HTTP API on top of the MCP stdio server.

---

## 14. Attribution

Patterns adapted from [safishamsi/graphify](https://github.com/safishamsi/graphify) (MIT) — specifically the compact NODE/EDGE line response format, the named query verb surface, and the GRAPH_REPORT.md interface-first digest concept. Credit will appear in `ATTRIBUTION.md` in the repo when it ships.
