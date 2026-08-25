#!/usr/bin/env node
// Plan #20 — close the managed-session install gap.
//
// Both the reviewer's managed Codex session AND apg-test-claude's
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
import { cppPreflight, cppPreflightMessage } from './lib/cpp-preflight.mjs';
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
  const opts = { runtime: null, projectRoot: null, check: false, pluginRoot: null, hintHook: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runtime') opts.runtime = argv[++i];
    else if (a === '--project-root') opts.projectRoot = argv[++i];
    else if (a === '--plugin-root') opts.pluginRoot = argv[++i];
    else if (a === '--check') opts.check = true;
    else if (a === '--no-hint-hook') opts.hintHook = false;
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

// "File absent" and "file unparseable" MUST take different branches: absent may
// be created, unparseable must abort rather than silently overwrite a config
// whose other entries (mcpServers, hooks, theme) we'd destroy.
//
// The BOM case is why this needs care on Windows specifically: plenty of Windows
// editors and PowerShell redirections write UTF-8 with a leading BOM, and
// JSON.parse rejects it. Treating that as "unparseable" would abort the install
// on a file that is perfectly valid JSON — so strip the BOM before parsing, and
// reserve the abort for genuinely malformed content.
export function parseJsonRelaxed(text, filePath) {
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    throw new Error(`existing ${filePath} is not valid JSON: ${err.message}`);
  }
}

function readJsonOrEmpty(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return parseJsonRelaxed(fs.readFileSync(filePath, 'utf8'), filePath);
}

// Back up a file we are about to modify, so a bad merge is always recoverable.
// Best-effort: a backup failure must not block the install itself.
function backupBeforeWrite(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, `${filePath}.apg-bak`);
  } catch { /* non-fatal */ }
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

// The SessionStart discoverability hook command (Sand Castle report P0 #1):
// managed sessions defer MCP tools behind a search step, so this fires at
// session start and tells the agent to ToolSearch "graph" + orient with
// graph_packet/graph_pull. Project-local, silent outside an .aify-graph/ repo.
function sessionHintCommand(pluginRoot) {
  const root = pluginRoot.replace(/\\/g, '/');
  return `node "${root}/scripts/hooks/session-start-hint.mjs"`;
}

/**
 * Merge the SessionStart discoverability hook into a project-local Claude Code
 * settings object (`.claude/settings.json`). Idempotent — skips if a
 * session-start-hint.mjs hook is already wired. Preserves all other hooks/keys.
 * Returns { settings, added }.
 */
/**
 * Merge one hook entry into a settings object, idempotently.
 *
 * ⚠ IDENTITY IS THE SCRIPT FILENAME, not the whole command string. The command embeds an absolute
 * plugin path, so matching on the full string would install a SECOND copy of the same hook every
 * time the repo moves — and a hook that fires twice per edit is how a rare signal becomes noise.
 */
function mergeHookEntry(existing, { event, scriptName, command, matcher }) {
  const next = { ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}) };
  const hooks = { ...(next.hooks && typeof next.hooks === 'object' && !Array.isArray(next.hooks) ? next.hooks : {}) };
  const list = Array.isArray(hooks[event]) ? [...hooks[event]] : [];
  const already = list.some((group) => Array.isArray(group?.hooks)
    && group.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(scriptName)));
  if (!already) {
    const group = { hooks: [{ type: 'command', command }] };
    if (matcher) group.matcher = matcher;
    list.push(group);
  }
  hooks[event] = list;
  next.hooks = hooks;
  return { settings: next, added: !already };
}

export function mergeSessionStartHook(existing, pluginRoot) {
  return mergeHookEntry(existing, {
    event: 'SessionStart',
    scriptName: 'session-start-hint.mjs',
    command: sessionHintCommand(pluginRoot),
  });
}

