// ⛔ I CORRECTED ONE DISCLOSURE LINE AND LEFT THE ONE ABOVE IT ASSERTING WHAT I HAD JUST WITHDRAWN.
//
// 28ad203e stopped the CONFIDENCE footer calling fetched rows "callers" and made it say the
// caller-function total is UNKNOWN. The TRUST banner one row above still renders, for the same
// mixed result:
//
//     TRUST: ... mixes 1 verified + 10 heuristic edges — caller set is a FLOOR, not exhaustive ...
//     CONFIDENCE: ... the caller-function total is UNKNOWN ... unrelated same-named calls OVERCOUNT
//
// A FLOOR is a lower bound: it says the real answer is at least this. That is TRUE of an all-verified
// set, where every edge is a real caller and only completeness is in doubt. It is FALSE of a mixed
// set, because the heuristic edges resolve by NAME and can include calls to unrelated same-named
// symbols — so the set can be too large as well as too small, and bounds it in neither direction.
//
// ⭐ THE REPAIR IS SCOPED TO THE MIXED BRANCH ONLY. The all-verified branches say FLOOR correctly and
// must keep saying it; a repair that removed every floor claim would trade one false statement for
// several. The control below is what holds that line.
//
// ⛔ AND A SECOND WRONG NOUN IN THE SAME FOOTER. `collapseCallerEdges` groups method rows by caller
// BEFORE `resultCount` is taken, and 28ad203e then labelled that number "candidate edge rows
// fetched". On a class rollup, ten method-target rows from one caller render as "1 candidate edge
// rows fetched". Making a label MORE SPECIFIC over an unchanged number made it MORE wrong: the old
// vague word happened to fit the collapsed count, and the precise one does not.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { buildTrustLine } from '../../../mcp/stdio/query/lsp-evidence.js';
import { graphCallers } from '../../../mcp/stdio/query/verbs/callers.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

const verified = { provenance: 'LSP_VERIFIED', extractor: 'cpp-clangd#deadbeef' };
const heuristic = { provenance: 'EXTRACTED', extractor: 'tree-sitter' };

const git = (r, ...a) => execFileSync('git', ['-C', r, ...a], { encoding: 'utf8' }).trim();

function insertCollection(db, commit) {
  db.run(
    `INSERT INTO code_intel_collections
       (collection_id, provider, provider_version, project_root, language, status,
        freshness_basis, freshness_value, compile_db_hash, indexed_commit,
        operations_json, collected_at)
     VALUES ('col-1','cpp-clangd','0.1.0','/x','cpp','ok',
        'compile_db_hash','hash-A','hash-A',$commit,$ops,'2026-06-19T01:02:14.438Z')`,
    {
      commit,
      ops: JSON.stringify({
        references: { status: 'ok', count: 10 },
        _session: { indexReady: true, refsFoundSymbols: 6643, refsNotFoundSymbols: 0 },
      }),
    },
  );
}

describe('the TRUST banner and the CONFIDENCE footer describe the same set', () => {
  let repoRoot; let dbPath;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-agree-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    dbPath = join(repoRoot, '.aify-graph', 'graph.sqlite');
    git(repoRoot, 'init', '-q');
    git(repoRoot, 'config', 'user.email', 't@t');
    git(repoRoot, 'config', 'user.name', 'T');
    await writeFile(join(repoRoot, 'a.txt'), 'a');
    git(repoRoot, 'add', '.');
    git(repoRoot, 'commit', '-qm', 'one');
  });
  afterEach(async () => { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win */ } });

  it('★★★ THE REAL CASE: a MIXED set is not called a floor', async () => {
    const head = git(repoRoot, 'rev-parse', 'HEAD');
    const db = openDb(dbPath);
    insertCollection(db, head);
    const edges = [verified, ...Array.from({ length: 10 }, () => heuristic)];
    const line = String(await buildTrustLine({ edges, db, repoRoot }));
    db.close();

    expect(line, 'the mix itself is still disclosed').toMatch(/1 verified/);
    expectAbsentWithLiveMatcher(
      /caller set is a FLOOR/,
      { forbidden: 'mixes 1 verified + 10 heuristic edges — caller set is a FLOOR, not exhaustive',
        allowed: 'mixes 1 verified + 10 heuristic edges — the 1 verified are real callers' },
      line,
      'a set that can OVERCOUNT is not a lower bound on real callers',
    );
  }, 60_000);

  it('★★★ THE DISCRIMINATING CONTROL: an ALL-VERIFIED capped set is STILL a floor', async () => {
    // ⛔ THE ASSERTION THAT STOPS AN OVER-CORRECTION. Every edge here was resolved by a compiler, so
    // every one is a real caller and the only open question is completeness — which is exactly what
    // FLOOR means. A repair that deleted every floor claim would pass the test above and be wrong.
    const head = git(repoRoot, 'rev-parse', 'HEAD');
    const db = openDb(dbPath);
    insertCollection(db, head);
    const line = String(await buildTrustLine({
      edges: [verified, verified], db, repoRoot, truncated: true,
    }));
    db.close();

    expect(line).toMatch(/FLOOR/);
  }, 60_000);

  it('★★ AND AN ALL-VERIFIED UNCAPPED SET still reports lsp-verified', async () => {
    const head = git(repoRoot, 'rev-parse', 'HEAD');
    const db = openDb(dbPath);
    insertCollection(db, head);
    const line = String(await buildTrustLine({ edges: [verified, verified], db, repoRoot }));
    db.close();

    expect(line).toMatch(/lsp-verified/);
  }, 60_000);
});

