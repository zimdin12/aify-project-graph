# Install aify-project-graph for the Hermes agent

**You are an agent reading this to install aify-project-graph for the user on the Hermes agent runtime. Execute every step exactly. The user's only manual action is restarting Hermes at the end.**

> **Hermes registration note.** Hermes is MCP-capable; the MCP *server stanza* below (`node … mcp/stdio/server.js --toolset=lean`) is runtime-agnostic and identical to every other runtime. Only the *registration entrypoint* is Hermes-specific. Step 2 gives two equivalent forms — the `hermes mcp` CLI (preferred, mirrors Claude Code / Codex) and a JSON-config patch fallback (mirrors OpenCode / Pi). Use whichever your Hermes build supports; if the CLI subcommand or config path differs in your build, keep the server stanza verbatim and only adjust the path/command — that is the sole variable part.

## Context: WSL vs native

If the user runs Hermes in WSL on Windows while also running another runtime on native Windows, the two need **separate clones** — `better-sqlite3` is a native module and its compiled binary must match the runtime. Install this doc inside the environment where Hermes actually runs.

## Prerequisites

```bash
node --version     # must be >= 20
git --version
```

If either fails, stop and tell the user to install the missing tool.

## Step 1 — clone to the fixed install path

```bash
CLONE_PATH="${XDG_CONFIG_HOME:-$HOME/.config}/hermes/plugins/aify-project-graph"

if [ ! -d "$CLONE_PATH" ]; then
  mkdir -p "$(dirname "$CLONE_PATH")"
  git clone https://github.com/zimdin12/aify-project-graph.git "$CLONE_PATH"
else
  git -C "$CLONE_PATH" pull --ff-only
fi

cd "$CLONE_PATH"
npm install
npm run validate:marketplace
npm test         # expect: full suite green; exact count changes as coverage grows
```

If the native module fails on load (`better_sqlite3.node is not a valid ... application`) — the MCP server auto-heals this on runtime startup; for the install-time test run, do it manually:

```bash
npm rebuild better-sqlite3
```

If `npm install` cannot compile the native module, install `build-essential` (Linux / WSL) or the platform equivalent.

## Step 2 — register the MCP server

Recommended profile is `--toolset=lean` (5 visible verbs: `graph_packet`, `graph_consequences`, `graph_pull`, `graph_change_plan`, `graph_health`) — keeps the highest-value live surfaces plus the one-shot workflow packet (`mode=orient|plan|debug|review|audit`). Hidden verbs stay callable by name via `tools/call`. Drop `--toolset=lean` for the full 23-verb surface (not recommended on lean runtimes).

**Form A — Hermes MCP CLI (preferred if available):**

```bash
hermes mcp remove aify-project-graph >/dev/null 2>&1 || true

hermes mcp add aify-project-graph \
  -- node --max-old-space-size=8192 "$CLONE_PATH/mcp/stdio/server.js" --toolset=lean
```

**Form B — JSON config patch (fallback; use if Hermes has no `mcp` CLI):**

Hermes config is assumed at `${XDG_CONFIG_HOME:-$HOME/.config}/hermes/hermes.json`. Patch via Node so existing `mcpServers` entries are merged, not overwritten. If your Hermes build reads a different config file, change `CONFIG_FILE` only — the server stanza is correct as-is.

```bash
CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/hermes/hermes.json"
mkdir -p "$(dirname "$CONFIG_FILE")"
if [ ! -f "$CONFIG_FILE" ]; then echo '{}' > "$CONFIG_FILE"; fi

node -e '
  const fs = require("fs");
  const file = process.argv[1];
  const serverPath = process.argv[2];
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, "utf-8")); } catch (_) {}
  if (!data || typeof data !== "object") data = {};
  if (!data.mcpServers || typeof data.mcpServers !== "object" || Array.isArray(data.mcpServers)) data.mcpServers = {};
  data.mcpServers["aify-project-graph"] = {
    command: "node",
    args: ["--max-old-space-size=8192", serverPath, "--toolset=lean"],
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
' "$CONFIG_FILE" "$CLONE_PATH/mcp/stdio/server.js"
```

`--max-old-space-size=8192` gives Node an 8 GB heap. On 8 GB RAM machines, use `4096`.

### Multi-repo caveat — MCP is cwd-bound

The registered MCP server has ONE `repoRoot` — whatever directory Hermes was launched from. Live verbs query that graph only; calls from a different cwd return `NO MATCH`. Cross-repo works via the static briefs (`.aify-graph/brief.*.md`) agents read directly. Launch Hermes from each target repo if you need live verbs there.

## Step 3 — install the skills

If Hermes loads SKILL.md-style skills (same markdown as Claude Code / Codex, with a `trigger:` frontmatter field that auto-activates when the aify-graph MCP tools are present), copy the tree. If your Hermes build has no skill loader, skip this step — the MCP verb descriptions carry the core guidance regardless.

```bash
HERMES_HOME="${HERMES_HOME:-$HOME/.config/hermes}"
mkdir -p "$HERMES_HOME/skills"

# Core skill
rm -rf "$HERMES_HOME/skills/aify-project-graph"
cp -R "$CLONE_PATH/integrations/hermes/skill" "$HERMES_HOME/skills/aify-project-graph"

# Peripheral skills (one subdir per skill)
for dir in "$CLONE_PATH/integrations/hermes/skills"/*/; do
  name=$(basename "$dir")
  rm -rf "$HERMES_HOME/skills/$name"
  cp -R "$dir" "$HERMES_HOME/skills/$name"
done
```

## Step 4 — tell the user to restart

Tell the user (paraphrase is fine):

> Install done. **Restart Hermes** so the MCP server loads. In any repo, first make sure `.gitignore` contains `.aify-graph/` and add local scratch/build patterns to `.aifyignore` when needed. Then call `graph_health()` to verify registration and `graph_index(force=true)` to build the graph. For the static-brief workflow, run once per target repo:
>
> ```bash
> node "$CLONE_PATH/scripts/graph-brief.mjs" /path/to/your/repo
> ```
>
> Then paste `/path/to/your/repo/.aify-graph/brief.agent.md` into your session prompt. Optional for C++ repos with `compile_commands.json`: run the code-intel import described in the README to add `CODE_INTEL` provenance facts before regenerating briefs.

(Expand `$CLONE_PATH` to the absolute path for the user's copy.)

## Verify (after restart)

```
graph_health()
```

Returns a trust/indexing summary. If no graph exists yet, call `graph_index(force=true)` before relying on live graph results.

## Troubleshooting

- **MCP tool not visible** → confirm Step 2 wrote the entry (CLI: re-run `hermes mcp add`; JSON: check `mcpServers.aify-project-graph` in the Hermes config file). If your Hermes build uses a different config path or CLI verb, only the registration entrypoint changes — the `node … server.js --toolset=lean` stanza is correct.
- **`better-sqlite3` flipped platforms** (same clone across Windows/WSL) → clone separately per environment, or `npm rebuild better-sqlite3` in the runtime you use.
- **Graph seems stale** → `graph_index(force=true)` for a full rebuild.
