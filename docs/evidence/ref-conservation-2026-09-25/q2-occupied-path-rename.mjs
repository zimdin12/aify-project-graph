// Q2 — RENAME ONTO AN OCCUPIED PATH. `git mv -f src/a.js src/b.js` where b.js ALREADY EXISTS.
//
// Asked by dashboard-manager: "A rename onto an occupied name is where I expect the conserved-count
// arithmetic to be right and the graph to be wrong — the counts add up because two symbols' references
// merged, and every assertion passes."
//
// Never run in this repo. Six `git mv` calls in the rename audit: four to a fresh name, one case-only,
// one parent-directory. So nothing is known about this case.
//
// ⛔ THE DISCRIMINATING ASSERTION IS NOT A COUNT. After `git mv -f a.js b.js`, b.js holds a.js's BYTES,
// so b.js must define ONLY a.js's symbol. If the two files' node sets merged, b.js defines BOTH — a
// stale symbol attributed to a file that no longer defines it — and any total stays plausible.
//
// Absolute expectations, never a differential against a forced rebuild: if resolution merges them, BOTH
// paths merge them identically and a differential is green by construction (the defect found in the
// rename audit's arms A-F today).
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const load = (...p) => import(pathToFileURL(path.join(REPO, ...p)).href);
const { ensureFresh } = await load('mcp', 'stdio', 'freshness', 'orchestrator.js');
const { openDb } = await load('mcp', 'stdio', 'storage', 'db.js');

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
const commitAll = (repo, msg) => { git(repo, 'add', '-A'); git(repo, 'commit', '-qm', msg); };
const dbOf = (repo) => path.join(repo, '.aify-graph', 'graph.sqlite');

function symbolsByFile(dbPath) {
  const db = openDb(dbPath);
  try {
    const rows = db.all(
      `SELECT file_path AS f, label AS l, type AS t FROM nodes
       WHERE file_path LIKE 'src/%' AND type <> 'File' ORDER BY f, l`,
    );
    const out = {};
    for (const r of rows) (out[r.f] ??= []).push(r.l);
    return out;
  } finally { db.close(); }
}
function filesInGraph(dbPath) {
  const db = openDb(dbPath);
  try {
    return db.all("SELECT DISTINCT file_path AS f FROM nodes WHERE file_path LIKE 'src/%' ORDER BY f")
      .map((r) => r.f);
  } finally { db.close(); }
}
function importPairs(dbPath) {
  const db = openDb(dbPath);
  try {
    return db.all(
      `SELECT e.source_file AS s, n.file_path AS d FROM edges e JOIN nodes n ON n.id = e.to_id
       WHERE e.relation = 'IMPORTS' ORDER BY s, d`,
    ).map((r) => `${r.s} -> ${r.d}`);
  } finally { db.close(); }
}

