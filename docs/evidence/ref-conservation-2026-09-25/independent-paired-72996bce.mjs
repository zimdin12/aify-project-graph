// Same-process, same-fixture differential at fixed APG 72996bce vs exact parent orchestrator.
// Fixture roots are disposable; no main checkout writes. Reports eight specifically emitted refs.
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const fixedRoot = 'C:/Users/Administrator/AppData/Local/hermes/cache/scratch/apg-ref-review-fixed-20260926';
const oldRoot = 'C:/Users/Administrator/AppData/Local/hermes/cache/scratch/apg-ref-review-20260926';
const load = (root, p) => import(pathToFileURL(join(root, p)).href);
const { ensureFresh: fixed } = await load(fixedRoot, 'mcp/stdio/freshness/orchestrator.js');
const { ensureFresh: reverted } = await load(oldRoot, 'mcp/stdio/freshness/orchestrator.js');
const { openDb } = await load(fixedRoot, 'mcp/stdio/storage/db.js');
const { extractFile } = await load(fixedRoot, 'mcp/stdio/ingest/extractors/generic.js');
const { getLanguageConfig } = await load(fixedRoot, 'mcp/stdio/ingest/languages/index.js');
const git = (r, ...args) => execFileSync('git', ['-C', r, ...args], { encoding: 'utf8' }).trim();
const paths = [];
const src = (r, f) => join(r, 'src', f);
async function init(prefix) {
  const r = await mkdtemp(join(tmpdir(), prefix)); paths.push(r);
  await mkdir(join(r, 'src'));
  git(r, 'init', '-q'); git(r, 'config', 'user.name', 'review'); git(r, 'config', 'user.email', 'review@example.invalid');
  await writeFile(join(r, '.gitignore'), '.aify-graph/\n');
  await writeFile(src(r, 'inner.js'), 'export function inner() { return 1; }\n');
  await writeFile(src(r, 'middle.js'), "import { inner } from './inner.js';\nexport function middle() { return inner() + 1; }\n");
  for (const n of ['outerA', 'outerB', 'outerC']) {
    await writeFile(src(r, `${n}.js`), `import { middle } from './middle.js';\nexport function ${n}() { return middle() + 1; }\n`);
  }
  git(r, 'add', '-A'); git(r, 'commit', '-qm', 'baseline');
  return r;
}
async function edit(r) {
  await writeFile(src(r, 'inner.js'), 'export function inner() { return 1; }\nexport function innerTwo() { return 2; }\n');
  git(r, 'add', '-A'); git(r, 'commit', '-qm', 'structural edit');
}
const population = ['outerA', 'outerB', 'outerC', 'middle'].flatMap((name) => {
  const target = name === 'middle' ? 'inner' : 'middle';
  return [{ file: `src/${name}.js`, relation: 'IMPORTS', target, role: 'file' },
          { file: `src/${name}.js`, relation: 'CALLS', target, role: 'symbol' }];
});
async function audit(repo, label) {
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  const manifest = JSON.parse(await readFile(join(repo, '.aify-graph', 'manifest.json'), 'utf8'));
  try {
    const rows = [];
    for (const s of population) {
      const source = await readFile(join(repo, s.file), 'utf8');
      const refs = extractFile({ filePath: s.file, source, config: getLanguageConfig(s.file) }).refs;
      const expected = s.role === 'file' ? `src/${s.target}.js` : s.target;
      const emitted = refs.filter((x) => x.relation === s.relation && x.target === expected);
      if (emitted.length !== 1) throw Error(`${label}: wrong extractor population for ${s.file}/${s.relation}: ${emitted.length}`);
      const edges = db.all(`SELECT n.label, n.file_path, n.type FROM edges e JOIN nodes n ON e.to_id=n.id
        WHERE e.source_file=? AND e.relation=? AND n.file_path=?`, [s.file, s.relation, `src/${s.target}.js`]);
      const matched = edges.filter((e) => s.role === 'file' ? e.type === 'File' : e.label === s.target);
      const unresolved = db.all('SELECT target FROM unresolved_refs WHERE source_file=? AND relation=?', [s.file, s.relation])
        .filter((u) => u.target === expected);
      rows.push({ ...s, emitted: emitted.length, edge: matched.length, unresolved: unresolved.length,
        verdict: matched.length ? 'EDGE' : unresolved.length ? 'UNRESOLVED' : 'LOST' });
    }
    const result = { label, tree: git(repo, 'rev-parse', 'HEAD^{tree}'), head: git(repo, 'rev-parse', 'HEAD'),
      indexed: manifest.commit, generation: manifest.generation,
      innerTwo: db.all("SELECT id FROM nodes WHERE label='innerTwo' AND file_path='src/inner.js'").length,
      rows };
    console.log(JSON.stringify(result));
    if (!result.indexed || !result.head.startsWith(result.indexed.slice(0, 10))) throw Error(`${label}: stale graph`);
    return result;
  } finally { db.close(); }
}
const nEdges = (a) => a.rows.filter((r) => r.verdict === 'EDGE').length;
const nLost = (a) => a.rows.filter((r) => r.verdict === 'LOST').length;
try {
  const roots = [await init('apg-paired-fixed-'), await init('apg-paired-reverted-'), await init('apg-paired-full-')];
  const [f, r, c] = roots;
  if (new Set(roots.map((x) => git(x, 'rev-parse', 'HEAD^{tree}'))).size !== 1) throw Error('baseline trees differ');
  await fixed({ repoRoot: f });
  await reverted({ repoRoot: r });
  const bf = await audit(f, 'FIXED_BASELINE');
  const br = await audit(r, 'REVERTED_BASELINE');
  await Promise.all(roots.map(edit));
  if (new Set(roots.map((x) => git(x, 'rev-parse', 'HEAD^{tree}'))).size !== 1) throw Error('edited trees differ');
  await fixed({ repoRoot: f });
  await reverted({ repoRoot: r });
  const af = await audit(f, 'FIXED_AFTER');
  const ar = await audit(r, 'REVERTED_AFTER');
  await fixed({ repoRoot: c, force: true });
  const ac = await audit(c, 'FULL_SAME_TREE');
  if ([bf, br, af, ar, ac].some((x) => x.rows.some((v) => v.emitted !== 1 || v.edge > 1 || v.unresolved > 0))) throw Error('unexpected ref population');
  if ([bf, br, af, ar, ac].some((x) => x.tree !== bf.tree && x.tree !== af.tree)) throw Error('tree changed unexpectedly');
  if ([bf, br].some((x) => x.tree !== bf.tree || x.innerTwo !== 0 || nEdges(x) !== 8)) throw Error('baseline control failed');
  if ([af, ar, ac].some((x) => x.tree !== af.tree || x.innerTwo !== 1)) throw Error('structural edit control failed');
  if (af.generation <= bf.generation || ar.generation <= br.generation) throw Error('incremental generation did not advance');
  if (nEdges(af) !== 8 || nEdges(ar) !== 2 || nEdges(ac) !== 8 || nLost(ar) !== 6) throw Error('differential or rebuild control failed');
  if (JSON.stringify(af.rows) !== JSON.stringify(ac.rows)) throw Error('fixed vs full row mismatch');
  // Observer negative control on the same full-build fixture after all positive evidence is frozen.
  const db = openDb(join(c, '.aify-graph', 'graph.sqlite'));
  try {
    const removed = db.run(`DELETE FROM edges WHERE relation='CALLS' AND source_file='src/middle.js'
      AND to_id IN (SELECT id FROM nodes WHERE label='inner' AND file_path='src/inner.js')`);
    if (removed.changes !== 1) throw Error(`wrong injected loss count ${removed.changes}`);
  } finally { db.close(); }
  const neg = await audit(c, 'DELIBERATE_ONE_EDGE_LOSS');
  const lost = neg.rows.filter((x) => x.verdict === 'LOST');
  if (nEdges(neg) !== 7 || lost.length !== 1 || lost[0].file !== 'src/middle.js' || lost[0].relation !== 'CALLS') throw Error('auditor did not detect planted loss');
  console.log(JSON.stringify({ verdict: 'PAIRED_DIFFERENTIAL_AND_CONTROLS_PASS', fixedEdges: 8, revertedEdges: 2,
    cleanEdges: 8, revertedLost: 6, unresolved: 0, plantedLossDetected: 1,
    scope: 'eight exact emitted refs in five-file synthetic history; does not certify all refs or historical cause' }));
} finally { for (const p of paths) await rm(p, { recursive: true, force: true }); }
