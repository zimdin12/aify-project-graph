import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUnresolvedCategorization, classifyUnresolvedRef } from '../../../mcp/stdio/freshness/unresolved-categorization.js';

describe('unresolved categorization', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-cat-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('prefers the full dirty-edges sidecar over the manifest sample', async () => {
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123',
      indexedAt: '2026-04-23T00:00:00.000Z',
      dirtyEdges: [{ relation: 'CALLS', target: 'onlySample', source_file: 'src/a.js', source_line: 1, extractor: 'javascript' }],
      dirtyEdgeCount: 2,
    }));
    await writeFile(join(repoRoot, '.aify-graph', 'dirty-edges.full.json'), JSON.stringify({
      count: 2,
      writtenAt: '2026-04-23T00:00:00.000Z',
      dirtyEdges: [
        { relation: 'CALLS', target: 'realOne', source_file: 'src/a.js', source_line: 1, extractor: 'javascript' },
        { relation: 'REFERENCES', target: 'realTwo', source_file: 'src/b.js', source_line: 2, extractor: 'javascript' },
      ],
    }));

    const out = await buildUnresolvedCategorization({ repoRoot });
    expect(out.source).toBe('sidecar');
    expect(out.total).toBe(2);
    expect(out.sample_size).toBe(2);
    expect(out.samples['fixable:call-short-name'][0].target).toBe('realOne');
  });

  it('classifies unresolved CONTAINS with empty target as a shape issue', () => {
    expect(classifyUnresolvedRef({
      relation: 'CONTAINS',
      target: '',
      source_file: 'engine/core/DayNightCycle.cpp',
      extractor: 'cpp',
    })).toBe('shape-issue:contains-missing-target');
  });
});
