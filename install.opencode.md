# Install aify-project-graph for OpenCode

**You are an agent reading this to install aify-project-graph for the user. Execute every step exactly. The user's only manual action is restarting OpenCode at the end.**

## Context: WSL vs native

If the user runs OpenCode in WSL on Windows while also running Claude Code on native Windows, the two need **separate clones** — `better-sqlite3` is a native module and its compiled binary must match the runtime. Install this doc inside the environment where OpenCode actually runs.

## Prerequisites

```bash
node --version     # must be >= 20
git --version
```

If either fails, stop and tell the user to install the missing tool.

## Step 1 — clone to the fixed install path

```bash
CLONE_PATH="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins/aify-project-graph"

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

If the native module fails on load (`better_sqlite3.node is not a valid ... application`). The MCP server auto-heals this on runtime startup; for the install-time test run, do it manually:

```bash
npm rebuild better-sqlite3
```

If `npm install` cannot compile the native module, install `build-essential` (Linux / WSL) or platform equivalent.

## Step 2 — register the MCP server

OpenCode config lives at `${XDG_CONFIG_HOME:-$HOME/.config}/opencode/opencode.json`. Patch it via a short Node script so existing `mcp` entries are merged, not overwritten.

```bash
CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/opencode.json"
mkdir -p "$(dirname "$CONFIG_FILE")"
if [ ! -f "$CONFIG_FILE" ]; then
  echo '{"$schema":"https://opencode.ai/config.json"}' > "$CONFIG_FILE"
fi

node -e '
  const fs = require("fs");
  const file = process.argv[1];
  const serverPath = process.argv[2];
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, "utf-8")); } catch (_) {}
  if (!data || typeof data !== "object") data = {};
  if (!data.$schema) data.$schema = "https://opencode.ai/config.json";
  if (!data.mcp || typeof data.mcp !== "object" || Array.isArray(data.mcp)) data.mcp = {};
  data.mcp["aify-project-graph"] = {
    type: "local",
    enabled: true,
    command: ["node", "--max-old-space-size=8192", serverPath, "--toolset=lean"],
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
' "$CONFIG_FILE" "$CLONE_PATH/mcp/stdio/server.js"
```

Recommended profile is `--toolset=lean` (3 visible verbs: `graph_consequences`, `graph_pull`, `graph_change_plan`). Hidden verbs remain callable by name. Drop `--toolset=lean` from the `command` array for the full 21-verb surface.

### Multi-repo caveat — MCP is cwd-bound

The registered MCP server has ONE `repoRoot` — whatever directory OpenCode was launched from. Live verbs query that graph only; calls from a different cwd return `NO MATCH`. Cross-repo works via the static briefs (`.aify-graph/brief.*.md`) that agents can read directly. Launch OpenCode from each target repo if you need live verbs there.

## Step 3 — skills

OpenCode does not load Claude-Code skill files. **Skip this step.**

## Step 4 — tell the user to restart

Tell the user (paraphrase is fine):

> Install done. **Restart OpenCode** so the MCP server loads. In any repo, call `graph_status()` — auto-indexes on first call. For the static-brief workflow (measured savings on orient tasks — see README for cross-tester numbers), run once per target repo:
>
> ```bash
> node "$CLONE_PATH/scripts/graph-brief.mjs" /path/to/your/repo
> ```
>
> Then paste `/path/to/your/repo/.aify-graph/brief.agent.md` into your session prompt. For plan tasks, hand-author `.aify-graph/functionality.json` (sample at `$CLONE_PATH/docs/examples/functionality.sample.json`) and re-run graph-brief.mjs.

(Expand `$CLONE_PATH` to the absolute path for the user's copy.)

## Verify (after restart)

```
graph_status()
```

Returns `indexed: false` initially; any query verb triggers the first build.

## Troubleshooting

- **MCP tool not visible** → check `${XDG_CONFIG_HOME:-$HOME/.config}/opencode/opencode.json` has the `mcp.aify-project-graph` entry; rerun Step 2 if missing.
- **`better-sqlite3` flipped platforms** (same clone across Windows/WSL) → clone separately in each environment, or `npm rebuild better-sqlite3` in the runtime you plan to use.
- **Graph seems stale** → `graph_index(force=true)` for full rebuild.
