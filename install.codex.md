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
npm install --legacy-peer-deps   # tree-sitter peer-dep mismatch; safe
npm test
```

If `npm test` fails with `better_sqlite3.node is not a valid ... application`, the native binary was built on another platform:

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

Drop `--toolset=lean` if the user wants the full 17-verb surface (not recommended on Codex).

`--max-old-space-size=8192` gives Node an 8 GB heap. On 8 GB RAM machines, use `4096`.

## Step 3 — skills

Codex does not load Claude-Code skill files. The MCP tool descriptions are self-documenting on Codex. **Skip this step.**

## Step 4 — tell the user to restart

Tell the user (paraphrase is fine):

> Install done. **Restart Codex** so the MCP server loads. In any repo, call `graph_status()` — auto-indexes on first call. For the full static-brief workflow (1.5-2.9× faster orientation, 17-35% cheaper tokens on orient tasks), run this one-time setup per target repo:
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
- **Node heap overflow on very large repos** → raise `--max-old-space-size` above 8192.