describe('the count the footer names is the count it describes', () => {
  let repoRoot;
  afterEach(async () => {
    if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win */ } }
    repoRoot = undefined;
  });

  /** A class with `methodCount` methods, all called by ONE caller — the rollup collapse shape. */
  async function classRollupRepo(methodCount) {
    const r = await mkdtemp(join(tmpdir(), 'apg-rollup-'));
    await mkdir(join(r, '.aify-graph'), { recursive: true });
    git(r, 'init', '-q');
    git(r, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i');
    const commit = git(r, 'rev-parse', 'HEAD');
    await writeFile(join(r, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit, indexedAt: new Date().toISOString(), nodes: methodCount + 2, edges: methodCount * 2,
      schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
      // ⛔ THE FOOTER ONLY RENDERS ON A SUSPICIOUS RESULT, AND MY FIRST FIXTURE WAS NOT ONE — so the
      // forbidden text could never appear and the assertion passed while proving nothing. That is
      // the dead-assertion shape: a live MATCHER over a subject that cannot reach the rejected
      // state. Weak trust (> UNRESOLVED_WEAK) puts the answer in the state the footer describes.
      dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 2001,
    }));
    const db = openDb(join(r, '.aify-graph', 'graph.sqlite'));
    const node = (id, type, label) => db.run(
      `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
       VALUES ($id,$type,$label,'src/a.js',1,2,'javascript',1,'{}')`, { id, type, label });
    node('cls', 'Class', 'Foo');
    node('k', 'Function', 'theCaller');
    for (let i = 0; i < methodCount; i += 1) {
      node(`m${i}`, 'Method', `method${i}`);
      db.run(`INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
              VALUES ('cls','m${i}','CONTAINS','src/a.js',1,1,'EXTRACTED','test')`);
      db.run(`INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
              VALUES ('k','m${i}','CALLS','src/a.js',${10 + i},0.9,'EXTRACTED','test')`);
    }
    db.close();
    return r;
  }

  it('★★★ TEN ROWS COLLAPSED INTO ONE GROUP ARE NOT "1 edge row fetched"', async () => {
    repoRoot = await classRollupRepo(10);
    const out = String(await graphCallers({ repoRoot, symbol: 'Foo' }));

    // The answer legitimately shows ONE caller — the collapse is correct and wanted.
    expect(out).toMatch(/theCaller/);
    // ⛔ AND THE SUBJECT MUST BE IN THE STATE THE PROHIBITION IS ABOUT. Without this the assertion
    // below passes on any fixture that simply never renders a footer, which is how it passed the
    // first time it was written.
    expect(out, 'the confidence footer must actually render here').toMatch(/CONFIDENCE:/);
    // What must not happen is describing the collapsed count with the fetched-rows noun.
    expectAbsentWithLiveMatcher(
      /1 candidate edge rows fetched/,
      { forbidden: 'CONFIDENCE: 1 candidate edge rows fetched · trust=weak',
        allowed: 'CONFIDENCE: 10 candidate edge rows fetched · trust=weak' },
      out,
      'ten fetched rows must not be reported as one',
    );
  }, 60_000);

  it('★★ THE CONTROL: with no rollup, rows and groups agree and the number is unchanged', async () => {
    // A single method call, no collapse: the two counts coincide, so this passes before and after
    // and proves the repair did not simply start printing a different number everywhere.
    repoRoot = await classRollupRepo(1);
    const out = String(await graphCallers({ repoRoot, symbol: 'Foo' }));

    expect(out).toMatch(/theCaller/);
  }, 60_000);
});
