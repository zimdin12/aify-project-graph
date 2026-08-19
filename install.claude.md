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
npm run validate:marketplace
npm test         # expect: full suite green; exact count changes as coverage grows
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

### Plan #20: project-local MCP for managed/spawned sessions

The user-level `claude mcp add` above is sufficient for INTERACTIVE sessions. It is NOT sufficient for **managed/spawned Claude Code sessions** (e.g., agents launched via aify-comms or other orchestrators) — those start with a sealed MCP surface that doesn't merge user-level config, so they will report `tools/list` without `mcp__aify-project-graph__*` even though the user-level install succeeded.

Run once per project you want managed agents to use APG in:

```bash
node "$CLONE_PATH/scripts/init-project-mcp.mjs" --runtime claude-code --project-root "$(pwd)"
```

This writes `<project>/.mcp.json` with the APG MCP server stanza, using env-expansion (`${APG_PLUGIN_ROOT:-<resolved-absolute-path>}`) so a developer can override the plugin path per shell. Claude Code may prompt for trust approval the first time it loads a project-scoped MCP server — approve once per project. Existing `.mcp.json` entries for other MCP servers are preserved (idempotent JSON-merge).

`--check` prints the would-write envelope without touching disk; useful in CI.

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

## ⚠ Updating an existing install — safety contracts change

Skills are installed by COPYING this tree, so an installed copy never updates when the server
does. On 2026-08-19 the C++ skill's central safety claim was **withdrawn**: `evidence.exhaustive
=== true` was documented as the safe basis for "no callers" / "dead code" / "safe to delete",
and it was falsified three times against real clangd. That flag is no longer issued.

Each shipped skill carries a marker like `<!-- APG-SAFETY-CONTRACT: 2026-08-19-exhaustive-withheld -->`
near the top. If your installed copy lacks the current marker, re-run Step 3 to replace it.

✅ Against a CURRENT server, a stale copy leaves you wrong-footed rather than unsafe: the
withdrawn advice was conditional on a flag a current server never issues, so the runtime refuses
underneath it.

⚠ **That qualifier is load-bearing — update BOTH.** An old skill paired with an old server, one
that can still emit the withdrawn grant, retains the original danger in full. The marker records
what the document was written against; it is not evidence that the running bytes are current.
Pull the repo and restart the MCP server as well as re-copying the skills.

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

> Install done. **Restart Claude Code** so the MCP server and skills load. Then in any repo you want to index, just say "generate project graphs" — the `/graph-build-all` skill first checks `.gitignore` / `.aifyignore`, then builds everything in one pass (30-90 seconds). Multi-run signal across apg dogfood + 2026-04-26 echoes A/B: briefs + overlay reliably save ~15-20% wall-clock and tool calls vs Grep-only on planning shapes; live verbs are conditionally helpful when used surgically (≤3 per planning task). Single-bench headlines carry small-n caveats — see the [README](README.md). For narrower jobs: `/graph-build-briefs`, `/graph-build-functionality`, `/graph-build-tasks`, `/graph-feature-edit`, `/graph-task-edit`, `/graph-anchor-drift`, `/graph-pull-context`, `/graph-walk-bugs`, `/graph-dashboard`.
> Optional for C++ repos with `compile_commands.json`: run the code-intel import described in the README to add `CODE_INTEL` provenance facts before regenerating briefs.
>
> For C++ inner-loop editing, the modern path is the bounded live verbs — `code_intel_diagnostics`, `code_intel_references`, `code_intel_definitions`, `code_intel_hover`, `code_intel_symbols`, `code_intel_hierarchy` (call + type hierarchy / virtual dispatch), and `code_intel_analyze`. They drive clangd live or bounded `clang-tidy` / compile-command checks, no collect/import round-trip, ~5-12× less response data than `graph_collect_code_intel` + `graph_pull` for atomic LSP questions. For repo-wide ranked callers, run `graph_collect_code_intel({language:"cpp", scope:"all"})` once, then `graph_callers` renders `[lsp✓]` + `LSP_VERIFIED` on real caller edges (don't re-grep those). `graph_shader` bridges C++↔GLSL bindings. Pair with `graph_packet({mode:"verify", files:[...]})` after edits. **Trust rule: `[lsp✓]` / `LSP_VERIFIED` = clangd ground truth; absence claims ("no callers") gate on `evidence.exhaustive === true`.** Templates for downstream-project `.lsp.json` / `.mcp.json`: see `docs/integrations/lsp.json.example` and `mcp.json.example`.

### Optional — clangd setup (enables the C++ code-intel trust spine)

clangd is **optional**; the graph works without it. When present it powers the `code_intel_*` verbs and `LSP_VERIFIED` caller edges. Resolution order: `APG_CLANGD` env var (explicit path) → `C:/Program Files/LLVM/bin/clangd.exe` on Windows → `clangd` on PATH.

```bash
# If clangd is not on PATH, point APG at it explicitly (Windows LLVM install):
#   set APG_CLANGD=C:/Program Files/LLVM/bin/clangd.exe   (or export on POSIX)
node "$CLONE_PATH/bin/apg.js" code-intel doctor cpp   # prerequisite report with fix hints
```

The C++ repo needs a `compile_commands.json` (project root or `build/`) for cross-TU references. **Windows note:** a `compile_commands.json` built under WSL/Linux carries Linux include/sysroot paths; references and hierarchy stay trustworthy, but full-quality **diagnostics/hover need clangd run under WSL** against the Linux DB (see `docs/code-intel-v2-status.md` known-issue P0-3).

### Recommended — SessionStart discoverability hint (managed/spawned agents)

In **managed** Claude/Codex sessions the MCP tools are deferred behind a search step, so an agent that doesn't already know APG exists can go straight to grep. The MCP server's own instructions already tell agents to `ToolSearch "graph"` (always on); this hook adds a stronger nudge that fires at session start, before any tool call.

**The project-local installer wires it for you.** When you run the Step-2 setup for claude-code:

```bash
node "$CLONE_PATH/scripts/init-project-mcp.mjs" --runtime claude-code --project-root /abs/path/to/project
```

…it now ALSO merges the SessionStart hook into that project's `.claude/settings.json` (idempotent; pass `--no-hint-hook` to skip). The hook prints a one-line "APG available — ToolSearch 'graph', orient with graph_packet/graph_pull" hint **only** when the cwd has a `.aify-graph/` directory, and is silent everywhere else.

To wire it by hand instead (e.g. into user-level settings so it covers every project):

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command",
        "command": "node \"$CLONE_PATH/scripts/hooks/session-start-hint.mjs\"" } ] }
    ]
  }
}
```

## Verify (after restart — agent cannot do this before)

```
graph_health()
```

Returns a trust/indexing summary. If no graph exists yet, call `graph_index(force=true)` or run `/graph-build-all` for full setup.

## Troubleshooting

- **`tool not found: graph_*`** → MCP didn't register. Re-run `claude mcp list` to confirm `aify-project-graph` is present; if not, Step 2 failed silently.
- **Skill not triggering** → confirm `~/.claude/skills/<name>/SKILL.md` exists (not nested one dir deeper).
- **`better-sqlite3` flipped platforms** (same clone used from Windows and WSL) → `cd "$CLONE_PATH" && npm rebuild better-sqlite3` from the runtime you plan to use.
- **Windows path errors in MCP args** → the `claude mcp add` CLI normalizes paths correctly; if you hand-edited `settings.json`, use forward slashes (`C:/...`), not backslashes.
