// FIX A — louder staleness gate. A NOT-FOUND result on a STALE index (the
// .aify-graph snapshot is behind HEAD) must loudly tie the absence to
// staleness so a just-landed-but-unindexed symbol isn't misread as "doesn't
// exist." On a FRESH index the not-found stays concise (no noise).
//
// Covers graph_search, graph_whereis, graph_find. graph_packet's stale path is
// exercised via its SNAPSHOT line in the existing packet suites; FIX A's
// not-found caveat is search/whereis/find.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { graphSearch } from '../../../mcp/stdio/query/verbs/search.js';
import { graphWhereis } from '../../../mcp/stdio/query/verbs/whereis.js';
import { graphFind } from '../../../mcp/stdio/query/verbs/find.js';
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

// Build a minimal completed snapshot with one known symbol, recording
// `indexedCommit` in the manifest so freshness can compare it to HEAD.
async function buildSnapshot(repoRoot, indexedCommit) {
  await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ('f1', 'Function', 'existingSymbol', 'src/app.js', 1, 1, 'javascript', 1.0, '{}')`,
  );
  db.close();
  await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit: indexedCommit,
    indexedAt: new Date().toISOString(),
    nodes: 1, edges: 0,
    schemaVersion: SCHEMA_VERSION, extractorVersion: '0.1.0',
    status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
}

describe('FIX A — stale not-found caveat', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-stale-caveat-'));
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  describe('STALE index (behind HEAD)', () => {
    beforeEach(async () => {
      initGitRepo(repoRoot);
      await mkdir(join(repoRoot, 'src'), { recursive: true });
      await writeFile(join(repoRoot, 'src', 'app.js'), 'export function existingSymbol() { return 1; }\n');
      const indexedCommit = commitAll(repoRoot, 'init');
      await buildSnapshot(repoRoot, indexedCommit);
      // Move HEAD ahead so the snapshot is N commits behind.
      await writeFile(join(repoRoot, 'src', 'b.js'), 'export const b = 2;\n');
      commitAll(repoRoot, 'second commit (adds newlyAddedSymbol upstream)');
      await writeFile(join(repoRoot, 'src', 'c.js'), 'export const c = 3;\n');
      commitAll(repoRoot, 'third commit');
    });

    it('graph_search appends the loud stale caveat with commit count on NO RESULTS', async () => {
      const out = await graphSearch({ repoRoot, query: 'newlyAddedSymbol' });
      expect(out).toMatch(/NO RESULTS/);
      expect(out).toMatch(/index is 2 commits behind HEAD/);
      expect(out).toMatch(/newly added but not yet indexed/);
      expect(out).toMatch(/NOT proof the symbol does not exist/);
    });

    it('graph_whereis appends the stale caveat on NO MATCH', async () => {
      const out = await graphWhereis({ repoRoot, symbol: 'newlyAddedSymbol' });
      expect(out).toMatch(/NO MATCH/);
      expect(out).toMatch(/commits behind HEAD/);
      expect(out).toMatch(/NOT proof the symbol does not exist/);
    });

    it('graph_find attaches stale_caveat when zero hits across layers', async () => {
      const out = await graphFind({ repoRoot, query: 'newlyAddedSymbol' });
      const parsed = JSON.parse(out);
      expect(parsed.totals.code).toBe(0);
      expect(parsed.stale_caveat).toMatch(/commits behind HEAD/);
      expect(parsed.stale_caveat).toMatch(/NOT proof the symbol does not exist/);
    });

    it('does NOT append the caveat when the symbol IS found (stale but present)', async () => {
      const out = await graphSearch({ repoRoot, query: 'existingSymbol' });
      expect(out).not.toMatch(/NOT proof the symbol does not exist/);
    });
  });

  describe('FRESH index (snapshot == HEAD)', () => {
    beforeEach(async () => {
      initGitRepo(repoRoot);
      await mkdir(join(repoRoot, 'src'), { recursive: true });
      await writeFile(join(repoRoot, 'src', 'app.js'), 'export function existingSymbol() { return 1; }\n');
      const head = commitAll(repoRoot, 'init');
      await buildSnapshot(repoRoot, head); // manifest.commit === HEAD → fresh
    });

    it('graph_search keeps the concise not-found (no stale caveat)', async () => {
      const out = await graphSearch({ repoRoot, query: 'doesNotExist' });
      expect(out).toMatch(/NO RESULTS/);
      expect(out).not.toMatch(/commits behind HEAD/);
      expect(out).not.toMatch(/NOT proof the symbol does not exist/);
    });

    it('graph_whereis keeps the concise NO MATCH', async () => {
      const out = await graphWhereis({ repoRoot, symbol: 'doesNotExist' });
      expect(out).toMatch(/NO MATCH/);
      expect(out).not.toMatch(/behind HEAD/);
    });

    it('graph_find has no stale_caveat on a fresh index', async () => {
      const out = await graphFind({ repoRoot, query: 'doesNotExist' });
      const parsed = JSON.parse(out);
      expect(parsed.stale_caveat).toBeUndefined();
    });
  });
});
