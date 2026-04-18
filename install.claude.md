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
      "args": ["--max-old-space-size=8192", "<path-to-aify-project-graph>/mcp/stdio/server.js"],
      "cwd": "<path-to-target-repo>"
    }
  }
}
```

The `--max-old-space-size=8192` flag gives Node an 8 GB heap for indexing. Safe default — adjust down to 4096 on lower-memory machines, up to 16384 for very large codebases.

Replace `<path-to-aify-project-graph>` with the absolute path to where you cloned the repo (use forward slashes on Windows).

Replace `<path-to-target-repo>` with the repo you want to index.

### 3. Install the skills

Copy the core skill plus the workflow skills into Claude Code's skill discovery path:

```bash
# Global (all projects)
mkdir -p ~/.claude/skills
cp -r <path-to-aify-project-graph>/integrations/claude-code/skill ~/.claude/skills/aify-project-graph
cp -r <path-to-aify-project-graph>/integrations/claude-code/skills/graph-map-functionality ~/.claude/skills/
cp -r <path-to-aify-project-graph>/integrations/claude-code/skills/graph-map-tasks ~/.claude/skills/
cp -r <path-to-aify-project-graph>/integrations/claude-code/skills/graph-anchor-drift ~/.claude/skills/
cp -r <path-to-aify-project-graph>/integrations/claude-code/skills/graph-pull-context ~/.claude/skills/

# OR project-scoped (this repo only)
mkdir -p <target-repo>/.claude/skills
cp -r <path-to-aify-project-graph>/integrations/claude-code/skill <target-repo>/.claude/skills/aify-project-graph
cp -r <path-to-aify-project-graph>/integrations/claude-code/skills/graph-map-functionality <target-repo>/.claude/skills/
cp -r <path-to-aify-project-graph>/integrations/claude-code/skills/graph-map-tasks <target-repo>/.claude/skills/
cp -r <path-to-aify-project-graph>/integrations/claude-code/skills/graph-anchor-drift <target-repo>/.claude/skills/
cp -r <path-to-aify-project-graph>/integrations/claude-code/skills/graph-pull-context <target-repo>/.claude/skills/
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

### 6. Start using

Key verbs:

```
graph_report()                                # orient in the project
graph_search(query="dispatch")                # fuzzy search for symbols
graph_whereis(symbol="get_db")                # exact definition lookup
graph_file(path="service/db.py")              # everything about one file
graph_preflight(symbol="get_db")              # edit safety check (SAFE/REVIEW/CONFIRM)
graph_callers(symbol="get_db")                # who calls this?
graph_callees(symbol="broadcast")             # what does this call?
graph_path(symbol="handleRequest")            # trace execution path
graph_impact(symbol="User")                   # blast radius analysis
graph_whereis(symbol="X", expand=true)        # definition + top edges
```

## Troubleshooting

- **`better-sqlite3` build fails:** Install native build tools (Windows: `windows-build-tools` or VS Build Tools; macOS: Xcode CLT; Linux: `build-essential`).
- **Graph seems stale:** Run `graph_index(force=true)` for a full rebuild.
- **`unresolvedEdges > 0` in status:** Some cross-file references couldn't be resolved. Usually harmless — run `graph_index(force=true)` if it's a lot.
