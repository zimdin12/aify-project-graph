// Sidecar preserves the FULL unresolved-edges list across runs.
//
// Regression for the P0 state-loss bug: manifest.dirtyEdges is capped at
// 500 for breakdown-query performance, but was also what the next run
// read back into refs — so anything past 500 vanished. The sidecar
// carries the complete list forward.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readDirtyEdgesSidecar,
  writeDirtyEdgesSidecar,
} from '../../../mcp/stdio/freshness/dirty-edges-sidecar.js';

describe('dirty-edges sidecar', () => {
  let graphDir;

  beforeEach(async () => {
    graphDir = await mkdtemp(join(tmpdir(), 'apg-sidecar-'));
  });

  afterEach(async () => {
    try { await rm(graphDir, { recursive: true, force: true }); } catch {}
  });

  it('returns null when sidecar is absent (caller falls back to manifest)', async () => {
    const got = await readDirtyEdgesSidecar(graphDir);
    expect(got).toBeNull();
  });

  it('round-trips a list larger than the 500-row manifest cap', async () => {
    const edges = Array.from({ length: 1200 }, (_, i) => ({
      from_id: `fn:a${i}`, relation: 'CALLS', extractor: 'javascript',
    }));
    await writeDirtyEdgesSidecar(graphDir, edges);
    const got = await readDirtyEdgesSidecar(graphDir);
    expect(got).toHaveLength(1200);
    expect(got[0].from_id).toBe('fn:a0');
    expect(got[1199].from_id).toBe('fn:a1199');
  });

  it('writing an empty list removes the sidecar (no stale file)', async () => {
    await writeDirtyEdgesSidecar(graphDir, [
      { from_id: 'fn:x', relation: 'CALLS', extractor: 'javascript' },
    ]);
    expect(await readDirtyEdgesSidecar(graphDir)).toHaveLength(1);
    await writeDirtyEdgesSidecar(graphDir, []);
    expect(await readDirtyEdgesSidecar(graphDir)).toBeNull();
  });

  it('returns empty array on corrupt JSON (not null — manifest fallback suppressed)', async () => {
    await mkdir(graphDir, { recursive: true });
    await writeFile(join(graphDir, 'dirty-edges.full.json'), '{ not valid json', 'utf8');
    const got = await readDirtyEdgesSidecar(graphDir);
    expect(got).toEqual([]);
  });
});
