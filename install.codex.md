# Install In Codex

1. Clone this repo where you want to keep the MCP server code.
2. Run `npm install`.
3. Run `npm test` and confirm the suite is green.
4. Make sure your checkout includes `mcp/stdio/server.js`. If it does not, pull the latest `main` first; the MCP stdio entrypoint lands separately from the ingest/freshness stack.

Add an MCP entry in Codex's config (`~/.codex/mcp.json` or your equivalent Codex MCP config) that launches:

```json
{
  "aify-project-graph": {
    "command": "node",
    "args": ["C:/path/to/aify-project-graph/mcp/stdio/server.js"]
  }
}
```

Restart Codex after saving the config. Then open the target repo you want to analyze and verify the install by calling `graph_status()` or `graph_report()`. The graph data is stored per target repo under `.aify-graph/graph.sqlite`.
