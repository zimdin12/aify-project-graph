// scripts/install-graph-hook.mjs
//
// Installs a git hook on every event that moves HEAD (see AIFY_HOOKS), each
// incrementally reindexing the aify graph, so the graph is never behind HEAD
// (no per-read latency).
// Idempotent: replaces only the aify-delimited block, preserving any other hook
// content. Run: node <thisRepo>/scripts/install-graph-hook.mjs [targetRepoRoot]
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';

export const AIFY_HOOK_MARKER = 'aify-project-graph post-commit reindex';
const HERE = dirname(fileURLToPath(import.meta.url));
const REINDEX = join(HERE, 'reindex.mjs');

// Every git event that can move HEAD. post-commit alone misses the ways HEAD
// moves that are not a local commit — which is how a repo reaches 20 commits
// stale while the hook is installed and working exactly as designed.
export const AIFY_HOOKS = ['post-commit', 'post-merge', 'post-checkout', 'post-rewrite'];

function aifyBlock(reindexPath, hook) {
  const invoke = `node "${reindexPath}" "$(git rev-parse --show-toplevel)" "${hook}" >/dev/null 2>&1 &`;
  const lines = [
    `# >>> ${AIFY_HOOK_MARKER} >>>`,
    '# Auto-refresh the code graph when HEAD moves (best-effort, backgrounded).',
  ];
  if (hook === 'post-checkout') {
    // git passes $3=1 for a branch checkout, $3=0 for a file checkout.
    // Without this, `git checkout -- file` triggers a full reindex.
    lines.push('if [ "$3" = "1" ]; then');
    lines.push(`  ${invoke}`);
    lines.push('fi');
  } else {
    lines.push(invoke);
  }
  lines.push(`# <<< ${AIFY_HOOK_MARKER} <<<`);
  return lines.join('\n');
}

// Strip a previously-installed aify block (between the BEGIN/END markers) so a
// re-install replaces rather than duplicates it.
function stripAifyBlock(body) {
  const begin = `# >>> ${AIFY_HOOK_MARKER} >>>`;
  const end = `# <<< ${AIFY_HOOK_MARKER} <<<`;
  const out = [];
  let skipping = false;
  // Normalize CRLF→LF so an existing CRLF hook doesn't leave stray \r on lines
  // (and so the rewritten /bin/sh hook stays pure-LF, which sh requires).
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    if (line.includes(begin)) { skipping = true; continue; }
    if (line.includes(end)) { skipping = false; continue; }
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

/**
 * Where git reads this repository's hooks, asked of git rather than assumed.
 *
 * ⛔ FOUND BY dashboard-manager, 2026-10-17. This used to be `<repo>/.git/hooks`, always. aify-dashboard sets
 * core.hooksPath=.githooks, so the install reported success into a directory git never reads, and the index went
 * stale with the hooks "installed". `rev-parse --git-path hooks` answers with core.hooksPath (local or global)
 * applied, and with a worktree's hooks in its main checkout.
 *
 * @returns {{ dir: string, configured: boolean } | null} `configured` is true when git reads hooks from somewhere
 *   other than the repository's own hooks directory; null when git cannot answer (not a repository).
 */
export function hooksLocation(repoRoot) {
  const ask = (args) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const dir = resolve(repoRoot, ask(['rev-parse', '--git-path', 'hooks']));
    const own = resolve(repoRoot, ask(['rev-parse', '--git-common-dir']), 'hooks');
    return { dir, configured: dir !== own };
  } catch {
    return null;
  }
}

/** Why the hooks were not installed. Thrown, so a caller cannot read a refusal as a success. */
export class HookInstallRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'HookInstallRefused';
  }
}

/**
 * ⛔ A CONFIGURED HOOKS DIRECTORY IS REFUSED BY DEFAULT. It is often tracked and shared by everyone who clones the
 * repository, and these hooks carry this machine's absolute reindex path. Pass `intoHooksPath` to write there anyway.
 */
export function installGraphHook(targetRepoRoot = process.cwd(), reindexPath = REINDEX, { intoHooksPath = false } = {}) {
  const where = hooksLocation(targetRepoRoot);
  if (where === null) throw new HookInstallRefused(`${targetRepoRoot} is not a git repository git can read, so there is no hook to install`);
  if (where.configured && !intoHooksPath) {
    throw new HookInstallRefused(
      `git reads this repository's hooks from ${where.dir} (core.hooksPath), not from its own hooks directory, so `
      + 'hooks put in its own directory would never run. Writing into the configured directory would put this machine\'s '
      + 'reindex path into it, and it is often tracked. Re-run with --into-hooks-path to write there anyway, or '
      + 'refresh the index on commit some other way.',
    );
  }
  const hooksDir = where.dir;
  if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
  const written = [];
  for (const hook of AIFY_HOOKS) {
    const hookPath = join(hooksDir, hook);
    let body = existsSync(hookPath) ? readFileSync(hookPath, 'utf8') : '#!/bin/sh\n';
    body = stripAifyBlock(body).replace(/\n+$/, '') + '\n';
    if (!body.startsWith('#!')) body = '#!/bin/sh\n' + body;
    body += '\n' + aifyBlock(reindexPath, hook) + '\n';
    writeFileSync(hookPath, body, 'utf8');
    try { chmodSync(hookPath, 0o755); } catch { /* windows: chmod is a noop */ }
    written.push(hookPath);
  }
  return written;
}

// CLI entry
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const intoHooksPath = args.includes('--into-hooks-path');
  const target = args.find((a) => !a.startsWith('--')) || process.cwd();
  try {
    const paths = installGraphHook(target, REINDEX, { intoHooksPath });
    console.log(`Installed ${paths.length} aify reindex hooks:`);
    for (const p of paths) console.log(`  ${p}`);
  } catch (error) {
    if (!(error instanceof HookInstallRefused)) throw error;
    console.error(`NOT INSTALLED: ${error.message}`);
    process.exitCode = 1;
  }
}
