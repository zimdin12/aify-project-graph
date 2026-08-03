# Install aify-project-graph for Cursor

**You are an agent reading this to install aify-project-graph for the user on Cursor. Execute every step exactly. The user's only manual action is restarting Cursor at the end.**

> **Cursor integration note.** Cursor consumes MCP via `~/.cursor/mcp.json` (global) or `<project>/.cursor/mcp.json` (project-local). It also has a separate **Rules** system (`.cursor/rules/*.mdc`) where per-project instructions live. APG's tool descriptions already carry the agent-facing guidance, so a Rules file is optional — but a small `.cursor/rules/aify-graph.mdc` improves discoverability. This install does both.

## Context: WSL vs native

If the user runs Cursor in WSL while running another agent on native Windows, the two need **separate clones** — `better-sqlite3` is a native module and its compiled binary must match the runtime.

## Prerequisites

```bash
node --version     # must be >= 20
git --version
```

If either fails, stop and tell the user to install the missing tool.

## Step 1 — clone to the fixed install path

```bash
CLONE_PATH="$HOME/.cursor/plugins/aify-project-graph"

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

If the native module fails on load (`better_sqlite3.node is not a valid ... application`):

```bash
npm rebuild better-sqlite3
```

## Step 2 — register the MCP server

Cursor's MCP config lives at `~/.cursor/mcp.json` (global) or `<project>/.cursor/mcp.json` (project-local). Patch via a Node script so existing `mcpServers` entries merge rather than overwrite.

**Global install (recommended for cross-project use):**

```bash
CURSOR_CONFIG="$HOME/.cursor/mcp.json"
mkdir -p "$(dirname "$CURSOR_CONFIG")"
if [ ! -f "$CURSOR_CONFIG" ]; then echo '{}' > "$CURSOR_CONFIG"; fi

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
' "$CURSOR_CONFIG" "$CLONE_PATH/mcp/stdio/server.js"
```

**Project-local install** (replace `~/.cursor/mcp.json` with `<project>/.cursor/mcp.json`).

Recommended profile is `--toolset=lean` (6 visible verbs). Drop the flag for the full surface (31 verbs listed in `tools/list`).

### Multi-repo caveat — MCP is cwd-bound

The registered MCP server has ONE `repoRoot` — whatever directory Cursor was launched from. Live verbs query that graph only. Cross-repo works via static briefs (`.aify-graph/brief.*.md`).

### Plan #20: project-local MCP for predictable per-project install

The user-level `~/.cursor/mcp.json` above works for most cases. For projects where you want the APG MCP server pinned at the **project** scope (so the registration travels with the repo + survives Cursor profile resets), run once per project:

```bash
node "$CLONE_PATH/scripts/init-project-mcp.mjs" --runtime cursor --project-root "$(pwd)"
```

This writes `<project>/.cursor/mcp.json` with the APG MCP server stanza, env-expanded (`${APG_PLUGIN_ROOT:-<resolved-absolute-path>}`). Idempotent JSON-merge — existing entries for other MCP servers are preserved. `--check` prints the would-write envelope without touching disk.

## Step 3 — install the Rules file (optional but recommended)

```bash
PROJECT_RULES_DIR="${PROJECT_ROOT:-.}/.cursor/rules"
mkdir -p "$PROJECT_RULES_DIR"
cat > "$PROJECT_RULES_DIR/aify-graph.mdc" <<'EOF'
---
description: aify-project-graph MCP — pre-indexed graph + briefs + bounded C++ code-intel
alwaysApply: false
---

When `.aify-graph/` exists in the workspace:

- Prefer `graph_packet({mode:"orient"|"plan"|"verify"|...})` for context primer over file-by-file Read.
- Use `code_intel_references` for absence claims (dead code, safe-to-delete) — trust the answer only when `evidence.exhaustive === true`. When degraded, follow `evidence.fallback`.
- Use `code_intel_diagnostics` for post-edit error checks without a full build.
- Static briefs at `.aify-graph/brief.*.md` are the cheap cross-repo path.

When `.aify-graph/` does NOT exist, run `node $CLONE_PATH/scripts/graph-brief.mjs /path/to/repo` to bootstrap.
EOF
```

## Step 4 — install the skills (optional)

If Cursor's runtime is reading SKILL.md-style instructions from `~/.cursor/skills/`, copy the tree. If your Cursor build has no skill loader, skip this step — the MCP verb descriptions + the Rules file above already carry the guidance.

```bash
CURSOR_SKILLS_DIR="${CURSOR_SKILLS_DIR:-$HOME/.cursor/skills}"
mkdir -p "$CURSOR_SKILLS_DIR"
rm -rf "$CURSOR_SKILLS_DIR/aify-project-graph"
cp -R "$CLONE_PATH/integrations/cursor/skill" "$CURSOR_SKILLS_DIR/aify-project-graph"

for dir in "$CLONE_PATH/integrations/cursor/skills"/*/; do
  name=$(basename "$dir")
  rm -rf "$CURSOR_SKILLS_DIR/$name"
  cp -R "$dir" "$CURSOR_SKILLS_DIR/$name"
done
```

## Step 5 — tell the user to restart

Tell the user (paraphrase is fine):

> Install done. **Restart Cursor** so the MCP server loads. In any repo, first make sure `.gitignore` contains `.aify-graph/`. Then call `graph_health()` to verify registration and `graph_index(force=true)` to build the graph. For the static-brief workflow, run once per target repo:
>
> ```bash
> node "$CLONE_PATH/scripts/graph-brief.mjs" /path/to/your/repo
> ```
>
> Then reference `/path/to/your/repo/.aify-graph/brief.agent.md` in your Cursor session prompt. Optional for C++ repos with `compile_commands.json`: run the code-intel import described in the README for `CODE_INTEL` provenance facts.

(Expand `$CLONE_PATH` to the absolute path for the user's copy.)

## Verify (after restart)

```
graph_health()
```

Returns a trust/indexing summary. If no graph exists yet, call `graph_index(force=true)` before relying on live graph results.

## Troubleshooting

- **MCP tool not visible** → confirm `~/.cursor/mcp.json` has the `mcpServers.aify-project-graph` entry; rerun Step 2 if missing. Cursor may need a full quit+relaunch (not just a reload) for new MCP servers.
- **`better-sqlite3` flipped platforms** (same clone across Windows/WSL) → clone separately per environment, or `npm rebuild better-sqlite3` in the runtime you use.
- **Rules not picked up** → confirm `.cursor/rules/aify-graph.mdc` is present in the project and Cursor's Rules panel shows it.
- **Graph seems stale** → `graph_index(force=true)` for a full rebuild.
