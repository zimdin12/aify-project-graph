#!/usr/bin/env node
// DOES THE CONSERVATION DETECTOR FIRE ON A REAL LOSS, OR ONLY ON ONE I PLANTED?
//
// ⛔ THE GAP THIS CLOSES, and it was found in my own shipped evidence rather than in code.
// `scripts/audit-ref-conservation-across-run.mjs` proves its detector with ARM B and ARM C, which
// DELETE AN EDGE FROM SQLITE. Those arms carry a caveat saying they prove the detector and not that
// a loss happened — and I treated writing that caveat as discharging it.
//
// dashboard-manager's precondition says otherwise, and it is about WHICH SUBJECT, not about what the
// arms claim:
//
//     A PLANTED CONTROL PROVES THE INSTRUMENT WORKS.
//     A BROKEN SUBJECT PROVES THE INSTRUMENT WORKS *ON THIS SUBJECT*.
//
// A planted DELETE is an artifact placed beside the subject. It cannot show that the detector sees a
// loss the PRODUCTION CODE PATH produces, because no production code path was involved in making it.
//
// ⭐ AND A REAL BROKEN SUBJECT EXISTS, so this needs no simulation. Before the fixed-point closure,
// `expandAffectedFiles` was one level deep: changing `inner.js` pulled in `middle.js`, re-extracting
// `middle.js` destroyed every edge pointing INTO it, and the three `outer` files were never named, so
// nothing rebuilt them. Six edges destroyed by one ordinary commit, with NO `unresolved_refs` row.
// Measured at 871a1d65 and recorded in docs/evidence/ref-conservation-2026-09-25/reproduction-output.txt.
//
// ⛔ PRE-REGISTERED, BEFORE THIS WAS FIRST RUN:
//   If the detector NAMES the refs the pre-closure code really lost, it is proven on this subject.
//   If it does NOT, then everything it has certified was certified by an instrument proven only
//   against its own plant, and that is how it must be reported — not as an inconclusive run.
//
// DESIGN. Only `ensureFresh` comes from the old tree; the classifier, the population rule and the
// join key are CURRENT, because those are the instrument under test. A paired run against the current
// orchestrator, same fixture and same history, must report ZERO losses — otherwise a detector that
// shouts on everything would pass the broken arm for the wrong reason.
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (...p) => import(pathToFileURL(path.join(REPO, ...p)).href);
const { openDb } = await load('mcp', 'stdio', 'storage', 'db.js');
const { extractFile } = await load('mcp', 'stdio', 'ingest', 'extractors', 'generic.js');
const { getLanguageConfig } = await load('mcp', 'stdio', 'ingest', 'languages', 'index.js');
const { keyOf, describeKey, refTargetName, recordedKeys } = await load('scripts', 'lib', 'ref-keys.mjs');

// The commit whose one-level expansion really destroyed edges. Not a guess: the reproduction output
// committed beside this script names it.
const PRE_CLOSURE = '871a1d65';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });
const commitAll = (repo, msg) => { git(repo, 'add', '-A'); git(repo, 'commit', '-qm', msg); };

function languageConfigFor(file) {
  try {
    return getLanguageConfig(file) ?? null;
  } catch {
    return null;
  }
}

function emittedNow(root) {
  const keys = new Set();
  for (const file of fs.readdirSync(path.join(root, 'src'))) {
    const rel = `src/${file}`;
    const config = languageConfigFor(rel);
    if (!config) continue;
    const source = fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
    for (const ref of extractFile({ filePath: rel, source, config }).refs ?? []) {
      keys.add(keyOf(ref.source_file, ref.relation, refTargetName(ref)));
    }
  }
  return keys;
}

function recordedNow(dbPath) {
  const db = openDb(dbPath);
  try {
    return recordedKeys(db).keys;
  } finally {
    db.close();
  }
}

function nodeLabelExists(dbPath, label) {
  const db = openDb(dbPath);
  try {
    return Boolean(db.get('SELECT 1 AS hit FROM nodes WHERE label = $label', { label }));
  } finally {
    db.close();
  }
}

