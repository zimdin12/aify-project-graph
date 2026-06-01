import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { buildTour } from '../../../mcp/stdio/query/verbs/tour.js';

function addNode(db, id, opts = {}) {
  const { type = 'Function', label = id, file_path = '', community_id = null, start_line = 1 } = opts;
  const extra = community_id != null ? JSON.stringify({ community_id }) : '{}';
  db.run(`INSERT INTO nodes (id, type, label, file_path, start_line, extra) VALUES ($id,$type,$label,$fp,$sl,$extra)`,
    { id, type, label, fp: file_path, sl: start_line, extra });
}
function addEdge(db, f, t, rel = 'CALLS') {
  db.run(`INSERT OR IGNORE INTO edges (from_id, to_id, relation, provenance) VALUES ($f,$t,$r,'EXTRACTED')`, { f, t, r: rel });
}

describe('buildTour', () => {
  let tmp; let db;
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'apg-tour-'));
    db = openDb(join(tmp, 'graph.sqlite'));
    addNode(db, 'main', { type: 'Entrypoint', label: 'main', file_path: 'game/main.cpp', start_line: 10 });
    // physics community
    addNode(db, 'p1', { community_id: 1, file_path: 'sim/fields/Gravity.cpp', label: 'GravityBody' });
    addNode(db, 'p2', { community_id: 1, file_path: 'sim/fields/Gravity.cpp', label: 'apply_gravity' });
    addNode(db, 'p3', { community_id: 1, file_path: 'sim/fields/Fluid.cpp', label: 'FluidSolver' });
    // rendering community
    addNode(db, 'r1', { community_id: 2, file_path: 'engine/render/Render.cpp', label: 'Renderer' });
    addNode(db, 'r2', { community_id: 2, file_path: 'engine/render/Shader.cpp', label: 'ShaderProgram' });
    addEdge(db, 'main', 'p1'); addEdge(db, 'main', 'r1');
    addEdge(db, 'p2', 'p1'); addEdge(db, 'p3', 'p1'); addEdge(db, 'r2', 'r1');
    addEdge(db, 'r1', 'p1'); // cross-archetype: rendering → physics
  });
  afterAll(async () => { db.close(); await rm(tmp, { recursive: true, force: true }); });

  it('produces an ordered tour with entrypoints first, archetypes, and a packet suggestion', () => {
    const md = buildTour(db, { steps: 8 });
    expect(md).toMatch(/TOUR/);
    expect(md).toMatch(/1\./);                 // ordered
    expect(md).toMatch(/main/);                // entry point present
    expect(md).toMatch(/Physics|Rendering/);   // archetype name
    expect(md).toMatch(/graph_packet/);        // suggested next verb
    // entry-point step should appear before the region steps
    expect(md.indexOf('main')).toBeLessThan(md.search(/Physics|Rendering/));
  });

  it('caps the number of steps', () => {
    const md = buildTour(db, { steps: 2 });
    const stepLines = (md.match(/^\s*\d+\.\s/gm) || []);
    expect(stepLines.length).toBeLessThanOrEqual(2);
  });

  it('focus narrows to one archetype', () => {
    const md = buildTour(db, { steps: 8, focus: 'physics' });
    expect(md).toMatch(/Physics/);
    expect(md).not.toMatch(/Rendering/);
  });

  it('handles an empty graph gracefully', () => {
    const tmpDb = openDb(join(tmp, 'empty.sqlite'));
    try { expect(buildTour(tmpDb, {})).toMatch(/empty|no .*graph|NO /i); }
    finally { tmpDb.close(); }
  });
});
