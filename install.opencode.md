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

Add to your OpenCode MCP config (typically `~/.opencode/config.json` under the `mcpServers` key, or per-project in `.opencode/config.json`):

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
graph_whereis(symbol="MyClass")        # find definition
graph_callers(symbol="myFunction")     # who calls this?
graph_callees(symbol="myFunction")     # what does this call?
graph_path(symbol="handleRequest")     # trace execution path
graph_impact(symbol="User")            # blast radius
graph_preflight(symbol="get_db")       # one-shot edit safety check
graph_file(path="src/auth/token.ts")   # everything about one file
graph_whereis(symbol="X", expand=true) # definition + top edges
```

## Troubleshooting

- **`better-sqlite3` build fails:** install native build tools for your OS.
- **Path errors on Windows:** use forward slashes in the `args` entry.
- **`unresolvedEdges > 0`:** some cross-file refs couldn't be resolved. Usually harmless — run `graph_index(force=true)` if it's a lot.
