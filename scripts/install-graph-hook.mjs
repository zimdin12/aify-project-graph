// scripts/install-graph-hook.mjs
//
// Installs a git hook on every event that moves HEAD (see AIFY_HOOKS), each
// incrementally reindexing the aify graph, so the graph is never behind HEAD
// (no per-read latency).
// Idempotent: replaces only the aify-delimited block, preserving any other hook
// content. Run: node <thisRepo>/scripts/install-graph-hook.mjs [targetRepoRoot]
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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

export function installGraphHook(targetRepoRoot = process.cwd(), reindexPath = REINDEX) {
  const hooksDir = join(targetRepoRoot, '.git', 'hooks');
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
  const target = process.argv[2] || process.cwd();
  const paths = installGraphHook(target);
  console.log(`Installed ${paths.length} aify reindex hooks:`);
  for (const p of paths) console.log(`  ${p}`);
}
