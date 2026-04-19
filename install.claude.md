# Install aify-project-graph for Claude Code

**You are an agent reading this to install aify-project-graph for the user. Execute every step exactly. The user's only manual action is restarting Claude Code at the end.**

## Prerequisites

```bash
node --version     # must be >= 20
git --version
claude --version   # Claude Code CLI must be on PATH
```

If any fails, stop and tell the user to install the missing tool.

## Step 1 — clone to the fixed install path

Do not ask the user where to put the source. The install path is pinned to avoid collisions with dev checkouts and to keep skill/MCP references stable.

```bash
CLONE_PATH="$HOME/.claude/plugins/aify-project-graph"

# Fresh install
if [ ! -d "$CLONE_PATH" ]; then
  mkdir -p "$(dirname "$CLONE_PATH")"
  git clone https://github.com/zimdin12/aify-project-graph.git "$CLONE_PATH"
else
  # Already installed — update in place
  git -C "$CLONE_PATH" pull --ff-only
fi

cd "$CLONE_PATH"
npm install
npm test              # expect: 144 passing
```

If `npm test` fails with `better_sqlite3.node is not a valid Win32 application` (or Linux equivalent), the native binary was built on another platform. Fix with:

```bash
npm rebuild better-sqlite3
```

Then rerun `npm test` — should now be 144 passing.

If the initial `npm install` fails to compile `better-sqlite3`, install native build tools:
- Windows: VS Build Tools ("Desktop development with C++")
- macOS: `xcode-select --install`
- Linux: `apt install build-essential`

## Step 2 — register the MCP server

Use the `claude mcp` CLI, not hand-edited JSON. Claude Code reads MCP servers from `~/.claude/settings.json` → `mcpServers`; a standalone `mcp.json` is silently ignored. The CLI writes to the correct file.

```bash
# Idempotent — remove any prior registration first
claude mcp remove --scope user aify-project-graph >/dev/null 2>&1 || true

claude mcp add aify-project-graph --scope user \
  -- node --max-old-space-size=8192 "$CLONE_PATH/mcp/stdio/server.js"
```

Do **not** pass `--toolset=lean` for Claude Code — Claude Code uses the full toolset.

The `--max-old-space-size=8192` gives Node an 8 GB heap, needed for repos with >100k extractable symbols. On 8 GB RAM machines, use `4096` instead.

## Step 3 — install the skills

Copy the whole skills tree dynamically so future skills are picked up without editing this doc.

```bash
mkdir -p "$HOME/.claude/skills"

# Core skill (flat SKILL.md at integrations/claude-code/skill/)
rm -rf "$HOME/.claude/skills/aify-project-graph"
cp -R "$CLONE_PATH/integrations/claude-code/skill" "$HOME/.claude/skills/aify-project-graph"

# Peripheral skills (one subdir per skill)
for dir in "$CLONE_PATH/integrations/claude-code/skills"/*/; do
  name=$(basename "$dir")
  rm -rf "$HOME/.claude/skills/$name"
  cp -R "$dir" "$HOME/.claude/skills/$name"
done
```

## Step 4 — tell the user to restart

Tell the user (paraphrase is fine):

> Install done. **Restart Claude Code** so the MCP server and skills load. Then in any repo you want to index, just say "generate project graphs" — the `/graph-build-all` skill will build everything in one pass (30-90 seconds). After that, every new session automatically reads the brief and saves you 1.5-2.9× wall-clock time. For narrower jobs: `/graph-build-briefs`, `/graph-build-functionality`, `/graph-build-tasks`, `/graph-feature-edit`, `/graph-task-edit`, `/graph-anchor-drift`, `/graph-pull-context`, `/graph-walk-bugs`, `/graph-dashboard`.

## Verify (after restart — agent cannot do this before)

```
graph_status()
```

Returns `indexed: false` initially; `graph_index()` or any query verb triggers the first build.

## Troubleshooting

- **`tool not found: graph_*`** → MCP didn't register. Re-run `claude mcp list` to confirm `aify-project-graph` is present; if not, Step 2 failed silently.
- **Skill not triggering** → confirm `~/.claude/skills/<name>/SKILL.md` exists (not nested one dir deeper).
- **`better-sqlite3` flipped platforms** (same clone used from Windows and WSL) → `cd "$CLONE_PATH" && npm rebuild better-sqlite3` from the runtime you plan to use.
- **Windows path errors in MCP args** → the `claude mcp add` CLI normalizes paths correctly; if you hand-edited `settings.json`, use forward slashes (`C:/...`), not backslashes.
