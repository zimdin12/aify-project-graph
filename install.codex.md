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

```json
{
  "mcpServers": {
    "aify-project-graph": {
      "command": "node",
      "args": ["<path-to-aify-project-graph>/mcp/stdio/server.js"]
    }
  }
}
```

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

Key verbs for navigation:

```
graph_report()                          # orient in the project
graph_whereis(symbol="MyClass")         # find definition
graph_callers(symbol="myFunction")      # who calls this?
graph_callees(symbol="myFunction")      # what does this call?
graph_path(symbol="handleRequest")      # trace execution path
graph_impact(symbol="User")             # what breaks if I change this?
graph_module_tree(path="src")           # directory/file hierarchy
graph_preflight(symbol="get_db")        # one-shot edit safety check
graph_file(path="src/auth/token.ts")    # everything about one file
graph_whereis(symbol="MyClass", expand=true)  # definition + top edges
graph_neighbors(symbol="X")             # all edges around X
```

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
