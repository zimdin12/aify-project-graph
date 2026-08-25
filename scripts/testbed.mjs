#!/usr/bin/env node
// A disposable, real-code corpus for measuring this tool against languages we actually target.
//
//   node scripts/testbed.mjs --setup    # shallow-clone, install the server, build each graph
//   node scripts/testbed.mjs --status   # what exists, how big, how many nodes/edges
//   node scripts/testbed.mjs --clean    # delete the whole corpus
//
// WHY REAL REPOSITORIES AND NOT FIXTURES. Every efficacy number this project has produced came from
// its OWN repository, which is dense, JavaScript, and names its documents after their incidents —
// so `ls | grep` answers discovery questions outright. That weakness was named in the A/B gate and
// never addressed. A corpus of third-party code in the languages we target removes it.
//
// ⚠ SHALLOW AND SMALL ON PURPOSE. The host is at 96% disk. `--depth 1`, no submodules, and repos
// chosen for structure rather than size — a caller graph needs real cross-file calls, not a large
// single header.
//
// ⛔ THE LANGUAGE TIERS ARE NOT EQUAL, AND THE CORPUS EXISTS PARTLY TO SHOW THAT:
//
//     cpp / python / typescript   compiler-verified backend (clangd, pyright, ts-langserver)
//     php                         tree-sitter extractor ONLY — no language server
//
// PHP therefore never earns `[lsp✓]`, never returns `exhaustive: true`, and can never license a
// "no callers / safe to delete" claim. It is in the corpus so that gap is measured rather than
// assumed, and so any future PHP backend has a before/after to be judged against.

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = process.env.APG_TESTBED || 'C:/Docker/apg-testbed';

/**
 * Chosen for STRUCTURE, not popularity: each has real cross-file calls, a public API surface, and
 * enough internal layering that "who calls this" is a question with a non-trivial answer.
 */
const REPOS = [
  { name: 'fmt',       language: 'cpp',        url: 'https://github.com/fmtlib/fmt.git',            note: 'headers + src, heavy template use' },
  { name: 'click',     language: 'python',     url: 'https://github.com/pallets/click.git',         note: 'decorator-driven dispatch, hard for static extraction' },
  { name: 'fast-route',language: 'php',        url: 'https://github.com/nikic/FastRoute.git',       note: 'PHP — heuristic tier only, no language server' },
  { name: 'p-queue',   language: 'typescript', url: 'https://github.com/sindresorhus/p-queue.git',  note: 'small TS with real class structure' },
];

const args = new Set(process.argv.slice(2));
const run = (cmd, cmdArgs, cwd) => execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 });

function dirSizeMb(p) {
  let total = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else { try { total += statSync(full).size; } catch { /* ignore */ } }
    }
  };
  try { walk(p); } catch { return null; }
  return Math.round(total / 1048576);
}

// ⛔ PATHS TRAVEL BY ENVIRONMENT, NEVER INTERPOLATED INTO AN INLINE `node -e` SCRIPT. The first
// version built the source text with Windows paths embedded and every one of the four repos
// reported "Command failed" with a truncated message — clone and install had succeeded, indexing
// had not, and running the identical call directly worked first time. Backslashes do not survive
// the trip. This project has a standing note about exactly that and I wrote the bug anyway.
const childEnv = (extra) => ({ ...process.env, APG_REPO: REPO.replace(/\\/g, '/'), ...extra });

const COUNT_SRC = `
  import('file:///' + process.env.APG_REPO + '/mcp/stdio/storage/db.js').then(({openExistingDb}) => {
    const d = openExistingDb(process.env.APG_DB);
    console.log(JSON.stringify({ nodes: d.get('SELECT COUNT(*) c FROM nodes').c, edges: d.get('SELECT COUNT(*) c FROM edges').c }));
    d.close();
  });`;

const INDEX_SRC = `
  import('file:///' + process.env.APG_REPO + '/mcp/stdio/query/verbs/index.js')
    .then(m => m.graphIndex({ repoRoot: process.env.APG_TARGET, force: true }))
    .then(() => process.exit(0))
    .catch(e => { console.error(e.message); process.exit(1); });`;

