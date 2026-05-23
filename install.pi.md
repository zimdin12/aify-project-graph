# Install aify-project-graph for Pi / low-resource Linux

**You are an agent reading this to install aify-project-graph on a Pi-style Linux host. Execute the steps in order.**

This install keeps the base APG runtime small: Node, SQLite native module, tree-sitter parsers, static briefs, and the lean MCP surface. C++ code-intel is optional and only runs when `compile_commands.json` and `clangd` are available.

## Step 0 - prerequisites

```bash
node --version   # must be >=20
npm --version
git --version
```

If native modules fail to build, install the platform build tools first:

```bash
sudo apt-get update
sudo apt-get install -y build-essential python3 make g++
```

Optional C++ precision backend:

```bash
sudo apt-get install -y clangd
```

Skip `clangd` on small devices unless the target repo already has `compile_commands.json` and you specifically need C++ precision facts.

## Step 1 - clone to a stable plugin path

```bash
PLUGIN_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/aify/plugins/aify-project-graph"
mkdir -p "$(dirname "$PLUGIN_ROOT")"

if [ -d "$PLUGIN_ROOT/.git" ]; then
  git -C "$PLUGIN_ROOT" pull --ff-only
else
  git clone https://github.com/zimdin12/aify-project-graph "$PLUGIN_ROOT"
fi

cd "$PLUGIN_ROOT"
npm install
npm run validate:marketplace
npm test
```

## Step 2 - register the MCP server

Use the host runtime's MCP registration mechanism. For low-resource agent profiles, use the lean surface:

```bash
node --max-old-space-size=2048 "$PLUGIN_ROOT/mcp/stdio/server.js" --toolset=lean
```

Visible lean verbs: `graph_packet`, `graph_consequences`, `graph_pull`, `graph_change_plan`, `graph_health`.

If the host is OpenCode, patch `${XDG_CONFIG_HOME:-$HOME/.config}/opencode/opencode.json` the same way `install.opencode.md` does, but point the command at `$PLUGIN_ROOT`.

### Plan #20 — managed-session install: USER-LEVEL ONLY (today)

Pi runtimes use whatever underlying agent host you registered above (OpenCode, Hermes, or another MCP-capable wrapper). Project-local MCP support depends on that host — see the host's install doc for the per-project init step if any. For OpenCode/Hermes/Codex hosts there is no project-local MCP path today; managed sessions may not see APG verbs.

## Step 3 - build a repo graph

From the target repo, prepare ignore hygiene before first index:

```bash
printf '\n.aify-graph/\n' >> .gitignore
printf '\nbuild/\ndist/\ngenerated/**\n*.tmp.cpp\n' >> .aifyignore
```

Then generate the graph and briefs:

```bash
node "$PLUGIN_ROOT/scripts/graph-brief.mjs" "$PWD"
```

If the runtime supports MCP tool calls, call `graph_index(force=true)` once from inside the repo before regenerating briefs.

## Optional - C++ code-intel (modern bounded verbs + batch collection)

Two surfaces, both optional, both require `clangd` on PATH:

**Atomic C++ inner-loop questions (fast, no DB round-trip).** When an agent just edited a file and wants ONE bounded answer — diagnostics, refs of a symbol, hover at a position — the bounded `code_intel_*` MCP verbs drive clangd live, no collection cycle needed. Listed in tools/list when the full surface is exposed; on lean Pi profile they're still callable by name:

- `code_intel_diagnostics({files:[...]})` — per-file errors
- `code_intel_references({file,line,col})` — symbol-aware refs
- `code_intel_definitions({file,line,col})` — defs across TUs
- `code_intel_hover({file,line,col})` — type sig + docstring
- `code_intel_symbols({file})` — document outline
- `code_intel_analyze({files:[...], mode:"clang-tidy"|"compile"})` — bounded analyzer/build facts for explicit files only

**Batch collection for whole-repo snapshots** (only when the repo has `compile_commands.json`):

```bash
test -f compile_commands.json || test -f build/compile_commands.json
# Modern v0.2 (validated, imports automatically):
node "$PLUGIN_ROOT/bin/apg.js" code-intel collect cpp --project-root "$PWD" --json > /tmp/cl.json
node "$PLUGIN_ROOT/scripts/import-code-intel.mjs" "$PWD" /tmp/cl.json
# Or legacy v0.1 source-scan:
node "$PLUGIN_ROOT/tools/code-intel/cpp-clangd/extract.mjs" "$PWD"
node "$PLUGIN_ROOT/scripts/import-code-intel.mjs" "$PWD" "$PWD/.aify-graph/code-intel/cpp-clangd.jsonl"
node "$PLUGIN_ROOT/scripts/graph-brief.mjs" "$PWD"
```

**Pi native LSP routing (optional).** If Pi's native LSP extension should drive clangd through the APG wrapper (uniform error exits, fix hints, project-local→bundled→global resolution), drop `.pi-lsp.json` in the target repo's root. Template at `$PLUGIN_ROOT/docs/integrations/pi-lsp.json.example`:

```json
{
  "autoStart": ["cpp"],
  "servers": { "cpp": { "command": "aify-code-intel", "args": ["serve-lsp", "cpp"] } }
}
```

The base graph still works without any of this. Imported facts are tagged `CODE_INTEL` so agents can distinguish compiler/LSP-derived edges from tree-sitter guesses.

## Verify

After restart or MCP registration, `graph_health()` should return a trust line. If no graph exists yet, call `graph_index(force=true)` before relying on live graph results. For planning work, prefer `graph_packet(target="feature:<id>")` or `.aify-graph/brief.plan.md` first, then source reads.
