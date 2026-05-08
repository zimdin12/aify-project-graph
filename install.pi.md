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

## Optional - C++ code-intel import

Only run this when the repo has a valid compile database:

```bash
test -f compile_commands.json || test -f build/compile_commands.json
node "$PLUGIN_ROOT/tools/code-intel/cpp-clangd/extract.mjs" "$PWD"
node "$PLUGIN_ROOT/scripts/import-code-intel.mjs" "$PWD" "$PWD/.aify-graph/code-intel/cpp-clangd.jsonl"
node "$PLUGIN_ROOT/scripts/graph-brief.mjs" "$PWD"
```

The base graph still works without this. Imported facts are tagged `CODE_INTEL` so agents can distinguish compiler/LSP-derived edges from tree-sitter guesses.

## Verify

After restart or MCP registration, `graph_health()` should return a trust line. If no graph exists yet, call `graph_index(force=true)` before relying on live graph results. For planning work, prefer `graph_packet(target="feature:<id>")` or `.aify-graph/brief.plan.md` first, then source reads.
