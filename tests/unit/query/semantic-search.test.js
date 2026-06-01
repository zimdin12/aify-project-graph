import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { buildEmbeddings, embeddingsPath } from '../../../mcp/stdio/intelligence/embeddings.js';
import { graphSearch } from '../../../mcp/stdio/query/verbs/search.js';

// Deterministic fake embedder: a tiny keyword-bucket vector. No network.
const DIMS = ['gravity', 'render', 'fluid', 'shader', 'search'];
const fakeVec = (text) => { const t = String(text).toLowerCase(); return DIMS.map((d) => (t.includes(d) ? 1 : 0)); };
const fakeEmbedder = { model: 'fake', async embedTexts(texts) { return texts.map(fakeVec); } };

function addNode(db, id, opts = {}) {
  const { type = 'Function', label = id, file_path = '' } = opts;
  db.run(`INSERT INTO nodes (id, type, label, file_path, extra) VALUES ($id,$type,$label,$fp,'{}')`,
    { id, type, label, fp: file_path });
}

describe('semantic search (mode=semantic)', () => {
  let repo;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'apg-sem-'));
    mkdirSync(join(repo, '.aify-graph'), { recursive: true });
    const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
    addNode(db, 'g1', { label: 'GravityBody', type: 'Class', file_path: 'sim/Gravity.cpp' });
    addNode(db, 'r1', { label: 'Renderer', type: 'Class', file_path: 'engine/Render.cpp' });
    addNode(db, 'f1', { label: 'FluidSolver', type: 'Class', file_path: 'sim/Fluid.cpp' });
    db.close();
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch {} });

  it('buildEmbeddings writes the sidecar', async () => {
    const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
    const r = await buildEmbeddings({ db, repoRoot: repo, embedder: fakeEmbedder });
    db.close();
    expect(r.count).toBe(3);
    expect(existsSync(embeddingsPath(repo))).toBe(true);
  });

  it('ranks the gravity symbol first for a gravity query', async () => {
    const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
    await buildEmbeddings({ db, repoRoot: repo, embedder: fakeEmbedder });
    db.close();
    const out = await graphSearch({ repoRoot: repo, query: 'gravity force', mode: 'semantic', embedder: fakeEmbedder });
    expect(out).toMatch(/GravityBody/);
    expect(out.indexOf('GravityBody')).toBeLessThan(out.indexOf('Renderer') === -1 ? Infinity : out.indexOf('Renderer'));
  });

  it('falls back to lexical + a hint when no embeddings exist', async () => {
    const out = await graphSearch({ repoRoot: repo, query: 'Renderer', mode: 'semantic', embedder: fakeEmbedder });
    expect(out).toMatch(/embeddings/i);            // the hint
    expect(out).toMatch(/Renderer/);               // lexical result still served
  });
});
