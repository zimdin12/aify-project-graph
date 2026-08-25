// ONE POPULATION RENDERER, USED BY EVERY graph_whereis OUTPUT ROUTE.
//
// ⛔ THE ENUMERATE-EVERY-EMITTER MISS, AGAIN, IN THE FIX FOR THE PREVIOUS ONE. The efficacy
// pilot found that an uncapped compact result stated no population. I fixed the compact route
// and shipped it. the reviewer then executed the OTHER routes:
//
//   expand=true, population=1  -> only "NODE ..." — no count, no predicate. The exact gap the
//                                 pilot found, alive in a public mode.
//   expand=true, population>1  -> "EXPANDED 1 OF N definitions" — a count with no basis.
//   capped compact             -> "SHOWING N OF M ... full set" — also no basis.
//
// ★ Their rule, and it is right: if the basis is load-bearing for the uncapped route it is
// load-bearing for the capped and expanded routes too. Three routes had three disclosures and
// one silence; the fix was applied to the one I was looking at.
//
// ⚠ AND THE PREDICATE MATTERS MORE THAN THE NUMBER. The count is over nodes whose EXACT LABEL
// matches, among DECLARATION types, IN THIS GRAPH SNAPSHOT. It is not a claim about the
// repository. The controls below prove what does and does not enter M — testing only that the
// words appear would pass on a renderer that counted the wrong set.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphWhereis } from '../../../mcp/stdio/query/verbs/whereis.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

async function repo({ decls = 0, sameLabelOtherType = 0, nearLabelSearchType = 0 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'apg-wpr-'));
  await mkdir(join(dir, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(dir, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0, schemaVersion: 4,
    extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(dir, '.aify-graph', 'graph.sqlite'));
  const ins = (id, type, label, file) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ('${id}','${type}','${label}','${file}',1,2,'js',1,'{}')`);
  for (let i = 0; i < decls; i += 1) ins(`d${i}`, 'Function', 'detect', `src/d${i}.js`);
  // CONTROL: same label, NOT a declaration type. Must not enter the population.
  for (let i = 0; i < sameLabelOtherType; i += 1) ins(`o${i}`, 'File', 'detect', `src/o${i}.js`);
  // CONTROL: a declaration type whose label merely CONTAINS the query. Must not enter it either.
  for (let i = 0; i < nearLabelSearchType; i += 1) ins(`n${i}`, 'Function', 'detectWsl', `src/n${i}.js`);
  db.close();
  return dir;
}

const BASIS = /exact label|declaration/i;

describe('every graph_whereis route states the population and its basis', () => {
  it('★★★ expand=true with ONE definition — the route that said nothing at all', async () => {
    repoRoot = await repo({ decls: 1 });
    const out = await graphWhereis({ repoRoot, symbol: 'detect', limit: 50, expand: true });
    expect(out, 'the pilot gap, alive in expand mode').toMatch(/1 of 1/);
    expect(out, 'and the basis must travel with it').toMatch(BASIS);
  }, 20_000);

  it('★★★ expand=true with MANY definitions — a count with no basis', async () => {
    repoRoot = await repo({ decls: 7 });
    const out = await graphWhereis({ repoRoot, symbol: 'detect', limit: 50, expand: true });
    expect(out, 'expand details the first match; the population is still 7').toMatch(/1 of 7/);
    expect(out).toMatch(BASIS);
  }, 20_000);

  it('★★★ the CAPPED compact route carries the basis too', async () => {
    repoRoot = await repo({ decls: 12 });
    const out = await graphWhereis({ repoRoot, symbol: 'detect', limit: 5 });
    // ⚠ Case-insensitive deliberately: the capped route renders "SHOWING 5 OF 12" and an older
    // regression pins that exact uppercase form. The property under test is that the count and
    // its basis are present, not how the words are capitalised — asserting the casing here would
    // pin a second, conflicting spelling of the same fact.
    expect(out).toMatch(/5 of 12/i);
    expect(out, 'if the basis is load-bearing uncapped it is load-bearing capped').toMatch(BASIS);
    expect(out, 'and the escape hatch must survive').toMatch(/limit=12/);
  }, 20_000);

  it('★★★ the UNCAPPED compact route — no regression', async () => {
    repoRoot = await repo({ decls: 10 });
    const out = await graphWhereis({ repoRoot, symbol: 'detect', limit: 50 });
    expect(out).toMatch(/10 of 10/);
    expect(out).toMatch(BASIS);
  }, 20_000);

  it('★★★ CONTROL: a same-label non-declaration node does NOT enter the population', async () => {
    // Without this, a renderer that counted every node with the label would pass every test
    // above while reporting a number that means something else.
    repoRoot = await repo({ decls: 3, sameLabelOtherType: 4 });
    const out = await graphWhereis({ repoRoot, symbol: 'detect', limit: 50 });
    expect(out, 'File nodes share the label but are not declarations').toMatch(/3 of 3/);
    expect(out).not.toMatch(/of 7/);
  }, 20_000);

  it('★★★ CONTROL: a near-label declaration does NOT enter the population', async () => {
    // "detectWsl" is a declaration and contains the query. Exact-label means exact.
    repoRoot = await repo({ decls: 3, nearLabelSearchType: 5 });
    const out = await graphWhereis({ repoRoot, symbol: 'detect', limit: 50 });
    expect(out).toMatch(/3 of 3/);
    expect(out).not.toMatch(/of 8/);
  }, 20_000);

  it('★★★ the claim is about THIS GRAPH, not about the repository', async () => {
    // ⚠ The distinction the reviewer drew, and the one that decides whether this attestation
    // can ever remove a reader's need to check source: the count is over indexed nodes. A
    // definition the extractor never saw is not in it, and the sentence must not imply it is.
    repoRoot = await repo({ decls: 4 });
    const out = await graphWhereis({ repoRoot, symbol: 'detect', limit: 50 });
    expect(out, 'the population is the graph, and must say so').toMatch(/graph|index/i);
    expect(out, 'and must not claim the repository').not.toMatch(/every definition in (the )?repo/i);
  }, 20_000);
});