async function buildFixture() {
  const repo = await mkdtemp(path.join(tmpdir(), 'apg-broken-subject-'));
  await mkdir(path.join(repo, 'src'), { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.name', 'broken-subject-audit');
  git(repo, 'config', 'user.email', 'broken-subject@example.invalid');
  await writeFile(path.join(repo, '.gitignore'), '.aify-graph/\n');
  await writeFile(path.join(repo, 'src', 'inner.js'), 'export function inner() { return 1; }\n');
  await writeFile(path.join(repo, 'src', 'middle.js'),
    "import { inner } from './inner.js';\nexport function middle() { return inner() + 1; }\n");
  for (const n of ['outerA', 'outerB', 'outerC']) {
    await writeFile(path.join(repo, 'src', `${n}.js`),
      `import { middle } from './middle.js';\nexport function ${n}() { return middle() + 1; }\n`);
  }
  commitAll(repo, 'baseline: outer -> middle -> inner');
  return repo;
}

// ⭐ NO PLANT ANYWHERE IN THIS FILE. The only mutation is an ordinary structural edit to inner.js —
// the same edit a developer makes — and the loss, if any, is produced by the indexer.
async function runAgainst(ensureFresh, label) {
  const repo = await buildFixture();
  const dbPath = path.join(repo, '.aify-graph', 'graph.sqlite');
  try {
    await ensureFresh({ repoRoot: repo });
    const emittedBefore = emittedNow(repo);
    const recordedBefore = recordedNow(dbPath);
    const population = new Set([...emittedBefore].filter((k) => recordedBefore.has(k)));

    await writeFile(path.join(repo, 'src', 'inner.js'),
      'export function inner() { return 1; }\nexport function innerMarker() { return 2; }\n');
    commitAll(repo, 'structural change to inner.js');
    await ensureFresh({ repoRoot: repo });

    const recordedAfter = recordedNow(dbPath);
    const emittedAfter = emittedNow(repo);
    const lost = [];
    const removed = [];
    let survived = 0;
    for (const key of population) {
      if (recordedAfter.has(key)) { survived += 1; continue; }
      (emittedAfter.has(key) ? lost : removed).push(key);
    }

    const reExtracted = nodeLabelExists(dbPath, 'innerMarker');
    console.log(`\n${'='.repeat(94)}\n${label}\n${'='.repeat(94)}`);
    console.log(`  ACTION CONTROL   node "innerMarker" from this run's edit is in the graph: `
      + `${reExtracted ? 'YES — the run re-extracted it' : '⛔ NO — this arm proves nothing'}`);
    console.log(`  POSITIVE CONTROL ${survived} of ${population.size} baseline refs SURVIVED`);
    console.log(`  REMOVED_AT_SOURCE ${removed.length}`);
    console.log(`  ⛔ LOST (${lost.length}) — still emitted, recorded NOWHERE, and NOT planted:`);
    for (const k of lost.sort()) console.log(`     ${describeKey(k)}`);
    return { lost, survived, reExtracted, population: population.size };
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

// ── the pre-closure tree, as a disposable detached worktree ─────────────────────────────────────
async function withPreClosureOrchestrator(fn) {
  const wt = await mkdtemp(path.join(tmpdir(), 'apg-preclosure-'));
  // A worktree of THIS repo at the pre-closure commit. Detached, disposable, removed in `finally`.
  execFileSync('git', ['-C', REPO, 'worktree', 'add', '--detach', '-q', wt, PRE_CLOSURE], { stdio: 'ignore' });
  try {
    // Node resolves node_modules by walking UP from the importing module, and a worktree in tmp has
    // no ancestor holding them. A junction needs no elevation on Windows; a symlink elsewhere.
    const link = path.join(wt, 'node_modules');
    if (!fs.existsSync(link)) {
      fs.symlinkSync(path.join(REPO, 'node_modules'), link,
        process.platform === 'win32' ? 'junction' : 'dir');
    }
    const orchestrator = path.join(wt, 'mcp', 'stdio', 'freshness', 'orchestrator.js');
    if (!fs.existsSync(orchestrator)) {
      throw new Error(`APPARATUS INVALID: no orchestrator at ${PRE_CLOSURE}; the commit or layout moved.`);
    }
    // ⚠ CONFIRM THE SUBJECT IS ACTUALLY THE BROKEN ONE before trusting any result from it. The
    // fixed version contains the worklist; the pre-closure one does not. If this check ever passes
    // silently against fixed code, the arm would report "no loss" and read as a healthy detector.
    const src = fs.readFileSync(orchestrator, 'utf8');
    const looksFixed = src.includes('const queue = []') && src.includes('enqueue');
    console.log(`SUBJECT CHECK: orchestrator at ${PRE_CLOSURE} contains the fixed-point worklist? `
      + `${looksFixed ? '⛔ YES — this is NOT the broken subject, every result below is void' : 'no, it is the one-level version'}`);
    if (looksFixed) throw new Error('APPARATUS INVALID: the pinned commit is not the pre-closure code.');
    const mod = await import(pathToFileURL(orchestrator).href);
    return await fn(mod.ensureFresh);
  } finally {
    // ⛔⛔ ORDER IS LOAD-BEARING, AND GETTING IT WRONG CAN DELETE THE REPO'S node_modules.
    //
    // 1. UNLINK THE JUNCTION FIRST. A recursive delete of the worktree while the junction is in
    //    place can follow it into the real `node_modules`. `rm` on the link removes the link;
    //    recursing through it removes 155 real directories. This is the same hazard as preferring
    //    readdir over realpath in path-exists.js, in the filesystem rather than in the check.
    // 2. THEN the worktree's own `.aify-graph`. ⚠ MEASURED SIDE EFFECT, not predicted: importing the
    //    pre-closure orchestrator SELF-INDEXES its own checkout — 6,861 nodes and 29,879 edges
    //    appeared in the worktree during the first run. The open SQLite handle is what made
    //    `git worktree remove` fail with "Device or resource busy".
    try {
      const link = path.join(wt, 'node_modules');
      if (fs.existsSync(link)) fs.unlinkSync(link);
    } catch {
      console.log(`⚠ could not unlink ${path.join(wt, 'node_modules')}; NOT deleting the worktree, `
        + 'because a recursive delete could follow it into the real node_modules. Remove it by hand.');
      execFileSync('git', ['-C', REPO, 'worktree', 'prune'], { stdio: 'ignore' });
      return;
    }
    try {
      fs.rmSync(path.join(wt, '.aify-graph'), { recursive: true, force: true });
    } catch { /* a held handle here only costs a retry below */ }
    try {
      execFileSync('git', ['-C', REPO, 'worktree', 'remove', '--force', wt], { stdio: 'ignore' });
    } catch {
      try {
        fs.rmSync(wt, { recursive: true, force: true });
      } catch {
        console.log(`⚠ worktree at ${wt} could not be removed (a handle is still held). The junction`
          + ' IS unlinked, so the repository node_modules is not at risk; remove the directory by hand.');
      }
    }
    execFileSync('git', ['-C', REPO, 'worktree', 'prune'], { stdio: 'ignore' });
  }
}

const broken = await withPreClosureOrchestrator(
  (ensureFresh) => runAgainst(ensureFresh, `BROKEN SUBJECT — orchestrator at ${PRE_CLOSURE}, one-level expansion, NO plant`),
);
const { ensureFresh: currentEnsureFresh } = await load('mcp', 'stdio', 'freshness', 'orchestrator.js');
const fixed = await runAgainst(currentEnsureFresh, 'CURRENT SUBJECT — fixed-point expansion, same fixture and history, NO plant');

console.log(`\n${'='.repeat(94)}\nVERDICT\n${'='.repeat(94)}`);
console.log(`  broken subject : ${broken.lost.length} LOST, ${broken.survived}/${broken.population} survived`);
console.log(`  current subject: ${fixed.lost.length} LOST, ${fixed.survived}/${fixed.population} survived`);
const controlsOk = broken.reExtracted && fixed.reExtracted && broken.survived > 0 && fixed.survived > 0;
const namesRealLoss = broken.lost.length > 0;
const quietWhenFixed = fixed.lost.length === 0;
console.log(`\n  controls in both runs (extraction ran, comparison non-vacuous): ${controlsOk ? 'ok' : '⛔ FAILED'}`);
console.log('  ⛔ THE PRE-REGISTERED QUESTION: does the detector NAME a loss the CODE produced,');
console.log(`     with nothing planted?  ${namesRealLoss ? 'YES' : 'NO'}`);
console.log(`  and does it stay quiet on the fixed subject?  ${quietWhenFixed ? 'YES' : '⛔ NO — it shouts on both, so the broken arm proves nothing'}`);
const ok = controlsOk && namesRealLoss && quietWhenFixed;
console.log(`\n  => ${ok
  ? 'PROVEN ON THIS SUBJECT: the detector names a real, code-produced loss and is silent without one.'
  : '⛔ NOT PROVEN ON THIS SUBJECT. Everything this detector has certified was certified by an '
    + 'instrument proven only against its own plant, and must be reported that way.'}`);
process.exit(ok ? 0 : 1);
