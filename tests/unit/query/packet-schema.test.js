// graph_packet schema invariants. Locks the M1 contract: presentation
// primitive that reads overlay + brief JSON directly, never triggers
// ensureFresh, returns fixed-schema markdown within budget, remains
// useful when LIVE is skipped or times out.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphPacket } from '../../../mcp/stdio/query/verbs/packet.js';

function git(repo, ...args) {
  execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
}

async function freshRepo() {
  const repo = await mkdtemp(join(tmpdir(), 'apg-packet-'));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  git(repo, 'commit', '--allow-empty', '-m', 'init');
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  return repo;
}

async function writeOverlay(repo, features) {
  await writeFile(
    join(repo, '.aify-graph', 'functionality.json'),
    JSON.stringify({ version: '0.1', features }),
  );
}

async function writeTasks(repo, tasks) {
  await writeFile(
    join(repo, '.aify-graph', 'tasks.json'),
    JSON.stringify({ tasks }),
  );
}

async function writeBrief(repo, brief = {}) {
  await writeFile(
    join(repo, '.aify-graph', 'brief.json'),
    JSON.stringify({
      graph_indexed_at: new Date().toISOString(),
      graph_commit: 'abc1234',
      repo: { unresolved_edges: 50 },
      features: { valid: [] },
      ...brief,
    }),
  );
}

async function writeManifest(repo, manifest = {}) {
  await writeFile(
    join(repo, '.aify-graph', 'manifest.json'),
    JSON.stringify({
      commit: 'abc1234',
      indexedAt: new Date().toISOString(),
      schemaVersion: 4,
      dirtyEdgeCount: 50,
      ...manifest,
    }),
  );
}

