// scripts/install-graph-hook.mjs
//
// Installs a git post-commit hook that incrementally reindexes the aify graph
// after every commit, so the graph is never behind HEAD (no per-read latency).
// Idempotent: replaces only the aify-delimited block, preserving any other hook
// content. Run: node <thisRepo>/scripts/install-graph-hook.mjs [targetRepoRoot]
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';

export const AIFY_HOOK_MARKER = 'aify-project-graph post-commit reindex';
const HERE = dirname(fileURLToPath(import.meta.url));
const REINDEX = join(HERE, 'reindex.mjs');

function aifyBlock(reindexPath) {
  return [
    `# >>> ${AIFY_HOOK_MARKER} >>>`,
    '# Auto-refresh the code graph after each commit (best-effort, backgrounded).',
    `node "${reindexPath}" "$(git rev-parse --show-toplevel)" >/dev/null 2>&1 &`,
    `# <<< ${AIFY_HOOK_MARKER} <<<`,
  ].join('\n');
}

// Strip a previously-installed aify block (between the BEGIN/END markers) so a
// re-install replaces rather than duplicates it.
function stripAifyBlock(body) {
  const begin = `# >>> ${AIFY_HOOK_MARKER} >>>`;
  const end = `# <<< ${AIFY_HOOK_MARKER} <<<`;
  const out = [];
  let skipping = false;
  for (const line of body.split('\n')) {
    if (line.includes(begin)) { skipping = true; continue; }
    if (line.includes(end)) { skipping = false; continue; }
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

export function installGraphHook(targetRepoRoot = process.cwd(), reindexPath = REINDEX) {
  const hooksDir = join(targetRepoRoot, '.git', 'hooks');
  if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
  const hookPath = join(hooksDir, 'post-commit');
  let body = existsSync(hookPath) ? readFileSync(hookPath, 'utf8') : '#!/bin/sh\n';
  body = stripAifyBlock(body).replace(/\n+$/, '') + '\n';
  if (!body.startsWith('#!')) body = '#!/bin/sh\n' + body;
  body += '\n' + aifyBlock(reindexPath) + '\n';
  writeFileSync(hookPath, body, 'utf8');
  try { chmodSync(hookPath, 0o755); } catch { /* windows: chmod is a noop */ }
  return hookPath;
}

// CLI entry
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = process.argv[2] || process.cwd();
  const path = installGraphHook(target);
  console.log(`Installed aify post-commit reindex hook → ${path}`);
}
