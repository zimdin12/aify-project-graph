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
npm test         # expect: full suite green; exact count changes as coverage grows
```

If `npm test` fails with `better_sqlite3.node is not a valid ... application`, the native binary was built on another platform. The MCP server auto-heals this on runtime startup, but the test command runs outside that path, so do it manually:

```bash
npm rebuild better-sqlite3
```

If `npm install` fails to compile the native module, install `build-essential` (Linux / WSL) or the platform equivalent.

## Step 2 — register the MCP server

Use the `codex mcp` CLI. Recommended profile is `--toolset=lean` (5 visible verbs: `graph_packet`, `graph_consequences`, `graph_pull`, `graph_change_plan`, `graph_health`) — measured to reduce tool-surface tax on Codex while keeping the highest-value live planning surfaces plus the one-shot orientation primitive. Hidden verbs remain callable by name via `tools/call`.

```bash
codex mcp remove aify-project-graph >/dev/null 2>&1 || true

codex mcp add aify-project-graph \
  -- node --max-old-space-size=8192 "$CLONE_PATH/mcp/stdio/server.js" --toolset=lean
```

Drop `--toolset=lean` if the user wants the full 21-verb surface (not recommended on Codex).

`--max-old-space-size=8192` gives Node an 8 GB heap. On 8 GB RAM machines, use `4096`.

### Multi-repo caveat — MCP is cwd-bound

The registered MCP server has ONE `repoRoot` — whatever directory Codex was launched from. Live verbs (`graph_impact`, `graph_path`, `graph_change_plan`, etc.) query that graph only. Calling them while working in a different repo returns `NO MATCH`.

What still works cross-repo:
- **Reading static briefs** directly from `.aify-graph/brief.*.md` in the target repo. This is the recommended cross-repo path and matches the skill's "brief-first" discipline.
- `/graph-build-all` and sibling build skills — they shell out to `scripts/graph-brief.mjs <repo>` with the target path.

Options for multi-repo teams:
- **Per-repo launch.** Launch Codex from each repo you work in; the same MCP registration applies but verbs operate on that cwd.
- **Rely on static briefs.** On Codex the brief-first workflow is already the safe path (see Codex-exec caveat below) — briefs cover most real usage without any live verb calls.

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

> Install done. **Restart Codex** so the MCP server loads. In any repo, first make sure `.gitignore` contains `.aify-graph/` and add local scratch/build patterns to `.aifyignore` when needed (`build-linux-techlead`, `generated/**`, `*.tmp.cpp`). Then say "generate project graphs" so the installed `graph-build-all` skill builds the graph, briefs, and functionality overlay. For the manual static-brief fallback, run:
>
> ```bash
> node ~/.codex/plugins/aify-project-graph/scripts/graph-brief.mjs /path/to/your/repo
> ```
>
> Then paste `/path/to/your/repo/.aify-graph/brief.agent.md` into your session prompt. Multi-run signal (apg dogfood + 2026-04-26 echoes A/B): briefs + overlay reliably save ~15-20% wall-clock and tool calls on planning shapes; live verbs are conditionally helpful when used surgically (≤3 per task). See the [README](README.md) for caveats. For plan tasks, hand-author `/path/to/your/repo/.aify-graph/functionality.json` (generic sample: `~/.codex/plugins/aify-project-graph/docs/examples/functionality.sample.json`; Laravel sample: `functionality.sample.laravel.json`) and re-run `graph-brief.mjs`. If the repo uses one shared test entrypoint instead of per-feature test files, add explicit `tests` arrays per feature in `functionality.json`.

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
