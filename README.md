# aify-project-graph

On-demand codebase graph map for coding agents. Scans any project with tree-sitter, builds a structural graph in a local SQLite file, and exposes high-intent query verbs over MCP. Agents navigate code, trace execution paths, and assess blast radius — using compact responses instead of reading files.

Typical token savings **~20–30%** on realistic agent tasks (graph + file reads together), with larger wins on orientation/architecture questions and smaller wins on specific-symbol lookups. Measured across 4 A/B test pairs on real codebases (Python, Node, PHP, C++). 10 languages. No server, no container, no cloud.

## Inspiration

Built on ideas from two sources:

- **[graphify](https://github.com/safishamsi/graphify)** (MIT) — the compact NODE/EDGE line format, named query verbs, token-budget discipline, and interface-first `GRAPH_REPORT` digest are patterns we adapted from graphify's design.
- **[Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)** — the concept of a persistent structured artifact between model and raw sources, with an index layer that teaches the agent how to use it.

## What we solved

The [LLM Wiki critique](https://medium.com/data-science-in-your-pocket/andrej-karpathys-llm-wiki-is-a-bad-idea-8c7e8953c618) identified 7 failure modes. We addressed all of them:

| Failure mode | How we solve it |
|---|---|
| **Persistent model mistakes** | No LLM in the ingest path. 100% tree-sitter deterministic extraction. |
| **Hallucinated connections** | Every edge is a real syntactic relationship. Framework-inferred edges carry lower confidence. |
| **Information loss via compression** | We store pointers (file:line), not summaries. No content is compressed. |
| **Broken source traceability** | Every node and edge carries `file_path`, `start_line`, `confidence`. |
| **Cascading update complexity** | Auto-derived from source on every query. Git-diff-aware incremental reindex. |
| **Scaling chaos** | Deterministic node IDs. Rigid typed schema. No freeform links. |
| **Stale data** | Freshness check on every query — graph always reflects current source. |

## How it compares to graphify

| | graphify | aify-project-graph |
|---|---|---|
| **Storage** | In-memory NetworkX (ephemeral) | SQLite (persistent across sessions) |
| **Scale** | ~100k nodes (Python memory limit) | 350k+ nodes tested, 1M target |
| **Freshness** | Full rebuild every run | Git-diff-aware incremental |
| **Languages** | Per-language Python extractors | Config-driven generic walker (10 langs, ~30 lines per config) |
| **Node types** | Code symbols only | Code + directories, docs, configs, routes, entry points, schemas |
| **Path tracing** | No | `graph_path` — readable execution stories |
| **Community detection** | Leiden | Louvain (same quality, JS-native) |
| **Framework awareness** | No | Plugin system (Laravel routes in v1) |
| **Dashboard** | No | Cytoscape.js interactive browser |
| **Fuzzy search** | No | `graph_search` with partial name + type + file filters |

## How it works

```
1. Agent calls graph_index() (or any query verb — auto-indexes on first call)
2. Tree-sitter parses every source file in the repo
3. Generic extractor emits nodes (Function, Class, File, Route, etc.) + edges (CALLS, IMPORTS, EXTENDS, etc.)
4. Cross-file resolver links references across files
5. Louvain community detection clusters related symbols
6. Everything persists to .aify-graph/graph.sqlite
7. Agent queries via MCP verbs — compact NODE/EDGE responses with file:line citations
8. On next query, git diff is checked — only changed files reindexed
```

The `.aify-graph/graph.sqlite` file IS the product. Like `.git/` is the product of `git init`.

## Install

### One-line agent prompt

Tell your agent:

> Read `AGENTS.md` from https://github.com/zimdin12/aify-project-graph and install it for this environment.

The agent-facing install doc is self-contained: it clones the repo, wires the MCP config for your runtime (Claude Code / Codex / OpenCode), installs the skill, and tells you the one manual step (restart).

### Manual install

```bash
git clone https://github.com/zimdin12/aify-project-graph.git
cd aify-project-graph
npm install
npm test  # verify: should be all green
```

Then register the MCP server in your agent's config:

**Claude Code** (`~/.claude/mcp.json`):
```json
{
  "mcpServers": {
    "aify-project-graph": {
      "command": "node",
      "args": ["<path>/aify-project-graph/mcp/stdio/server.js"]
    }
  }
}
```

**Codex** (`~/.codex/mcp.json`):
```json
{
  "mcpServers": {
    "aify-project-graph": {
      "command": "node",
      "args": ["<path>/aify-project-graph/mcp/stdio/server.js"]
    }
  }
}
```

Replace `<path>` with the absolute path (forward slashes on Windows).

Restart your agent. The graph builds automatically on first query.

### Install the skill (Claude Code only)

```bash
cp -r <path>/aify-project-graph/integrations/claude-code/skill \
  ~/.claude/skills/aify-project-graph
```

## Query verbs

15 verbs organized by purpose:

### Discovery — orient in a new project
| Verb | What it does | Example |
|---|---|---|
| `graph_report()` | Full project orientation: files, languages, entry points, hub symbols, community clusters | First thing to call on any unfamiliar repo |
| `graph_search(query="UserCont")` | Fuzzy symbol search with type/file filters | Find symbols by partial name |
| `graph_whereis(symbol="get_db")` | Exact definition lookup: file:line | When you know the exact name |
| `graph_module_tree(path="src/auth")` | Directory + file + symbol hierarchy | Explore a specific area |

### Analysis — understand code before changing it
| Verb | What it does | Example |
|---|---|---|
| `graph_preflight(symbol="get_db")` | One-shot edit safety check: location, callers, impact, test coverage, trust signal | **Call before editing any symbol** |
| `graph_file(path="src/auth/token.ts")` | Everything about one file: defines, imports, callers-in, callees-out, test coverage | Understand a file in one call |
| `graph_callers(symbol="get_db")` | Who calls this? Ranked by depth, confidence, test proximity | Before understanding usage |
| `graph_callees(symbol="handle")` | What does this call? | Before understanding dependencies |
| `graph_neighbors(symbol="User")` | All connections: calls, refs, imports, extends, tests | Full picture of a symbol |
| `graph_impact(symbol="User")` | Deep blast radius analysis via transitive edge walk | When you need full dependency tree |
| `graph_path(symbol="handleRequest")` | Trace execution path as a readable story | Understand flow end-to-end |

### Administrative
| Verb | What it does |
|---|---|
| `graph_status()` | Is graph indexed? Node/edge counts, trust signals |
| `graph_index(force=true)` | Rebuild from scratch |
| `graph_dashboard()` | Open interactive visual browser |

## Response format

All query verbs return compact line format with file:line citations:

```
NODE 5d9e7ebe function get_db service/db.py:217
EDGE abc123→5d9e7ebe CALLS service/routers/api_v2.py:918 conf=0.95
EDGE def456→5d9e7ebe CALLS service/import_v2.py:14 conf=0.95
TRUNCATED 32 more (use top_k=20)
```

Path traces return indented stories:

```
PATH handleRequest src/server.ts:10
  -> validateToken src/auth.ts:12 conf=0.95
    -> jwt.verify external:0 conf=0.80
  -> User.findById src/models/user.ts:34 conf=0.90
    -> db.query src/db.ts:12 conf=1.00
```

## Languages

12 languages supported via config-driven generic extractor:

| Tier | Languages | Accuracy |
|---|---|---|
| **Tier 1** (90%+) | Python, JavaScript, TypeScript, Go, Ruby, Java | Explicit imports + clear structure |
| **Tier 2** (70-85%) | PHP (incl. traits/enums/interfaces, member/static/nullsafe calls, namespace-based module qname), C, C++ (incl. out-of-class `Class::method` definitions), Rust | Framework magic or preprocessor gaps |
| **Tier 3** (60-70%) | C++ templates (specialisations `Foo<int>::bar` not yet handled), GLSL, CSS | Template-heavy C++, shader/style subset |

Adding a new language = writing a ~30-line config file.

Project-level escape hatches at repo root:
- `.aifyignore` — additional dirs to exclude on top of defaults
- `.aifyinclude` — un-exclude from defaults (e.g. `build` or `vendor` when they hold real code)

## Performance

| Repo size | Index time | Query latency | Nodes |
|---|---|---|---|
| Small (32 files) | **1 second** | **~160ms** | 516 |
| Medium (915 files) | **10 seconds** | **~1.3s** | 6,669 |
| Large C/C++ (251 files) | **21 seconds** | ~1s | 4,000 |

Noop (no changes): ~170ms on small repos, <1s on medium.

## A/B Test Results

Controlled A/B tests with real subagents: same task, same model, same repo — only difference is whether the agent uses graph verbs or only Read/Grep/Glob.

### Three task regimes

Graph's value depends heavily on task shape. Measured across 5 real codebases (Node, Python, PHP+Laravel, C++) with real subagents:

| Task shape | Token savings | Graph's role |
|---|---|---|
| **Orient / report / hub-rank** | **−25% avg** (up to **−39%**) | Irreplaceable — grep can't rank by resolved edges |
| **Trace** multi-file chain | **−6.5% avg** (up to **−23.8%**) | Structural accelerator when edges model the path |
| **Search** single-symbol lookup | 0% (tied) | Grep's home turf — graph matches, doesn't beat |

**Tool-use reduction**: on orient tasks, graph averaged **3.2 tool calls** vs **16.8 for grep-based approach** — a 5.3× reduction in round-trips. This matters more than raw tokens for agent latency and cost (each tool call re-sends the prompt).

The A–E extraction improvements (PHP traits/method-params/facades, Python decorators, C++ out-of-class methods, ECS lambdas, External boundary terminals) are *edge-quality* improvements — they help exactly the workloads where relationships are the bottleneck, not the workloads where grep is already local-optimal.

### Per-repo results (post-A-E rebuild)

| Repo | Trace Δ | Search Δ | Notable |
|---|---|---|---|
| aify-project-graph (Node) | −2.3% | −2.5% | Small repo — both methods converge |
| aify-claude (Python) | **−13.7%** | −1.2% | Graph cleanly identified 3 wake mechanisms on POST /dispatch trace |
| mem0-fork (Python + TS) | +7.9% | −1.9% | `Memory.add → _add_to_vector_store → …` is a linear chain in one file; reading wins |
| **echoes (C++)** | **−23.8%** | +4.9% | **Flagship trace win.** Full input→movement pipeline traced via `graph_report + whereis + callees` |
| lc-api (Laravel PHP) | +12.5% | −2.6% | Trace loss exposes Laravel middleware-group (`Kernel.php` config array) as a known extraction gap |

### When to use the graph

- **✅ Orient in an unfamiliar repo** (`graph_report`, `graph_whereis(expand=true)`)
- **✅ Trace execution across 3+ files** (input pipelines, request handlers, middleware chains where modeled)
- **✅ Impact/blast-radius on a symbol with non-trivial fan-in** (`graph_preflight`, `graph_callers` with class-level rollup)
- **✅ Framework-pattern navigation** — Laravel routes/traits/facades, Flecs ECS systems, Python decorators

### When grep/read is fine (or better)

- ❌ Find a single known symbol by exact name
- ❌ Linear call chains in one file
- ❌ Dynamic dispatch that static analysis can't see (service-container resolution, reflection, metaclasses)
- ❌ Config-driven flow (Laravel middleware groups, route parameters as strings)

### Honest limits remaining

- **Laravel middleware-group expansion**: `Kernel.php` declares `allow-end-user → ['require-token', 'throttle-...']`. The static extractor sees the array but doesn't emit edges, so trace tasks crossing a middleware boundary fall back to Read.
- **C++ templates** `Foo<T>::bar()` now work for single-template cases, but nested templates and SFINAE specializations are still regex/AST-limited.
- **Dynamic dispatch** (`app(Foo::class)`, `$factory->create($kind)`, Python reflection): captured where statically declared (Item 4 heuristics), invisible otherwise.
- **Earlier releases** over-counted nodes on repos containing `.claude/worktrees/` or `build/_deps/`. Current release excludes those by default. If your project legitimately keeps code under `build/` or `vendor/`, use `.aifyinclude` to opt back in.

### Dogfood repos (current, post end-test)

| Repo | Language | Files | Nodes | Edges | Index time |
|---|---|---|---|---|---|
| aify-claude | Python+Node | 32 | 469 | 1,103 | 2s |
| mem0-fork | Python+TS+JS | 926 | 6,672 | 13,772 | 16s |
| lc-api (Laravel) | PHP | 1,820 | 14,467 | 43,858 | 69s |
| echoes_of_the_fallen | C/C++ + GLSL | 322 | 6,128 | 17,612 | 34s |

Numbers reflect the full extractor stack: out-of-class C++ methods, PHP traits/enums/interfaces/namespace-based modules, member+static+nullsafe PHP calls, facade + `app(X::class)` + constructor-DI REFERENCES, GLSL shader functions, CSS class selectors, flecs ECS lambda component types, External boundary nodes for unresolved cross-module references, and family-gated cross-language resolution.

## Detailed docs

- [AGENTS.md](AGENTS.md) — one-stop agent-driven install (preferred)
- [Design spec](docs/superpowers/specs/2026-04-16-aify-project-graph-design.md)
- [Install for Claude Code](install.claude.md) — human walkthrough
- [Install for Codex](install.codex.md) — human walkthrough
- [Install for OpenCode](install.opencode.md) — human walkthrough
- [Query format reference](SKILL.md)
- [Dogfood baseline](docs/dogfood/baseline-2026-04-16.md)

## License

MIT. See [LICENSE](LICENSE).

Patterns adapted from [graphify](https://github.com/safishamsi/graphify) (MIT). See [ATTRIBUTION.md](ATTRIBUTION.md).
