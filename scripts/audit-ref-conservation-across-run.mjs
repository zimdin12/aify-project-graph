#!/usr/bin/env node
// IS A REFERENCE CONSERVED ACROSS AN INCREMENTAL RUN — and if not, WHY not?
//
// `scripts/audit-ref-conservation.mjs` answers a POINT-IN-TIME question: does the graph, right now,
// hold every ref the extractor emits? That check cannot certify preservation ACROSS a run, and its own
// limit 3 says why: an index that went quiet conserves refs perfectly, because nothing changed them.
//
// This one takes a before and an after. The hard part is not detecting that a ref is gone. It is
// deciding WHY it is gone, because there are two reasons and only one is a defect:
//
//   REMOVED_AT_SOURCE  the file no longer emits that ref. Someone deleted the call. NOT a loss.
//   LOST               the file STILL emits it, and the graph holds neither an edge nor an
//                      `unresolved_refs` row. Nothing recorded that anything was dropped.
//
// ⭐ THE DISCRIMINATOR IS THE EXTRACTOR, NOT A SECOND GRAPH. Re-extract the source after the run and
// ask whether it still emits the ref. Extraction is upstream of both graphs, so this needs no oracle
// that has not itself been checked — the same reasoning as the point-in-time script's opening note.
//
// ⛔⛔ ARM A IS THE ARM THAT DECIDES WHETHER THIS CHECK IS WORTH HAVING, and it is not merely "also
// test the negative". A check that reports a legitimate removal as a loss produces findings that are
// wrong, and a reader who has dismissed three wrong findings will dismiss the fourth without reading
// it — which is how a real loss gets ignored by a working instrument. If ARM A cannot be made to pass
// cleanly, this script is to be REPORTED AS DECORATION rather than tuned until it passes.
// (Framing from dashboard-manager, 2026-09-26.)
//
// ⛔ PRE-REGISTERED, BEFORE ANY RESULT EXISTED: if the planted drop in ARM B does not produce a
// refusal NAMING FILE, RELATION AND TARGET, this check is DECORATION. Not "mostly works".
//
// FIXTURE ATTRIBUTION: the three-link `outerA/B/C.js -> middle.js -> inner.js` chain and the paired-arm
// method are graph-senior-dev's, from the independent witness committed at
// `docs/evidence/ref-conservation-2026-09-25/independent-paired-72996bce.mjs`. Theirs enumerates eight
// refs by hand; this derives its population from the indexer's own enumeration so it does not depend on
// a list someone must remember to update. The classifier and the arms are graph-tech-lead's.
//
// PORTABLE BY CONSTRUCTION: every root is a fresh `mkdtemp`, apg is imported relative to this file, and
// no path from any machine appears anywhere. Run `node scripts/audit-ref-conservation-across-run.mjs`
// from any checkout. Exits non-zero if either arm fails.
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (...p) => import(pathToFileURL(path.join(REPO, ...p)).href);
const { ensureFresh } = await load('mcp', 'stdio', 'freshness', 'orchestrator.js');
const { openDb } = await load('mcp', 'stdio', 'storage', 'db.js');
const { extractFile } = await load('mcp', 'stdio', 'ingest', 'extractors', 'generic.js');
const { getLanguageConfig } = await load('mcp', 'stdio', 'ingest', 'languages', 'index.js');
const { loadEffectiveIgnoredDirs, pathContainsIgnoredDir, isIgnoredDirName } =
  await load('mcp', 'stdio', 'ingest', 'ignored-dirs.js');
// The join key lives in one module because this audit and the point-in-time one got it wrong
// independently; `scripts/lib/ref-keys.mjs` carries the three measured mistakes and why each failed.
const { keyOf, describeKey, refTargetName, recordedKeys } = await load('scripts', 'lib', 'ref-keys.mjs');

const FABRICATED = 'zzqNotARealTargetAnywhere';
const CLASS = Object.freeze({ SURVIVED: 'SURVIVED', REMOVED_AT_SOURCE: 'REMOVED_AT_SOURCE', LOST: 'LOST' });

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
const commitAll = (repo, msg) => { git(repo, 'add', '-A'); git(repo, 'commit', '-qm', msg); };

function languageConfigFor(file) {
  try {
    return getLanguageConfig(file) ?? null;
  } catch {
    return null;
  }
}

