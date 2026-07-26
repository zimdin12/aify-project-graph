// P2-1 — turn "this set may be incomplete" into a POINTER.
//
// A callee list is OUTGOING, which is exactly what the boundary scanner models:
// a dynamic-dispatch site inside the queried symbol's body is a place where its
// callee set provably ends. Naming that site beats a generic "may be incomplete".
//
// Deliberately NOT wired into graph_callers: that question is INCOMING, so
// scanning the queried symbol's own body would present its OUTGOING dispatch as
// if it explained missing callers. The obvious alternative — reading REFERENCES
// edges as "address taken, may be invoked indirectly" — measured too noisy to
// use (name-collision matches like `file`/`abs`/`trust` dominate), and noise on
// the trust surface is worse than silence.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { graphCallees } from '../../../mcp/stdio/query/verbs/callees.js';

function insertNode(db, node) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id, $type, $label, $file_path, $start_line, $end_line, $language, $confidence, $extra)`,
    { start_line: 1, end_line: 20, language: 'javascript', confidence: 1, extra: '{}', ...node });
}

function insertEdge(db, edge) {
  db.run(
    `INSERT INTO edges (from_id, to_id, relation, source_file, source_line, confidence, provenance, extractor)
     VALUES ($from_id, $to_id, $relation, $source_file, $source_line, $confidence, $provenance, $extractor)`,
    { source_line: 1, confidence: 1, provenance: 'EXTRACTED', extractor: 'javascript', ...edge });
}

describe('graph_callees announces dynamic-dispatch boundaries', () => {
  let repoRoot;
  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-boundary-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    await mkdir(join(repoRoot, 'src'), { recursive: true });
  });
  afterEach(async () => { try { await rm(repoRoot, { recursive: true, force: true }); } catch {} });

  it('names the dispatch site where the callee set ends', async () => {
    await writeFile(join(repoRoot, 'src', 'router.js'), [
      'export function dispatch(name, payload) {',
      '  logIt(payload);',
      '  return handlers["save"](payload);',
      '}',
    ].join('\n'));

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'root', type: 'Function', label: 'dispatch', file_path: 'src/router.js', start_line: 1, end_line: 4 });
    insertNode(db, { id: 'log', type: 'Function', label: 'logIt', file_path: 'src/log.js' });
    insertEdge(db, { from_id: 'root', to_id: 'log', relation: 'CALLS', source_file: 'src/router.js', source_line: 2 });
    db.close();

    const out = await graphCallees({ repoRoot, symbol: 'dispatch' });

    // The static callee is still reported...
    expect(out).toContain('logIt');
    // ...and the place the static view ends is NAMED, not merely hinted at.
    expect(out).toMatch(/DYNAMIC-DISPATCH BOUNDARY/);
    expect(out).toMatch(/computed member call/);
    expect(out).toMatch(/key "save"/);
  });

  it('stays silent when the body has no dynamic dispatch', async () => {
    await writeFile(join(repoRoot, 'src', 'plain.js'), [
      'export function plain() {',
      '  return helper();',
      '}',
    ].join('\n'));

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'root', type: 'Function', label: 'plain', file_path: 'src/plain.js', start_line: 1, end_line: 3 });
    insertNode(db, { id: 'h', type: 'Function', label: 'helper', file_path: 'src/h.js' });
    insertEdge(db, { from_id: 'root', to_id: 'h', relation: 'CALLS', source_file: 'src/plain.js', source_line: 2 });
    db.close();

    const out = await graphCallees({ repoRoot, symbol: 'plain' });

    expect(out).toContain('helper');
    expect(out).not.toMatch(/DYNAMIC-DISPATCH BOUNDARY/);
  });
});
