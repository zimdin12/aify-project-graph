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

Recommended profile is `--toolset=lean` (6 visible verbs: `graph_packet`, `graph_consequences`, `graph_pull`, `graph_change_plan`, `graph_health`, `graph_watch`) — keeps the highest-value live surfaces plus the one-shot workflow packet (`mode=orient|plan|debug|review|audit`). Hidden verbs stay callable by name via `tools/call`. Drop `--toolset=lean` for the full surface (31 verbs listed in `tools/list`; not recommended on lean runtimes).

**Form A — Hermes MCP CLI (preferred if available):**

```bash
hermes mcp remove aify-project-graph >/dev/null 2>&1 || true

hermes mcp add aify-project-graph \
  -- node --max-old-space-size=8192 "$CLONE_PATH/mcp/stdio/server.js" --toolset=lean
```

**Form B — YAML config patch (fallback; use if Hermes has no `mcp` CLI):**

Hermes reads MCP servers from **`$HERMES_HOME/config.yaml`** under the top-level **`mcp_servers`** key — NOT a JSON file.

> ⚠ **RESOLVE `$HERMES_HOME` FIRST — `~/.hermes` is a common default, not a safe assumption.** On a real Windows install (measured 2026-08-07) `HERMES_HOME` was `%LOCALAPPDATA%\hermes`, and a `~/.hermes/config.yaml` also existed carrying **ten** MCP servers — none of which Hermes ever loaded, because it reads the other file. The stale one looks perfectly plausible, so "I edited the config" is not evidence the config is live.
>
> ```bash
> echo "$HERMES_HOME"                 # if set, this wins — use it
> ls "$HERMES_HOME/config.yaml"       # the file Hermes actually reads
> ```
>
> Confirm with a server you know works: if `aify-comms` (or any working server) is registered in one file and absent from the other, **the file containing it is the live one.** A registration written to the other file is a silent no-op.

Add this block (merge into an existing `mcp_servers:` map if one is already present; do not clobber sibling servers):

```yaml
# $HERMES_HOME/config.yaml  (default ~/.hermes/config.yaml)
mcp_servers:
  aify-project-graph:
    command: node
    args:
      - --max-old-space-size=8192
      - <CLONE_PATH>/mcp/stdio/server.js
      - --toolset=lean
    timeout: 120
    connect_timeout: 60
    enabled: true
```

Expand `<CLONE_PATH>` to the absolute clone path. `--max-old-space-size=8192` gives Node an 8 GB heap; on 8 GB RAM machines use `4096`.

### Step 2b — CONDITIONAL: if a `platform_toolsets` allowlist exists, add the toolset to it

Hermes exposes each MCP server's tools through a **dynamic toolset named `mcp-<server>`** — here, **`mcp-aify-project-graph`**. If a Hermes profile enables an **explicit** `platform_toolsets` allowlist, the server connects successfully but its tools are **filtered out of the session** unless the toolset is on that list. When an allowlist exists, this is the single most common reason a correctly-registered Hermes MCP server shows **zero verbs**.

> ★ **MEASURED 2026-08-07: `platform_toolsets` does NOT gate MCP server tools.** The live config carried `toolsets: [hermes-cli]` (line 6), `platform_toolsets.cli` (line 590) listing **16 built-ins only** — browser, file, memory, terminal, skills, … — and `known_plugin_toolsets` (line 608). `aify-comms` is registered in `mcp_servers`, is **absent** from every one of those lists, and its tools reach sessions normally. That is a working counter-example: **an MCP server does not need to appear in any allowlist.**
>
> **So registration is the whole job, and it comes first.** If the server is not in the live `mcp_servers`, no allowlist edit can help — the tools do not exist to be filtered. Only if tools are still missing AFTER the server is registered in the resolved-`$HERMES_HOME` config and the session restarted does filtering become a real question.
>
> ⚠ **Grep for `toolsets:`, `platform_toolsets:` AND `known_plugin_toolsets:`, in the file at the resolved `$HERMES_HOME`.** Two ways to get this wrong, both observed in the field this week: checking a same-named config elsewhere, and reading the head of a long file and inferring a key's absence without searching for it. The second was mine — 632 lines, and I concluded from the first 20.

**First check whether an allowlist even exists** — the handling is different, and getting this wrong can BREAK a working fleet:

