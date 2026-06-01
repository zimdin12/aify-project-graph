import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { computeOverview } from '../../../mcp/stdio/intelligence/analytics.js';

function addNode(db, id, opts = {}) {
  const { type = 'Function', label = id, file_path = '', community_id = null } = opts;
  const extra = community_id != null ? JSON.stringify({ community_id }) : '{}';
  db.run(`INSERT INTO nodes (id, type, label, file_path, extra) VALUES ($id,$type,$label,$fp,$extra)`,
    { id, type, label, fp: file_path, extra });
}

describe('computeOverview archetype naming', () => {
  let tmp; let db;
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'apg-archetype-'));
    db = openDb(join(tmp, 'graph.sqlite'));
    // community 1 = physics; community 2 = rendering
    addNode(db, 'p1', { community_id: 1, file_path: 'sim/fields/Gravity.cpp', label: 'GravityBody' });
    addNode(db, 'p2', { community_id: 1, file_path: 'sim/fields/Gravity.cpp', label: 'apply_gravity' });
    addNode(db, 'p3', { community_id: 1, file_path: 'sim/fields/Fluid.cpp', label: 'FluidCell' });
    addNode(db, 'r1', { community_id: 2, file_path: 'engine/render/Render.cpp', label: 'Renderer' });
    addNode(db, 'r2', { community_id: 2, file_path: 'engine/render/Shader.cpp', label: 'ShaderProgram' });
  });
  afterAll(async () => { db.close(); await rm(tmp, { recursive: true, force: true }); });

  it('attaches an archetype to each community cluster and upgrades the label', () => {
    const overview = computeOverview(db, { topSymbols: 5 });
    const physics = overview.find((c) => c.cluster === 'c:1');
    const rendering = overview.find((c) => c.cluster === 'c:2');
    expect(physics.archetype.id).toBe('physics');
    expect(physics.label).toMatch(/Physics/);          // generic "community 1" upgraded
    expect(rendering.archetype.id).toBe('rendering');
    expect(rendering.label).toMatch(/Rendering/);
  });

  it('lets a curated architecture-overlay layer name win over the heuristic', async () => {
    // Layer clusters only form for nodes WITHOUT a community_id (community takes
    // precedence). Seed layer-only physics nodes so the cluster keys on l:.
    const tmp2 = await mkdtemp(join(tmpdir(), 'apg-archetype-layer-'));
    const db2 = openDb(join(tmp2, 'graph.sqlite'));
    try {
      addNode(db2, 'g1', { file_path: 'sim/fields/Gravity.cpp', label: 'GravityBody' });
      addNode(db2, 'g2', { file_path: 'sim/fields/Fluid.cpp', label: 'FluidCell' });
      const architecture = {
        layers: [{ id: 'gameplay', name: 'Gameplay Layer' }],
        assignments: { 'sim/fields/Gravity.cpp': { layerId: 'gameplay' }, 'sim/fields/Fluid.cpp': { layerId: 'gameplay' } },
      };
      const overview = computeOverview(db2, { topSymbols: 5, architecture });
      const layerCluster = overview.find((c) => c.cluster === 'l:gameplay');
      expect(layerCluster).toBeTruthy();
      expect(layerCluster.label).toBe('Gameplay Layer'); // overlay name preserved, not overwritten by archetype
    } finally {
      db2.close(); await rm(tmp2, { recursive: true, force: true });
    }
  });
});
