# Install aify-project-graph for Codex

## Prerequisites

- Node.js >= 20
- git
- Codex CLI (`codex` or `codex-aify`)

## Steps

### 1. Clone and install

```bash
git clone https://github.com/zimdin12/aify-project-graph.git
cd aify-project-graph
npm install
npm test   # should be all green
```

### 2. Register the MCP server

Add to your Codex MCP config. The config file is typically at `~/.codex/mcp.json` or can be set per-project.

Recommended: use the lean profile on Codex. It keeps the highest-signal workflow verbs and trims passive MCP/tool-surface overhead that showed up in the benchmarks.

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

Replace `<path-to-aify-project-graph>` with the absolute path where you cloned the repo. **Use forward slashes on Windows** (e.g. `C:/Docker/aify-project-graph/mcp/stdio/server.js`).

The `cwd` for the MCP server is inherited from your Codex session — it will use the repo you have open as the target to scan.

### 3. Restart Codex

Close and reopen your Codex session (or `codex-aify` if using the aify wrapper) so the MCP server is picked up.

### 4. Verify

In your Codex session, call:

```
graph_status()
```

First call auto-builds the graph (10-60 seconds depending on repo size). Then:

```
graph_report()
```

Should return a project orientation digest with directory layout, languages, entry points, hub symbols, and community clusters.

### 5. Start using

Key verbs for navigation in the recommended lean profile:

```
graph_report()                          # orient in the project
graph_lookup(symbol="MyClass")          # fast exact-name lookup
graph_path(symbol="handleRequest")      # trace execution path
graph_change_plan(symbol="User")        # plan a safe multi-file change
graph_preflight(symbol="get_db")        # one-shot edit safety check
graph_file(path="src/auth/token.ts")    # everything about one file
graph_onboard(path="src")               # curated entrypoints + read order
```

If you want the full low-level traversal surface on Codex (`graph_search`, `graph_whereis`, `graph_callers`, `graph_neighbors`, `graph_dashboard`, etc.), remove `--toolset=lean` from the args and restart Codex.

### Even cheaper: use the static briefs

`.aify-graph/brief.agent.md` is a precomputed ~350-token orientation artifact that replaces most orient-shaped MCP calls. Paste it into your system prompt or user message for any session where you need to "understand this repo."

Measured data: brief-only beats lean-MCP by **−21% to −32% tokens** on orient tasks with quality equal or better across self-repo (Node) and lc-api (PHP/Laravel). Codex agents consistently preferred reading the brief over invoking MCP verbs when the brief contained the answer.

Four brief variants ship at `.aify-graph/`:

- `brief.agent.md` — combined, best default for one-shot prompts
- `brief.onboard.md` — stripped, for new-to-this-repo sessions (~250 tok)
- `brief.plan.md` — leads with features, open tasks by feature, feature-tagged recent commits (~310 tok)
- `brief.md` — human-readable full version

Regen: `node scripts/graph-brief.mjs <repoRoot>` (automatic on next graph index).

## How it works

- Scans your project with tree-sitter (10 languages supported)
- Builds a graph in `.aify-graph/graph.sqlite` (local to each repo)
- Stays fresh automatically — detects git changes and reindexes on every query
- Returns compact NODE/EDGE lines with file:line citations
- No backend server, no container — runs inside the MCP stdio process

## Troubleshooting

- **`better-sqlite3` build fails:** Install native build tools for your OS.
- **Graph seems stale:** `graph_index(force=true)` for full rebuild.
- **`unresolvedEdges > 0`:** Some cross-file refs couldn't be resolved. Usually harmless. Try `graph_index(force=true)` if it's many.
- **Codex dispatch errors:** Make sure the path to `server.js` uses forward slashes on Windows. Backslash paths can cause `AbsolutePathBuf` errors.
