// "WHERE IS THE DESIGN DOC" — THE QUESTION AN AGENT ASKS AFTER COMPACTION.
//
// ⛔ Steven's case, 2026-08-19: an agent that had worked a project for two months asked where
// the game design doc was. It had read that doc many times; compaction erased that it existed
// at all. That is not a lookup, it is a DISCOVERY question — and grep cannot help you find
// something you do not know to search for. The published measurements that put grep at 100% on
// symbol localization all presuppose you know the symbol.
//
// ⇒ Measured on this repo before the fix, and both halves failed:
//   graph_search("design doc", kind:"all")  -> NO RESULTS. A two-word natural query can never
//     match, because the predicate is a single LIKE over `label`, and no file is named
//     "design doc".
//   graph_search("plan", kind:"all", limit:5) -> five FUNCTIONS. The eleven `docs/*plan*.md`
//     files rank 22 through 32, because code types earn +1000 in the scorer. At the default
//     limit the caller never sees one.
//
// ★ THE SECOND IS THE SHARPER DEFECT. `kind:"all"` is the caller explicitly asking to include
// docs. Including them and then ranking every one below every function is inclusion the reader
// cannot reach — the same shape as a cap reported as a population.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphSearch } from '../../../mcp/stdio/query/verbs/search.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

// A repo shaped like the real problem: many functions whose names contain the query word, and
// one document that is the thing the agent is actually looking for.
async function repoWithDocAndNoise() {
  const repo = await mkdtemp(join(tmpdir(), 'apg-doc-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 31, edges: 0, schemaVersion: 4,
    extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  for (let i = 0; i < 30; i += 1) {
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('f${i}','Function','buildDesignThing${i}','src/f${i}.js',1,2,'javascript',1,'{}')`);
  }
  db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
          VALUES ('d1','Document','game-design.md','docs/game-design.md',1,1,'markdown',1,'{}')`);
  db.close();
  return repo;
}

describe('finding a document you forgot existed', () => {
  it('★★★ a multi-word query finds the doc — filenames are not phrases', async () => {
    repoRoot = await repoWithDocAndNoise();
    const out = await graphSearch({ repoRoot, query: 'design doc', kind: 'all', limit: 10 });
    expect(out, 'no file is named "design doc"; the tokens must be matched separately')
      .not.toMatch(/NO RESULTS/);
    expect(out).toMatch(/game-design\.md/);
  }, 20_000);

  it('★★★ with kind="all" the doc is REACHABLE at the default limit', async () => {
    // Inclusion the caller cannot reach is not inclusion. Thirty functions match the word too;
    // the document must not sit behind all of them when the caller explicitly widened.
    repoRoot = await repoWithDocAndNoise();
    const out = await graphSearch({ repoRoot, query: 'design', kind: 'all', limit: 5 });
    expect(out, 'the caller asked for docs and got five functions').toMatch(/game-design\.md/);
  }, 20_000);

  it('★★★ the default kind="code" still puts code first — this must not invert', async () => {
    // The control. Widening for an explicit kind="all" must not degrade the ordinary code
    // search, or the fix has traded one wrong ranking for another.
    repoRoot = await repoWithDocAndNoise();
    const out = await graphSearch({ repoRoot, query: 'design', limit: 3 });
    const first = out.split('\n').find((l) => l.startsWith('NODE')) || '';
    expect(first, 'a plain code search still leads with code').toMatch(/function/);
  }, 20_000);
});

// ⭐ THE ONLY QUERY WHERE AN INDEX BEATS `ls docs/`.
//
// The roadmap is explicit that the competitor on discovery is not grep — it is `ls docs/`, which
// finds anything whose NAME carries the topic, costs nothing and needs no index. "Can it find
// game-design.md" is a test `ls` also passes. The index earns its keep on exactly one shape:
// TOPIC -> DOCUMENT WHERE THE FILENAME DOES NOT CONTAIN THE TOPIC.
//
// ⛔ AND THAT WAS THE ONE SHAPE THAT RETURNED NOTHING. `sweep.js` extracts a `title` — the
// document's first heading — onto every text document and writes it into `extra`. All 154
// Document nodes on this repo carry one. Nothing queried it. Measured before the fix:
//
//     graph_search("install guide", kind:"all")   0 hits   (AGENTS.md is titled "Agent install guide")
//     graph_search("verified seams")              0 hits
//     graph_search("attribution")                 3 hits   <- the control: name matching worked fine
//
// 76 of 154 titles (49%) contain a word appearing NOWHERE in the filename or path. The data was
// extracted, stored, and unreachable — the same shape as the doc-link layer, which had good data
// behind a `type='File'` lookup that could never match a Document.
describe('a document is findable by its TITLE, not only by its filename', () => {
  async function repoWithTitledDoc() {
    const repo = await mkdtemp(join(tmpdir(), 'apg-title-'));
    await mkdir(join(repo, '.aify-graph'), { recursive: true });
    execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
    const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit, indexedAt: new Date().toISOString(), nodes: 2, edges: 0, schemaVersion: 4,
      extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    }));
    const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
    // The filename shares NO word with the topic. This is the whole point: `ls` cannot find it.
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('d1','Document','ADR-0007.md','docs/ADR-0007.md',1,1,'markdown',1,
                    '{"title":"Retry policy for flaky downstream calls","summary":"x"}')`);
    // A distractor whose NAME contains a query word, so a passing result cannot be an accident of
    // there being only one node in the graph.
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('f1','Function','retryOnce','src/retry.js',1,2,'javascript',1,'{}')`);
    db.close();
    return repo;
  }

  const nodesIn = (out) => String(out).split('\n').filter((l) => l.startsWith('NODE '));

  it('★★★ a topic that appears ONLY in the title finds the document', async () => {
    repoRoot = await repoWithTitledDoc();
    const out = await graphSearch({ repoRoot, query: 'flaky downstream', kind: 'all', limit: 10 });
    const docs = nodesIn(out).filter((l) => / document /.test(l));
    expect(docs.length, 'the title is the only place these words appear').toBe(1);
    expect(docs[0]).toContain('ADR-0007.md');
  }, 30_000);

  it('★★★ a SINGLE-WORD title query also works — both branches of the predicate', async () => {
    // The multi-token and single-token paths build the match clause separately, and my first fix
    // touched only one of them. A test that exercises one branch cannot see the other.
    repoRoot = await repoWithTitledDoc();
    const out = await graphSearch({ repoRoot, query: 'retry', kind: 'all', limit: 10 });
    const lines = nodesIn(out);
    expect(lines.some((l) => l.includes('ADR-0007.md')), 'title match on one token').toBe(true);
    expect(lines.some((l) => l.includes('retryOnce')), 'and the name match still works').toBe(true);
  }, 30_000);

  it('★★★ a query matching NOTHING still returns nothing — the slot promotes no filler', async () => {
    // ⛔ ef-manager's second probe, and the reason it exists: `kind:"all"` RESERVES page space for
    // widened types, and a reserved slot is a strong incentive to promote something. A discovery
    // surface that answers every question is worse than one that admits it has no answer — the
    // absence-claim defect class, arriving through a ranking feature rather than a query.
    repoRoot = await repoWithTitledDoc();
    const out = await graphSearch({ repoRoot, query: 'quantum entanglement', kind: 'all', limit: 10 });
    expect(nodesIn(out), 'no legitimate answer means no answer').toEqual([]);
  }, 30_000);

  it('★★★ the title match does not fire for the DEFAULT kind, only where docs were asked for', async () => {
    // The control on scope. Widening what a code search returns would trade one wrong behaviour
    // for another, and `kind:"code"` excludes Documents by type regardless of what matched.
    repoRoot = await repoWithTitledDoc();
    const out = await graphSearch({ repoRoot, query: 'flaky downstream', limit: 10 });
    expect(nodesIn(out).filter((l) => / document /.test(l)), 'code search stays a code search')
      .toEqual([]);
  }, 30_000);
});
