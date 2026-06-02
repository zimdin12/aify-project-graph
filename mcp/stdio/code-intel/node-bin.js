// Resolve a bundled/installed Node CLI (language server) binary.
//
// LSP servers for TS/JS (typescript-language-server) and Python (pyright) ship
// as npm packages bundled with this plugin, so we own provisioning — the host
// (Claude Code / Hermes) needs no LSP config. Resolution order, most-specific
// first, so a project's own toolchain version wins:
//   1. <projectRoot>/node_modules/.bin/<name>   (the target repo's own copy)
//   2. <pluginRoot>/node_modules/.bin/<name>    (bundled with this plugin)
//   3. <name> on PATH                            (last-resort / dev installs)
// Returns an absolute path for 1-2, or the bare name for 3 (spawned via PATH).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plugin root = the package dir that contains node_modules. This file lives at
// <pluginRoot>/mcp/stdio/code-intel/node-bin.js → up three dirs.
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// On Windows npm installs `<name>` and `<name>.cmd`; prefer the .cmd shim so the
// binary is directly spawnable without a shell.
function binCandidates(dir, name) {
  const base = path.join(dir, 'node_modules', '.bin', name);
  return process.platform === 'win32' ? [`${base}.cmd`, `${base}.exe`, base] : [base];
}

export function resolveNodeBin(name, projectRoot, { pluginRoot = PLUGIN_ROOT } = {}) {
  const roots = [];
  if (projectRoot) roots.push(projectRoot);
  if (pluginRoot && pluginRoot !== projectRoot) roots.push(pluginRoot);
  for (const root of roots) {
    for (const cand of binCandidates(root, name)) {
      try { if (fs.existsSync(cand)) return cand; } catch { /* keep looking */ }
    }
  }
  return name; // fall through to PATH
}

export { PLUGIN_ROOT };
