# Install aify-project-graph for OpenCode

**You are an agent reading this to install aify-project-graph for the user. Execute every step. The user's only manual action is restarting OpenCode at the end.**

## Prerequisites to check

```bash
node --version   # must be >= 20
git --version    # must be installed
```

If either fails, stop and tell the user to install them.

## Step 1 — clone + build

Ask where to put the source (typical: Windows `C:/Docker/aify-project-graph`, macOS/Linux `~/code/aify-project-graph`). Then:

```bash
git clone https://github.com/zimdin12/aify-project-graph.git <CLONE_PATH>
cd <CLONE_PATH>
npm install
npm test                                    # should show 144 passing
```

If `better-sqlite3` build fails, install native build tools (Windows: VS Build Tools; macOS: `xcode-select --install`; Linux: `apt install build-essential`).

Store `<CLONE_PATH>` as absolute path with forward slashes.

## Step 2 — write the MCP config

File: `~/.opencode/config.json` (global) or `.opencode/config.json` (per-project). Merge if `mcpServers` exists:

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

`--toolset=lean` keeps the MCP surface small. Hidden verbs are still callable by name.

## Step 3 — tell the user to restart

OpenCode doesn't load Claude-Code skill files. The MCP tool descriptions are self-documenting. Tell the user:

> Install done. **Restart OpenCode** so the MCP server loads. In any repo, call `graph_status()` (auto-indexes on first call). For best wins, run once per repo:
>
> ```bash
> node <CLONE_PATH>/scripts/graph-brief.mjs <YOUR_REPO>
> ```
>
> Then paste `<YOUR_REPO>/.aify-graph/brief.agent.md` into your session prompt. For plan tasks, hand-author `.aify-graph/functionality.json` (sample at `<CLONE_PATH>/docs/examples/functionality.sample.json`) and re-run graph-brief.mjs.

## Verify

```
graph_status()
```

## Troubleshooting

- **Path errors on Windows**: forward slashes in the args
- **`better-sqlite3` native module flips**: `npm rebuild better-sqlite3` in the runtime you plan to use
- **Graph stale**: `graph_index(force=true)`
