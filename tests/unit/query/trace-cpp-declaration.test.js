// ★ THE FIXTURE GAP THAT LET THREE C++ DEFECTS THROUGH.
//
// ef-manager, 2026-08-11, after testing graph_trace on a real 339-file C++ repo:
//
//   "Your test corpus is structurally incapable of producing the failure modes of the
//    language the tool is mainly used on. That is now a pattern, not three coincidences."
//
// They are right. Every trace/explore fixture I own is JavaScript, and **JS has no
// header/implementation split**, so no fixture I could write would express:
//
//   · a CALLS hop resolving to a header DECLARATION instead of the definition
//   · "callees: (none indexed)" that is true of a prototype and false of the function
//   · the same verb resolving CALLS → header but OVERRIDDEN_BY → implementation
//
// The defect it produced: `ChunkManager::setVoxel → WorldBuffer::writeSingleVoxelGpu`
// inlined ONE LINE of prototype from WorldBuffer.h:580, reported no callees, and did it
// beneath "treat each block as a Read you have ALREADY performed; do not Read a file
// shown here". The implementation is ~50 lines at WorldBuffer.cpp:2151. The trace ended
// the investigation exactly where the work is, and told the reader not to look.
//
// So this file exists to make that shape expressible in a unit fixture: a .h with a bare
// declaration, a .cpp with the real body, and an edge that lands on the declaration.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphTrace } from '../../../mcp/stdio/query/verbs/trace.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;

const HEADER = [
  '#pragma once',
  'class WorldBuffer {',
  'public:',
  '  void writeSingleVoxelGpu(int slot, int localX, unsigned char material);',
  '};',
].join('\n');

const IMPL = [
  '#include "WorldBuffer.h"',
  '',
  'void WorldBuffer::writeSingleVoxelGpu(int slot, int localX, unsigned char material) {',
  '  waitForFence();',
  '  recordCommandBuffer();',
  '  dispatchCompute();',
  '}',
].join('\n');

const CALLER = [
  '#include "WorldBuffer.h"',
  '',
  'void ChunkManager::setVoxel(int x, unsigned char m) {',
  '  buffer.writeSingleVoxelGpu(0, x, m);',
  '}',
].join('\n');

function node(db, n) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id, $type, $label, $file_path, $start_line, $end_line, 'cpp', 1, '{}')`, n,
  );
}
function edge(db, e) {
  db.run(
    `INSERT INTO edges (from_id, to_id, relation, source_file, source_line, confidence, provenance, extractor)
     VALUES ($from_id, $to_id, $relation, $source_file, 1, 1, 'EXTRACTED', 'test')`, e,
  );
}

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-cpp-split-'));
  await mkdir(join(repoRoot, 'engine'), { recursive: true });
  await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  await writeFile(join(repoRoot, 'engine', 'WorldBuffer.h'), HEADER);
  await writeFile(join(repoRoot, 'engine', 'WorldBuffer.cpp'), IMPL);
  await writeFile(join(repoRoot, 'engine', 'ChunkManager.cpp'), CALLER);
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'init'], { cwd: repoRoot });
  const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 3, edges: 1,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));

  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  // The caller.
  node(db, { id: 'setVoxel', type: 'Method', label: 'setVoxel', file_path: 'engine/ChunkManager.cpp', start_line: 3, end_line: 5 });
  // ★ THE DECLARATION — one line, no body. This is what the CALLS edge lands on.
  node(db, { id: 'decl', type: 'Method', label: 'writeSingleVoxelGpu', file_path: 'engine/WorldBuffer.h', start_line: 4, end_line: 4 });
  // ★ THE DEFINITION — the thing the reader actually needs.
  node(db, { id: 'impl', type: 'Method', label: 'writeSingleVoxelGpu', file_path: 'engine/WorldBuffer.cpp', start_line: 3, end_line: 7 });
  edge(db, { from_id: 'setVoxel', to_id: 'decl', relation: 'CALLS', source_file: 'engine/ChunkManager.cpp' });
  db.close();
});

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
});

const asText = (o) => (typeof o === 'string' ? o : JSON.stringify(o));

describe('graph_trace on a C++ header/implementation split', () => {
  it('★★ a CALLS hop landing on a DECLARATION renders the DEFINITION body', async () => {
    const text = asText(await graphTrace({ repoRoot, from: 'setVoxel', to: 'writeSingleVoxelGpu' }));

    // Sanity first: the trace must actually have run, or every assertion below is vacuous.
    expect(text, 'fixture must produce a trace').toMatch(/writeSingleVoxelGpu/);

    // The body a reader needs — from the .cpp, not the one-line prototype.
    expect(text, 'must inline the implementation body').toMatch(/dispatchCompute/);
    // And it must say where it came from, so the reader is not silently redirected.
    expect(text).toMatch(/resolved from the declaration at engine\/WorldBuffer\.h/);
  });

  it('★ the same definition is not rendered twice in one trace', async () => {
    // ef-manager, on real C++ after the declaration fix: an interface→impl trace rendered
    // the SAME 13 lines at START and at HOP 1, because resolving both to the definition
    // collapsed them onto one node. Before the fix START showed the one-line declaration
    // — wrong, but distinct. On a large function this doubles the payload for zero
    // information.
    //
    // A fix that introduces a new cost is not finished. The provenance line still prints
    // for each hop; only the repeated BODY is suppressed.
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    // Make START itself resolve to the same definition as the hop target.
    db.run("UPDATE nodes SET file_path='engine/WorldBuffer.h', start_line=4, end_line=4 WHERE id='setVoxel'");
    db.run("UPDATE nodes SET label='writeSingleVoxelGpu' WHERE id='setVoxel'");
    db.close();

    const text = asText(await graphTrace({ repoRoot, from: 'writeSingleVoxelGpu', to: 'writeSingleVoxelGpu' }));

    const bodyCount = (text.match(/dispatchCompute/g) ?? []).length;
    expect(bodyCount, 'the shared definition body must appear at most once').toBeLessThanOrEqual(1);
  });

  it('★ when NO definition exists, it says DECLARATION ONLY rather than implying the function is empty', async () => {
    // The honest fallback. "callees: (none indexed)" under a prototype is an artefact of
    // what got resolved, not a fact about the code — so the absence must be labelled.
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.run("DELETE FROM nodes WHERE id = 'impl'");
    db.close();

    const text = asText(await graphTrace({ repoRoot, from: 'setVoxel', to: 'writeSingleVoxelGpu' }));

    expect(text).toMatch(/DECLARATION ONLY/);
    expect(text, 'must warn that a zero-callee reading is an artefact').toMatch(/says nothing about the real function/);
  });
});
