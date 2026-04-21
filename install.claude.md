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
npm test         # expect: ~165 passing (165 as of 2026-04-21)
```

A committed `.npmrc` sets `legacy-peer-deps=true` because several tree-sitter grammar packages declare `peerOptional tree-sitter@^0.21.1` while the repo pins `^0.22.0`. Both versions work at runtime; npm just refuses to auto-resolve. The `.npmrc` makes `npm install` work with no flags; do not delete it.

If `npm test` fails with `better_sqlite3.node is not a valid Win32 application` (or Linux equivalent), the native binary was built on another platform. The MCP server auto-heals this on runtime startup, but the test command runs outside that startup path, so do it manually:

```bash
npm rebuild better-sqlite3
```

If the initial `npm install` fails to compile `better-sqlite3`, install native build tools:
- Windows: VS Build Tools ("Desktop development with C++")
- macOS: `xcode-select --install`
- Linux: `apt install build-essential`

## Step 2 — register the MCP server

Use the `claude mcp` CLI, not hand-edited JSON. The CLI writes to `~/.claude.json` (user scope) which Claude Code reads on launch. Do NOT hand-edit this file — it is also managed by Claude Code internals. A standalone `~/.claude/mcp.json` is silently ignored. Hand-editing `~/.claude/settings.json` → `mcpServers` works but is a legacy path; prefer the CLI.

```bash
# Idempotent — remove any prior registration first
claude mcp remove --scope user aify-project-graph >/dev/null 2>&1 || true

claude mcp add aify-project-graph --scope user \
  -- node --max-old-space-size=8192 "$CLONE_PATH/mcp/stdio/server.js"
```

Do **not** pass `--toolset=lean` for Claude Code — Claude Code uses the full toolset.

The `--max-old-space-size=8192` gives Node an 8 GB heap, needed for repos with >100k extractable symbols. On 8 GB RAM machines, use `4096` instead.

### Multi-repo caveat — MCP is cwd-bound

The registered MCP server has ONE `repoRoot` — whatever directory Claude Code was launched from. Live verbs (`graph_change_plan`, `graph_impact`, `graph_path`, etc.) query that graph only. If you call them while working in a different repo, they return `NO MATCH`.

What still works cross-repo:
- **Reading static briefs** — agents that read `.aify-graph/brief.*.md` directly work for any repo that has a graph. This is the recommended cross-repo path and matches the skill's "brief-first" discipline.
- **`/graph-build-all`** and sibling build-skills — they operate on the target repo's `.aify-graph/` by shelling to `scripts/graph-brief.mjs` with the repo path.

What does NOT work cross-repo with a single registration:
- Any live MCP verb query against a repo different from where Claude Code was launched.

Options for multi-repo teams:
- **Per-repo launch.** Launch a separate Claude Code session from each repo. Each one auto-uses the same MCP registration but the verbs operate on the local cwd.
- **Rely on static briefs.** The measured win (−36% tool calls on orient tasks) comes from the briefs, not the live verbs — for most work briefs alone are enough.
- **Register multiple MCP instances.** Future option if live-verb cross-repo becomes common; not yet supported out of the box.

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