// POPULATION: the indexer's own enumeration. ⛔ NOT `SELECT DISTINCT file_path FROM nodes` — the
// point-in-time script measured 65% conservation that way, because nodes exist for files the pipeline
// never extracts refs from, and the population error looked exactly like a catastrophic defect.
function listCandidates(root, ignoredDirs, dir = root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (isIgnoredDirName(entry.name, ignoredDirs) || pathContainsIgnoredDir(rel, ignoredDirs)) continue;
      listCandidates(root, ignoredDirs, abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (pathContainsIgnoredDir(rel, ignoredDirs)) continue;
    if (!languageConfigFor(rel)) continue;
    out.push(rel);
  }
  return out;
}

// ── what the extractor says the whole tree references, right now ───────────────────────────────
function emittedNow(root) {
  const keys = new Set();
  for (const file of listCandidates(root, loadEffectiveIgnoredDirs(root))) {
    let source;
    try {
      source = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
    } catch {
      continue;
    }
    let refs;
    try {
      refs = extractFile({ filePath: file, source, config: languageConfigFor(file) }).refs ?? [];
    } catch {
      continue;
    }
    for (const ref of refs) keys.add(keyOf(ref.source_file, ref.relation, refTargetName(ref)));
  }
  return keys;
}

// ── what the graph recorded, as an EDGE or as a REFUSAL. A ref in either place was not lost. ────
// Delegated to the shared module: matching an emitted target against `nodes.label` alone made this
// audit go QUIET on a planted IMPORTS loss (ARM C), because an import's target is a path.
function recordedNow(dbPath) {
  const db = openDb(dbPath);
  try {
    return recordedKeys(db).keys;
  } finally {
    db.close();
  }
}

// ⭐ ACTION CONTROL, per arm: a node the arm's own edit introduced. Its presence proves the run
// RE-EXTRACTED THE MUTATED FILE. Without it, a run that did nothing at all reads as a clean arm — and
// a quiet arm and a correct arm are otherwise identical.
function nodeLabelExists(dbPath, label) {
  const db = openDb(dbPath);
  try {
    return Boolean(db.get('SELECT 1 AS hit FROM nodes WHERE label = $label', { label }));
  } finally {
    db.close();
  }
}

function generationOf(repo) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repo, '.aify-graph', 'manifest.json'), 'utf8')).generation ?? null;
  } catch {
    return null;
  }
}

// ⭐ THE POPULATION, and the correction that cost the most thought. NOT the raw recorded set: one edge
// is addressable by several strings (label, path, path.label, id), so a single dropped edge would
// report four losses, three of which nothing ever emitted. The population is the refs the graph
// actually HELD, expressed in the ONE form the extractor emits them in.
//
// ⚠ STATED LIMIT: a ref emitted at baseline but never recorded is EXCLUDED here. That is a
// point-in-time loss and `audit-ref-conservation.mjs` is the check that owns it. This audit answers
// "did a ref the graph held survive a run", and it would be dishonest to let it imply the other.
export function baselinePopulation({ emittedBefore, recordedBefore }) {
  const held = new Set();
  for (const key of emittedBefore) if (recordedBefore.has(key)) held.add(key);
  return held;
}

// ⭐ THE CLASSIFIER, and the whole point of the script. Pure: three sets in, a verdict per key out.
export function classify({ population, recordedAfter, emittedAfter }) {
  const out = { [CLASS.SURVIVED]: [], [CLASS.REMOVED_AT_SOURCE]: [], [CLASS.LOST]: [] };
  for (const key of population) {
    if (recordedAfter.has(key)) { out[CLASS.SURVIVED].push(key); continue; }
    // Gone from the graph. The EXTRACTOR decides which kind of gone it is.
    out[emittedAfter.has(key) ? CLASS.LOST : CLASS.REMOVED_AT_SOURCE].push(key);
  }
  return out;
}

