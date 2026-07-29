// A result that quietly drops matches is the same failure class as a false
// exhaustive:true — the agent cannot tell a complete answer from a capped one.
//
// LH-1 (2026-07-26): graph_search truncated SILENTLY, twice — a SQL candidate cap
// and a display slice — and rendered with no `truncated` argument at all.
// P0-4: graph_callers printed caller DECLARATION lines in a format that reads as
// call sites; the Sand Castle census scored it 0/8 for exactly that reason.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { graphSearch } from '../../../mcp/stdio/query/verbs/search.js';
import { graphCallers } from '../../../mcp/stdio/query/verbs/callers.js';

function insertNode(db, node) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id, $type, $label, $file_path, $start_line, $end_line, $language, $confidence, $extra)`,
    { start_line: 1, end_line: 1, language: 'cpp', confidence: 1, extra: '{}', ...node });
}

function insertEdge(db, edge) {
  db.run(
    `INSERT INTO edges (from_id, to_id, relation, source_file, source_line, confidence, provenance, extractor)
     VALUES ($from_id, $to_id, $relation, $source_file, $source_line, $confidence, $provenance, $extractor)`,
    { source_line: 1, confidence: 1, provenance: 'EXTRACTED', extractor: 'cpp', ...edge });
}

describe('truncation honesty', () => {
  let repoRoot;
  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-trunc-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  });
  afterEach(async () => { try { await rm(repoRoot, { recursive: true, force: true }); } catch {} });

  it('graph_search reports how many of how many matches it showed', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    for (let i = 0; i < 40; i++) {
      insertNode(db, { id: `fn${i}`, type: 'Function', label: `render_widget_${i}`, file_path: `src/w${i}.cpp` });
    }
    db.close();

    const out = await graphSearch({ repoRoot, query: 'render_widget', limit: 10 });

    // 40 match, 10 shown — the agent must be told, and told how to see more.
    expect(out).toMatch(/SHOWING 10 of 40/);
    // The hint must name a limit that actually SHOWS the set. This asserted
    // `limit=30` (a hardcoded limit+20) which pinned a defect: with 200
    // candidates and limit=20 the hint said 40, so an agent following it still
    // could not see the set and had no way to know how many rounds it would take.
    expect(out).toMatch(/limit=40/);
  });

  it('graph_search stays quiet when nothing was dropped', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'only', type: 'Function', label: 'solitary_fn', file_path: 'src/a.cpp' });
    db.close();

    const out = await graphSearch({ repoRoot, query: 'solitary_fn', limit: 10 });

    expect(out).toContain('solitary_fn');
    expect(out).not.toMatch(/SHOWING/);
    expect(out).not.toMatch(/candidate cap/);
  });

  it('graph_search warns that the hard candidate cap makes results a FLOOR', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    // Exceed the 200-row SQL cap: beyond it, nodes are never scored at all, so
    // raising `limit` cannot reveal them — a distinct, harder ceiling.
    for (let i = 0; i < 240; i++) {
      insertNode(db, { id: `n${i}`, type: 'Function', label: `handle_event_${i}`, file_path: `src/h${i}.cpp` });
    }
    db.close();

    const out = await graphSearch({ repoRoot, query: 'handle_event', limit: 10 });

    expect(out).toMatch(/candidate cap/);
    expect(out).toMatch(/FLOOR/);
  });

  it('graph_callers states its locations are caller declarations, not call sites', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'callee', type: 'Function', label: 'sample_fluid_drag', file_path: 'sim/Terrain.cpp', start_line: 796 });
    insertNode(db, { id: 'caller', type: 'Function', label: 'build_intents', file_path: 'sim/Terrain.cpp', start_line: 5102 });
    insertEdge(db, { from_id: 'caller', to_id: 'callee', relation: 'CALLS', source_file: 'sim/Terrain.cpp', source_line: 5836 });
    db.close();

    const out = await graphCallers({ repoRoot, symbol: 'sample_fluid_drag' });

    expect(out).toContain('build_intents');
    // The exact confusion that scored this verb 0/8 on a call-site census.
    expect(out).toMatch(/LOCATIONS:/);
    expect(out).toMatch(/declaration, not a call site/i);
    expect(out).toMatch(/code_intel_references/);
  });
});
