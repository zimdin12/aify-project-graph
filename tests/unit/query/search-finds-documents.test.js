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