/**
 * The PostToolUse deletion guard: fires ONLY when an edit deleted an exported declaration that
 * still has compiler-verified callers.
 *
 * ⚠ OPT-IN, unlike the SessionStart hint, and deliberately. The roadmap records placement of this
 * hook as the operator's decision, and it is the more intrusive of the two: it injects text into a
 * session mid-task rather than once at the start. Measured fire rate is 4.8% of edits (upper
 * bound) against 85.5% for the "here are the callers" variant that was disqualified — but a
 * measured-low rate is an argument for offering it, not for enabling it on someone's behalf.
 */
export function mergeDeletionGuardHook(existing, pluginRoot) {
  const script = path.join(pluginRoot, 'scripts', 'hooks', 'post-edit-deletion-guard.mjs');
  return mergeHookEntry(existing, {
    event: 'PostToolUse',
    scriptName: 'post-edit-deletion-guard.mjs',
    command: `node "${script}"`,
    matcher: 'Edit|Write|MultiEdit',
  });
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

  // RECOMMENDED for claude-code: also wire the SessionStart discoverability hook
  // into project-local .claude/settings.json so managed/spawned sessions in this
  // project get nudged to ToolSearch the verbs (the #1 adoption gap). Claude-Code
  // only (Cursor has no equivalent SessionStart hook surface here). Opt out with
  // --no-hint-hook.
  const wantHintHook = opts.hintHook && opts.runtime === 'claude-code';
  const settingsPath = path.join(projectRoot, '.claude', 'settings.json');
  let hintPlan = null;
  if (wantHintHook) {
    let settingsExisting;
    try { settingsExisting = readJsonOrEmpty(settingsPath); }
    catch (err) { console.error(err.message); process.exit(3); }
    hintPlan = mergeSessionStartHook(settingsExisting, pluginRoot);
  }

  if (opts.check) {
    console.log(JSON.stringify({
      mode: 'check',
      runtime: opts.runtime,
      configPath,
      wouldWrite: merged,
      pluginRoot,
      existingHadAifyEntry: !!(existing?.mcpServers?.['aify-project-graph']),
      approvalNote: approvalNoteFor(opts.runtime),
      cppPreflight: cppPreflight(projectRoot),
      hintHook: wantHintHook
        ? { settingsPath, wouldWrite: hintPlan.settings, alreadyPresent: !hintPlan.added }
        : { skipped: opts.runtime !== 'claude-code' ? 'not claude-code' : 'disabled (--no-hint-hook)' },
    }, null, 2));
    return;
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  backupBeforeWrite(configPath);
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n');
  console.log(`Wrote ${configPath}`);

  if (wantHintHook) {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    backupBeforeWrite(settingsPath);
    fs.writeFileSync(settingsPath, JSON.stringify(hintPlan.settings, null, 2) + '\n');
    console.log(hintPlan.added
      ? `Wired the SessionStart discoverability hint into ${settingsPath} (managed agents will be nudged to ToolSearch the graph verbs).`
      : `SessionStart discoverability hint already present in ${settingsPath} — left as-is.`);
  }

  // ⛔ C++ PREFLIGHT AT INSTALL TIME, WHEN THE OPERATOR IS ALREADY CONFIGURING. Measured on a fresh
  // clone of fmt: collection returns `compile_db_missing` in 74ms — typed, fast, with the right
  // remedy. The error is good; discovering it deep inside a later workflow is not.
  //
  // ⚠ NONFATAL AND NARROW. It never fails the install, and it reports what it FOUND rather than
  // asserting what C++ projects require: a compile DB may be committed, and CMake emits one at
  // configure time.
  const cpp = cppPreflight(projectRoot);
  const cppMsg = cppPreflightMessage(cpp);
  if (cppMsg) console.log(`\n${cppMsg}`);

  const note = approvalNoteFor(opts.runtime);
  if (note) console.log(note);
  console.log(`\nNext: restart your ${opts.runtime} session in ${projectRoot} for the MCP server to load.`);
}

if (process.argv[1] && process.argv[1].endsWith('init-project-mcp.mjs')) {
  main().catch(err => { console.error(err?.stack || err); process.exit(1); });
}
