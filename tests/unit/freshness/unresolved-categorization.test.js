import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUnresolvedCategorization, classifyUnresolvedRef } from '../../../mcp/stdio/freshness/unresolved-categorization.js';
import { countTrustRelevantDirtyEdges } from '../../../mcp/stdio/freshness/unresolved-metrics.js';

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

  it('classifies node builtins as external imports without treating normal calls as packages', () => {
    expect(classifyUnresolvedRef({
      relation: 'IMPORTS',
      target: 'node:fs.promises',
      source_file: 'src/a.js',
      extractor: 'javascript',
    })).toBe('external-by-design:node-builtin');

    // A genuinely-fixable short-name call (not on the resolver denylist) stays
    // fixable — it is NOT misclassified as an external package.
    expect(classifyUnresolvedRef({
      relation: 'CALLS',
      target: 'renderWidget',
      source_file: 'src/a.js',
      extractor: 'javascript',
    })).toBe('fixable:call-short-name');
  });

  it('routes resolver-denylisted names + JS globals to denylisted-by-design, not fixable', () => {
    // COMMON_NAMES (set/get/parse/log/…) — the resolver refuses these by design,
    // so an unresolved CALLS/REFERENCES to one is NOT actionable backlog.
    expect(classifyUnresolvedRef({
      relation: 'CALLS', target: 'set', extractor: 'javascript',
    })).toBe('denylisted-by-design:common-name');
    expect(classifyUnresolvedRef({
      relation: 'REFERENCES', target: 'parse', extractor: 'typescript',
    })).toBe('denylisted-by-design:common-name');
    // JS/Node ambient globals — structurally unresolvable (no def node).
    expect(classifyUnresolvedRef({
      relation: 'REFERENCES', target: '__dirname', extractor: 'javascript',
    })).toBe('denylisted-by-design:js-global');
  });

  it('classifies C++ system/STL includes as external (audit: echoes measurement)', () => {
    // Bare STL header (#include <vector>) — was landing in unclassified.
    expect(classifyUnresolvedRef({ relation: 'IMPORTS', target: 'algorithm', extractor: 'cpp' })).toBe('external-by-design:cpp-system');
    expect(classifyUnresolvedRef({ relation: 'IMPORTS', target: 'memory', extractor: 'cpp' })).toBe('external-by-design:cpp-system');
    // Path-style third-party header — was landing in fixable:qualified-path.
    expect(classifyUnresolvedRef({ relation: 'IMPORTS', target: 'SDL3/SDL.h', extractor: 'cpp' })).toBe('external-by-design:cpp-system');
    expect(classifyUnresolvedRef({ relation: 'IMPORTS', target: 'audio/miniaudio.h', extractor: 'cpp' })).toBe('external-by-design:cpp-system');
    // A project CALLS target starting with a vendor-ish prefix is NOT a system include (M5).
    expect(classifyUnresolvedRef({ relation: 'CALLS', target: 'stdSort', extractor: 'cpp' })).not.toBe('external-by-design:cpp-system');
  });

  it('does not hide an intra-repo JS import as an external npm package', () => {
    // Audit 2026-06-12: a normalized intra-repo import target contains `/` with
    // no `@` scope — it must remain visible (fixable/unclassified), not npm.
    expect(classifyUnresolvedRef({
      relation: 'IMPORTS', target: 'mcp/stdio/code-intel/providers/index.js.registerProvider', extractor: 'javascript',
    })).not.toBe('external-by-design:npm');
    // A real bare/scoped npm specifier is still classified npm.
    expect(classifyUnresolvedRef({
      relation: 'IMPORTS', target: 'react.useState', extractor: 'javascript',
    })).toBe('external-by-design:npm');
    expect(classifyUnresolvedRef({
      relation: 'IMPORTS', target: '@scope/pkg.thing', extractor: 'typescript',
    })).toBe('external-by-design:npm');
  });

  it('counts only fixable or unclassified unresolved refs as trust-relevant', () => {
    const refs = [
      { relation: 'IMPORTS', target: 'node:path', extractor: 'javascript' },
      { relation: 'IMPORTS', target: 'react', extractor: 'javascript' },
      { relation: 'CONTAINS', target: '', extractor: 'cpp' },
      { relation: 'CALLS', target: 'missingInternal', extractor: 'javascript' },
      { relation: 'IMPORTS', target: './maybe-local.js', extractor: 'javascript' },
    ];

    expect(countTrustRelevantDirtyEdges(refs)).toBe(2);
  });
});
