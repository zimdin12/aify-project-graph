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

10 languages supported via config-driven generic extractor:

| Tier | Languages | Accuracy |
|---|---|---|
| **Tier 1** (90%+) | Python, JavaScript, TypeScript, Go, Ruby, Java | Explicit imports + clear structure |
| **Tier 2** (70-80%) | PHP, C, Rust | Framework magic or preprocessor gaps |
| **Tier 3** (60%) | C++ | Templates/ADL limit static analysis |

Adding a new language = writing a ~30-line config file.

## Performance

| Repo size | Index time | Query latency | Nodes |
|---|---|---|---|
| Small (32 files) | **1 second** | **~160ms** | 516 |
| Medium (915 files) | **10 seconds** | **~1.3s** | 6,669 |
| Large C/C++ (251 files) | **21 seconds** | ~1s | 4,000 |

Noop (no changes): ~170ms on small repos, <1s on medium.

## A/B Test Results

Controlled A/B tests with real subagents: same task, same model, same repo — only difference is whether the agent uses graph verbs or only Read/Grep/Glob. Both agents could freely read source files; this is **realistic mode**, not "graph-only vs files-only."

### Realistic mode (graph + files vs files-only)

| Repo | Task type | Tokens (graph) | Tokens (files) | Savings | Wall-clock |
|---|---|---|---|---|---|
| aify-project-graph (Node) | Search: entry + top callees | 29,954 | 38,377 | **−22%** | 2.6× faster |
| aify-project-graph (Node) | Plan: add new verb | 40,467 | 38,074 | +6% | 1.3× faster |
| aify-claude (Python) | Search | 32,608 | 44,613 | **−27%** | 2.2× faster |
| aify-claude (Python) | Plan: add cron dispatch | 40,924 | 46,522 | **−12%** | graph slower |
| mem0-fork (Python+TS) | Search | 29,618 | 47,039 | **−37%** | 1.4× faster |
| mem0-fork (Python+TS) | Plan: add Redis backend | 35,545 | 41,783 | **−15%** | graph slower |
| echoes (C++) | Search: AudioSystem | 31,111 | 33,826 | −8% | ≈equal |
| echoes (C++) | Orient: architecture | 29,709 | 42,614 | **−30%** | 1.3× faster |

**Average: −24% tokens on search/orient tasks, −13% on "plan a feature" tasks.**

The graph doesn't replace file reading — it **focuses** it. Instead of reading 10 files to find the right 2, the graph points you directly there. Biggest wins on orientation and architecture questions; smaller wins (or parity) on narrow symbol lookups where grep is already targeted.

### Caveats

- On **C++ repos**, `graph_callers` / `graph_preflight` currently under-report because out-of-class method definitions in `.cpp` files lose their class ownership during extraction. Fix in progress. Orientation queries (`graph_report`, `graph_whereis`, `graph_path`) are unaffected.
- Earlier releases over-counted nodes on repos containing `.claude/worktrees/` or `build/_deps/` (CMake vendored libraries). Current release excludes those by default — see [IGNORED_DIRS](mcp/stdio/ingest/ignored-dirs.js). If your project legitimately keeps code under `build/` or `vendor/`, file an issue — configurable overrides are on the roadmap.

### Dogfood repos

| Repo | Language | Files | Nodes | Edges | Index time |
|---|---|---|---|---|---|
| aify-comms | Python+Node | 32 | 482 | 1,151 | 1s |
| mem0-fork | Python+TS+JS | 915 | 6,514 | 13,773 | 10s |
| lc-api (Laravel) | PHP | 1,902 | 11,572 | 20,628 | 12s |
| echoes_of_the_fallen | C/C++ | 251 | 4,000 | 6,811 | 21s |

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
