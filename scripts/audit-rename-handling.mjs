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
// ⭐ THE SAME PREDICATE THE PASS ITSELF USES to decide whether a file is indexable
// (`orchestrator.js:1243` wraps this exact function in a try/catch and treats a throw as "not a
// language we handle"). Imported rather than reimplemented ON PURPOSE: a coverage check that
// disagreed with the pass about WHICH FILES OUGHT TO BE COVERED would manufacture both false alarms
// and false silence, and there would be no way to tell which one you were looking at.
const { getLanguageConfig } = await load('mcp', 'stdio', 'ingest', 'languages', 'index.js');

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
const gitOut = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
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

// ⛔⛔ THE INVERSE DIRECTION, WHICH `phantomsIn` STRUCTURALLY CANNOT SEE.
//
// Named by dashboard-manager, 2026-09-29, and their framing is the one to keep: "if the population is
// built from what the pass emitted, a rename the pass FAILS TO EMIT is not a failure, it is an
// ABSENCE FROM THE POPULATION, and the check cannot fail on it."
//
// `phantomsIn` walks `SELECT DISTINCT file_path FROM nodes` and asks the filesystem about each one.
// That direction catches a NODE WHOSE FILE IS GONE. It cannot catch a FILE WHOSE NODE IS GONE,
// because a file the pass never indexed leaves NOTHING TO ENUMERATE — and an enumeration of nodes
// going green over zero nodes is indistinguishable from one going green over correct ones.
//
// ⇒ So the population here comes FROM GIT, never from the graph: `git ls-files` is what git says is
// tracked, which is the same substrate `getChangedFilesBetween` reads (`git.js:159`) and is
// independent of anything the pass chose to write. A tracked file that is indexable and still on disk
// MUST have at least one node.
//
// ⛔⛔ THE NAME CARRIES THE LIMIT, and that is dashboard-manager's point rather than a style choice.
// The limit below ("blind to untracked files, so never reuse this as a completeness check") lived in a
// note for one commit. A note is read by whoever wrote it. `coverageIn` is what somebody greps for when
// they want to know whether the graph is complete, and they would find it, call it, and never open the
// note. `coverageOfTrackedFiles` states the fail-open direction at every call site, so a misuse is
// visible in the diff instead of in a document the reuser never opens.
//
// ⚠ AND A GAP IS NOT AUTOMATICALLY A DEFECT, which is why the skip report is consulted. The pass has
// branches that DELIBERATELY leave a file with no nodes and say so — the >1 MB cap at
// `orchestrator.js:643` is the clearest. A gap the pass DECLARED is accounted for; a gap it did not
// declare is the failure this limb exists to catch.
//
// ⛔⛔ AND IT REFUSES RATHER THAN CLASSIFYING WHEN THE SKIP REPORT MIGHT BE INCOMPLETE. The first
// version said the truncation at `orchestrator.js:1028` was "fail-closed in direction, which is the
// direction to be wrong in", and that was not good enough. dashboard-manager walked it one step
// further: past 50 skips, a DECLARED gap reads as unexplained, so the first person to hit 51 sees a red
// that is A LIE ABOUT A FILE THE CAP DELIBERATELY LEFT ALONE — and the repair they reach for is
// widening the allowance, which loses the real direction permanently and quietly.
//
// ⇒ A CHECK THAT CANNOT TELL WHICH OF TWO WORLDS IT IS IN MUST NOT REPORT EITHER. Classifying against a
// list known to be truncated is reading an instrument that silently under-reports.
//
// ⭐ AND THE DETECTION COMES FROM THE ARTIFACT, NOT FROM A PRODUCER FLAG — their second warning, which
// would otherwise have landed on this exact line. Completeness is established by comparing two views of
// ONE array: how many the pass says it skipped (`skippedFileCount`) against how many it actually handed
// over (`skippedFiles.length`). Nothing here asks the producer "did you truncate?", and nothing hardcodes
// 50, which would be a number to remember to update when the cap moves.
//
// ⚠ IT FAILS CLOSED ON ITS OWN PRECONDITION: completeness must be POSITIVELY established. A missing or
// non-numeric count refuses rather than defaulting to "complete", because `undefined > n` is false and a
// naive comparison would have read a missing count as nothing-was-truncated.
async function coverageOfTrackedFiles(repo, dbPath, skipReport) {
  const tracked = gitOut(repo, 'ls-files').split(/\r?\n/).filter(Boolean);
  const indexable = [];
  for (const f of tracked) {
    // Tracked but no longer on disk is not a coverage gap — that is the DELETE case, and a node for
    // it would be a phantom, which is the other limb's job. Exact case, for the reason at the top.
    if (!(await presentWithExactCase(repo, f))) continue;
    try {
      getLanguageConfig(f);
    } catch {
      continue;
    }
    indexable.push(f);
  }

  const db = openDb(dbPath);
  let covered;
  try {
    covered = new Set(db.all("SELECT DISTINCT file_path AS f FROM nodes WHERE file_path <> ''").map((r) => r.f));
  } finally {
    db.close();
  }

  const gaps = indexable.filter((f) => !covered.has(f));

  // The precondition, checked before any classification is attempted.
  const list = skipReport?.files ?? [];
  const claimedCount = skipReport?.count;
  const complete = typeof claimedCount === 'number' && claimedCount === list.length;
  if (!complete) {
    return {
      population: indexable.length,
      gaps,
      refused: typeof claimedCount !== 'number'
        ? `skip report carries no numeric count (got ${JSON.stringify(claimedCount)}), so completeness cannot be established`
        : `the pass reports ${claimedCount} skipped file(s) but handed over ${list.length}, so the skip report is TRUNCATED`,
      unexplained: null,
      declared: null,
    };
  }

  const declared = new Set(list.map((s) => s.file));
  return {
    population: indexable.length,
    gaps,
    refused: null,
    unexplained: gaps.filter((g) => !declared.has(g)),
    declared: gaps.filter((g) => declared.has(g)),
  };
}

