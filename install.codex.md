# Install aify-project-graph for Codex

**You are an agent reading this to install aify-project-graph for the user. Execute every step. The user's only manual action is restarting Codex at the end.**

## Prerequisites to check

```bash
node --version   # must be >= 20
git --version    # must be installed
```

If either fails, stop and tell the user to install them.

## Step 1 — clone + build

Ask the user where to put the source (typical: Windows `C:/Docker/aify-project-graph`, macOS/Linux `~/code/aify-project-graph`). Then:

```bash
git clone https://github.com/zimdin12/aify-project-graph.git <CLONE_PATH>
cd <CLONE_PATH>
npm install
npm test                                    # should show 144 passing
```

If `better-sqlite3` build fails:
- Windows: VS Build Tools ("Desktop development with C++")
- macOS: `xcode-select --install`
- Linux: `apt install build-essential`

Store `<CLONE_PATH>` as absolute path with forward slashes.

## Step 2 — write the MCP config

File: `~/.codex/mcp.json`. Merge with existing `mcpServers` if present:

```json
{
  "mcpServers": {
    "aify-project-graph": {
      "command": "node",
      "args": ["--max-old-space-size=8192", "<CLONE_PATH>/mcp/stdio/server.js", "--toolset=lean"]
    }
  }
}
```

`--toolset=lean` exposes 3 high-value verbs (graph_impact, graph_path, graph_change_plan) instead of 17. Measured: 48-run bench showed zero MCP routing on the full lean profile, so fewer visible tools means less manifest overhead without losing functionality (hidden verbs stay callable by name).

## Step 3 — tell the user to restart

Codex doesn't support skills the way Claude Code does — the MCP tool descriptions are self-documenting. Tell the user:

> Install done. **Restart Codex** so the MCP server loads. In any repo, call `graph_status()` first (auto-indexes on first call). For the full static-brief workflow, run this one-time setup per repo:
>
> ```bash
> node <CLONE_PATH>/scripts/graph-brief.mjs <YOUR_REPO>
> ```
>
> Then paste `<YOUR_REPO>/.aify-graph/brief.agent.md` into prompts for ~30% cheaper, 1.5-2.9× faster orientation. For plan tasks, hand-author `<YOUR_REPO>/.aify-graph/functionality.json` (sample at `<CLONE_PATH>/docs/examples/functionality.sample.json`) and re-run graph-brief.mjs.

## Verify (after restart)

```
graph_status()
```

Returns `indexed: false` initially, then `indexed: true` after first auto-build.

## Troubleshooting

- **`AbsolutePathBuf` errors on Windows**: forward slashes only in the MCP args path (`C:/...`)
- **`better-sqlite3` flipped platforms** (Windows/WSL): `cd <CLONE_PATH> && npm rebuild better-sqlite3` from the runtime you plan to use
- **Graph seems stale**: `graph_index(force=true)` for full rebuild
