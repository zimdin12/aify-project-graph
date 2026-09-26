#!/usr/bin/env node
// DOES AN INCREMENTAL RUN HANDLE A RENAME — and can the check that says so see a case-only one?
//
// A rename is where a code graph most easily accumulates phantoms: the old path's nodes must go, the
// new path's must appear, and nothing upstream is obliged to tell the graph the two are related.
//
// ⭐ THE INVARIANT THAT NEEDS NO ORACLE. A node naming a `file_path` that is not in the tree is a
// phantom, full stop. No second graph, no rebuild, no similarity threshold — just the directory
// listing. That matters because a rename and a delete-plus-create are indistinguishable at the graph
// level, and any check that tried to tell them apart would need a similarity cut, which is a number
// chosen after seeing the data. ⇒ APG NEVER DISTINGUISHES THEM: it deletes the old nodes and creates
// the new ones. There is no threshold here to get wrong.
//
// ⛔⛔ THE CHECK'S OWN FIRST DEFECT, AND WHY THIS FILE EXISTS. The first version of this probe asked
// `existsSync(join(repo, file))`. On Windows that is CASE-INSENSITIVE, so after
// `git mv -f src/middle.js src/Middle.js` it answered TRUE for the stale spelling and printed
// PHANTOMS: NONE over a live phantom. The defect was caught only because the probe also printed the
// IMPORTS list and 5 did not equal the rebuild's 4 — a count comparison caught what the dedicated
// detector could not. A probe that cannot return ABSENT cannot return PRESENT, and mine could not, on
// exactly the platform this repo runs on.
//
// ⭐ SO THE GROUND TRUTH HERE IS COMPUTED INDEPENDENTLY, and deliberately does NOT import
// `existsWithExactCase` from `mcp/stdio/freshness/path-exists.js`. That helper is the FIX being
// tested. Judging the fix with the fix is a same-source oracle: a bug in it would hide itself and
// this audit would agree with the defect. `presentWithExactCase` below is a second implementation,
// written against `readdir`, and the two must be kept independent.
//
// ⛔ PRE-REGISTERED, BEFORE THE FIX WAS RUN. The fix is REFUTED if either holds:
//   1. a case-only rename still leaves TWO File nodes for ONE file on disk; or
//   2. any node for a GENUINELY PRESENT file is deleted (over-deletion) — the worse direction, since
//      the caller's response to "absent" is `deleteNodesForFile`. ARM E exists only to catch this.
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (...p) => import(pathToFileURL(path.join(REPO, ...p)).href);
const { ensureFresh } = await load('mcp', 'stdio', 'freshness', 'orchestrator.js');
const { openDb } = await load('mcp', 'stdio', 'storage', 'db.js');

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
const commitAll = (repo, msg) => { git(repo, 'add', '-A'); git(repo, 'commit', '-qm', msg); };

// ⭐ The independent ground truth: EVERY segment must appear, spelled exactly, in its parent's
// directory listing. Written here rather than imported, so the fix cannot grade its own homework.
//
// ⛔⛔ THIS FUNCTION HAS NOW BEEN BLIND TWICE, IN THE SAME WAY, AND BOTH TIMES THE ARM WAS RESCUED BY
// A COUNT RATHER THAN BY THE DETECTOR.
//   v1 used `existsSync` -> case-insensitive on Windows -> printed PHANTOMS: NONE over a live
//      case-renamed file. Caught because the IMPORTS list showed 5 against a rebuild's 4.
//   v2 read the parent directory but compared the BASENAME ONLY -> printed PHANTOMS: NONE over FOUR
//      live `src/*` nodes after a parent-directory rename. Caught because the IMPORTS list showed 8
//      against a rebuild's 4.
// Each time the detector agreed with what I expected, so nothing collided and nothing prompted a
// check. ⇒ WHEN A PROBE ANSWERS A YES/NO QUESTION, PRINT THE UNDERLYING POPULATION TOO: the count
// disagreeing with the verdict is the only thing that can catch a verdict which is confidently wrong.
// That redundancy is not clutter here, it is the thing that has done the work twice.
async function presentWithExactCase(root, relPath) {
  const segments = relPath.split(/[\\/]+/).filter((s) => s && s !== '.');
  let parent = root;
  for (const segment of segments) {
    try {
      if (!(await readdir(parent)).includes(segment)) return false;
    } catch {
      return false;
    }
    parent = path.join(parent, segment);
  }
  // No segments means the path IS the repo root (`.`), which exists. Returning false here reported
  // the root as a phantom and failed every arm — a false alarm from the detector, caught because the
  // arms went red all at once rather than the one arm under test.
  return true;
}

