// THE FIX THAT UNDER-ENUMERATED, IN THE FUNCTION WHOSE COMMENT WARNS ABOUT UNDER-ENUMERATING.
//
// ⛔ FIELD REPORT (ef-manager, 2026-08-19, against 528a68c). The path-target branch probes
// `type IN ('File','Directory')`. This graph also holds 69 `Document` and 54 `Config` nodes —
// 123 real indexed files on disk — and every one of them still answered `NO MATCH`:
//
//   graph_whereis("docs/whereis-threshold-retirement.md") -> NO MATCH ...
//   graph_search("whereis-threshold-retirement", kind:"all") -> NODE ... document ... docs/…:1
//
// Reproduced on a second repo in a different language. And the remedy the miss offered cannot
// terminate: graph_search matches on basename, so a PATH argument can never match it, at any
// `kind`. The reader concludes the file is not in the graph — the exact sentence the original
// fix existed to stop producing.
//
// ★ THE LESSON IS THE ONE ALREADY WRITTEN THREE LINES ABOVE THE DEFECT: "enumerate every
// emitter rather than the ones that come to mind." I then hand-listed two of the four
// file-bearing types. A hand-list is a rule, and a rule is not a remedy — it fails silently the
// next time a node type is added.
//
// ⇒ SO THE ENUMERATION IS DELETED, NOT EXTENDED. The question "is this path indexed" is
// answered by asking whether ANY node carries that `file_path`. There is no type list left to
// fall behind, which is why this test asserts a CAPABILITY against a type that does not exist
// yet rather than checking off the four types we know about today.
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

async function repoWithNode({ type, label, filePath }) {
  const repo = await mkdtemp(join(tmpdir(), 'apg-pt-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 1, edges: 0, schemaVersion: 4,
    extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
          VALUES ('p1','${type}','${label}','${filePath}',1,1,'markdown',1,'{}')`);
  db.close();
  return repo;
}

describe('graph_whereis given a path that is indexed', () => {
  // The two types the original fix covered. Kept so the fix cannot regress backwards.
  for (const type of ['File', 'Directory']) {
    it(`★ does not claim absence for an indexed ${type} node`, async () => {
      repoRoot = await repoWithNode({ type, label: 'thing', filePath: 'src/thing' });
      const out = await graphWhereis({ repoRoot, symbol: 'src/thing' });
      expect(out).not.toMatch(/NO MATCH/);
    }, 20_000);
  }

  // The two ef-manager found in the field. 123 nodes in our own graph.
  for (const type of ['Document', 'Config']) {
    it(`★★★ does not claim absence for an indexed ${type} node`, async () => {
      repoRoot = await repoWithNode({ type, label: 'notes.md', filePath: 'docs/notes.md' });
      const out = await graphWhereis({ repoRoot, symbol: 'docs/notes.md' });
      expect(out, `${type} is a real indexed file; NO MATCH is false about the repository`)
        .not.toMatch(/NO MATCH/);
      expect(out, 'the reader must learn the path IS indexed and this was the wrong question')
        .toMatch(/docs\/notes\.md/);
    }, 20_000);
  }

  it('★★★ CAPABILITY, NOT NAMES: a node type that does not exist today still works', async () => {
    // If this test ever needs editing to add a type name, the defect has come back. The probe
    // must key on carrying a file_path, not on membership of a list someone maintains.
    repoRoot = await repoWithNode({ type: 'Notebook', label: 'x.ipynb', filePath: 'nb/x.ipynb' });
    const out = await graphWhereis({ repoRoot, symbol: 'nb/x.ipynb' });
    expect(out, 'a future node type must not silently reintroduce the false-absence answer')
      .not.toMatch(/NO MATCH/);
  }, 20_000);

  it('★★★ a symbol miss that is NOT a path still answers as a symbol miss', async () => {
    // The widened probe must not start answering "that is a path" for ordinary symbol names.
    repoRoot = await repoWithNode({ type: 'Document', label: 'notes.md', filePath: 'docs/notes.md' });
    const out = await graphWhereis({ repoRoot, symbol: 'computeThing' });
    expect(out, 'no node carries this as a path; this is an ordinary miss').toMatch(/NO MATCH/);
  }, 20_000);
});