// ── fixture: the three-link chain, which a one-hop repair could not cover ───────────────────────
async function buildFixture() {
  const repo = await mkdtemp(path.join(tmpdir(), 'apg-across-run-'));
  await mkdir(path.join(repo, 'src'), { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.name', 'conservation-audit');
  git(repo, 'config', 'user.email', 'conservation-audit@example.invalid');
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

async function runArm({ name, intent, marker, mutate, plant, expectLost, expectNamed }) {
  const repo = await buildFixture();
  const dbPath = path.join(repo, '.aify-graph', 'graph.sqlite');
  try {
    await ensureFresh({ repoRoot: repo });
    const population = baselinePopulation({
      emittedBefore: emittedNow(repo),
      recordedBefore: recordedNow(dbPath),
    });
    const genBefore = generationOf(repo);

    await mutate(repo);
    await ensureFresh({ repoRoot: repo });
    const plantNote = plant ? plant(dbPath) : null;

    const recordedAfter = recordedNow(dbPath);
    const emittedAfter = emittedNow(repo);
    const genAfter = generationOf(repo);
    const verdict = classify({ population, recordedAfter, emittedAfter });

    const reExtracted = nodeLabelExists(dbPath, marker);
    const generationMoved = genBefore !== null && genAfter !== null && genAfter > genBefore;
    const survived = verdict[CLASS.SURVIVED].length;
    const negativeSeen = recordedAfter.has(keyOf('src/outerA.js', 'CALLS', FABRICATED));

    console.log(`\n${'='.repeat(92)}\nARM ${name}: ${intent}\n${'='.repeat(92)}`);
    console.log('  CONTROLS FIRST, because a quiet arm and a correct arm read identically:');
    console.log(`    ACTION    node "${marker}" introduced by this arm's edit is in the graph: `
      + `${reExtracted ? 'YES — the run re-extracted the mutated file' : 'NO — ⛔ THE RUN DID NOT RE-EXTRACT IT; this arm proves nothing'}`);
    console.log(`    ACTION    generation ${genBefore} -> ${genAfter}: `
      + `${generationMoved ? 'advanced, so a publication happened' : '⛔ DID NOT ADVANCE'}`);
    console.log(`    POSITIVE  ${survived} refs SURVIVED — a zero here means the comparison is vacuous`);
    console.log(`    NEGATIVE  fabricated target ${FABRICATED} recorded? `
      + `${negativeSeen ? '⛔ PRESENT — the lookup cannot report absence, this arm is void' : 'no, as it must be'}`);
    if (plantNote) console.log(`    PLANT     ${plantNote}`);
    console.log(`\n  population ${population.size} refs the graph HELD at baseline (emitted AND recorded);`
      + ` extractor now emits ${emittedAfter.size}`);
    console.log(`\n  REMOVED_AT_SOURCE (${verdict[CLASS.REMOVED_AT_SOURCE].length}) — the file stopped emitting these, so NOT losses:`);
    for (const k of verdict[CLASS.REMOVED_AT_SOURCE]) console.log(`    ${describeKey(k)}`);
    console.log(`\n  ⛔ LOST (${verdict[CLASS.LOST].length}) — still emitted, recorded NOWHERE:`);
    for (const k of verdict[CLASS.LOST]) console.log(`    ${describeKey(k)}`);

    const named = expectNamed
      ? verdict[CLASS.LOST].length === 1 && verdict[CLASS.LOST][0] === expectNamed
      : true;
    const ok = verdict[CLASS.LOST].length === expectLost
      && reExtracted && generationMoved && survived > 0 && !negativeSeen && named;
    console.log(`\n  EXPECTED LOST ${expectLost}, GOT ${verdict[CLASS.LOST].length}`
      + `${expectNamed ? `; the named ref is ${named ? 'the one planted' : '⛔ NOT the one planted'}` : ''}`
      + `  =>  ${ok ? `ARM ${name} PASSES` : `⛔ ARM ${name} FAILS`}`);
    return {
      name,
      ok,
      lost: verdict[CLASS.LOST],
      removed: verdict[CLASS.REMOVED_AT_SOURCE].length,
      named,
      planted: Boolean(expectNamed),
    };
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

// The refs ARM B and ARM C plant losses on. Named as constants so the expectation and the plant
// cannot drift apart.
// ⚠ These are in the EXTRACTOR's form, which is what the population is keyed by — not the node's
// label. For a module ref those differ: the extractor emits `src/middle.js`, the node is labelled
// `middle.js`, and confusing the two is mistake 3 in `scripts/lib/ref-keys.mjs`.
const PLANTED_CALLS = keyOf('src/outerB.js', 'CALLS', 'middle');
const PLANTED_IMPORTS = keyOf('src/outerC.js', 'IMPORTS', 'src/middle.js');

// Delete one recorded edge whose source still emits it, and refuse rather than pass vacuously if the
// edge is not there to delete.
function plantEdgeLoss({ sourceFile, relation, label }) {
  return (dbPath) => {
    const db = openDb(dbPath);
    try {
      const row = db.get(
        `SELECT e.from_id AS f, e.to_id AS t, e.relation AS r
         FROM edges e JOIN nodes n ON n.id = e.to_id
         WHERE e.source_file = $sourceFile AND e.relation = $relation AND n.label = $label`,
        { sourceFile, relation, label },
      );
      if (!row) {
        throw new Error(
          `PLANT FAILED: no ${sourceFile} ${relation} ${label} edge survived the run, so there is `
          + 'nothing to drop and this arm would pass vacuously. Either the closure regressed or the '
          + 'fixture changed.',
        );
      }
      db.run('DELETE FROM edges WHERE from_id = $f AND to_id = $t AND relation = $r', row);
      return `deleted the surviving ${sourceFile} ${relation} ${label} edge — a PLANTED loss, not an observed one`;
    } finally {
      db.close();
    }
  };
}

const arms = [
  {
    name: 'A',
    intent: 'a ref whose source INTENTIONALLY stopped referencing it must NOT be reported as lost',
    marker: 'armMarkerA',
    expectLost: 0,
    mutate: async (repo) => {
      // outerA stops importing and calling middle. Both its refs legitimately disappear.
      await writeFile(path.join(repo, 'src', 'outerA.js'),
        'export function armMarkerA() { return 0; }\nexport function outerA() { return 1; }\n');
      commitAll(repo, 'outerA legitimately stops using middle');
    },
  },
  {
    name: 'B',
    intent: 'a SURVIVING ref dropped by storage MUST be reported, naming file, relation and target',
    marker: 'armMarkerB',
    expectLost: 1,
    expectNamed: PLANTED_CALLS,
    mutate: async (repo) => {
      await writeFile(path.join(repo, 'src', 'inner.js'),
        'export function inner() { return 1; }\nexport function armMarkerB() { return 2; }\n');
      commitAll(repo, 'structural change to inner.js');
    },
    // ⚠⚠ A PLANTED LOSS, NOT AN OBSERVED ONE. The fixed-point closure means the real loss no longer
    // occurs on this fixture, so the only way to show the DETECTOR fires is to delete a recorded edge
    // whose source still emits it. This arm proves the detector works. It is NOT evidence that a loss
    // happened, and nothing derived from it may be reported as one.
    plant: plantEdgeLoss({ sourceFile: 'src/outerB.js', relation: 'CALLS', label: 'middle' }),
  },
  {
    // ⛔⛔ THE ARM THAT COVERS THE RELATION THE REAL DEFECT DESTROYED. ARM B proves only that the
    // detector sees a CALLS loss. The primary specimen in this whole arc was an IMPORTS edge, and the
    // IMPORTS key joins a target the extractor writes as './middle.js' to a node whose label is
    // 'middle.js'. If those forms do not match, a LOST import classifies as REMOVED_AT_SOURCE — a
    // false quiet, in the one relation that matters most, hidden behind ARM A's clean pass.
    //
    // ⛔ PRE-REGISTERED BEFORE THIS ARM WAS FIRST RUN: if it fails, the instrument is BLIND TO IMPORTS
    // LOSSES and that is the finding. The key does not get adjusted until this passes.
    name: 'C',
    intent: 'the same planted drop on an IMPORTS ref — the relation the real defect actually destroyed',
    marker: 'armMarkerC',
    expectLost: 1,
    expectNamed: PLANTED_IMPORTS,
    mutate: async (repo) => {
      await writeFile(path.join(repo, 'src', 'inner.js'),
        'export function inner() { return 1; }\nexport function armMarkerC() { return 3; }\n');
      commitAll(repo, 'structural change to inner.js');
    },
    plant: plantEdgeLoss({ sourceFile: 'src/outerC.js', relation: 'IMPORTS', label: 'middle.js' }),
  },
];

const results = [];
for (const arm of arms) results.push(await runArm(arm));

console.log(`\n${'='.repeat(92)}\nVERDICT\n${'='.repeat(92)}`);
for (const r of results) {
  console.log(`  ARM ${r.name}: ${r.ok ? 'PASS' : 'FAIL'}   lost ${r.lost.length}, removed-at-source ${r.removed}`);
}
// ⛔ THE PRE-REGISTERED QUESTION, asked of EVERY arm that planted a loss — not just the first.
// Asking it of the CALLS arm alone is what let the IMPORTS blindness pass a clean run: the relation the
// real defect primarily destroyed was the one the question never covered.
console.log('\n  ⛔ THE PRE-REGISTERED QUESTION: does each planted arm NAME file, relation and target?');
for (const r of results.filter((x) => x.planted)) {
  console.log(`     ARM ${r.name}: ${r.named && r.lost.length === 1
    ? `YES — ${describeKey(r.lost[0])}`
    : 'NO — for this relation the check is DECORATION, not a conservation check'}`);
}
const allOk = results.every((r) => r.ok);
console.log(`\n  => ${allOk
  ? 'USABLE: a legitimate removal stays quiet, and a dropped surviving ref is named.'
  : 'NOT USABLE — report as decoration rather than tuning until it passes.'}`);
process.exit(allOk ? 0 : 1);