function graphCounts(root) {
  const db = join(root, '.aify-graph', 'graph.sqlite');
  if (!existsSync(db)) return null;
  try {
    const out = execFileSync(process.execPath, ['-e', COUNT_SRC], {
      encoding: 'utf8', timeout: 60000, env: childEnv({ APG_DB: db.replace(/\\/g, '/') }),
    });
    return JSON.parse(out.trim());
  } catch { return null; }
}

if (args.has('--clean')) {
  if (!existsSync(CORPUS)) { console.log(JSON.stringify({ action: 'clean', existed: false })); process.exit(0); }
  const before = dirSizeMb(CORPUS);
  rmSync(CORPUS, { recursive: true, force: true, maxRetries: 3 });
  console.log(JSON.stringify({ action: 'clean', removed: CORPUS, freedMb: before, stillExists: existsSync(CORPUS) }, null, 2));
  process.exit(existsSync(CORPUS) ? 1 : 0);
}

if (args.has('--status')) {
  const rows = REPOS.map((r) => {
    const root = join(CORPUS, r.name);
    const present = existsSync(root);
    return {
      name: r.name,
      language: r.language,
      cloned: present,
      installed: present && existsSync(join(root, '.mcp.json')),
      indexed: present && existsSync(join(root, '.aify-graph', 'graph.sqlite')),
      sizeMb: present ? dirSizeMb(root) : null,
      graph: present ? graphCounts(root) : null,
      note: r.note,
    };
  });
  console.log(JSON.stringify({ corpus: CORPUS, exists: existsSync(CORPUS), repos: rows }, null, 2));
  process.exit(0);
}

if (!args.has('--setup')) {
  console.error('usage: node scripts/testbed.mjs [--setup | --status | --clean]');
  process.exit(2);
}

mkdirSync(CORPUS, { recursive: true });
const report = [];

for (const r of REPOS) {
  const root = join(CORPUS, r.name);
  const row = { name: r.name, language: r.language, steps: {} };
  try {
    if (!existsSync(root)) {
      run('git', ['clone', '--depth', '1', '--single-branch', '--no-tags', r.url, root], CORPUS);
      row.steps.clone = 'ok';
    } else row.steps.clone = 'already present';

    run(process.execPath, [join(REPO, 'scripts', 'init-project-mcp.mjs'), '--project-root', root, '--runtime', 'claude-code'], REPO);
    row.steps.install = existsSync(join(root, '.mcp.json')) ? 'ok' : 'FAILED';

    // Index through the same entry point an operator would use.
    execFileSync(process.execPath, ['-e', INDEX_SRC], {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900000,
      env: childEnv({ APG_TARGET: root.replace(/\\/g, '/') }),
    });
    // ⚠ Verified by the ARTIFACT existing, not by the command returning — a write call that does
    // not throw is a claim about an operation, never evidence about a file.
    row.steps.index = existsSync(join(root, '.aify-graph', 'graph.sqlite')) ? 'ok' : 'FAILED';

    row.sizeMb = dirSizeMb(root);
    row.graph = graphCounts(root);
  } catch (err) {
    // ⚠ CARRY THE CHILD'S STDERR. The first version reported only "Command failed: node -e", which
    // hid the actual cause through two full rebuild cycles — an absolute Windows path handed to a
    // dynamic import needs a file:// URL, and the child said so every time. A diagnostic that names
    // no cause costs more than no diagnostic, because it looks like one.
    const stderr = (err.stderr ? String(err.stderr) : '').trim();
    row.error = (stderr || String(err.message || err)).split('\n').slice(0, 3).join(' | ').slice(0, 300);
  }
  report.push(row);
}

// ⚠ Fails closed: a corpus where any repo did not index is not a corpus to measure against, and
// reporting partial success as success is how a coverage gap becomes an unexplained result later.
const ok = report.every((r) => !r.error && r.steps.index === 'ok');
console.log(JSON.stringify({ corpus: CORPUS, ok, repos: report }, null, 2));
process.exit(ok ? 0 : 1);
