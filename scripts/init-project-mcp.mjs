#!/usr/bin/env node
// Plan #20 — close the managed-session install gap.
//
// Both graph-senior-dev's managed Codex session AND apg-test-claude's
// managed Claude Code session reported `apg_mcp_tools_exposed: false`
// after running install.*.md. Root cause: `claude mcp add` / `codex mcp
// add` write user-level config (~/.claude.json, ~/.codex/mcp.json) but
// managed agent sessions start from a sealed MCP surface that doesn't
// merge user config. Result: spawned agents (the ones the dashboard
// wants to use APG) never see our verbs.
//
// This script writes a PROJECT-LOCAL MCP config so any session opened
// in that project — managed or interactive — sees APG without ever
// touching user-level config. Supported today:
//
//   --runtime claude-code  → <project>/.mcp.json
//     Claude Code's documented project-scoped MCP server file. May
//     prompt the user for trust approval the first time it's invoked.
//     https://code.claude.com/docs/en/mcp
//
//   --runtime cursor       → <project>/.cursor/mcp.json
//     Cursor's project-scoped MCP config (already documented in
//     install.cursor.md).
//
// NOT supported (docs-only callouts in install.*.md):
//   - codex: managed/CLI config only; no project-local MCP surface.
//   - hermes: project-local not documented; treat as unknown.
//
// Per senior-dev's lock: runtime must be EXPLICIT. The script will
// refuse to infer from `.aify-graph/` presence alone (a shared repo
// would get the wrong IDE config). And graph_index does NOT auto-fire
// this — it's a deliberate, opt-in step the user runs once per project.
//
// Idempotent: existing project-local MCP configs are JSON-merged; only
// the `aify-project-graph` entry is added/updated; sibling MCP server
// entries are preserved.
//
// Usage:
//   node scripts/init-project-mcp.mjs --runtime claude-code --project-root /abs/path
//   node scripts/init-project-mcp.mjs --runtime cursor --project-root /abs/path
//   node scripts/init-project-mcp.mjs --runtime claude-code --check --project-root /abs/path
//
// --check prints what WOULD be written without writing. Useful for CI
// and verification scripts.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const RESOLVED_PLUGIN_ROOT = path.resolve(SELF_DIR, '..');

const SUPPORTED_RUNTIMES = new Set(['claude-code', 'cursor']);
const DOCS_ONLY_RUNTIMES = new Set(['codex', 'hermes', 'opencode', 'pi-linux']);

function usage(exitCode = 2) {
  console.error('Usage: init-project-mcp.mjs --runtime <claude-code|cursor> --project-root <abs-path> [--check] [--plugin-root <abs-path>]');
  console.error('       (codex / hermes / opencode / pi-linux are user-level-only — see install.<runtime>.md)');
  process.exit(exitCode);
}

function parseArgs(argv) {
  const opts = { runtime: null, projectRoot: null, check: false, pluginRoot: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runtime') opts.runtime = argv[++i];
    else if (a === '--project-root') opts.projectRoot = argv[++i];
    else if (a === '--plugin-root') opts.pluginRoot = argv[++i];
    else if (a === '--check') opts.check = true;
    else if (a === '-h' || a === '--help') usage(0);
    else { console.error(`unknown arg: ${a}`); usage(); }
  }
  if (!opts.runtime || !opts.projectRoot) usage();
  if (!SUPPORTED_RUNTIMES.has(opts.runtime)) {
    if (DOCS_ONLY_RUNTIMES.has(opts.runtime)) {
      console.error(`runtime '${opts.runtime}' has no project-local MCP surface; see install.${opts.runtime}.md for user-level install.`);
    } else {
      console.error(`unknown runtime: ${opts.runtime}`);
    }
    process.exit(2);
  }
  return opts;
}

function configPathFor(runtime, projectRoot) {
  if (runtime === 'claude-code') return path.join(projectRoot, '.mcp.json');
  if (runtime === 'cursor') return path.join(projectRoot, '.cursor', 'mcp.json');
  throw new Error(`configPathFor: unsupported runtime ${runtime}`);
}

function readJsonOrEmpty(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    // Honest failure: refuse to overwrite a file we can't parse — caller
    // sees the error + can decide whether to delete or fix manually.
    throw new Error(`existing ${filePath} is not valid JSON: ${err.message}`);
  }
}

function mcpServerStanza(pluginRoot) {
  // Env-expanded so a developer can override per shell without re-running
  // this script (e.g. testing a sibling APG checkout). Claude Code's
  // project-scoped MCP loader supports ${VAR:-default} expansion per the
  // MCP docs. The literal default value is the absolute path resolved at
  // script run time — cross-platform forward-slash form.
  const literalDefault = pluginRoot.replace(/\\/g, '/');
  return {
    type: 'stdio',
    command: 'node',
    args: [
      '--max-old-space-size=8192',
      `\${APG_PLUGIN_ROOT:-${literalDefault}}/mcp/stdio/server.js`,
    ],
  };
}

/**
 * Merge the aify-project-graph entry into a project-local MCP config.
 * Preserves sibling MCP servers exactly; replaces only the named entry.
 * Returns the merged object (does not write).
 */
export function mergeAifyEntry(existing, pluginRoot) {
  const next = { ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}) };
  const servers = next.mcpServers && typeof next.mcpServers === 'object' && !Array.isArray(next.mcpServers)
    ? { ...next.mcpServers }
    : {};
  servers['aify-project-graph'] = mcpServerStanza(pluginRoot);
  next.mcpServers = servers;
  return next;
}

function approvalNoteFor(runtime) {
  if (runtime === 'claude-code') {
    return 'NOTE: Claude Code may prompt the user for trust approval the first time a project-scoped MCP server is invoked. Approve once per project.';
  }
  return null;
}

async function main() {
  const opts = parseArgs(process.argv);
  const projectRoot = path.resolve(opts.projectRoot);
  if (!fs.existsSync(projectRoot)) {
    console.error(`project-root does not exist: ${projectRoot}`);
    process.exit(2);
  }
  const pluginRoot = opts.pluginRoot ? path.resolve(opts.pluginRoot) : RESOLVED_PLUGIN_ROOT;

  const configPath = configPathFor(opts.runtime, projectRoot);
  let existing;
  try {
    existing = readJsonOrEmpty(configPath);
  } catch (err) {
    console.error(err.message);
    process.exit(3);
  }

  const merged = mergeAifyEntry(existing, pluginRoot);

  if (opts.check) {
    console.log(JSON.stringify({
      mode: 'check',
      runtime: opts.runtime,
      configPath,
      wouldWrite: merged,
      pluginRoot,
      existingHadAifyEntry: !!(existing?.mcpServers?.['aify-project-graph']),
      approvalNote: approvalNoteFor(opts.runtime),
    }, null, 2));
    return;
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n');

  console.log(`Wrote ${configPath}`);
  const note = approvalNoteFor(opts.runtime);
  if (note) console.log(note);
  console.log(`\nNext: restart your ${opts.runtime} session in ${projectRoot} for the MCP server to load.`);
}

if (process.argv[1] && process.argv[1].endsWith('init-project-mcp.mjs')) {
  main().catch(err => { console.error(err?.stack || err); process.exit(1); });
}
