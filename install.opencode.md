# Install aify-project-graph for OpenCode

## Prerequisites

- Node.js >= 20
- git
- OpenCode CLI

## Steps

### 1. Clone and install

```bash
git clone https://github.com/zimdin12/aify-project-graph.git
cd aify-project-graph
npm install
npm test   # verify: all green
```

### 2. Register the MCP server

Add to your OpenCode MCP config (typically `~/.opencode/config.json` under the `mcpServers` key, or per-project in `.opencode/config.json`).

Recommended: use the lean profile on OpenCode. It keeps the highest-signal workflow verbs and trims passive MCP/tool-surface overhead that showed up in the Codex/OpenCode-style benchmarks.

```json
{
  "mcpServers": {
    "aify-project-graph": {
      "command": "node",
      "args": ["--max-old-space-size=8192", "<path-to-aify-project-graph>/mcp/stdio/server.js", "--toolset=lean"]
    }
  }
}
```

The `--max-old-space-size=8192` flag gives Node an 8 GB heap for indexing. Safe default — adjust down to 4096 on lower-memory machines, up to 16384 for very large codebases.

Replace `<path-to-aify-project-graph>` with the absolute path. **Use forward slashes on Windows** (e.g. `C:/Docker/aify-project-graph/mcp/stdio/server.js`).

The `cwd` is inherited from your OpenCode session, so the graph targets the repo you have open.

### 3. Restart OpenCode

### 4. Verify

In OpenCode, call:

```
graph_status()
```

First call auto-builds the graph (seconds to a couple of minutes depending on repo size). Then:

```
graph_report()
```

Returns a project orientation digest with directory layout, languages, entry points, and hub symbols.

### 5. Start using

```
graph_report()                         # orient in the project
graph_lookup(symbol="MyClass")         # fast exact-name lookup
graph_path(symbol="handleRequest")     # trace execution path
graph_change_plan(symbol="User")       # plan a safe multi-file change
graph_preflight(symbol="get_db")       # one-shot edit safety check
graph_file(path="src/auth/token.ts")   # everything about one file
graph_onboard(path="src")              # curated entrypoints + read order
```

If you want the full low-level traversal surface on OpenCode (`graph_search`, `graph_whereis`, `graph_callers`, `graph_neighbors`, `graph_dashboard`, etc.), remove `--toolset=lean` from the args and restart OpenCode.

### Even cheaper: use the static briefs

`.aify-graph/brief.agent.md` is a precomputed ~350-token orientation artifact that replaces most orient-shaped MCP calls. Paste it into your system prompt or user message at session start — measured data shows brief-only beats lean-MCP by **−21% to −32% tokens** on orient tasks with quality equal or better.

Four brief variants ship at `.aify-graph/`:

- `brief.agent.md` — combined, best default
- `brief.onboard.md` — stripped, new-to-this-repo sessions (~250 tok)
- `brief.plan.md` — features, open tasks by feature, feature-tagged recent commits (~310 tok)
- `brief.md` — human-readable full version

Regen: `node scripts/graph-brief.mjs <repoRoot>` (automatic on next graph index).

## Troubleshooting

- **`better-sqlite3` build fails:** install native build tools for your OS.
- **Path errors on Windows:** use forward slashes in the `args` entry.
- **`unresolvedEdges > 0`:** some cross-file refs couldn't be resolved. Usually harmless — run `graph_index(force=true)` if it's a lot.
