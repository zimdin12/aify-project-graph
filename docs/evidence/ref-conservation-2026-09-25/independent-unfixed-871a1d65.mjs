// Independent bounded conservation witness against APG 871a1d65 (no main-checkout edits).
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const APG = 'C:/Users/Administrator/AppData/Local/hermes/cache/scratch/apg-ref-review-20260926';
const mod = (p) => import(pathToFileURL(join(APG, p)).href);
const { ensureFresh } = await mod('mcp/stdio/freshness/orchestrator.js');
const { openDb } = await mod('mcp/stdio/storage/db.js');
const { extractFile } = await mod('mcp/stdio/ingest/extractors/generic.js');
const { getLanguageConfig } = await mod('mcp/stdio/ingest/languages/index.js');
const git = (r, ...args) => execFileSync('git', ['-C', r, ...args], { encoding: 'utf8' }).trim();
const out = (r, f) => join(r, 'src', f);
const paths = [];
async function init(prefix) {
  const r = await mkdtemp(join(tmpdir(), prefix)); paths.push(r);
  await mkdir(join(r, 'src'));
  git(r, 'init', '-q'); git(r, 'config', 'user.name', 'review'); git(r, 'config', 'user.email', 'review@example.invalid');
  await writeFile(join(r, '.gitignore'), '.aify-graph/\n');
  await writeFile(out(r, 'inner.js'), 'export function inner() { return 1; }\n');
  await writeFile(out(r, 'middle.js'), "import { inner } from './inner.js';\nexport function middle() { return inner() + 1; }\n");
  for (const n of ['outerA', 'outerB', 'outerC']) {
    await writeFile(out(r, `${n}.js`), `import { middle } from './middle.js';\nexport function ${n}() { return middle() + 1; }\n`);
  }
  git(r, 'add', '-A'); git(r, 'commit', '-qm', 'baseline');
  return r;
}
async function edit(r) {
  await writeFile(out(r, 'inner.js'), 'export function inner() { return 1; }\nexport function innerTwo() { return 2; }\n');
  git(r, 'add', '-A'); git(r, 'commit', '-qm', 'structural edit');
}
const states = ['outerA', 'outerB', 'outerC', 'middle'].flatMap((name) => {
  const target = name === 'middle' ? 'inner' : 'middle';
  return [{ file: `src/${name}.js`, relation: 'IMPORTS', target, role: 'file' },
          { file: `src/${name}.js`, relation: 'CALLS', target, role: 'symbol' }];
});
async function audit(repo, label) {
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  const manifest = JSON.parse(await readFile(join(repo, '.aify-graph', 'manifest.json'), 'utf8'));
  try {
    const emits = [];
    const rows = [];
    for (const s of states) {
      const source = await readFile(join(repo, s.file), 'utf8');
      const extracted = extractFile({ filePath: s.file, source, config: getLanguageConfig(s.file) }).refs;
      const expectation = s.role === 'file' ? `src/${s.target}.js` : s.target;
      const matching = extracted.filter((x) => x.relation === s.relation && x.target === expectation);
      if (matching.length !== 1) throw Error(`bad emitted population ${label} ${s.file} ${s.relation}: ${matching.length}`);
      emits.push({ file: s.file, relation: s.relation, target: matching[0].target });
      const edges = db.all(`SELECT n.label, n.file_path, n.type FROM edges e JOIN nodes n ON e.to_id=n.id
        WHERE e.source_file=? AND e.relation=? AND n.file_path=?`,
        [s.file, s.relation, `src/${s.target}.js`]);
      // File imports resolve to File endpoints; calls resolve to exact named symbol endpoints.
      const matched = edges.filter((e) => s.role === 'file' ? e.type === 'File' : e.label === s.target);
      const unresolved = db.all('SELECT target FROM unresolved_refs WHERE source_file=? AND relation=?', [s.file, s.relation])
        .filter((u) => u.target === expectation);
      rows.push({ ...s, emittedTarget: matching[0].target, emitted: matching.length, edge: matched.length, unresolved: unresolved.length,
        verdict: matched.length ? 'EDGE' : unresolved.length ? 'UNRESOLVED' : 'LOST' });
    }
    const innerTwo = db.all("SELECT id FROM nodes WHERE label='innerTwo' AND file_path='src/inner.js'").length;
    const r = { label, head: git(repo, 'rev-parse', 'HEAD'), tree: git(repo, 'rev-parse', 'HEAD^{tree}'), indexed: manifest.commit,
      generation: manifest.generation, innerTwo, rows };
    console.log(JSON.stringify(r));
    if (!r.indexed || !r.head.startsWith(r.indexed.slice(0, 10))) throw Error(`${label}: graph not current`);
    return r;
  } finally { db.close(); }
}
try {
  const incremental = await init('apg-conservation-inc-');
  const clean = await init('apg-conservation-full-');
  await ensureFresh({ repoRoot: incremental });
  const baseline = await audit(incremental, 'BASELINE');
  await edit(incremental); await edit(clean);
  await ensureFresh({ repoRoot: incremental });
  const after = await audit(incremental, 'INCREMENTAL_AFTER_STRUCTURAL_EDIT');
  await ensureFresh({ repoRoot: clean, force: true });
  const rebuilt = await audit(clean, 'FULL_SAME_HISTORY');
  if (after.tree !== rebuilt.tree) throw Error('the final file trees differ; cannot compare the arms');
  if (after.innerTwo !== 1 || baseline.innerTwo !== 0 || after.generation <= baseline.generation) throw Error('action control failed: edited inner was not re-extracted');
  if (baseline.rows.some((r) => r.verdict !== 'EDGE') || rebuilt.rows.some((r) => r.verdict !== 'EDGE')) throw Error('positive control failed');
  // Strong negative control: remove one known-good edge in disposable rebuilt graph, leaving no unresolved row.
  const db = openDb(join(clean, '.aify-graph', 'graph.sqlite'));
  try {
    const n = db.run(`DELETE FROM edges WHERE relation='CALLS' AND source_file='src/middle.js'
      AND to_id IN (SELECT id FROM nodes WHERE label='inner' AND file_path='src/inner.js')`);
    if (n.changes !== 1) throw Error(`negative control did not delete exactly one edge: ${n.changes}`);
  } finally { db.close(); }
  const negative = await audit(clean, 'NEGATIVE_CONTROL_MUTATED_DISPOSABLE_DB');
  const lost = negative.rows.filter((r) => r.verdict === 'LOST');
  if (lost.length !== 1 || lost[0].file !== 'src/middle.js' || lost[0].relation !== 'CALLS') throw Error('negative control failed to detect intentional loss');
  console.log(JSON.stringify({ verdict: 'CONTROLS_VALID', baselineEdges: baseline.rows.length,
    afterLost: after.rows.filter((r) => r.verdict === 'LOST').length,
    afterUnresolved: after.rows.filter((r) => r.verdict === 'UNRESOLVED').length,
    cleanEdges: rebuilt.rows.length, negativeDetected: lost.length,
    scope: 'eight exact refs emitted by extractor in five-file fixture, not all APG refs' }));
} finally {
  for (const p of paths) await rm(p, { recursive: true, force: true });
}
