# Install aify-project-graph for Codex

**You are an agent reading this to install aify-project-graph for the user. Execute every step exactly. The user's only manual action is restarting Codex at the end.**

## Context: WSL vs native

Codex is typically used in WSL on Windows. If the user also runs Claude Code on native Windows, the two runtimes need **separate clones** — `better-sqlite3` is a native module and its compiled binary must match the runtime (Windows .node ≠ Linux .so). Install this doc inside the environment where Codex actually runs (usually WSL). The Claude-Code install is a separate clone on the Windows side via `install.claude.md`.

## Prerequisites

```bash
node --version     # must be >= 20
git --version
codex --version    # Codex CLI must be on PATH
```

If any fails, stop and tell the user to install the missing tool.

## Step 1 — clone to the fixed install path

Do not ask the user where to put the source. The install path is pinned to avoid collisions with dev checkouts.

```bash
CLONE_PATH="$HOME/.codex/plugins/aify-project-graph"

if [ ! -d "$CLONE_PATH" ]; then
  mkdir -p "$(dirname "$CLONE_PATH")"
  git clone https://github.com/zimdin12/aify-project-graph.git "$CLONE_PATH"
else
  git -C "$CLONE_PATH" pull --ff-only
fi

cd "$CLONE_PATH"
npm install
npm test         # expect: 165 passing (as of 2026-04-21)
```

If `npm test` fails with `better_sqlite3.node is not a valid ... application`, the native binary was built on another platform. The MCP server auto-heals this on runtime startup, but the test command runs outside that path, so do it manually:

```bash
npm rebuild better-sqlite3
```

If `npm install` fails to compile the native module, install `build-essential` (Linux / WSL) or the platform equivalent.

## Step 2 — register the MCP server

Use the `codex mcp` CLI. Recommended profile is `--toolset=lean` (3 visible verbs: `graph_impact`, `graph_path`, `graph_change_plan`) — measured to reduce tool-surface tax on Codex with no functional loss, hidden verbs remain callable by name via `tools/call`.

```bash
codex mcp remove aify-project-graph >/dev/null 2>&1 || true

codex mcp add aify-project-graph \
  -- node --max-old-space-size=8192 "$CLONE_PATH/mcp/stdio/server.js" --toolset=lean
```

Drop `--toolset=lean` if the user wants the full 19-verb surface (not recommended on Codex).

`--max-old-space-size=8192` gives Node an 8 GB heap. On 8 GB RAM machines, use `4096`.

## Step 3 — install the skills

Codex loads skills from `${CODEX_HOME:-$HOME/.codex}/skills/`. We ship Codex-format skills (same SKILL.md markdown as Claude Code, but with an additional `trigger:` frontmatter field that auto-activates the skill when the aify-graph MCP tools are present). Copy the whole tree dynamically so future skills are picked up without editing this doc.

```bash
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
mkdir -p "$CODEX_HOME/skills"

# Core skill
rm -rf "$CODEX_HOME/skills/aify-project-graph"
cp -R "$CLONE_PATH/integrations/codex/skill" "$CODEX_HOME/skills/aify-project-graph"

# Peripheral skills (one subdir per skill)
for dir in "$CLONE_PATH/integrations/codex/skills"/*/; do
  name=$(basename "$dir")
  rm -rf "$CODEX_HOME/skills/$name"
  cp -R "$dir" "$CODEX_HOME/skills/$name"
done
```

The skills auto-activate when the `graph_status` / `graph_pull` / `graph_index` MCP tools are available (i.e. after the MCP server is registered in Step 2). They cover the same workflows as the Claude Code set: `/graph-build-all`, `/graph-build-briefs`, `/graph-build-functionality`, `/graph-build-tasks`, `/graph-feature-edit`, `/graph-task-edit`, `/graph-anchor-drift`, `/graph-pull-context`, `/graph-walk-bugs`, `/graph-dashboard`. Codex doesn't expose them as slash commands the same way Claude Code does, but the agent reads them when relevant tasks come up.

## Step 4 — tell the user to restart

Tell the user (paraphrase is fine):

> Install done. **Restart Codex** so the MCP server loads. In any repo, call `graph_status()` — auto-indexes on first call. For the static-brief workflow (cross-tester 2026-04-20 matched-N on shell-accessible tasks: roughly parity aggregate on Codex due to prompt caching; the real Codex win is on overlay-dependent tasks where brief-only goes baseline 2/4 clean → brief 4/4 clean, −18% tokens, −51% duration), run this one-time setup per target repo:
>
> ```bash
> node ~/.codex/plugins/aify-project-graph/scripts/graph-brief.mjs /path/to/your/repo
> ```
>
> Then paste `/path/to/your/repo/.aify-graph/brief.agent.md` into your session prompt. For plan tasks, hand-author `/path/to/your/repo/.aify-graph/functionality.json` (sample at `~/.codex/plugins/aify-project-graph/docs/examples/functionality.sample.json`) and re-run `graph-brief.mjs`.

## Verify (after restart)

```
graph_status()
```

Returns `indexed: false` initially; any query verb triggers the first build.

## Troubleshooting

- **Tool not registered** → `codex mcp list` should show `aify-project-graph`. If not, Step 2 failed silently — rerun.
- **Path errors on Windows** → Not applicable in WSL. If installing in Git Bash on Windows instead of WSL, use forward slashes (`C:/...`) in any hand-edited config.
- **`better-sqlite3` flipped platforms** → happens when the same clone is used from both Windows and WSL. Fix: clone separately in each environment, or run `npm rebuild better-sqlite3` in the runtime you currently plan to use.
- **Graph seems stale** → `graph_index(force=true)` for full rebuild.
- **`codex exec` cancels live MCP calls** → interactive Codex works, but some non-interactive `codex exec` runs cancel MCP tool calls mid-flight. Use the brief-first workflow in `exec`, or verify live verbs in an interactive Codex session.
- **Node heap overflow on very large repos** → raise `--max-old-space-size` above 8192.
