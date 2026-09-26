#!/usr/bin/env node
// THE EXPANSION IS ONE LEVEL DEEP. A THREE-LINK CHAIN SHOULD LOSE ITS OUTER EDGE.
//
// Mechanism (docs/evidence/ref-conservation-2026-09-25/MECHANISM.md):
//   expandAffectedFiles reads `edges WHERE to_id IN (<changed file's nodes>)` to find dependents;
//   deleteNode runs `DELETE FROM edges WHERE from_id = $id OR to_id = $id`.
// So re-extracting a file destroys every edge pointing INTO it, and only the files the expansion
// named get rebuilt.
//
// The previous probe used TWO links — callers → target — and produced identical graphs, because the
// expansion pulled the callers in. That is the repair working.
//
// PREDICTION, written before the run: with THREE links, changing the innermost file pulls in the
// MIDDLE one as its dependent. Re-extracting the middle one destroys the OUTER file's edges into it,
// and the outer file was never expanded, so nothing regenerates them.
//
//   outer.js  --imports-->  middle.js  --imports-->  inner.js
//   change inner.js  ⇒  middle.js re-extracted  ⇒  outer.js's edge into middle.js destroyed
//
// REFUTED IF the graphs are identical: then the expansion is deeper than one level, or something else
// regenerates the outer edge, and the mechanism write-up needs correcting.
//
// ⚠ READ THE DATE BEFORE READING THE VERDICT. This wording was written against the ONE-LEVEL
// expansion. It reproduced there: six edges destroyed by one commit. After the fixed-point fix the
// same probe prints IDENTICAL, which under the fixed code means the repair works rather than that the
// hypothesis was wrong. Both runs are preserved in reproduction-output.txt; the label alone is
// ambiguous across the fix and the two runs are not.
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

async function step0(repo) {
  await writeFile(join(repo, 'src', 'inner.js'), 'export function inner() { return 1; }\n');
  await writeFile(join(repo, 'src', 'middle.js'),
    "import { inner } from './inner.js';\nexport function middle() { return inner() + 1; }\n");
  // Several outer files, so a single flaky result cannot be mistaken for the pattern.
  for (const n of ['outerA', 'outerB', 'outerC']) {
    await writeFile(join(repo, 'src', `${n}.js`),
      `import { middle } from './middle.js';\nexport function ${n}() { return middle() + 1; }\n`);
  }
  commitAll(repo, 'baseline: outer -> middle -> inner');
}

const HISTORY = [
  // Change the INNERMOST file structurally. The expansion pulls in middle.js as its dependent.
  // Re-extracting middle.js deletes every edge pointing into it — the three outer imports and calls.
  async (repo) => {
    await writeFile(join(repo, 'src', 'inner.js'),
      'export function inner() { return 1; }\n\nexport function innerTwo() { return 2; }\n');
    commitAll(repo, 'structural change to inner.js');
  },
];

function report(dbPath, label) {
  const db = openDb(dbPath);
  try {
    const imports = db.all(
      `SELECT e.source_file AS src, n.file_path AS dst FROM edges e JOIN nodes n ON n.id = e.to_id
       WHERE e.relation = 'IMPORTS' ORDER BY src, dst`,
    ).map((r) => `${r.src} -> ${r.dst}`);
    const calls = db.all(
      `SELECT e.source_file AS src, n.label AS tgt FROM edges e JOIN nodes n ON n.id = e.to_id
       WHERE e.relation = 'CALLS' AND n.label IN ('middle','inner') ORDER BY src, tgt`,
    ).map((r) => `${r.src} -> ${r.tgt}()`);
    const unresolved = db.all(
      "SELECT source_file, target, relation FROM unresolved_refs WHERE target LIKE '%middle%'",
    ).map((r) => `${r.source_file} ${r.relation} ${r.target}`);
    console.log(`\n${label}`);
    console.log(`  IMPORTS (${imports.length}):`);
    for (const i of imports) console.log(`    ${i}`);
    console.log(`  CALLS into middle/inner (${calls.length}):`);
    for (const c of calls) console.log(`    ${c}`);
    console.log(`  unresolved rows mentioning middle: ${unresolved.length ? unresolved : 'NONE — silent'}`);
    return { imports, calls };
  } finally {
    db.close();
  }
}

const A = await initRepo('apg-p3-inc-');
const B = await initRepo('apg-p3-full-');
for (const repo of [A, B]) await step0(repo);
await ensureFresh({ repoRoot: A });
report(join(A, '.aify-graph', 'graph.sqlite'), 'INCREMENTAL, at the baseline');

for (const step of HISTORY) { await step(A); await step(B); await ensureFresh({ repoRoot: A }); }
const inc = report(join(A, '.aify-graph', 'graph.sqlite'), 'INCREMENTAL, after changing inner.js');

await ensureFresh({ repoRoot: B, force: true });
const full = report(join(B, '.aify-graph', 'graph.sqlite'), 'FULL REBUILD of the same history');

const missingImports = full.imports.filter((i) => !inc.imports.includes(i));
const missingCalls = full.calls.filter((c) => !inc.calls.includes(c));
console.log(`\nVERDICT: ${missingImports.length + missingCalls.length === 0
  ? 'IDENTICAL — REFUTED, the expansion is deeper than one level'
  : 'REPRODUCED — the incremental graph is missing edges a rebuild has'}`);
for (const i of missingImports) console.log(`  MISSING IMPORTS: ${i}`);
for (const c of missingCalls) console.log(`  MISSING CALLS:   ${c}`);

await rm(A, { recursive: true, force: true });
await rm(B, { recursive: true, force: true });