- **A `platform_toolsets:` block EXISTS** → append `mcp-aify-project-graph` to the relevant profile's list (keep every existing entry):

  ```yaml
  # $HERMES_HOME/config.yaml
  platform_toolsets:
    cli:
      - hermes-cli          # keep whatever entries already exist
      - mcp-aify-project-graph
  ```

- **NO `platform_toolsets:` block anywhere** → Hermes is not filtering by an allowlist you can see, so the graph tools *should* already be visible. Follow the decision procedure below rather than guessing — **do not blind-create the section as a first move**, because a fresh `platform_toolsets.cli: [hermes-cli, mcp-aify-project-graph]` can RESTRICT the session to those two toolsets and silently drop whatever else loaded by default.

**Note on Form A:** the `hermes mcp add` CLI writes `mcp_servers` but does not touch `platform_toolsets`, so if a filtering profile already exists you must append the toolset there manually.

### Step 2c — DECIDE IT FROM EVIDENCE (do this instead of guessing)

An earlier version of this doc stopped at "if there is no section, look elsewhere," which left teams with a conditional they had no way to resolve — one real deployment sat blocked for two weeks because of it. Resolve it by observation instead:

1. **Observe whether the tools are actually exposed.** Start a normal hermes session in a repo that has a `.aify-graph/` directory and ask it to list its available tools, or invoke one directly by name:

   ```text
   graph_health()
   ```

   - **Tools respond** → nothing is filtering them. You are done; the allowlist is not your problem.
   - **`graph_health` is unknown / no `graph_*` tools listed** → continue to step 2.

2. **Confirm the server itself is connecting.** Check the hermes logs/console for an `aify-project-graph` MCP connection at startup.
   - **It never connects** → this is a registration or command problem (Step 1/2), not a toolset filter. Verify the `command`/`args` path in `config.yaml` runs by hand: `node <CLONE_PATH>/mcp/stdio/server.js --toolset=lean` should start and wait on stdin.
   - **It connects but the tools are invisible** → this IS the toolset-exposure case. Go to step 3.

3. **Try the allowlist — reversibly.** This is safe because you take a backup first and verify both directions:

   ```bash
   cp "$HERMES_HOME/config.yaml" "$HERMES_HOME/config.yaml.bak"
   ```

   Add the section, including any toolsets you already rely on, plus ours:

   ```yaml
   platform_toolsets:
     cli:
       - hermes-cli
       - mcp-aify-project-graph
   ```

   Restart hermes and check BOTH:
   - graph tools now respond (`graph_health()`), **and**
   - the tools your agents were already using still work.

   **If anything you relied on disappeared, restore immediately:**

   ```bash
   mv "$HERMES_HOME/config.yaml.bak" "$HERMES_HOME/config.yaml"
   ```

   and report what vanished — that tells us the real default set for your build.

Note the reference precedent: the CodeGraph installer creates `platform_toolsets` with `[hermes-cli, mcp-codegraph]` when the section is absent, so create-if-missing is an established recipe — the backup-and-verify loop above is simply how you confirm it for *your* build without betting a working fleet on it.

### Managed / spawned hermes agents

If a hand-launched hermes session sees the tools but a **managed/spawned** one (e.g. via an orchestrator wrapper) does not, the difference is the managed profile, not `config.yaml` — see Plan #20 below.

### Optional — clangd setup for the C++ code-intel trust spine

clangd is **optional** but powers the `code_intel_*` verbs + `LSP_VERIFIED` caller edges. Resolution order: `APG_CLANGD` env var → `C:/Program Files/LLVM/bin/clangd.exe` (Windows) → `clangd` on PATH. On Hermes, set `APG_CLANGD` in the MCP server's `env` (the `config.yaml` `mcp_servers.aify-project-graph` stanza) when clangd isn't on PATH — for a WSL Hermes that means the WSL clangd path (e.g. `/usr/bin/clangd`), which also gives full diagnostics against a WSL-built `compile_commands.json`:

```yaml
# config.yaml — mcp_servers stanza env (illustrative)
mcp_servers:
  aify-project-graph:
    command: node
    args: ["--max-old-space-size=8192", "<CLONE_PATH>/mcp/stdio/server.js", "--toolset=lean"]
    env:
      APG_CLANGD: /usr/bin/clangd
```

