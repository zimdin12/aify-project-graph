# Install aify-project-graph for Claude Code

**You are an agent reading this to install aify-project-graph for the user. Execute every step. The user's only manual action is restarting Claude Code at the end.**

## Prerequisites to check

```bash
node --version   # must be >= 20
git --version    # must be installed
```

If either fails, stop and tell the user to install them.

## Step 1 — clone + build

Ask the user where to put the source (typical choices: Windows `C:/Docker/aify-project-graph`, macOS/Linux `~/code/aify-project-graph`). Then:

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

Store `<CLONE_PATH>` — you'll need the absolute path below. Convert Windows backslashes to forward slashes.

## Step 2 — write the MCP config

File path: `~/.claude/mcp.json` (global). If it exists, merge with `mcpServers`. If not, create it:

```json
{
  "mcpServers": {
    "aify-project-graph": {
      "command": "node",
      "args": ["--max-old-space-size=8192", "<CLONE_PATH>/mcp/stdio/server.js"]
    }
  }
}
```

Do NOT add `--toolset=lean` for Claude Code — Claude Code uses the full toolset.

## Step 3 — install all five skills

```bash
mkdir -p ~/.claude/skills
cp -r <CLONE_PATH>/integrations/claude-code/skill ~/.claude/skills/aify-project-graph
cp -r <CLONE_PATH>/integrations/claude-code/skills/graph-setup ~/.claude/skills/
cp -r <CLONE_PATH>/integrations/claude-code/skills/graph-map-functionality ~/.claude/skills/
cp -r <CLONE_PATH>/integrations/claude-code/skills/graph-map-tasks ~/.claude/skills/
cp -r <CLONE_PATH>/integrations/claude-code/skills/graph-anchor-drift ~/.claude/skills/
cp -r <CLONE_PATH>/integrations/claude-code/skills/graph-pull-context ~/.claude/skills/
```

## Step 4 — tell the user to restart

Tell the user (paraphrase is fine):

> Install done. **Restart Claude Code** so the MCP server and skills load. Then in any repo you want to index, just say "generate project graphs" — the `/graph-setup` skill will build everything in one pass (30-90 seconds). After that, every new session automatically reads the brief and saves you 1.5-2.9× wall-clock time.

## Verify (after restart — agent can't do this before)

```
graph_status()
```

Should return `indexed: false` initially in a fresh repo, then `indexed: true` after the first auto-build.

## Troubleshooting

- **`better-sqlite3` flipped platforms** (e.g. same repo from Windows and WSL): `cd <CLONE_PATH> && npm rebuild better-sqlite3`
- **Skill not triggering**: check it lives at `~/.claude/skills/<name>/SKILL.md`, not nested deeper
- **MCP config path errors on Windows**: use forward slashes (`C:/...`), not backslashes
