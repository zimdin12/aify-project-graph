# Agent install guide — aify-project-graph

**You are an agent reading this to install aify-project-graph into your host runtime.** Follow the steps below in order. Every step is deterministic; do not skip or reorder.

## What this is

A local MCP server that indexes the user's current repo into a SQLite-backed code graph and exposes 15 query verbs (`graph_report`, `graph_whereis`, `graph_callers`, `graph_impact`, etc.). Compact NODE/EDGE output with `file:line` citations. No server, no container, client-side only.

## Before you start

Check the user's runtime. This guide covers:

- **Claude Code** — MCP config at `~/.claude/mcp.json`; skills at `~/.claude/skills/`
- **Codex** — MCP config at `~/.codex/mcp.json`
- **OpenCode** — MCP config at `~/.opencode/config.json` (or `.opencode/config.json` per project)

If unsure, ask the user which they're in.

## Install (all runtimes)

### 1. Clone the repo

Ask the user where they want the source. Typical choices:
- Windows: `C:/Docker/aify-project-graph` or `C:/Users/<user>/code/aify-project-graph`
- macOS/Linux: `~/code/aify-project-graph` or `/opt/aify-project-graph`

Then:

```bash
git clone https://github.com/zimdin12/aify-project-graph.git <target-path>
cd <target-path>
npm install
npm test     # expect: 82/82 passing
```

If tests fail on `better-sqlite3`, install native build tools:
- Windows: VS Build Tools (`npm install -g windows-build-tools` or install "Desktop development with C++" via Visual Studio Installer)
- macOS: `xcode-select --install`
- Linux: `apt install build-essential` (or distro equivalent)

### 2. Register the MCP server

Add an entry under `mcpServers` in the runtime's config file. The value is identical across runtimes:

```json
{
  "mcpServers": {
    "aify-project-graph": {
      "command": "node",
      "args": ["--max-old-space-size=8192", "<absolute-path-to-clone>/mcp/stdio/server.js"]
    }
  }
}
```

The `--max-old-space-size=8192` flag (8 GB heap) is operational safety for indexing very large repos. Default Node heap is ~2 GB which is enough for small/medium projects but can fail on repos with >100k extractable symbols. Adjust to what your machine has — 4096 is fine on 8 GB RAM machines; 8192 is recommended on 16 GB+.

Rules:
- Use absolute path. On Windows, **forward slashes** (`C:/...`), not backslashes.
- If the config file has other `mcpServers` entries, merge — don't overwrite.
- If the file doesn't exist yet, create it with just the `{"mcpServers": {...}}` wrapper.

Runtime-specific config paths:

| Runtime | Config path |
|---|---|
| Claude Code | `~/.claude/mcp.json` (global) or `.claude/mcp.json` (project) |
| Codex | `~/.codex/mcp.json` (global) or per-project equivalent |
| OpenCode | `~/.opencode/config.json` (global) or `.opencode/config.json` (project) |

### 3. Install the skill (Claude Code only)

Copy the skill so the agent learns the verb contract and workflow rules:

```bash
# Global (all projects for this user)
mkdir -p ~/.claude/skills
cp -r <target-path>/integrations/claude-code/skill ~/.claude/skills/aify-project-graph
```

Codex and OpenCode don't use skill files — the MCP tool descriptions are self-documenting for them.

### 4. Restart the runtime

The MCP server and skill are picked up on agent restart. **This is the only step the user must do themselves** (you can't restart your host).

### 5. Verify

On next session, call in order:

```
graph_status()    # should report indexed: true (or an immediate auto-build)
graph_report()    # should return a compact project orientation
```

If you see tool not found errors, the config didn't take effect — recheck the path (absolute, forward slashes) and that the runtime was fully restarted.

## Using it afterwards

Key verbs — invoke on demand, not all at session start:

```
graph_report()                               # orient
graph_search(query="dispatch")               # fuzzy symbol find
graph_whereis(symbol="get_db", expand=true)  # exact find + top edges
graph_preflight(symbol="get_db")             # SAFE/REVIEW/CONFIRM before editing
graph_callers(symbol="get_db")               # who calls this
graph_path(symbol="handleRequest")           # execution trace
graph_impact(symbol="User")                  # blast radius
graph_file(path="src/auth/token.ts")         # whole-file digest
```

The graph lives in `<target-repo>/.aify-graph/graph.sqlite`. Add `.aify-graph/` to the target repo's `.gitignore` if not already present — the graph is derived and should never be committed.

## What the install is NOT

- No server to run — the MCP process launches on-demand via stdio
- No Docker, no cloud service, no account setup
- No daemon — the graph builds in-process on first query per session

## If something goes wrong

- `graph_status()` returns `indexed: false` after multiple queries → check Node version (`node --version` must be ≥20)
- `unresolvedEdges` is very large → `graph_index(force=true)` for a clean rebuild
- Suspicious stale data → `rm -rf <target-repo>/.aify-graph` and query again to force rebuild
- Skill-specific behaviour questions → read `integrations/claude-code/skill/SKILL.md`
