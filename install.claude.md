# Install aify-project-graph for Claude Code

## Prerequisites

- Node.js >= 20
- git
- The repo you want to index

## Steps

### 1. Clone or locate aify-project-graph

```bash
git clone https://github.com/zimdin12/aify-project-graph.git
cd aify-project-graph
npm install
npm test   # should be all green
```

### 2. Register the MCP server

Add to your Claude Code MCP config (`~/.claude/mcp.json` or project-level `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "aify-project-graph": {
      "command": "node",
      "args": ["<path-to-aify-project-graph>/mcp/stdio/server.js"],
      "cwd": "<path-to-target-repo>"
    }
  }
}
```

Replace `<path-to-aify-project-graph>` with the absolute path to where you cloned the repo (use forward slashes on Windows).

Replace `<path-to-target-repo>` with the repo you want to index.

### 3. Install the skill

Copy the skill folder into Claude Code's skill discovery path:

```bash
# Global (all projects)
cp -r <path-to-aify-project-graph>/integrations/claude-code/skill ~/.claude/skills/aify-project-graph

# OR project-scoped (this repo only)
cp -r <path-to-aify-project-graph>/integrations/claude-code/skill <target-repo>/.claude/skills/aify-project-graph
```

### 4. Restart Claude Code

The MCP server and skill are picked up on restart.

### 5. Verify

In Claude Code, run:

```
graph_status()
```

First call will auto-build the graph (may take 10-60 seconds depending on repo size). Subsequent calls are instant.

Then:

```
graph_report()
```

Should return a project orientation digest with directory layout, languages, entry points, hub symbols.

## Troubleshooting

- **`better-sqlite3` build fails:** Install native build tools (Windows: `windows-build-tools` or VS Build Tools; macOS: Xcode CLT; Linux: `build-essential`).
- **Graph seems stale:** Run `graph_index(force=true)` for a full rebuild.
- **`unresolvedEdges > 0` in status:** Some cross-file references couldn't be resolved. Usually harmless — run `graph_index(force=true)` if it's a lot.
