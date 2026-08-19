// THE RANKER ONLY EVER SAW AN ARBITRARY SAMPLE.
//
// ⛔ graph-senior-dev, 2026-08-19, reviewing a different question: `search.js` selects its
// candidate page with `SELECT * FROM nodes WHERE label LIKE $q LIMIT 200` and **no ORDER BY**,
// then scores in JS — where a code-typed node earns +1000. So the +1000 can only be awarded to
// whatever 200 rows storage order happened to hand over.
//
// ★ MEASURED on this repo's own graph before the fix:
//     query "e" — 3593 matches, 1577 code-typed, 138 inside the 200-row page, 1439 DISPLACED
//     query "a" — 2675 matches, 1157 code-typed, 155 inside the page, 1002 DISPLACED
//     query "s" — 3013 matches, 1106 code-typed, 122 inside the page,  984 DISPLACED
// 91% of the code results the ranker exists to promote were removed before it ran.
//
// ⚠ THE EXISTING DISCLOSURE IS TRUE AND STILL MISLEADS. It says results are "a FLOOR, not a
// complete match set", which sounds like "there are more of these below". What actually
// happened is that the page was chosen by rowid and the ranking is a ranking OF AN ARBITRARY
// SAMPLE. A reader told "floor" concludes the top hits are the best ones; they are the best of
// a sample nobody chose. That is the cap-as-total defect wearing a ranking.
//
// ⇒ THE PAGE MUST BE SELECTED BY THE SAME PRIORITY THE SCORER APPLIES. Ordering the SQL by the
// scorer's dominant term is what makes the two agree; a bigger cap would not — it would move
// the boundary and keep the arbitrariness. Displacement WITHIN the code tier remains possible
// and is still disclosed, because this narrows the defect rather than removing it.
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

// 400 filler nodes inserted FIRST, so rowid order buries the code node past the 200 cap.
// The needle is the last row: any selection that is not priority-ordered misses it.
//
// ⚠ THE FILLER TYPE IS LOAD-BEARING AND MY FIRST VERSION GOT IT WRONG. I used `External`, which
// the default kind='code' filter already excludes in SQL — so the fixture never filled the page
// and the test passed against the unfixed code. `Module` and `File` are NOT excluded (525 and
// 527 of them in this repo's own graph), so they are what actually crowds Functions out.
// Same apparatus error as the probe that produced the measurement: measuring a population the
// verb does not query.
async function repoWithBuriedFunction() {
  const repo = await mkdtemp(join(tmpdir(), 'apg-cap-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 401, edges: 0, schemaVersion: 4,
    extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  for (let i = 0; i < 400; i += 1) {
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('n${i}','Module','widgetRef${i}','src/m${i}.js',0,0,'javascript',1,'{}')`);
  }
  db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
          VALUES ('needle','Function','widgetBuilder','src/w.js',10,20,'javascript',1,'{}')`);
  db.close();
  return repo;
}

describe('graph_search candidate page', () => {
  it('★★★ a code-typed match is not lost to storage order before scoring runs', async () => {
    repoRoot = await repoWithBuriedFunction();
    // Substring query, so this takes the broad LIKE path rather than the exact-name fast path.
    const out = await graphSearch({ repoRoot, query: 'widget' });
    expect(out, 'the ranker awards +1000 to code types; it never saw this one')
      .toMatch(/widgetBuilder/);
  }, 20_000);

  it('★★★ the exact-name fast path is untouched by the ordering change', async () => {
    // The control. Exact-name lookup must not change behaviour, or the fix has reached past
    // the defect into a route that was already correct.
    repoRoot = await repoWithBuriedFunction();
    const out = await graphSearch({ repoRoot, query: 'widgetBuilder' });
    expect(out).toMatch(/widgetBuilder/);
  }, 20_000);

  it('★★★ truncation is still disclosed — narrowing the defect is not removing it', async () => {
    // Displacement WITHIN the code tier is still possible, so the cap note must survive. A fix
    // that quietly deleted the warning would trade a known limit for an unknown one.
    repoRoot = await repoWithBuriedFunction();
    const out = await graphSearch({ repoRoot, query: 'widget' });
    expect(out, 'the candidate cap is still real and must still be stated').toMatch(/candidate cap|FLOOR/);
  }, 20_000);
});
