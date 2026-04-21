#!/usr/bin/env node
// Install / uninstall the aify-project-graph git post-commit hook.
//
// Usage:
//   node scripts/install-hooks.mjs <repoRoot>           # install
//   node scripts/install-hooks.mjs <repoRoot> --remove  # uninstall
//
// The hook reindexes the graph and regenerates briefs in the background
// after every commit. Background mode keeps the commit fast; logs land
// in .aify-graph/hook.log.
//
// Idempotent: re-installing replaces the hook. If an UNKNOWN hook already
// exists (not one we wrote), we refuse to overwrite unless --force is set.

import { readFileSync, writeFileSync, existsSync, chmodSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const APG_ROOT = resolve(THIS_DIR, '..');

const MARKER = '# aify-project-graph post-commit hook.';

const args = process.argv.slice(2);
const repoRootArg = args.find(a => !a.startsWith('--'));
const remove = args.includes('--remove') || args.includes('--uninstall');
const force = args.includes('--force');

if (!repoRootArg) {
  console.error('usage: install-hooks.mjs <repoRoot> [--remove] [--force]');
  process.exit(2);
}

const repoRoot = resolve(repoRootArg);
const gitDir = resolveGitDir(repoRoot);
if (!gitDir) {
  console.error(`not a git repo: ${repoRoot}`);
  process.exit(1);
}

const hooksDir = join(gitDir, 'hooks');
const hookPath = join(hooksDir, 'post-commit');
const sourceHook = join(APG_ROOT, 'scripts', 'hooks', 'post-commit');

if (remove) {
  if (!existsSync(hookPath)) {
    console.log(`no hook to remove at ${hookPath}`);
    process.exit(0);
  }
  const current = readFileSync(hookPath, 'utf8');
  if (!current.includes(MARKER) && !force) {
    console.error(`existing post-commit hook was not installed by us; refusing to remove. Use --force to override.`);
    process.exit(1);
  }
  unlinkSync(hookPath);
  console.log(`removed ${hookPath}`);
  process.exit(0);
}

if (!existsSync(sourceHook)) {
  console.error(`source hook missing: ${sourceHook}`);
  process.exit(1);
}

mkdirSync(hooksDir, { recursive: true });

if (existsSync(hookPath)) {
  const current = readFileSync(hookPath, 'utf8');
  if (!current.includes(MARKER) && !force) {
    console.error(`an unrelated post-commit hook already exists at ${hookPath}. Use --force to overwrite.`);
    process.exit(1);
  }
}

const body = readFileSync(sourceHook, 'utf8');
writeFileSync(hookPath, body, 'utf8');
try { chmodSync(hookPath, 0o755); } catch {} // chmod fails silently on Windows, that's fine — git still runs it
console.log(`installed ${hookPath}`);
console.log(`logs: ${join(repoRoot, '.aify-graph', 'hook.log')}`);

function resolveGitDir(rr) {
  try {
    // Respects submodule worktrees where .git is a file, not a dir.
    const out = execSync('git rev-parse --git-dir', { cwd: rr, encoding: 'utf8' }).trim();
    return resolve(rr, out);
  } catch {
    return null;
  }
}