async function phantomsIn(repo, dbPath) {
  const db = openDb(dbPath);
  let paths;
  try {
    paths = db.all("SELECT DISTINCT file_path AS f FROM nodes WHERE file_path <> ''").map((r) => r.f);
  } finally {
    db.close();
  }
  const phantoms = [];
  for (const f of paths) if (!(await presentWithExactCase(repo, f))) phantoms.push(f);
  return phantoms;
}

function importsIn(dbPath) {
  const db = openDb(dbPath);
  try {
    return db.all(
      `SELECT e.source_file AS s, n.file_path AS d FROM edges e JOIN nodes n ON n.id = e.to_id
       WHERE e.relation = 'IMPORTS' ORDER BY s, d`,
    ).map((r) => `${r.s} -> ${r.d}`);
  } finally {
    db.close();
  }
}

function unresolvedIn(dbPath) {
  const db = openDb(dbPath);
  try {
    return db.all('SELECT source_file AS s, relation AS r, target AS t FROM unresolved_refs ORDER BY s, t')
      .map((x) => `${x.s} ${x.r} ${x.t}`);
  } finally {
    db.close();
  }
}

async function buildFixture() {
  const repo = await mkdtemp(path.join(tmpdir(), 'apg-rename-'));
  await mkdir(path.join(repo, 'src'), { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.name', 'rename-audit');
  git(repo, 'config', 'user.email', 'rename-audit@example.invalid');
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

const dbOf = (repo) => path.join(repo, '.aify-graph', 'graph.sqlite');

async function runArm({ name, intent, mutate, expectImports, expectUnresolved }) {
  const inc = await buildFixture();
  const full = await buildFixture();
  try {
    await ensureFresh({ repoRoot: inc });
    const baseImports = importsIn(dbOf(inc));
    const basePhantoms = await phantomsIn(inc, dbOf(inc));

    await mutate(inc);
    await mutate(full);
    await ensureFresh({ repoRoot: inc });
    await ensureFresh({ repoRoot: full, force: true });

    const incImports = importsIn(dbOf(inc));
    const fullImports = importsIn(dbOf(full));
    const incPhantoms = await phantomsIn(inc, dbOf(inc));
    const incUnresolved = unresolvedIn(dbOf(inc));

    const missing = fullImports.filter((x) => !incImports.includes(x));
    const extra = incImports.filter((x) => !fullImports.includes(x));

    console.log(`\n${'='.repeat(94)}\nARM ${name}: ${intent}\n${'='.repeat(94)}`);
    console.log('  CONTROLS FIRST:');
    console.log(`    BASELINE   ${baseImports.length} IMPORTS before the rename `
      + `${baseImports.length === 4 ? '(4, as the fixture defines)' : '⛔ NOT 4 — the fixture or the indexer changed'}`);
    console.log(`    BASELINE   phantoms before the rename: ${basePhantoms.length === 0 ? 'none, as it must be' : `⛔ ${JSON.stringify(basePhantoms)}`}`);
    console.log(`\n  incremental IMPORTS (${incImports.length}): ${JSON.stringify(incImports)}`);
    console.log(`  rebuild     IMPORTS (${fullImports.length}): ${JSON.stringify(fullImports)}`);
    console.log(`  unresolved  (${incUnresolved.length}): ${incUnresolved.length ? JSON.stringify(incUnresolved) : 'none'}`);
    console.log(`  ⛔ PHANTOM file_paths after the run (exact-case, computed independently): `
      + `${incPhantoms.length ? JSON.stringify(incPhantoms) : 'NONE'}`);
    console.log(`  in rebuild but not incremental: ${JSON.stringify(missing)}`);
    console.log(`  in incremental but not rebuild: ${JSON.stringify(extra)}`);

    const ok = incPhantoms.length === 0
      && basePhantoms.length === 0
      && baseImports.length === 4
      && missing.length === 0
      && extra.length === 0
      && incImports.length === expectImports
      && incUnresolved.length === expectUnresolved;
    console.log(`\n  EXPECTED ${expectImports} IMPORTS and ${expectUnresolved} unresolved, `
      + `GOT ${incImports.length} and ${incUnresolved.length}  =>  ${ok ? `ARM ${name} PASSES` : `⛔ ARM ${name} FAILS`}`);
    return { name, ok };
  } finally {
    await rm(inc, { recursive: true, force: true });
    await rm(full, { recursive: true, force: true });
  }
}

// ⛔ ARM E: THE DETECTOR'S OWN CONTROL. Every other arm asserts PHANTOMS: NONE, and a detector that
// can never say PRESENT would satisfy all of them. This plants a node for a file that does not exist
// and requires it reported. Without this arm, the four zeros above are worthless.
async function runDetectorControl() {
  const repo = await buildFixture();
  try {
    await ensureFresh({ repoRoot: repo });
    const before = await phantomsIn(repo, dbOf(repo));
    const db = openDb(dbOf(repo));
    try {
      db.run(
        `INSERT INTO nodes (id, type, label, file_path, start_line, end_line)
         VALUES ('planted-phantom', 'Symbol', 'plantedPhantom', 'src/doesNotExist.js', 1, 1)`,
      );
    } finally {
      db.close();
    }
    const after = await phantomsIn(repo, dbOf(repo));
    // And the case-only form, which is the one the FIRST version of this probe could not see.
    const caseBlindSeen = await presentWithExactCase(repo, 'src/MIDDLE.js');

    console.log(`\n${'='.repeat(94)}\nARM E: the phantom detector's own control — can it report PRESENT?\n${'='.repeat(94)}`);
    console.log(`  phantoms before planting: ${before.length === 0 ? 'none' : JSON.stringify(before)}`);
    console.log(`  phantoms after planting a node for src/doesNotExist.js: `
      + `${after.includes('src/doesNotExist.js') ? 'DETECTED — the instrument can say PRESENT' : '⛔ NOT DETECTED — every zero above is void'}`);
    console.log(`  CASE CONTROL: is 'src/MIDDLE.js' (wrong case, file is middle.js) reported present? `
      + `${caseBlindSeen ? '⛔ YES — the check is case-blind, which is the original defect' : 'no, correctly absent'}`);
    const ok = before.length === 0 && after.includes('src/doesNotExist.js') && !caseBlindSeen;
    console.log(`\n  =>  ${ok ? 'ARM E PASSES' : '⛔ ARM E FAILS'}`);
    return { name: 'E', ok };
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

const results = [];
results.push(await runArm({
  name: 'A',
  intent: 'rename + importers updated — the ordinary case',
  expectImports: 4,
  expectUnresolved: 0,
  mutate: async (repo) => {
    git(repo, 'mv', 'src/middle.js', 'src/core.js');
    for (const n of ['outerA', 'outerB', 'outerC']) {
      await writeFile(path.join(repo, 'src', `${n}.js`),
        `import { middle } from './core.js';\nexport function ${n}() { return middle() + 1; }\n`);
    }
    commitAll(repo, 'rename middle.js -> core.js, importers updated');
  },
}));
results.push(await runArm({
  name: 'B',
  intent: 'rename, importers left BROKEN — must be refused loudly, never silently dropped',
  expectImports: 1,
  expectUnresolved: 6,
  mutate: async (repo) => {
    git(repo, 'mv', 'src/middle.js', 'src/core.js');
    commitAll(repo, 'rename only, importers left broken');
  },
}));
results.push(await runArm({
  name: 'C',
  intent: 'CASE-ONLY rename middle.js -> Middle.js — the defect this audit was written for',
  expectImports: 4,
  expectUnresolved: 0,
  mutate: async (repo) => {
    git(repo, 'mv', '-f', 'src/middle.js', 'src/Middle.js');
    for (const n of ['outerA', 'outerB', 'outerC']) {
      await writeFile(path.join(repo, 'src', `${n}.js`),
        `import { middle } from './Middle.js';\nexport function ${n}() { return middle() + 1; }\n`);
    }
    commitAll(repo, 'case-only rename middle.js -> Middle.js');
  },
}));
results.push(await runArm({
  name: 'D',
  intent: 'rename + rewrite in one commit, which defeats git rename detection',
  expectImports: 4,
  expectUnresolved: 0,
  mutate: async (repo) => {
    git(repo, 'mv', 'src/middle.js', 'src/core.js');
    await writeFile(path.join(repo, 'src', 'core.js'),
      "import { inner } from './inner.js';\nexport function middle() { return inner() + 99; }\n"
      + 'export function extra() { return 7; }\n');
    for (const n of ['outerA', 'outerB', 'outerC']) {
      await writeFile(path.join(repo, 'src', `${n}.js`),
        `import { middle } from './core.js';\nexport function ${n}() { return middle() + 1; }\n`);
    }
    commitAll(repo, 'rename and rewrite together');
  },
}));
// ⛔ ARM F: THE PARENT DIRECTORY, which shipped in 27c5c422 as a "stated limit" in a comment and was
// then EXECUTED as a defect by graph-senior-dev: `src/` -> `Src/` left FOUR File nodes against a
// forced rebuild's TWO, plus a stale `src/outer.js -> src/middle.js` edge. Built from the shape they
// actually ran rather than one I invented.
//
// ⚠ APPARATUS NOTE, theirs: a direct `git mv -f src Src` fails with `Invalid argument`, so the rename
// goes through an intermediate directory and lands as ONE commit whose delta is `D src/*` + `A Src/*`.
// A run that skipped this would produce no case-only parent delta and the arm would pass vacuously.
results.push(await runArm({
  name: 'F',
  intent: 'CASE-ONLY rename of a PARENT DIRECTORY src/ -> Src/ (graph-senior-dev, executed)',
  expectImports: 4,
  expectUnresolved: 0,
  mutate: async (repo) => {
    git(repo, 'mv', 'src', 'srcTmpRename');
    git(repo, 'mv', 'srcTmpRename', 'Src');
    commitAll(repo, 'case-only rename of the parent directory');
  },
}));
// ⛔⛔ ARM G: SAME-BASENAME COLLISION — THE CASE EVERY OTHER ARM IN THIS FILE IS BLIND TO.
//
// Named by dashboard-manager, 2026-09-26, by reading forward a limit I had volunteered about the
// CONSERVATION check: a ref repointed to a DIFFERENT file with the SAME BASENAME reads "conserved",
// because `label` is a basename and a basename is an accepted address form. Their step was to point
// that at THIS file's corpus, and it lands:
//
//   ⛔ EVERY FIXTURE FILE ABOVE LIVES IN `src/` WITH A UNIQUE NAME. A corpus of uniquely-named files
//      CANNOT DISTINGUISH "repointed correctly" from "repointed to the other one", so a green over it
//      is SILENCE, NOT EVIDENCE. Same shape as the six arms with no file-as-parent-segment, which is
//      how `path-exists.js` came to describe a load-bearing premise as an optimisation.
//
// ⚠ AND THE SHARPER HALF, which is mine and is worse than the fixture gap. Arms A-F compare the
// incremental pair list against a FORCED REBUILD's pair list. That is a DIFFERENTIAL BETWEEN TWO CODE
// PATHS, not a check against ground truth: if resolution picks the wrong same-named file, BOTH paths
// pick it identically, `missing` is empty, and the arm is green. So this arm asserts the ABSOLUTE
// expected pairs and never an agreement.
//
// ⇒ AND THE PROHIBITION THAT FOLLOWS, written here because the next person will be tempted:
//   CONSERVATION MUST NEVER BE USED AS THE "NOTHING WAS LOST" HALF OF A RENAME ARM. A rename that
//   repoints a ref to the wrong same-named file is precisely the case conservation calls conserved, so
//   leaning on it would mean leaning on the one instrument blind to the failure renames introduce.
//   This file imports nothing from the conservation audit today (verified: 0 references) and must not.
async function runSameBasenameArm() {
  const repo = await mkdtemp(path.join(tmpdir(), 'apg-basename-'));
  try {
    await mkdir(path.join(repo, 'src', 'a'), { recursive: true });
    await mkdir(path.join(repo, 'src', 'b'), { recursive: true });
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.name', 'rename-audit');
    git(repo, 'config', 'user.email', 'rename-audit@example.invalid');
    await writeFile(path.join(repo, '.gitignore'), '.aify-graph/\n');
    // TWO files with the SAME BASENAME in DIFFERENT directories. This is the whole point of the arm.
    await writeFile(path.join(repo, 'src', 'a', 'shared.js'), 'export function shared() { return 1; }\n');
    await writeFile(path.join(repo, 'src', 'b', 'shared.js'), 'export function shared() { return 2; }\n');
    await writeFile(path.join(repo, 'src', 'refA.js'),
      "import { shared } from './a/shared.js';\nexport function refA() { return shared(); }\n");
    await writeFile(path.join(repo, 'src', 'refB.js'),
      "import { shared } from './b/shared.js';\nexport function refB() { return shared(); }\n");
    commitAll(repo, 'baseline: refA -> a/shared.js, refB -> b/shared.js');
    await ensureFresh({ repoRoot: repo });

    const WANT_A = 'src/refA.js -> src/a/shared.js';
    const WANT_B = 'src/refB.js -> src/b/shared.js';
    const base = importsIn(dbOf(repo));

    console.log(`\n${'='.repeat(94)}\nARM G: same-basename collision — a COUNT and a DIFFERENTIAL are both blind here\n${'='.repeat(94)}`);
    console.log(`  baseline pairs: ${JSON.stringify(base)}`);
    // POSITIVE CONTROL: the instrument can say CORRECT, against ground truth rather than a rebuild.
    const baseOk = base.includes(WANT_A) && base.includes(WANT_B);
    console.log(`  POSITIVE  both absolute pairs present at baseline: ${baseOk ? 'YES' : '⛔ NO — every verdict below is void'}`);

    // ⭐ THE PLANT, IN THE ARTIFACT THE CHECK READS: repoint refA's IMPORTS edge at the OTHER
    // same-named file. This is what a resolver picking the wrong sibling would leave behind.
    const db = openDb(dbOf(repo));
    let planted = false;
    try {
      const other = db.get("SELECT id FROM nodes WHERE file_path = 'src/b/shared.js' AND type = 'File'");
      const edge = db.get("SELECT from_id, to_id, relation FROM edges WHERE source_file = 'src/refA.js' AND relation = 'IMPORTS'");
      if (other && edge) {
        db.run('UPDATE edges SET to_id = $to WHERE from_id = $f AND to_id = $t AND relation = $r',
          { to: other.id, f: edge.from_id, t: edge.to_id, r: edge.relation });
        planted = true;
      }
    } finally {
      db.close();
    }
    // ⛔ A PLANT THAT PLANTED NOTHING CANNOT REPORT A GREEN.
    console.log(`  PLANT     repointed refA's IMPORTS edge at src/b/shared.js: ${planted ? 'done' : '⛔ FAILED — nothing to repoint, arm is void'}`);

    const after = importsIn(dbOf(repo));
    // ⭐ THE DISCRIMINATING CONTROL, and the reason this arm exists rather than a count assertion:
    // the COUNT is unchanged by a mis-repoint, so a count cannot see it. The PAIR SET is not.
    const countBlind = after.length === base.length;
    const pairsSaw = !after.includes(WANT_A) && after.includes('src/refA.js -> src/b/shared.js');
    console.log(`  COUNT     ${base.length} -> ${after.length}: ${countBlind ? 'UNCHANGED — a count is structurally blind to this' : '⛔ changed, so this arm is not testing what it claims'}`);
    console.log(`  PAIRS     wrong pairing named: ${pairsSaw ? 'YES — src/refA.js -> src/b/shared.js' : '⛔ NO — the pair check cannot see a mis-repoint either'}`);

    const ok = baseOk && planted && countBlind && pairsSaw;
    console.log(`\n  =>  ${ok ? 'ARM G PASSES — absolute pairs catch what the count and the rebuild-differential miss' : '⛔ ARM G FAILS'}`);
    return { name: 'G', ok };
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}
results.push(await runSameBasenameArm());
results.push(await runDetectorControl());

console.log(`\n${'='.repeat(94)}\nVERDICT\n${'='.repeat(94)}`);
for (const r of results) console.log(`  ARM ${r.name}: ${r.ok ? 'PASS' : 'FAIL'}`);
const allOk = results.every((r) => r.ok);
console.log(`\n  => ${allOk
  ? 'Renames leave no phantom, and the phantom detector is proven able to report one.'
  : '⛔ NOT CLEAN — read the failing arm above.'}`);
process.exit(allOk ? 0 : 1);
