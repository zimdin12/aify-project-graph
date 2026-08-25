import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

// ⛔ EVERY NEGATIVE HERE GOES THROUGH A LIVE MATCHER. The repo's own guard rejected the first cut of
// this file for four bare negative assertions — correctly: "the summary does not accuse this graph"
// and "the regex is dead" produce the same green, and the guard was the only thing that could tell
// them apart. The canaries are the real accusation string and a NEARBY line it must not be mistaken
// for — the manifest-status verdict this check exists to supplement.
const ACCUSED = /index-incomplete:/;
const CANARIES = {
  forbidden: 'index-incomplete: the manifest describes 2572 nodes but the database holds 90',
  allowed: 'previous-run-did-not-finish: status=partial (run graph_index(force=true))',
};

// ⛔ F8 — THE WIRING, NOT THE DETECTOR.
//
// `graph-capabilities.test.js` proves `isIndexIncomplete` classifies correctly when it is handed
// counts. This file proves `graph_health` actually HANDS IT ANY, and that what it produces reaches
// a reader. Those are different questions, and this repository keeps finding that only the first
// one has an obvious test: three separate fixes in this audit added a correct value somewhere no
// consumer could see it.
//
// ⛔⛔ AND THE MANIFEST CANNOT REPORT THIS ITSELF. `manifestStatus !== 'ok'` already produces a
// `previous-run-did-not-finish` line — but `writeManifest` renames atomically at the END of a
// successful index, so the run that fails hardest is precisely the one that never rewrites the
// manifest. The manifest of a catastrophically interrupted index says `status: 'ok'`. The assertion
// below pins that: status is 'ok' in the fixture, and the finding must surface anyway.
//
// ⭐ Live proof, taken in the same pass as this file was written: four pinned third-party arms (fmt,
// click, fast-route, p-queue) are NOT accused, and a real p-queue graph with its code nodes deleted
// IS — reported as `manifest 184 / database 98`. This file is the regression guard for that.

describe('graph_health — an interrupted index is reported through the real verb', () => {
  let repoRoot;

  const writeManifest = (extra) => writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit: 'abc1234',
    indexedAt: '2026-08-26T00:00:00.000Z',
    schemaVersion: 4,
    extractorVersion: '0.1.0',
    // ⛔ THE WHOLE POINT: a healthy-looking manifest from the LAST GOOD run.
    status: 'ok',
    dirtyFiles: [],
    dirtyEdges: [],
    dirtyEdgeCount: 0,
    ...extra,
  }));

  // The observed survivors, by type and count: Document 43, Directory 25, Config 22 — and no code.
  const seed = (rows) => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      for (const [type, n] of Object.entries(rows)) {
        for (let i = 0; i < n; i += 1) {
          db.run('INSERT INTO nodes (id, type, label, file_path, language) VALUES (?, ?, ?, ?, ?)',
            [`${type}:${i}`, type, `${type}-${i}`, `src/${type}-${i}`, type === 'Document' ? '' : 'typescript']);
        }
      }
    } finally { db.close(); }
  };

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-health-incomplete-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  });

  afterEach(async () => {
    if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* ignore */ } }
  });

  it('⛔ THE OBSERVED SHAPE: manifest 2,572 / database 90 / zero code nodes', async () => {
    seed({ Document: 43, Directory: 25, Config: 22 });
    await writeManifest({ nodes: 2572, edges: 13618 });

    const r = await graphHealth({ repoRoot });

    expect(r.manifestStatus).toBe('ok');                  // the manifest sees nothing wrong
    expect(r.capabilities.reason).toBe('index_incomplete'); // health does
    expect(r.capabilities.orientationUsable).toBe(false);
    expect(r.capabilities.absenceAuthority).toBe(false);
    expect(r.capabilities.nextAction).toMatch(/graph_index/);
    expect(r.capabilities.nextAction).toContain('2572');
    expect(r.capabilities.nextAction).toContain('90');
  });

  it('⛔ IT REACHES A READER — the summary carries it, not only a nested field', async () => {
    // The recurring defect in this audit is a correct value no consumer receives. `summary` is the
    // surface an agent reads before any nested object, so the finding is asserted THERE.
    seed({ Document: 43, Directory: 25, Config: 22 });
    await writeManifest({ nodes: 2572, edges: 13618 });

    const { summary } = await graphHealth({ repoRoot });
    expect(summary).toMatch(/index-incomplete:/);
    expect(summary).toContain('2572');
    expect(summary).toMatch(/graph_index\(force=true\)/);
  });

  it('⭐ POSITIVE CONTROL: an agreeing graph is not accused, on either surface', async () => {
    // Without this, both assertions above are satisfied by a verb that condemns every graph.
    seed({ Function: 40, Class: 10, Document: 40 });
    await writeManifest({ nodes: 90, edges: 0 });

    const r = await graphHealth({ repoRoot });
    expect(r.capabilities.reason).not.toBe('index_incomplete');
    expect(r.capabilities.orientationUsable).toBe(true);
    expectAbsentWithLiveMatcher(ACCUSED, CANARIES, r.summary, 'an agreeing graph must not be accused');
  });

  it('⭐ A DOCS-ONLY REPOSITORY IS NOT A BROKEN ONE', async () => {
    // Zero code nodes is normal here. Firing on it alone would accuse every documentation tree.
    seed({ Document: 60, Directory: 30 });
    await writeManifest({ nodes: 90, edges: 0 });

    const r = await graphHealth({ repoRoot });
    expect(r.capabilities.orientationUsable).toBe(true);
    expectAbsentWithLiveMatcher(ACCUSED, CANARIES, r.summary, 'a docs-only repository is not broken');
  });

  it('⛔ UNKNOWN REFUSES TO ACCUSE: a manifest predating these fields', async () => {
    // Older manifests carry no node/edge counts. A graph is not called broken because its integrity
    // could not be read — the opposite default would condemn every pre-existing graph on upgrade.
    seed({ Document: 43, Directory: 25, Config: 22 });
    await writeManifest({});

    const r = await graphHealth({ repoRoot });
    expect(r.capabilities.orientationUsable).toBe(true);
    expectAbsentWithLiveMatcher(ACCUSED, CANARIES, r.summary, 'a manifest with no counts is not evidence of damage');
  });
});