Verify with `node "$CLONE_PATH/bin/apg.js" code-intel doctor cpp`. The repo needs a `compile_commands.json`; references/hierarchy stay trustworthy cross-platform, full diagnostics/hover want clangd matching the DB's toolchain (run under WSL for a WSL/Linux DB — status-doc known-issue P0-3).

### Code-intel verbs (after install)

For C++ work the bounded live verbs are `code_intel_diagnostics / references / definitions / hover / symbols / hierarchy / analyze` (clangd live, no collect round-trip). For repo-wide ranked callers, run `graph_collect_code_intel({language:"cpp", scope:"all"})` once → `graph_callers` then renders `[lsp✓]` + `LSP_VERIFIED` on real caller edges. `graph_shader` bridges C++↔GLSL bindings. **Trust rule: `[lsp✓]` / `LSP_VERIFIED` = clangd ground truth — don't re-grep it; absence claims gate on `evidence.exhaustive === true`.**

### Multi-repo caveat — MCP is cwd-bound

The registered MCP server has ONE `repoRoot` — whatever directory Hermes was launched from. Live verbs query that graph only; calls from a different cwd return `NO MATCH`. Cross-repo works via the static briefs (`.aify-graph/brief.*.md`) agents read directly. Launch Hermes from each target repo if you need live verbs there.

### Plan #20 — managed-session install: USER-LEVEL ONLY (today)

No project-local MCP config path is documented for Hermes today. User-level (Form A CLI / Form B YAML-config) is the only path. **Managed/spawned Hermes sessions** (started via aify-comms `hermes-aify` or any other orchestrator) launch a real Hermes CLI session that DOES read `$HERMES_HOME/config.yaml` — so they pick up `mcp_servers` normally. The usual reason a managed Hermes agent reports **no APG verbs** while a hand-launched one sees them is the **`platform_toolsets.cli` allowlist (Step 2b)**: the managed profile filters the `mcp-aify-project-graph` toolset out. Fix Step 2b and restart the managed session. If your Hermes build proves to support a project-local MCP file path, file an issue with the path and we'll add it to `scripts/init-project-mcp.mjs` alongside claude-code and cursor.

## Step 3 — install the skills

If Hermes loads SKILL.md-style skills (same markdown as Claude Code / Codex, with a `trigger:` frontmatter field that auto-activates when the aify-graph MCP tools are present), copy the tree. If your Hermes build has no skill loader, skip this step — the MCP verb descriptions carry the core guidance regardless.

```bash
# ★ DO NOT ASSUME THE DEFAULT — RESOLVE IT. On a real Windows install measured
# 2026-08-07, HERMES_HOME was set to %LOCALAPPDATA%\hermes, and BOTH documented
# defaults ($HOME/.config/hermes and $HOME/.hermes) were wrong. An earlier fix
# here made the two blocks of this doc agree on $HOME/.hermes, which removed the
# internal contradiction while leaving both halves pointing at a home Hermes
# does not use — so skills and MCP config landed in a file nobody reads, and the
# install reported success. Agreeing with yourself is not the same as being right.
#
# If HERMES_HOME is already exported, that value wins. Verify before copying:
#   echo "$HERMES_HOME"                       # empty? then check both candidates
#   ls "$HERMES_HOME/config.yaml"             # the config Hermes actually reads
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
echo "Installing skills to: $HERMES_HOME/skills"   # ← confirm this is the live home
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

- **MCP tool not visible** → (1) confirm Step 2 wrote the entry: `mcp_servers.aify-project-graph` under `$HERMES_HOME/config.yaml` (CLI: re-run `hermes mcp add`). (2) **Most common cause:** confirm Step 2b — `mcp-aify-project-graph` is listed under `platform_toolsets.cli` (and any other profile in use). A server that's "connected" per `graph_health` failing to appear in `tools/list` is almost always this allowlist filter, not a registration miss. If your Hermes build uses a different config path or CLI verb, only the registration entrypoint changes — the `node … server.js --toolset=lean` stanza is correct.
- **`better-sqlite3` flipped platforms** (same clone across Windows/WSL) → clone separately per environment, or `npm rebuild better-sqlite3` in the runtime you use.
- **Graph seems stale** → `graph_index(force=true)` for a full rebuild.
