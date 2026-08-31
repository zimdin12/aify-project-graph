import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUnresolvedCategorization, classifyUnresolvedRef, renderUnresolvedCategorizationReport } from '../../../mcp/stdio/freshness/unresolved-categorization.js';
import { countTrustRelevantDirtyEdges } from '../../../mcp/stdio/freshness/unresolved-metrics.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { replaceUnresolvedRefs } from '../../../mcp/stdio/storage/unresolved-refs.js';
import { bumpGraphGeneration } from '../../../mcp/stdio/storage/publication-schema.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

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

  // ⚠ THIS TEST USED TO SEED A SIDECAR FILE AND ASSERT source === 'sidecar'. The population moved
  // into the database, so the fixture moved with it — but the PROPERTY is unchanged and deliberately
  // so: the full population must beat the manifest's 500-row sample. Relabelling the assertion to
  // 'table' without moving the fixture would have been a test rewritten to match the code rather
  // than a property re-proved against it.
  const seedTable = (rows) => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try { replaceUnresolvedRefs(db, rows); } finally { db.close(); }
  };

  it('prefers the full unresolved table over the manifest sample', async () => {
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123',
      indexedAt: '2026-04-23T00:00:00.000Z',
      dirtyEdges: [{ relation: 'CALLS', target: 'onlySample', source_file: 'src/a.js', source_line: 1, extractor: 'javascript' }],
      dirtyEdgeCount: 2,
    }));
    seedTable([
      { from_id: 'src/a.js::caller', relation: 'CALLS', target: 'realOne', source_file: 'src/a.js', source_line: 1, extractor: 'javascript' },
      { from_id: 'src/b.js::caller', relation: 'REFERENCES', target: 'realTwo', source_file: 'src/b.js', source_line: 2, extractor: 'javascript' },
    ]);

    const out = await buildUnresolvedCategorization({ repoRoot });
    expect(out.source).toBe('table');
    expect(out.total).toBe(2);
    expect(out.sample_size).toBe(2);
    expect(out.samples['fixable:call-short-name'][0].target).toBe('realOne');
  });

  it('⛔ an EMPTY table is authoritative — it does not fall back to the manifest sample', async () => {
    // ⭐ THE DISCRIMINATION THE FILE COULD NOT EXPRESS. `readDirtyEdgesSidecar` returned [] both for
    // "genuinely nothing unresolved" and for "the file was corrupt", so an empty answer and a failed
    // read were the same value. A present-but-empty table means the last rebuild committed and found
    // nothing; consulting the manifest here would resurrect a stale sample as if it were current.
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123',
      indexedAt: '2026-04-23T00:00:00.000Z',
      dirtyEdges: [{ relation: 'CALLS', target: 'staleSample', source_file: 'src/a.js', source_line: 1, extractor: 'javascript' }],
      dirtyEdgeCount: 1,
    }));
    seedTable([]);

    const out = await buildUnresolvedCategorization({ repoRoot });
    expect(out.source).toBe('table');
    expect(out.total).toBe(0);
    expectAbsentWithLiveMatcher(
      /staleSample/,
      { forbidden: '{"target":"staleSample"}', allowed: '{"target":"realOne"}' },
      JSON.stringify(out.samples),
      'a stale manifest row must not reappear as current',
    );
  });

  it('POSITIVE CONTROL: a LEGACY graph with no table still reports the manifest sample, labelled', async () => {
    // Without this the table branch could be unconditional and the two tests above would prove
    // nothing about preference — only that the table path exists.
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123',
      indexedAt: '2026-04-23T00:00:00.000Z',
      dirtyEdges: [{ relation: 'CALLS', target: 'onlySample', source_file: 'src/a.js', source_line: 1, extractor: 'javascript' }],
      dirtyEdgeCount: 37,
    }));

    const out = await buildUnresolvedCategorization({ repoRoot });
    expect(out.source, 'a graph with no table must say which floor it is quoting').toBe('manifest-sample');
    expect(out.total, 'the uncapped count, not the sample size').toBe(37);
    expect(out.sample_size).toBe(1);
    expect(out.capped, 'and it must say the number it reported is not the population').toBe(true);
  });

  it('⛔ the artifact carries the publication state beside its commit', async () => {
    // The artifact emits table rows next to graph_commit and graph_indexed_at taken from the
    // manifest. Without a generation comparison a consumer cannot tell whether the graph those rows
    // came from is the one that commit describes — new refs attributed to an old commit.
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123', indexedAt: '2026-04-23T00:00:00.000Z', generation: 1,
      dirtyEdges: [], dirtyEdgeCount: 0,
    }));
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      bumpGraphGeneration(db, { unresolvedCount: 0, trustUnresolvedCount: 0 });   // generation 1
      replaceUnresolvedRefs(db, []);
    } finally { db.close(); }

    expect((await buildUnresolvedCategorization({ repoRoot })).generationState).toBe('attested');
  });

  it('⛔ a graph whose generation disagrees is NOT reported as attested', async () => {
    // ⛔ The positive control above proves the field can say yes; this proves it can say no. One
    // without the other is a constant dressed as a measurement.
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc123', indexedAt: '2026-04-23T00:00:00.000Z', generation: 9,
      dirtyEdges: [], dirtyEdgeCount: 0,
    }));
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      bumpGraphGeneration(db, { unresolvedCount: 0, trustUnresolvedCount: 0 });   // generation 1
      replaceUnresolvedRefs(db, []);
    } finally { db.close(); }

    expect((await buildUnresolvedCategorization({ repoRoot })).generationState)
      .toBe('generation_mismatch');
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

  it('render turns a non-zero fixable count into an actionable pointer (field report #4a)', () => {
    const withFixable = renderUnresolvedCategorizationReport({
      repoRoot: '/repo', total: 3, source: 'table', capped: false, sample_size: 3,
      summary: { external: 0, denylisted: 0, fixable: 2, shapeIssues: 0, unclassified: 1 },
      buckets: { 'fixable:call-short-name': 2, unclassified: 1 },
      samples: {},
    });
    expect(withFixable).toMatch(/fixable =/);
    expect(withFixable).toContain('graph_collect_code_intel');

    // No fixable → no pointer noise on the happy path.
    const noFixable = renderUnresolvedCategorizationReport({
      repoRoot: '/repo', total: 1, source: 'table', capped: false, sample_size: 1,
      summary: { external: 1, denylisted: 0, fixable: 0, shapeIssues: 0, unclassified: 0 },
      buckets: { 'external-by-design:npm': 1 },
      samples: {},
    });
    expect(noFixable).not.toMatch(/fixable =/);
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
