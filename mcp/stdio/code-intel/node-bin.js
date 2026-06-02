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

// Resolve a package's bin SCRIPT (the .js/.mjs entry, not the .cmd shim) so it
// can be run via `node`. Windows cannot directly spawn a `.cmd` (modern Node
// rejects it with EINVAL), and running the script with process.execPath is
// cross-platform and avoids shell quoting. Returns the absolute script path or
// null. `binName` selects which entry when the package exposes several.
function readBinScript(root, pkgName, binName) {
  const pkgDir = path.join(root, 'node_modules', pkgName);
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')); } catch { return null; }
  let rel = null;
  if (typeof pkg.bin === 'string') rel = pkg.bin;
  else if (pkg.bin && typeof pkg.bin === 'object') rel = pkg.bin[binName] || pkg.bin[pkgName] || Object.values(pkg.bin)[0];
  if (!rel) return null;
  const abs = path.join(pkgDir, rel);
  try { return fs.existsSync(abs) ? abs : null; } catch { return null; }
}

// Build a cross-platform spawn config for an npm-distributed language server.
// Prefers running the package's JS entry via `node` (project-local → plugin);
// falls back to the bare bin name on PATH (POSIX, where the shim is executable).
export function nodeLspSpawn({ pkgName, binName, args = [], projectRoot, pluginRoot = PLUGIN_ROOT }) {
  const roots = [];
  if (projectRoot) roots.push(projectRoot);
  if (pluginRoot && pluginRoot !== projectRoot) roots.push(pluginRoot);
  for (const root of roots) {
    const script = readBinScript(root, pkgName, binName);
    if (script) return { command: process.execPath, args: [script, ...args] };
  }
  return { command: resolveNodeBin(binName, projectRoot, { pluginRoot }), args };
}

export { PLUGIN_ROOT };