// ⭐⭐ PRINT THE POPULATION BESIDE THE VERDICT. The reachable failure of the limb above is not a wrong
// answer, it is a VACUOUS one: if `git ls-files` returned nothing, or `getLanguageConfig` threw for
// every file, `indexable` is empty, `unexplained` is empty, and the limb reports clean forever. An
// empty population and a fully-covered one produce the identical verdict, so the count is the only
// thing that can tell them apart and it is asserted, not merely displayed.
function coverageLine(cov, expectPopulation) {
  const vacuous = cov.population === 0;
  const popOk = cov.population === expectPopulation;
  const head = `  COVERAGE of TRACKED files (the INVERSE of the phantom walk): population ${cov.population} `
    + `${vacuous ? '⛔ VACUOUS — every verdict from this limb is void' : popOk ? `(${expectPopulation}, as the fixture defines)` : `⛔ NOT ${expectPopulation} — fixture or predicate changed`}`;
  // A REFUSAL IS NOT A CLEAN RESULT AND MUST NOT READ LIKE ONE. It prints the precondition it could not
  // meet and takes the arm red, because the audit cannot certify what it cannot separate.
  if (cov.refused) {
    return `${head}\n    ⛔ REFUSED TO CLASSIFY: ${cov.refused}`
      + `\n    (${cov.gaps.length} gap(s) found, left UNCLASSIFIED — declared and undeclared cannot be told apart in this run)`;
  }
  return `${head}\n    files on disk, tracked and indexable, with NO node: `
    + `${cov.unexplained.length ? `⛔ ${JSON.stringify(cov.unexplained)}` : 'NONE'}`
    + `${cov.declared.length ? `\n    gaps the pass DECLARED, accounted for: ${JSON.stringify(cov.declared)}` : ''}`;
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

// ⚠ `expectPopulation` HAS NO DEFAULT ON PURPOSE. A default would apply silently to the next arm
// somebody adds, and if that arm's fixture has a different file count the coverage limb would compare
// against a number nobody chose. Omitting it leaves `undefined`, which fails the strict equality and
// takes the arm red — the direction that gets noticed.
async function runArm({ name, intent, mutate, expectImports, expectUnresolved, expectPopulation }) {
  const inc = await buildFixture();
  const full = await buildFixture();
  try {
    await ensureFresh({ repoRoot: inc });
    const baseImports = importsIn(dbOf(inc));
    const basePhantoms = await phantomsIn(inc, dbOf(inc));

    await mutate(inc);
    await mutate(full);
    const incResult = await ensureFresh({ repoRoot: inc });
    await ensureFresh({ repoRoot: full, force: true });

    const incImports = importsIn(dbOf(inc));
    const fullImports = importsIn(dbOf(full));
    const incPhantoms = await phantomsIn(inc, dbOf(inc));
    const incUnresolved = unresolvedIn(dbOf(inc));
    const incCoverage = await coverageOfTrackedFiles(inc, dbOf(inc), {
      files: incResult?.skippedFiles, count: incResult?.skippedFileCount,
    });

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
    console.log(coverageLine(incCoverage, expectPopulation));

    const ok = incPhantoms.length === 0
      && basePhantoms.length === 0
      && baseImports.length === 4
      && missing.length === 0
      && extra.length === 0
      && incImports.length === expectImports
      && incUnresolved.length === expectUnresolved
      // The population assertion is HALF THE LIMB, not decoration: without it an empty population
      // reports "NONE unexplained" and passes.
      && incCoverage.population === expectPopulation
      && !incCoverage.refused
      && incCoverage.unexplained?.length === 0;
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
  // 5 tracked, indexable, on-disk .js files: inner, middle-or-its-new-name, outerA, outerB, outerC.
  // `.gitignore` is excluded because `getLanguageConfig` throws for it — measured, not assumed.
  expectPopulation: 5,
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
  // 5 tracked, indexable, on-disk .js files: inner, middle-or-its-new-name, outerA, outerB, outerC.
  // `.gitignore` is excluded because `getLanguageConfig` throws for it — measured, not assumed.
  expectPopulation: 5,
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
  // 5 tracked, indexable, on-disk .js files: inner, middle-or-its-new-name, outerA, outerB, outerC.
  // `.gitignore` is excluded because `getLanguageConfig` throws for it — measured, not assumed.
  expectPopulation: 5,
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
  // 5 tracked, indexable, on-disk .js files: inner, middle-or-its-new-name, outerA, outerB, outerC.
  // `.gitignore` is excluded because `getLanguageConfig` throws for it — measured, not assumed.
  expectPopulation: 5,
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
  // 5 tracked, indexable, on-disk .js files: inner, middle-or-its-new-name, outerA, outerB, outerC.
  // `.gitignore` is excluded because `getLanguageConfig` throws for it — measured, not assumed.
  expectPopulation: 5,
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
    // The coverage limb runs here too, BEFORE the plant, so this arm's own fixture cannot quietly stop
    // being indexed. 4 files: a/shared.js, b/shared.js, refA.js, refB.js.
    const gCoverage = await coverageOfTrackedFiles(repo, dbOf(repo), { files: [], count: 0 });
    console.log(coverageLine(gCoverage, 4));

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

    const ok = baseOk && planted && countBlind && pairsSaw
      && gCoverage.population === 4 && !gCoverage.refused && gCoverage.unexplained?.length === 0;
    console.log(`\n  =>  ${ok ? 'ARM G PASSES — absolute pairs catch what the count and the rebuild-differential miss' : '⛔ ARM G FAILS'}`);
    return { name: 'G', ok };
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}
results.push(await runSameBasenameArm());
results.push(await runDetectorControl());

// ⛔⛔ ARM H: THE COVERAGE LIMB'S OWN CONTROL, and the measurement that decides whether the limb was
// worth adding at all.
//
// ARM E exists because a phantom detector that cannot report PRESENT cannot report NONE. The coverage
// limb needs exactly the same control, and one thing more: it has to be shown that the limb catches
// something THE PHANTOM WALK CANNOT, or it is redundant with a check that already ran.
//
// So one plant, read by BOTH instruments, and the two must disagree:
//   - coverage MUST name the file (a tracked, indexable, on-disk file with no nodes)
//   - the phantom walk MUST stay SILENT (no node names a missing path — there is no node at all)
//
// ⚠ AND WHAT THIS ARM DOES NOT ESTABLISH, said here rather than left for someone to assume: the plant
// is a DB mutation, so it proves THE INSTRUMENT can report the state. It does not prove the pass can
// REACH it by renaming. The reachable production route is the >1 MB cap at `orchestrator.js:643`,
// which leaves exactly this state and DECLARES it via `skippedFiles`; that is why the limb separates
// declared gaps from unexplained ones instead of failing on any gap at all.
async function runCoverageControl() {
  const repo = await buildFixture();
  try {
    await ensureFresh({ repoRoot: repo });
    const before = await coverageOfTrackedFiles(repo, dbOf(repo), { files: [], count: 0 });

    console.log(`\n${'='.repeat(94)}\nARM H: the coverage limb's own control — and does it see what the phantom walk cannot?\n${'='.repeat(94)}`);
    console.log(`  POSITIVE  clean fixture, coverage population ${before.population}, unexplained `
      + `${before.unexplained.length}: ${before.population === 5 && before.unexplained.length === 0
        ? 'CLEAN, as it must be' : '⛔ not clean before the plant — every verdict below is void'}`);

    // THE PLANT: remove every node for one file, leaving the file itself tracked and on disk. This is
    // the state a rename would leave if the pass deleted the old path's nodes and never indexed the
    // new path — the case dashboard-manager named.
    const db = openDb(dbOf(repo));
    let plantedRows = 0;
    try {
      plantedRows = db.all("SELECT id FROM nodes WHERE file_path = 'src/outerA.js'").length;
      db.run("DELETE FROM nodes WHERE file_path = 'src/outerA.js'");
    } finally {
      db.close();
    }
    console.log(`  PLANT     deleted ${plantedRows} node(s) for src/outerA.js, file left on disk and tracked: `
      + `${plantedRows > 0 ? 'done' : '⛔ FAILED — nothing deleted, arm is void'}`);

    const after = await coverageOfTrackedFiles(repo, dbOf(repo), { files: [], count: 0 });
    const phantomsAfter = await phantomsIn(repo, dbOf(repo));

    // ⛔⛔ EQUALITY AGAINST EXACTLY THE PLANTED SET, NOT MEMBERSHIP — and this is the one change in this
    // file that came from a FALSIFIED PREDICTION rather than from a defect anybody found.
    //
    // dashboard-manager pre-registered, without having opened this repo: "mutate `coverageIn` so it
    // returns ALL tracked files rather than the uncovered ones; my prediction is STILL GREEN on ARM H".
    // Measured: the ARM went RED, so the prediction was wrong. But THIS LINE stayed green, because
    // `includes(...)` is satisfied by a limb that names every tracked file. What took the arm red was the
    // BASELINE control and the DECLARED limb — neither of which is the assertion under test.
    //
    // ⇒ So the arm had TWO RESCUERS a differently-shaped fixture would not have had, and the green was
    // luck about which controls happened to exist. That is this file's own header defect for the third
    // time: "the arm was rescued by" something other than the thing being tested.
    //
    // ⇒ Equality stops the assertion being CARRIED. It is not that it gets stronger; it is that it now
    // fails on its own when the limb saturates, instead of depending on a neighbour to notice.
    const coverageSaw = after.unexplained?.length === 1 && after.unexplained[0] === 'src/outerA.js';
    const phantomBlind = phantomsAfter.length === 0;
    // ⚠ THE FAILURE MESSAGE PRINTS WHAT IT ACTUALLY GOT, because the two ways this assertion can fail
    // need different repairs and a fixed message named only one of them. Under `gaps = []` the limb
    // reports nothing; under a saturated limb it reports everything. The first draft said "cannot report
    // a gap" for both, which is a red stating the wrong reason — as uninformative as a green for the
    // wrong reason, and it would have sent the next reader at the opposite bug.
    console.log(`  COVERAGE  names EXACTLY the uncovered file: ${coverageSaw
      ? 'YES — ["src/outerA.js"]'
      : `⛔ NO — got ${JSON.stringify(after.unexplained)}; `
        + `${after.unexplained?.length === 0 ? 'reports nothing, so its NONE means nothing'
          : 'reports more than the planted set, so the limb is SATURATED and a green here would be vacuous'}`}`);
    console.log(`  PHANTOM   walk over the same graph: ${phantomBlind
      ? 'SILENT — confirms the direction it structurally cannot see'
      : `⛔ reported ${JSON.stringify(phantomsAfter)} — then this plant is not the case being demonstrated`}`);

    // ⭐ AND THE OTHER HALF OF THE ACCOUNTING, so a DECLARED gap is proven not to fail the limb.
    // Same plant, same graph, but handed the skip record the pass would have produced.
    const declaredView = await coverageOfTrackedFiles(repo, dbOf(repo),
      { files: [{ file: 'src/outerA.js', phase: 'too_large' }], count: 1 });
    const declaredOk = declaredView.unexplained?.length === 0 && declaredView.declared?.includes('src/outerA.js');
    console.log(`  DECLARED  the same gap, handed the pass's own skip record: ${declaredOk
      ? 'accounted for, not a failure — the two categories are genuinely separate'
      : '⛔ the skip accounting does not work'}`);

    // ⭐ THE REFUSAL, WATCHED RATHER THAN ASSUMED. A limb that refuses is only useful if the refusal
    // actually fires on a truncated report AND is not mistaken for a clean result. Two shapes, both of
    // which a naive comparison would have passed: a count LARGER than the list it handed over, and a
    // missing count (`undefined > n` is false, so absence would have read as nothing-was-truncated).
    const truncatedView = await coverageOfTrackedFiles(repo, dbOf(repo),
      { files: [{ file: 'src/outerA.js', phase: 'too_large' }], count: 51 });
    const noCountView = await coverageOfTrackedFiles(repo, dbOf(repo),
      { files: [{ file: 'src/outerA.js', phase: 'too_large' }] });
    const refusesTruncated = Boolean(truncatedView.refused) && truncatedView.unexplained === null;
    const refusesNoCount = Boolean(noCountView.refused) && noCountView.unexplained === null;
    console.log(`  REFUSAL   count(51) > list(1), i.e. a truncated report: ${refusesTruncated
      ? 'REFUSED to classify, and returned no verdict to misread' : '⛔ classified anyway'}`);
    console.log(`  REFUSAL   no numeric count at all: ${refusesNoCount
      ? 'REFUSED — absence is not treated as completeness' : '⛔ absence read as complete'}`);

    const ok = before.population === 5 && !before.refused && before.unexplained.length === 0
      && plantedRows > 0 && coverageSaw && phantomBlind && declaredOk
      && refusesTruncated && refusesNoCount;
    console.log(`\n  =>  ${ok
      ? 'ARM H PASSES — the coverage limb names EXACTLY the gap the phantom walk is blind to, declared gaps do '
        + 'not fail it, and it REFUSES rather than classifying when the skip report may be truncated'
      : '⛔ ARM H FAILS'}`);
    return { name: 'H', ok };
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}
results.push(await runCoverageControl());

console.log(`\n${'='.repeat(94)}\nVERDICT\n${'='.repeat(94)}`);
for (const r of results) console.log(`  ARM ${r.name}: ${r.ok ? 'PASS' : 'FAIL'}`);
const allOk = results.every((r) => r.ok);
// ⚠ THIS LINE NAMES BOTH DIRECTIONS BECAUSE THE AUDIT NOW CHECKS BOTH. It said only "renames leave no
// phantom" for one commit after the coverage limb landed, which is the failure shape this repo keeps
// hitting: behaviour moved and the prose describing it did not, so the summary understated what had
// been measured. A reader stopping at the verdict would have concluded the inverse direction was still
// unchecked.
console.log(`\n  => ${allOk
  ? 'Renames leave no phantom (no node names a missing file), no tracked indexable file is left '
    + 'without a node, and BOTH detectors are proven able to report their own failure.'
  : '⛔ NOT CLEAN — read the failing arm above.'}`);
process.exit(allOk ? 0 : 1);
