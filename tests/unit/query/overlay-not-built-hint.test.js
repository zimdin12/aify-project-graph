// FIX B — overlay-empty hint. When functionality.json is missing / empty /
// all-broken (every feature anchor resolves:0), graph_packet and graph_pull BY
// FEATURE/TASK used to return silent-nothing that read as "tool broken." They
// must instead return a clear OVERLAY NOT BUILT hint. The happy path (a
// populated, resolving overlay) must be untouched.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { graphPacket } from '../../../mcp/stdio/query/verbs/packet.js';
import { graphPull } from '../../../mcp/stdio/query/verbs/pull.js';
import { SCHEMA_VERSION } from '../../../mcp/stdio/storage/schema.js';

function git(repoRoot, ...args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function initGitRepo(repoRoot) {
  git(repoRoot, 'init', '-q');
  git(repoRoot, 'config', 'user.email', 'test@test');
  git(repoRoot, 'config', 'user.name', 'test');
}

function commitAll(repoRoot, message) {
  git(repoRoot, 'add', '.');
  git(repoRoot, 'commit', '-q', '-m', message);
  return git(repoRoot, 'rev-parse', 'HEAD');
}

// Build a graph that knows ONE real symbol/file so resolving anchors is
// meaningful (a feature anchored to a non-existent symbol → resolved:0/broken;
// a feature anchored to the real file → resolves → built).
async function buildGraph(repoRoot) {
  initGitRepo(repoRoot);
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'app.js'), 'export function realSymbol() { return 1; }\n');
  const head = commitAll(repoRoot, 'init');
  await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ('file1', 'File', 'app.js', 'src/app.js', 1, 1, 'javascript', 1.0, '{}')`,
  );
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ('fn1', 'Function', 'realSymbol', 'src/app.js', 1, 1, 'javascript', 1.0, '{}')`,
  );
  db.close();
  await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit: head, indexedAt: new Date().toISOString(),
    nodes: 2, edges: 0, schemaVersion: SCHEMA_VERSION, extractorVersion: '0.1.0',
    status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  return head;
}

async function writeOverlay(repoRoot, features) {
  await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'),
    JSON.stringify({ version: '0.1', features }, null, 2));
}

describe('FIX B — overlay-not-built hint', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-overlay-built-'));
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  describe('all-broken overlay (every anchor resolves:0 — the sand_castle case)', () => {
    beforeEach(async () => {
      await buildGraph(repoRoot);
      // Feature anchors point at symbols/files that do NOT exist in the graph
      // → validateAnchors() reports resolved:0 → all-broken.
      await writeOverlay(repoRoot, [
        { id: 'ghost', label: 'Ghost Feature',
          anchors: { symbols: ['doesNotExist'], files: ['src/missing/*'], routes: [], docs: [] } },
      ]);
    });

    it('graph_pull(feature:...) returns the OVERLAY NOT BUILT hint instead of empty not-found', async () => {
      const out = await graphPull({ repoRoot, node: 'feature:something' });
      const parsed = JSON.parse(out);
      expect(parsed.error).toBe('overlay not built');
      expect(parsed.hint).toMatch(/OVERLAY NOT BUILT/);
      expect(parsed.hint).toMatch(/graph-build-functionality/);
      expect(parsed.hint).toMatch(/0 resolved anchors/);
    });

    it('graph_pull(task:...) also returns the hint when overlay is all-broken', async () => {
      const out = await graphPull({ repoRoot, node: 'task:CU-999' });
      const parsed = JSON.parse(out);
      expect(parsed.error).toBe('overlay not built');
      expect(parsed.hint).toMatch(/OVERLAY NOT BUILT/);
    });
  });

  describe('missing overlay (functionality.json absent)', () => {
    beforeEach(async () => {
      await buildGraph(repoRoot); // no functionality.json written
    });

    it('graph_packet(feature:...) returns the OVERLAY NOT BUILT hint', async () => {
      const out = await graphPacket({ repoRoot, target: 'feature:something' });
      expect(out).toMatch(/OVERLAY NOT BUILT/);
      expect(out).toMatch(/functionality\.json missing/);
      expect(out).toMatch(/graph-build-functionality/);
      expect(out).toMatch(/Raw-symbol queries .* work without the overlay/);
    });

    it('graph_pull(feature:...) returns the OVERLAY NOT BUILT hint', async () => {
      const out = await graphPull({ repoRoot, node: 'feature:something' });
      const parsed = JSON.parse(out);
      expect(parsed.error).toBe('overlay not built');
      expect(parsed.hint).toMatch(/functionality\.json missing/);
    });
  });

  describe('empty overlay (features: [])', () => {
    beforeEach(async () => {
      await buildGraph(repoRoot);
      await writeOverlay(repoRoot, []);
    });

    it('graph_packet emits the hint for an empty overlay', async () => {
      const out = await graphPacket({ repoRoot, target: 'feature:anything' });
      expect(out).toMatch(/OVERLAY NOT BUILT/);
    });
  });

  describe('populated overlay (happy path untouched)', () => {
    beforeEach(async () => {
      await buildGraph(repoRoot);
      // Feature with a real, resolving anchor → built.
      await writeOverlay(repoRoot, [
        { id: 'core', label: 'Core', description: 'the real feature',
          anchors: { symbols: ['realSymbol'], files: ['src/app.js'], routes: [], docs: [] } },
      ]);
    });

    it('graph_packet(feature:core) renders a real packet, NOT the hint', async () => {
      const out = await graphPacket({ repoRoot, target: 'feature:core' });
      expect(out).not.toMatch(/OVERLAY NOT BUILT/);
      expect(out).toMatch(/FEATURE: Core/);
    });

    it('graph_pull(feature:core) returns feature layers, NOT the hint', async () => {
      const out = await graphPull({ repoRoot, node: 'feature:core' });
      const parsed = JSON.parse(out);
      expect(parsed.error).toBeUndefined();
      expect(parsed.node.kind).toBe('feature');
      expect(parsed.node.id).toBe('core');
    });

    it('graph_pull(feature:bogus) on a built overlay still gives the normal not-found (NOT the hint)', async () => {
      const out = await graphPull({ repoRoot, node: 'feature:bogus' });
      const parsed = JSON.parse(out);
      expect(parsed.error).toBe('feature not found');
      expect(parsed.hint).not.toMatch(/OVERLAY NOT BUILT/);
    });
  });
});
