// NOTHING EVER #INCLUDES A .cpp.
//
// Field report (sc-manager, Sand Castle, 2026-08-04→05), and the rare kind that
// survives its own author checking it. The observation was:
//
//   graph_consequences(target="sim/fields/UnifiedFluidWriteback.cpp")
//     → tests_adjacent: [], provenance: "none"      (on a FRESH index)
//
// The reported diagnosis — "tests_adjacent is overlay-only, no structural
// fallback" — was wrong. The structural tier exists and works. Running the same
// call against the HEADER returned the test with provenance import_linked.
//
// The real cause: in C++ the declaration and definition are one unit split
// across two files, and tests include the HEADER. So an implementation file has
// no incoming include edges from any test, and the honest structural answer for
// a .cpp is zero. Technically correct, practically useless — a reviewer asking
// "what tests this implementation file" is asking the right question.
//
// Reported alongside: the count was right too. Their grep had OR'd two different
// headers and then said "four test files include the target's headers"; exactly
// one includes the target header, which is what the tool returned.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphConsequences } from '../../../mcp/stdio/query/verbs/consequences.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

function initGit(repoRoot) {
  const runGit = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'ignore' });
  runGit('init', '-q');
  runGit('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init');
}

function insertNode(db, node) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id, $type, $label, $file_path, $start_line, $end_line, $language, $confidence, $extra)`,
    { start_line: 1, end_line: 1, language: 'cpp', confidence: 1, extra: '{}', ...node },
  );
}

function insertEdge(db, edge) {
  db.run(
    `INSERT INTO edges (from_id, to_id, relation, source_file, source_line, confidence, provenance, extractor)
     VALUES ($from_id, $to_id, $relation, $source_file, $source_line, $confidence, $provenance, $extractor)`,
    { source_line: 1, confidence: 1, provenance: 'EXTRACTED', extractor: 'test', ...edge },
  );
}

describe('graph_consequences — .cpp inherits its header test adjacency', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-companion-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    initGit(repoRoot);
    const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
      schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    }));
  });

  afterEach(async () => {
    if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
  });

  /** The exact Sand Castle shape: test includes the .h, nothing includes the .cpp. */
  function buildFixture() {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'impl', type: 'File', label: 'Writeback.cpp', file_path: 'sim/fields/Writeback.cpp' });
    insertNode(db, { id: 'hdr', type: 'File', label: 'Writeback.h', file_path: 'sim/fields/Writeback.h' });
    insertNode(db, { id: 'tst', type: 'File', label: 'test_writeback.cpp', file_path: 'tests/fields/test_writeback.cpp' });
    // The ONLY include edge in the graph: test → header. Deliberately no edge
    // touching the .cpp, which is the whole point of the case.
    insertEdge(db, {
      from_id: 'tst', to_id: 'hdr', relation: 'IMPORTS', source_file: 'tests/fields/test_writeback.cpp',
    });
    db.close();
  }

  it('★ a .cpp target surfaces the test that includes its paired header', async () => {
    buildFixture();
    const res = await graphConsequences({ repoRoot, target: 'sim/fields/Writeback.cpp' });

    // Before the fix this was [] — the honest structural answer to a question
    // nobody asks.
    expect(res.tests_adjacent).toContain('tests/fields/test_writeback.cpp');
  });

  it('says the adjacency came via the HEADER, not via this file', async () => {
    buildFixture();
    const res = await graphConsequences({ repoRoot, target: 'sim/fields/Writeback.cpp' });

    // Not laundered into `import_linked`: the edge is real, but it lands on the
    // paired header rather than the queried file, and a reader judging whether
    // coverage is real should be able to see that distinction.
    expect(res.tests_adjacent_provenance).toBe('companion_header_linked');
    const basis = res.tests_adjacency_basis ?? res.tests_adjacent_basis;
    expect(basis, 'the basis names the header it came through').toBeTruthy();
    expect(basis[0].via_header).toBe('sim/fields/Writeback.h');
  });

  it('a direct include of the queried file still reports the stronger tier', async () => {
    // Guards against the new branch swallowing the original one: when something
    // imports the target directly, that is a stronger claim and must win.
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'hdr', type: 'File', label: 'Writeback.h', file_path: 'sim/fields/Writeback.h' });
    insertNode(db, { id: 'tst', type: 'File', label: 'test_writeback.cpp', file_path: 'tests/fields/test_writeback.cpp' });
    insertEdge(db, { from_id: 'tst', to_id: 'hdr', relation: 'IMPORTS', source_file: 'tests/fields/test_writeback.cpp' });
    db.close();

    const res = await graphConsequences({ repoRoot, target: 'sim/fields/Writeback.h' });
    expect(res.tests_adjacent).toContain('tests/fields/test_writeback.cpp');
    expect(res.tests_adjacent_provenance).toBe('import_linked');
  });

  it('a .cpp with no header and no test linkage still reports none', async () => {
    // The fix must not invent adjacency where there is none — that was the
    // original sin this whole field (four tiers, named provenance) exists to undo.
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'lonely', type: 'File', label: 'Lonely.cpp', file_path: 'sim/fields/Lonely.cpp' });
    db.close();

    const res = await graphConsequences({ repoRoot, target: 'sim/fields/Lonely.cpp' });
    expect(res.tests_adjacent).toEqual([]);
    expect(res.tests_adjacent_provenance).toBe('none');
  });
});
