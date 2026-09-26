#!/usr/bin/env node
// Can the incremental path diverge from a rebuild on the shape found on 2026-09-25?
//
// The recipe comes from the worktree experiments, not from a guess:
//   E1b — a real symbol added to a file re-extracts it and its edges SURVIVE that run.
//   E2  — the NEXT incremental run deleted 45 edge rows owned by 35 files it did not
//         re-extract, every one pointing at a node whose id was re-minted in the PREVIOUS run.
// So the shape is: re-mint a symbol's id by editing ABOVE it, then run the index AGAIN via an
// unrelated commit, and see whether the callers that were never re-extracted lost their edges.
//
// Mirrors tests/unit/freshness/incremental-equals-rebuild.test.js: repo A refreshes after every
// commit, repo B only at the end with force, then canonical node/edge sets are compared.
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureFresh } from 'file:///C:/Docker/aify-project-graph/mcp/stdio/freshness/orchestrator.js';
import { openDb } from 'file:///C:/Docker/aify-project-graph/mcp/stdio/storage/db.js';

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
const commitAll = (repo, msg) => { git(repo, 'add', '-A'); git(repo, 'commit', '-qm', msg); };

async function initRepo(prefix) {
  const repo = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(repo, 'src'), { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'probe@example.com');
  git(repo, 'config', 'user.name', 'probe');
  return repo;
}

const CALLERS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];

async function step0(repo) {
  // The callee. `victim` sits at the BOTTOM so anything inserted above shifts its byte span.
  await writeFile(join(repo, 'src', 'target.js'),
    'export function untouched() { return 0; }\n\nexport function victim() { return 1; }\n');
  // Callers in their OWN files, so a later edit to target.js never re-extracts them.
  for (const c of CALLERS) {
    await writeFile(join(repo, 'src', `${c}.js`),
      `import { victim } from './target.js';\nexport function ${c}() { return victim(); }\n`);
  }
  await writeFile(join(repo, 'src', 'unrelated.js'), 'export function unrelated() { return 7; }\n');
  commitAll(repo, 'baseline: six callers of victim');
}

const HISTORY = [
  // 1. RE-MINT: a real symbol inserted ABOVE victim shifts its declarator span, so its site id
  //    is hashed differently. Only target.js is re-extracted; the six callers are untouched.
  async (repo) => {
    await writeFile(join(repo, 'src', 'target.js'),
      'export function untouched() { return 0; }\n\nexport function inserted() { return 2; }\n\n'
      + 'export function victim() { return 1; }\n');
    commitAll(repo, 'insert a symbol above victim — re-mints its id');
  },
  // 2. AN UNRELATED COMMIT, to make the index run again. In the worktree this is the run that
  //    pruned the now-orphaned edges from files it did not re-extract.
  async (repo) => {
    await writeFile(join(repo, 'src', 'unrelated.js'),
      'export function unrelated() { return 7; }\n\nexport function alsoUnrelated() { return 8; }\n');
    commitAll(repo, 'unrelated change — second index run');
  },
  // 3. And a third, in case the prune lags by more than one run.
  async (repo) => {
    await writeFile(join(repo, 'src', 'unrelated.js'),
      'export function unrelated() { return 7; }\n\nexport function alsoUnrelated() { return 8; }\n\n'
      + 'export function thirdUnrelated() { return 9; }\n');
    commitAll(repo, 'another unrelated change — third index run');
  },
];

function canonical(dbPath) {
  const db = openDb(dbPath);
  try {
    const nodes = db.all(
      `SELECT type, label, file_path, start_line, end_line FROM nodes
       ORDER BY file_path, label, start_line, type`,
    ).map((n) => `${n.type}|${(n.type === 'Directory' && n.file_path === '.') ? '<root>' : n.label}`
      + `|${n.file_path}|${n.start_line}-${n.end_line}`);
    const edges = db.all(
      `SELECT e.relation AS relation, fn.label AS from_label, fn.file_path AS from_file,
              tn.label AS to_label, tn.file_path AS to_file
       FROM edges e LEFT JOIN nodes fn ON fn.id = e.from_id LEFT JOIN nodes tn ON tn.id = e.to_id
       ORDER BY relation, from_file, from_label, to_file, to_label`,
    ).map((e) => `${e.relation}|${e.from_file}:${e.from_file === '.' ? '<root>' : e.from_label}`
      + `|${e.to_file}:${e.to_file === '.' ? '<root>' : e.to_label}`);
    return { nodes, edges };
  } finally {
    db.close();
  }
}

const victimCallers = (dbPath) => {
  const db = openDb(dbPath);
  try {
    return db.all(
      `SELECT e.source_file AS f FROM edges e JOIN nodes n ON n.id = e.to_id
       WHERE n.label = 'victim' AND e.relation = 'CALLS' ORDER BY e.source_file`,
    ).map((r) => r.f);
  } finally {
    db.close();
  }
};

const A = await initRepo('apg-probe-inc-');
const B = await initRepo('apg-probe-full-');

for (const repo of [A, B]) await step0(repo);
// A: refresh after the baseline and after EVERY step. B: nothing until the end.
await ensureFresh({ repoRoot: A });
console.log(`baseline incremental — victim callers: ${JSON.stringify(victimCallers(join(A, '.aify-graph', 'graph.sqlite')))}`);

for (let i = 0; i < HISTORY.length; i += 1) {
  await HISTORY[i](A);
  await HISTORY[i](B);
  const r = await ensureFresh({ repoRoot: A });
  console.log(`after step ${i + 1} — indexed=${r?.indexed} nodes=${r?.nodes} edges=${r?.edges}`
    + ` victim callers: ${JSON.stringify(victimCallers(join(A, '.aify-graph', 'graph.sqlite')))}`);
}

await ensureFresh({ repoRoot: B, force: true });
console.log(`\nFULL REBUILD — victim callers: ${JSON.stringify(victimCallers(join(B, '.aify-graph', 'graph.sqlite')))}`);

const a = canonical(join(A, '.aify-graph', 'graph.sqlite'));
const b = canonical(join(B, '.aify-graph', 'graph.sqlite'));
const onlyA = a.edges.filter((e) => !b.edges.includes(e));
const onlyB = b.edges.filter((e) => !a.edges.includes(e));
const nodesOnlyA = a.nodes.filter((n) => !b.nodes.includes(n));
const nodesOnlyB = b.nodes.filter((n) => !a.nodes.includes(n));

console.log(`\nVERDICT: ${onlyA.length + onlyB.length + nodesOnlyA.length + nodesOnlyB.length === 0
  ? 'IDENTICAL — the recipe does NOT reproduce the divergence'
  : 'DIVERGED'}`);
console.log(`edges only in INCREMENTAL (${onlyA.length}):`);
for (const e of onlyA.slice(0, 20)) console.log(`  ${e}`);
console.log(`edges only in REBUILD (${onlyB.length}):`);
for (const e of onlyB.slice(0, 20)) console.log(`  ${e}`);
console.log(`nodes only in INCREMENTAL (${nodesOnlyA.length}), only in REBUILD (${nodesOnlyB.length})`);
for (const n of nodesOnlyA.slice(0, 10)) console.log(`  INC ONLY ${n}`);
for (const n of nodesOnlyB.slice(0, 10)) console.log(`  REB ONLY ${n}`);

await rm(A, { recursive: true, force: true });
await rm(B, { recursive: true, force: true });
