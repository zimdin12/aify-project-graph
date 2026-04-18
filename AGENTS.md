# Agent install guide — aify-project-graph

**You are an agent reading this to install aify-project-graph into your host runtime.** Follow the steps below in order. Every step is deterministic; do not skip or reorder.

## What this is

A local MCP server that indexes the user's current repo into a SQLite-backed code graph and exposes high-intent query verbs (`graph_report`, `graph_whereis`, `graph_callers`, `graph_impact`, etc.). Compact NODE/EDGE output with `file:line` citations. No server, no container, client-side only.

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
npm test     # expect: all tests green
```

If tests fail on `better-sqlite3`, install native build tools:
- Windows: VS Build Tools (`npm install -g windows-build-tools` or install "Desktop development with C++" via Visual Studio Installer)
- macOS: `xcode-select --install`
- Linux: `apt install build-essential` (or distro equivalent)

### 2. Register the MCP server

Add an entry under `mcpServers` in the runtime's config file. Claude Code keeps the full toolset. Codex and OpenCode should use the lean profile to reduce passive MCP/tool-surface overhead.

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

For **Codex** and **OpenCode**, append `--toolset=lean` to the args:

```json
{
  "mcpServers": {
    "aify-project-graph": {
      "command": "node",
      "args": ["--max-old-space-size=8192", "<absolute-path-to-clone>/mcp/stdio/server.js", "--toolset=lean"]
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

### 3. Install the skills (Claude Code only)

Copy all four skills so the agent learns the verb contract AND the editing workflow (functionality.json, tasks.json, drift detection):

```bash
# Global (all projects for this user)
mkdir -p ~/.claude/skills
cp -r <target-path>/integrations/claude-code/skill ~/.claude/skills/aify-project-graph
cp -r <target-path>/integrations/claude-code/skills/graph-map-functionality ~/.claude/skills/
cp -r <target-path>/integrations/claude-code/skills/graph-map-tasks ~/.claude/skills/
cp -r <target-path>/integrations/claude-code/skills/graph-anchor-drift ~/.claude/skills/
```

What each skill does:
- **aify-project-graph** — core verb contract + navigation rules
- **graph-map-functionality** — agent proposes `.aify-graph/functionality.json` (user's feature map); never hand-authored
- **graph-map-tasks** — source-agnostic task→feature attribution (ClickUp, Asana, Linear, Jira, GitHub Issues, or plaintext)
- **graph-anchor-drift** — detects stale/broken feature anchors from diffs and proposes targeted patches

Codex and OpenCode don't use skill files — the MCP tool descriptions are self-documenting for them, and the skills above are conversational workflows that only work in Claude Code.

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
graph_preflight(symbol="get_db")             # SAFE/REVIEW/CONFIRM before editing
graph_path(symbol="handleRequest")           # execution trace
graph_impact(symbol="User")                  # blast radius
graph_file(path="src/auth/token.ts")         # whole-file digest
```

Verb notes by profile:

- **Claude Code / full toolset**: `graph_search(query="dispatch")`, `graph_whereis(symbol="get_db", expand=true)`, `graph_callers(symbol="get_db")`
- **Codex / OpenCode lean toolset**: `graph_lookup(symbol="get_db")` for exact names. Low-level search/caller verbs are intentionally omitted from lean mode; remove `--toolset=lean` if you want the full surface.

The graph lives in `<target-repo>/.aify-graph/graph.sqlite`. Add `.aify-graph/` to the target repo's `.gitignore` if not already present — the graph is derived and should never be committed.

## Static briefs (prefer over MCP for orient-shaped tasks)

`.aify-graph/` also contains five precomputed brief artifacts that often answer orient/plan questions without a single MCP call:

- **`brief.md`** (~500 tok) — human-readable full brief
- **`brief.agent.md`** (~350 tok) — dense prompt substrate; paste into session prompt for orient sessions
- **`brief.onboard.md`** (~250 tok) — stripped variant for new-to-this-repo sessions
- **`brief.plan.md`** (~310 tok) — leads with features, open tasks by feature, feature-tagged recent commits, and risk areas. For change-planning sessions.
- **`brief.json`** — machine-readable equivalent

Measured on real codex runs: brief-only beats lean-MCP by **−21% to −32% tokens** on orient tasks with quality equal or better. Use briefs first; reach for MCP verbs only for precision queries the brief can't answer.

Regenerate with:
```bash
node <target-repo>/scripts/graph-brief.mjs <target-repo>
```

## Functionality + task overlays (Claude Code)

For richer briefs, use the skills to build overlays:

1. `/graph-map-functionality` — agent proposes `.aify-graph/functionality.json` from repo structure; user reviews diff
2. `/graph-map-tasks` — agent pulls open tasks from whatever tracker is connected (ClickUp/Asana/Linear/Jira/GitHub) and attributes them to features
3. `/graph-anchor-drift` — run after commits that touched anchored code; proposes targeted anchor patches

After running any of these, regenerate briefs: the `FEATURES` / `OPEN_TASKS` / `TRUST` sections in brief.plan.md automatically pick up the new data.

## What the install is NOT

- No server to run — the MCP process launches on-demand via stdio
- No Docker, no cloud service, no account setup
- No daemon — the graph builds in-process on first query per session

## If something goes wrong

- `graph_status()` returns `indexed: false` after multiple queries → check Node version (`node --version` must be ≥20)
- `unresolvedEdges` is very large → `graph_index(force=true)` for a clean rebuild
- Suspicious stale data → `rm -rf <target-repo>/.aify-graph` and query again to force rebuild
- Same repo used from both Windows and WSL → native Node addons can flip platforms (`better-sqlite3` is the usual one). Re-run `npm rebuild better-sqlite3` in the runtime you plan to use.
- Skill-specific behaviour questions → read `integrations/claude-code/skill/SKILL.md`