async function build() {
  const repo = await mkdtemp(path.join(tmpdir(), 'apg-q2-'));
  await mkdir(path.join(repo, 'src'), { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.name', 'q2');
  git(repo, 'config', 'user.email', 'q2@example.invalid');
  await writeFile(path.join(repo, '.gitignore'), '.aify-graph/\n');
  await writeFile(path.join(repo, 'src', 'a.js'), 'export function fa() { return 1; }\n');
  await writeFile(path.join(repo, 'src', 'b.js'), 'export function fb() { return 2; }\n');
  await writeFile(path.join(repo, 'src', 'refA.js'),
    "import { fa } from './a.js';\nexport function refA() { return fa(); }\n");
  await writeFile(path.join(repo, 'src', 'refB.js'),
    "import { fb } from './b.js';\nexport function refB() { return fb(); }\n");
  commitAll(repo, 'baseline: a.js defines fa, b.js defines fb');
  return repo;
}

const inc = await build();
const full = await build();
let failures = 0;
const fail = (m) => { failures += 1; console.log('  ⛔ ' + m); };

try {
  await ensureFresh({ repoRoot: inc });
  const baseSyms = symbolsByFile(dbOf(inc));
  const baseFiles = filesInGraph(dbOf(inc));
  const basePairs = importPairs(dbOf(inc));

  console.log('='.repeat(94));
  console.log('Q2: rename ONTO AN OCCUPIED PATH — git mv -f src/a.js src/b.js (b.js already exists)');
  console.log('='.repeat(94));
  console.log('  BASELINE files   : ' + JSON.stringify(baseFiles));
  console.log('  BASELINE symbols : ' + JSON.stringify(baseSyms));
  console.log('  BASELINE pairs   : ' + JSON.stringify(basePairs));
  // POSITIVE CONTROL: both files and both symbols must be there, or the arm proves nothing.
  const baseOk = baseFiles.includes('src/a.js') && baseFiles.includes('src/b.js')
    && (baseSyms['src/a.js'] ?? []).includes('fa') && (baseSyms['src/b.js'] ?? []).includes('fb');
  console.log('  POSITIVE  a.js/fa and b.js/fb both present at baseline: ' + (baseOk ? 'YES' : 'NO'));
  if (!baseOk) fail('baseline does not contain the confounder; every verdict below is void');

  // THE MUTATION: overwrite an occupied path.
  for (const repo of [inc, full]) {
    git(repo, 'mv', '-f', 'src/a.js', 'src/b.js');
    commitAll(repo, 'rename a.js ONTO the existing b.js');
  }
  await ensureFresh({ repoRoot: inc });
  await ensureFresh({ repoRoot: full, force: true });

  const incSyms = symbolsByFile(dbOf(inc));
  const incFiles = filesInGraph(dbOf(inc));
  const incPairs = importPairs(dbOf(inc));
  const fullSyms = symbolsByFile(dbOf(full));

  console.log('');
  console.log('  AFTER files      : ' + JSON.stringify(incFiles));
  console.log('  AFTER symbols    : ' + JSON.stringify(incSyms));
  console.log('  AFTER pairs      : ' + JSON.stringify(incPairs));
  console.log('  REBUILD symbols  : ' + JSON.stringify(fullSyms));
  console.log('');

  // 1. the overwritten source path must be GONE from the graph.
  if (incFiles.includes('src/a.js')) fail('src/a.js still in the graph — the deleted path was not removed');
  else console.log('  ok  src/a.js is gone from the graph');

  // 2. ⛔ THE DISCRIMINATOR: b.js now holds a.js BYTES, so it must define fa and NOT fb.
  const bSyms = incSyms['src/b.js'] ?? [];
  if (!bSyms.includes('fa')) fail("src/b.js does not define 'fa' — the moved content was not extracted");
  if (bSyms.includes('fb')) {
    fail("src/b.js STILL defines 'fb' — TWO FILES' SYMBOL SETS MERGED. A stale symbol is attributed to a "
      + 'file that no longer defines it, and every count stays plausible.');
  } else if (bSyms.includes('fa')) {
    console.log("  ok  src/b.js defines only 'fa' — the symbol sets did NOT merge");
  }

  // ⛔ 3. REF CONSERVATION FOR THE NOW-DANGLING IMPORT. refA.js STILL CONTAINS `import ... from './a.js'`
  // and a.js no longer exists. That ref must be SOMEWHERE — an unresolved_refs row — or it was lost
  // silently, which is the exact failure conservation exists to catch. A clean symbol-merge result says
  // nothing about this.
  const unresolved = (() => {
    const db = openDb(dbOf(inc));
    try {
      return db.all('SELECT source_file AS s, relation AS r, target AS t FROM unresolved_refs ORDER BY s, t')
        .map((x) => `${x.s} ${x.r} ${x.t}`);
    } finally { db.close(); }
  })();
  console.log('  UNRESOLVED       : ' + JSON.stringify(unresolved));
  const refAHeld = unresolved.some((u) => u.startsWith('src/refA.js ') && u.includes('a.js'));
  if (!refAHeld) {
    fail("refA.js still imports './a.js' but the ref is in NEITHER edges NOR unresolved_refs — a ref "
      + 'emitted by source with no record anywhere. That is a silent loss.');
  } else {
    console.log("  ok  refA.js's dangling './a.js' import is retained as an unresolved ref, not dropped");
  }

  // 4. did the incremental and the rebuild agree? Reported, never used as the pass condition.
  const agree = JSON.stringify(incSyms) === JSON.stringify(fullSyms);
  console.log('  info incremental agrees with forced rebuild: ' + agree
    + '  (reported, NOT the pass condition — both paths can be wrong identically)');

  // ⛔⛔ THE PROBE'S OWN CONTROL — because a CLEAN result from an instrument nobody has watched fire is
  // indistinguishable from a blind one. The merge check above is the whole point of this probe, so the
  // merged state is PLANTED IN THE ARTIFACT and the check must report it.
  const merged = (() => {
    const db = openDb(dbOf(inc));
    try {
      db.run(`INSERT INTO nodes (id, type, label, file_path, start_line, end_line)
              VALUES ('planted-fb', 'Symbol', 'fb', 'src/b.js', 1, 1)`);
    } finally { db.close(); }
    return (symbolsByFile(dbOf(inc))['src/b.js'] ?? []);
  })();
  const wouldFire = merged.includes('fb') && merged.includes('fa');
  console.log('');
  console.log("  SELF-CONTROL  planted 'fb' back onto src/b.js: " + JSON.stringify(merged));
  console.log('  SELF-CONTROL  the merge discriminator WOULD have fired: '
    + (wouldFire ? 'YES — the clean result above is a real negative' : '⛔ NO — the clean result is VOID'));
  if (!wouldFire) fail('the merge check cannot detect a merged symbol set, so it cannot report an unmerged one');

  console.log('');
  console.log(failures === 0 ? 'VERDICT: 0 failures — occupied-path rename is CLEAN'
    : `VERDICT: ${failures} FAILURE(S)`);
} finally {
  await rm(inc, { recursive: true, force: true });
  await rm(full, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