describe('graph_packet — schema invariants', () => {
  let repo;
  beforeEach(async () => { repo = await freshRepo(); });
  afterEach(async () => {
    for (let i = 0; i < 5; i += 1) {
      try { await rm(repo, { recursive: true, force: true }); return; } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  it('errors usefully when target is missing', () => {
    const out = graphPacket({ repoRoot: repo, target: '' });
    expect(out).toMatch(/ERROR/);
  });

  it('returns NOT FOUND with hints when target does not match', async () => {
    await writeOverlay(repo, []);
    await writeTasks(repo, []);
    await writeBrief(repo);
    await writeManifest(repo);
    const out = graphPacket({ repoRoot: repo, target: 'feature:nonexistent' });
    expect(out).toMatch(/not found/);
    expect(out).toMatch(/HINT/);
    expect(out).toMatch(/SNAPSHOT:/); // still includes snapshot for context
  });

  it('renders feature packet with all required sections', async () => {
    await writeOverlay(repo, [
      {
        id: 'auth',
        label: 'Authentication',
        anchors: { files: ['src/auth/*'], symbols: ['authenticate'], docs: ['docs/auth.md'] },
        contracts: ['docs/contracts/auth.md'],
        tests: ['tests/test_auth.py'],
        depends_on: ['storage'],
        source: 'user',
      },
    ]);
    await writeTasks(repo, []);
    await writeBrief(repo);
    await writeManifest(repo);
    const out = graphPacket({ repoRoot: repo, target: 'feature:auth' });
    expect(out).toMatch(/^FEATURE: Authentication/m);
    expect(out).toMatch(/^STATUS: overlay-defined/m);
    expect(out).toMatch(/^FEATURES: auth, dep:storage/m);
    expect(out).toMatch(/^SNAPSHOT: indexed=/m);
    expect(out).toMatch(/^READ FIRST:/m);
    expect(out).toMatch(/^CONTRACTS:/m);
    expect(out).toMatch(/^TESTS:/m);
    expect(out).toMatch(/^LIVE: skipped_under_budget/m);
  });

  it('renders task packet with linked features and merged contracts/tests', async () => {
    await writeOverlay(repo, [
      {
        id: 'auth',
        anchors: { files: ['src/auth/*'] },
        contracts: ['docs/auth-contract.md'],
        tests: ['tests/test_auth.py'],
      },
      {
        id: 'sessions',
        anchors: { files: ['src/sessions/*'] },
        contracts: ['docs/sessions-contract.md'],
        tests: ['tests/test_sessions.py'],
      },
    ]);
    await writeTasks(repo, [
      { id: 'CU-1', title: 'Wire login', status: 'open', features: ['auth', 'sessions'], files_hint: ['src/auth/login.py'] },
    ]);
    await writeBrief(repo);
    await writeManifest(repo);
    const out = graphPacket({ repoRoot: repo, target: 'task:CU-1' });
    expect(out).toMatch(/^TASK: Wire login/m);
    expect(out).toMatch(/^STATUS: open/m);
    expect(out).toMatch(/^FEATURES: auth, sessions/m);
    expect(out).toMatch(/src\/auth\/login\.py/);
    expect(out).toMatch(/docs\/auth-contract\.md/);
    expect(out).toMatch(/docs\/sessions-contract\.md/);
    expect(out).toMatch(/tests\/test_auth\.py/);
  });

  it('accepts bare id when explicit prefix not given', async () => {
    await writeOverlay(repo, [{ id: 'auth', anchors: { files: ['src/*'] } }]);
    await writeTasks(repo, []);
    await writeBrief(repo);
    await writeManifest(repo);
    const out = graphPacket({ repoRoot: repo, target: 'auth' });
    expect(out).toMatch(/^FEATURE: auth/m);
  });

  it('SNAPSHOT line includes STALE marker when indexed != HEAD', async () => {
    await writeOverlay(repo, [{ id: 'auth', anchors: { files: ['src/*'] } }]);
    await writeTasks(repo, []);
    await writeBrief(repo, { graph_commit: 'oldcommit' });
    await writeManifest(repo, { commit: 'oldcommit' });
    const out = graphPacket({ repoRoot: repo, target: 'feature:auth' });
    expect(out).toMatch(/SNAPSHOT:.*STALE/);
  });

  it('LIVE line is always present and explicit about state', async () => {
    await writeOverlay(repo, [{ id: 'auth', anchors: { files: ['src/*'] } }]);
    await writeTasks(repo, []);
    await writeBrief(repo);
    await writeManifest(repo);
    const out = graphPacket({ repoRoot: repo, target: 'feature:auth' });
    expect(out).toMatch(/^LIVE: (enriched|skipped_under_budget|timeout|unavailable)/m);
  });

  it('clamps output to budget by dropping tail sections', async () => {
    // Build an over-budget feature with many anchor files, contracts, tests
    const manyFiles = Array.from({ length: 30 }, (_, i) => `src/file${i}.js`);
    const manyContracts = Array.from({ length: 30 }, (_, i) => `docs/contract${i}.md`);
    const manyTests = Array.from({ length: 30 }, (_, i) => `tests/test${i}.py`);
    await writeOverlay(repo, [
      {
        id: 'big',
        anchors: { files: manyFiles, docs: manyContracts },
        contracts: manyContracts,
        tests: manyTests,
      },
    ]);
    await writeTasks(repo, []);
    await writeBrief(repo);
    await writeManifest(repo);
    const out = graphPacket({ repoRoot: repo, target: 'feature:big', budget: 200 });
    // Should drop some tail sections to fit budget
    expect(out.length / 4).toBeLessThan(280); // allow some headroom for clamp messages
    expect(out).toMatch(/dropped — over budget/);
  });

  it('still useful when LIVE is skipped (overlay-first acceptance)', async () => {
    // No brief features.valid, no enrichment — packet still has FEATURES + READ FIRST + CONTRACTS
    await writeOverlay(repo, [
      { id: 'core', anchors: { files: ['src/core/*'], docs: ['docs/core.md'] }, contracts: ['docs/core-contract.md'] },
    ]);
    await writeTasks(repo, []);
    await writeBrief(repo);
    await writeManifest(repo);
    const out = graphPacket({ repoRoot: repo, target: 'feature:core' });
    expect(out).toMatch(/READ FIRST:/);
    expect(out).toMatch(/CONTRACTS:/);
    expect(out).toMatch(/LIVE: skipped/);
  });
});
