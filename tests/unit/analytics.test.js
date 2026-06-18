// Unit tests for the shared analytics module (P2a / P2-9).
// Builds a synthetic in-tmp graph.sqlite and exercises each pure function:
// overview clustering, hotspot ranking, cycle detection (incl. rotation-dedup
// + acyclic case), provenance mix, and the digest budget cap.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../mcp/stdio/storage/db.js';
import {
  computeOverview,
  computeHotspots,
  computeCycles,
  computeProvenanceMix,
  computeDigest,
  computeIsolated,
  normalizeRotation,
} from '../../mcp/stdio/intelligence/analytics.js';

function addNode(db, id, opts = {}) {
  const {
    type = 'Function',
    label = id,
    file_path = '',
    community_id = null,
  } = opts;
  const extra = community_id != null ? JSON.stringify({ community_id }) : '{}';
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, extra) VALUES ($id,$type,$label,$fp,$extra)`,
    { id, type, label, fp: file_path, extra },
  );
}

function addEdge(db, from_id, to_id, opts = {}) {
  const { relation = 'CALLS', provenance = 'EXTRACTED' } = opts;
  db.run(
    `INSERT OR IGNORE INTO edges (from_id, to_id, relation, provenance) VALUES ($f,$t,$r,$p)`,
    { f: from_id, t: to_id, r: relation, p: provenance },
  );
}

describe('analytics: computeOverview', () => {
  let tmp; let db;
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'apg-analytics-overview-'));
    db = openDb(join(tmp, 'graph.sqlite'));
    // Two communities; A-cluster (1) has 3 symbols, B-cluster (2) has 2.
    addNode(db, 'a1', { community_id: 1, file_path: 'src/a1.js', label: 'hubA' });
    addNode(db, 'a2', { community_id: 1, file_path: 'src/a2.js' });
    addNode(db, 'a3', { community_id: 1, file_path: 'src/a3.js' });
    addNode(db, 'b1', { community_id: 2, file_path: 'lib/b1.js', label: 'hubB' });
    addNode(db, 'b2', { community_id: 2, file_path: 'lib/b2.js' });
    // hubA is high-degree within cluster 1.
    addEdge(db, 'a2', 'a1');
    addEdge(db, 'a3', 'a1');
    addEdge(db, 'a1', 'a2');
    // inter-cluster: a1 → b1 twice via distinct relations.
    addEdge(db, 'a1', 'b1', { relation: 'CALLS' });
    addEdge(db, 'a1', 'b1', { relation: 'REFERENCES' });
    addEdge(db, 'a2', 'b2', { relation: 'CALLS' });
  });
  afterAll(async () => { db.close(); await rm(tmp, { recursive: true, force: true }); });

  it('clusters by community_id and ranks by node_count', () => {
    const overview = computeOverview(db, { topSymbols: 5 });
    expect(overview.length).toBe(2);
    expect(overview[0].cluster).toBe('c:1');
    expect(overview[0].node_count).toBe(3);
    expect(overview[1].node_count).toBe(2);
  });

  it('top_symbols are degree-sorted (hubA first in cluster 1)', () => {
    const overview = computeOverview(db, { topSymbols: 5 });
    const c1 = overview.find((c) => c.cluster === 'c:1');
    expect(c1.top_symbols[0].label).toBe('hubA');
  });

  it('aggregates inter-cluster edge counts (c:1 → c:2 = 3)', () => {
    const overview = computeOverview(db, { topSymbols: 5 });
    const c1 = overview.find((c) => c.cluster === 'c:1');
    const toC2 = c1.edges_to.find((e) => e.cluster === 'c:2');
    expect(toC2.count).toBe(3); // a1→b1 (x2) + a2→b2
  });

  it('computeIsolated surfaces degree<=1 symbols (knowledge gaps), not hubs', () => {
    const iso = computeIsolated(db, { limit: 10 });
    expect(iso.every((i) => i.degree <= 1)).toBe(true);     // only the isolated tail
    expect(iso.map((i) => i.label)).not.toContain('hubA');  // the high-degree hub is excluded
    expect(iso.length).toBeGreaterThanOrEqual(1);           // a3 / b2 have degree 1
  });

  it('computeDigest includes a GAPS block when isolated symbols exist', () => {
    const text = computeDigest(db, { budget: 8000 });
    expect(text).toContain('GAPS');
  });

  it('computeDigest includes a SUGGESTED QUESTIONS block synthesized from the facts', () => {
    const text = computeDigest(db, { budget: 8000 });
    expect(text).toContain('QUESTIONS');
    // pairs structure with our trust angle (heuristic call edges → verify)
    expect(text).toMatch(/god object|heuristic|dead code|couple|cycle/i);
  });

  it('falls back to top-level dir when no community_id', () => {
    const overview = computeOverview(db, { topSymbols: 5 });
    // all nodes have community ids here, so no dir-clusters expected
    expect(overview.every((c) => c.cluster.startsWith('c:'))).toBe(true);
  });
});

describe('analytics: dir fallback clustering', () => {
  let tmp; let db;
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'apg-analytics-dir-'));
    db = openDb(join(tmp, 'graph.sqlite'));
    addNode(db, 'x1', { file_path: 'src/x1.js' });
    addNode(db, 'x2', { file_path: 'src/x2.js' });
    addNode(db, 'y1', { file_path: 'lib/y1.js' });
  });
  afterAll(async () => { db.close(); await rm(tmp, { recursive: true, force: true }); });

  it('clusters by top-level directory when community_id absent', () => {
    const overview = computeOverview(db, { topSymbols: 5 });
    const keys = overview.map((c) => c.cluster).sort();
    expect(keys).toEqual(['d:lib', 'd:src']);
  });
});

describe('analytics: computeHotspots', () => {
  let tmp; let db;
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'apg-analytics-hot-'));
    db = openDb(join(tmp, 'graph.sqlite'));
    addNode(db, 'god', { label: 'GodObject', file_path: 'src/god.js' });
    addNode(db, 'mid', { label: 'Middle', file_path: 'src/mid.js' });
    addNode(db, 'leaf', { label: 'Leaf', file_path: 'src/leaf.js' });
    addNode(db, 'noise', { label: 'get', file_path: 'src/util.js' });
    addNode(db, 'dir', { type: 'Directory', label: 'src', file_path: 'src' });
    // god gets 3 in, 2 out = degree 5; mid 1 in 1 out; leaf 1 in.
    addEdge(db, 'mid', 'god');
    addEdge(db, 'leaf', 'god');
    addEdge(db, 'noise', 'god');
    addEdge(db, 'god', 'mid');
    addEdge(db, 'god', 'leaf');
    // noise node gets high degree but must be filtered.
    addEdge(db, 'god', 'noise');
    addEdge(db, 'mid', 'noise');
    addEdge(db, 'leaf', 'noise');
  });
  afterAll(async () => { db.close(); await rm(tmp, { recursive: true, force: true }); });

  it('ranks god node first by in+out degree', () => {
    const hs = computeHotspots(db, { limit: 5 });
    expect(hs[0].label).toBe('GodObject');
    expect(hs[0].degree).toBe(6); // 3 in + 3 out (incl. noise edge)
  });

  it('excludes the noise denylist label', () => {
    const hs = computeHotspots(db, { limit: 10 });
    expect(hs.some((h) => h.label === 'get')).toBe(false);
  });

  it('excludes container node types', () => {
    const hs = computeHotspots(db, { limit: 10 });
    expect(hs.some((h) => h.type === 'Directory')).toBe(false);
  });

  it('honors the limit', () => {
    const hs = computeHotspots(db, { limit: 2 });
    expect(hs.length).toBeLessThanOrEqual(2);
  });
});

describe('analytics: computeCycles', () => {
  let tmp; let db;
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'apg-analytics-cyc-'));
    db = openDb(join(tmp, 'graph.sqlite'));
    // Files a.js → b.js → c.js → a.js (3-cycle) and a separate 2-cycle d↔e.
    // Symbols live in files; cycles are detected at FILE level.
    addNode(db, 'sa', { file_path: 'a.js' });
    addNode(db, 'sb', { file_path: 'b.js' });
    addNode(db, 'sc', { file_path: 'c.js' });
    addNode(db, 'sd', { file_path: 'd.js' });
    addNode(db, 'se', { file_path: 'e.js' });
    addNode(db, 'sf', { file_path: 'f.js' }); // acyclic tail
    addEdge(db, 'sa', 'sb', { relation: 'IMPORTS' });
    addEdge(db, 'sb', 'sc', { relation: 'IMPORTS' });
    addEdge(db, 'sc', 'sa', { relation: 'IMPORTS' });
    addEdge(db, 'sd', 'se', { relation: 'IMPORTS' });
    addEdge(db, 'se', 'sd', { relation: 'IMPORTS' });
    addEdge(db, 'sf', 'sa', { relation: 'IMPORTS' }); // f→a, not part of a cycle
  });
  afterAll(async () => { db.close(); await rm(tmp, { recursive: true, force: true }); });

  it('finds both cycles, tightest first', () => {
    const { cycles } = computeCycles(db, { maxLen: 5, topN: 20 });
    expect(cycles.length).toBe(2);
    expect(cycles[0].length).toBe(2); // d↔e tightest
    expect(cycles[1].length).toBe(3); // a→b→c
  });

  it('dedups rotations (a→b→c == b→c→a)', () => {
    const { cycles } = computeCycles(db, { maxLen: 5, topN: 20 });
    const three = cycles.find((c) => c.length === 3);
    // normalized to lexicographically-smallest start → a.js first
    expect(three[0]).toBe('a.js');
    expect(three).toEqual(['a.js', 'b.js', 'c.js']);
    // exactly one representative of the rotation class
    expect(cycles.filter((c) => c.length === 3).length).toBe(1);
  });

  it('respects maxLen bound (no 3-cycle when maxLen=2)', () => {
    const { cycles } = computeCycles(db, { maxLen: 2, topN: 20 });
    expect(cycles.every((c) => c.length <= 2)).toBe(true);
    expect(cycles.some((c) => c.length === 2)).toBe(true);
  });
});

describe('analytics: acyclic graph', () => {
  let tmp; let db;
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'apg-analytics-acyc-'));
    db = openDb(join(tmp, 'graph.sqlite'));
    addNode(db, 'sa', { file_path: 'a.js' });
    addNode(db, 'sb', { file_path: 'b.js' });
    addNode(db, 'sc', { file_path: 'c.js' });
    addEdge(db, 'sa', 'sb', { relation: 'IMPORTS' });
    addEdge(db, 'sb', 'sc', { relation: 'IMPORTS' });
  });
  afterAll(async () => { db.close(); await rm(tmp, { recursive: true, force: true }); });

  it('reports no cycles honestly', () => {
    const { cycles, capped } = computeCycles(db, { maxLen: 5, topN: 20 });
    expect(cycles).toEqual([]);
    expect(capped).toBe(false);
  });
});

describe('analytics: normalizeRotation', () => {
  it('rotates to lexicographically-smallest member', () => {
    expect(normalizeRotation(['b', 'c', 'a'])).toEqual(['a', 'b', 'c']);
    expect(normalizeRotation(['c', 'a', 'b'])).toEqual(['a', 'b', 'c']);
    expect(normalizeRotation(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('analytics: computeProvenanceMix', () => {
  let tmp; let db;
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'apg-analytics-prov-'));
    db = openDb(join(tmp, 'graph.sqlite'));
    addNode(db, 'n1', { file_path: 'a.js' });
    addNode(db, 'n2', { file_path: 'b.js' });
    addNode(db, 'n3', { file_path: 'c.js' });
    addNode(db, 'sh', { type: 'Schema', label: 'binding0' });
    // 4 LSP_VERIFIED, 4 EXTRACTED, 2 INFERRED call-family edges = 10 total.
    addEdge(db, 'n1', 'n2', { relation: 'CALLS', provenance: 'LSP_VERIFIED' });
    addEdge(db, 'n1', 'n3', { relation: 'CALLS', provenance: 'LSP_VERIFIED' });
    addEdge(db, 'n2', 'n1', { relation: 'REFERENCES', provenance: 'LSP_VERIFIED' });
    addEdge(db, 'n2', 'n3', { relation: 'USES_TYPE', provenance: 'LSP_VERIFIED' });
    addEdge(db, 'n3', 'n1', { relation: 'CALLS', provenance: 'EXTRACTED' });
    addEdge(db, 'n3', 'n2', { relation: 'CALLS', provenance: 'EXTRACTED' });
    addEdge(db, 'n1', 'sh', { relation: 'REFERENCES', provenance: 'EXTRACTED' });
    addEdge(db, 'n2', 'sh', { relation: 'REFERENCES', provenance: 'EXTRACTED' });
    addEdge(db, 'n3', 'sh', { relation: 'CALLS', provenance: 'INFERRED' });
    addEdge(db, 'n1', 'n2', { relation: 'USES_TYPE', provenance: 'INFERRED' });
    // non-call-family edge should not count toward provenance mix.
    addEdge(db, 'n1', 'n2', { relation: 'IMPORTS', provenance: 'EXTRACTED' });
  });
  afterAll(async () => { db.close(); await rm(tmp, { recursive: true, force: true }); });

  it('counts call-family edges by provenance', () => {
    const mix = computeProvenanceMix(db);
    expect(mix.total_call_edges).toBe(10);
    expect(mix.by_provenance.LSP_VERIFIED).toBe(4);
    expect(mix.by_provenance.EXTRACTED).toBe(4);
    expect(mix.by_provenance.INFERRED).toBe(2);
  });

  it('computes lsp-verified percentage', () => {
    const mix = computeProvenanceMix(db);
    expect(mix.lsp_verified_pct).toBe(40);
  });
});

describe('analytics: computeDigest budget cap', () => {
  let tmp; let db;
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'apg-analytics-digest-'));
    db = openDb(join(tmp, 'graph.sqlite'));
    addNode(db, 'f', { type: 'File', label: 'a.js', file_path: 'a.js' });
    for (let i = 0; i < 30; i++) {
      addNode(db, `s${i}`, { community_id: (i % 4) + 1, file_path: `src/s${i}.js`, label: `sym${i}` });
    }
    for (let i = 0; i < 29; i++) {
      addEdge(db, `s${i}`, `s${(i + 1) % 30}`, { relation: 'CALLS' });
      addEdge(db, `s${i}`, 's0', { relation: 'REFERENCES' });
    }
  });
  afterAll(async () => { db.close(); await rm(tmp, { recursive: true, force: true }); });

  it('produces a header + sections within a large budget', () => {
    const text = computeDigest(db, { budget: 6000 });
    expect(text).toMatch(/^DIGEST /);
    expect(text).toContain('HOTSPOTS');
    expect(text).toContain('PROVENANCE');
  });

  it('caps output to the char budget and notes truncation', () => {
    const full = computeDigest(db, { budget: 100000 });
    const small = computeDigest(db, { budget: 400 });
    // Truncated output drops trailing blocks → strictly shorter than full.
    expect(small.length).toBeLessThan(full.length);
    expect(small).toContain('TRUNCATED');
    expect(small).toMatch(/^DIGEST /); // header always survives
    // Body (minus the truncation note) stays within budget plus slack for the
    // single block kept unconditionally when it alone exceeds the budget.
    const body = small.replace(/\n\nTRUNCATED[^\n]*$/, '');
    const longestBlock = Math.max(...full.split('\n\n').map((b) => b.length));
    expect(body.length).toBeLessThanOrEqual(400 + longestBlock);
  });
});
