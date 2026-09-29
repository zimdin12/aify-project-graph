// Does "indexed" now mean "the graph holds code", or still "a file exists"?
//
// Three sites decided whether indexing happened by the PRESENCE OF A NAMED ARTIFACT
// (`existsSync(.aify-graph/graph.sqlite)`): `linkage-scratch-repo.mjs:isIndexed`, its caller's guard in
// `linkage-scope-runner.mjs`, and `testbed.mjs`'s status row. The shape was named by dashboard-manager,
// 2026-09-29; the correct predicate already existed in the tree at `testbed.mjs:365`.
//
// ⛔ THIS CALLS THE REAL `isIndexed()`, NOT A COPY OF ITS BODY. The first version of this probe
// reimplemented the query in a child-process shim, which would have proved the PREDICATE works while
// saying nothing about whether the METHOD uses it — the distinction that has cost this project several
// rounds. `materialise()` takes one real fixture file, so the real object can be driven through all three
// states with its private `#dir` set the way its own consumers set it.
//
// ⛔ AND THE ARM THAT DECIDES THE PROBE IS WORTH ANYTHING: an EMPTY database file must report NOT
// indexed. A probe that only checked "no file" and "real graph" would pass against the old `existsSync`
// implementation too, and would therefore prove nothing about the change.
import { mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { ScratchRepo } = await import(pathToFileURL(join(REPO, 'scripts', 'lib', 'linkage-scratch-repo.mjs')).href);

const repo = new ScratchRepo({ id: 'probe-indexed', files: ['corpus/normalize.cpp'] }).materialise();
const graphDir = join(repo.dir, '.aify-graph');
const dbPath = join(graphDir, 'graph.sqlite');
let failures = 0;
const check = (label, got, want, note) => {
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok ' : '⛔ '} ${label.padEnd(46)} isIndexed() = ${String(got).padEnd(5)} (want ${want})${note ? `  ${note}` : ''}`);
};

try {
  console.log('Driving the REAL ScratchRepo.isIndexed() through three states:\n');

  // ── STATE 1: no graph at all. The method must say false, and this is also the negative control
  // proving the method can return false for a reason other than the new query.
  check('no .aify-graph directory at all', await repo.isIndexed(), false);

  // ── STATE 2: an EMPTY graph.sqlite. THE CASE THE OLD PREDICATE COULD NOT SEE.
  mkdirSync(graphDir, { recursive: true });
  writeFileSync(dbPath, '');
  const existsSaysYes = existsSync(dbPath);
  check('EMPTY graph.sqlite on disk', await repo.isIndexed(), false,
    `<- existsSync says ${existsSaysYes}, so the OLD implementation returned TRUE here`);

  // ── STATE 3: POSITIVE CONTROL — a real graph. Without this the probe proves only that the method can
  // say false, which a method returning a constant false would also satisfy.
  const realDb = join(REPO, '.aify-graph', 'graph.sqlite');
  if (!existsSync(realDb)) {
    console.log('  ⛔  POSITIVE CONTROL UNAVAILABLE — no graph at this repo, so a constant-false method '
      + 'would pass every arm above. Run graph_index and re-run this probe.');
    failures += 1;
  } else {
    copyFileSync(realDb, dbPath);
    check('a REAL graph copied in', await repo.isIndexed(), true, '<- the method can also say true');
  }

  console.log(`\n=> ${failures === 0
    ? 'PASS — isIndexed() reads the graph. An empty database file no longer counts as indexed.'
    : `⛔ ${failures} arm(s) failed; read them above.`}`);
} finally {
  repo.dispose();
  if (existsSync(repo.dir ?? '')) rmSync(repo.dir, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
