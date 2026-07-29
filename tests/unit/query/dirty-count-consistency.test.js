// ONE TREE, ONE DIRTY NUMBER.
//
// Field report (2026-07-27): on a working tree with ZERO tracked modifications
// and 592 untracked files, graph_packet printed `dirty=592` while the read-verb
// staleness warning (correctly) said nothing at all. Two contradictory dirty
// counts for the same tree at the same commit is worse than either alone — the
// agent cannot tell which verb is load-bearing, so the accurate banner loses
// credibility to the wrong one.
//
// Rule: any dirty COUNT that influences trust counts TRACKED modifications only.
// Untracked files were never in the graph, so they cannot make an indexed file
// stale. graph_health may report untracked separately, but must LABEL it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphPacket } from '../../../mcp/stdio/query/verbs/packet.js';
import { getTrackedDirtyFilesSync, getDirtyFilesSync } from '../../../mcp/stdio/freshness/git.js';

function git(repo, ...args) {
  execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
}

async function repoWithUntrackedNoise() {
  const repo = await mkdtemp(join(tmpdir(), 'apg-dirty-'));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'src', 'tracked.js'), 'export const a = 1;\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');

  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit: head, indexedAt: new Date().toISOString(), schemaVersion: 4, dirtyEdgeCount: 10,
  }));
  await writeFile(join(repo, '.aify-graph', 'brief.json'), JSON.stringify({
    graph_commit: head, repo: { unresolved_edges: 10 }, features: { valid: [] },
  }));
  // 12 untracked files — never indexed, so irrelevant to snapshot trust.
  await mkdir(join(repo, 'scratch'), { recursive: true });
  for (let i = 0; i < 12; i += 1) {
    await writeFile(join(repo, 'scratch', `n${i}.js`), 'noise\n');
  }
  return repo;
}

describe('dirty counts key on tracked modifications', () => {
  let repo;
  beforeEach(async () => { repo = await repoWithUntrackedNoise(); });
  afterEach(async () => { try { await rm(repo, { recursive: true, force: true }); } catch {} });

  it('getTrackedDirtyFilesSync excludes untracked files', () => {
    // Baseline: the unfiltered helper DOES see the noise, so the filter is what
    // makes the difference (guards against the test passing for the wrong reason).
    expect(getDirtyFilesSync(repo).length).toBeGreaterThanOrEqual(12);
    expect(getTrackedDirtyFilesSync(repo)).toEqual([]);
  });

  it('graph_packet SNAPSHOT reports dirty=0 when only untracked files exist', async () => {
    const out = await graphPacket({ repoRoot: repo, target: 'feature:nonexistent' });
    expect(out).toMatch(/SNAPSHOT: indexed=/);
    expect(out).toMatch(/dirty=0/);
    // The exact field-report shape: the untracked count leaking into `dirty=`.
    expect(out).not.toMatch(/dirty=1[0-9]/);
  });

  it('graph_packet SNAPSHOT does count a real tracked modification', async () => {
    // The guard must not over-correct into always reporting zero.
    await writeFile(join(repo, 'src', 'tracked.js'), 'export const a = 2;\n');
    const out = await graphPacket({ repoRoot: repo, target: 'feature:nonexistent' });
    expect(out).toMatch(/dirty=1\b/);
    expect(getTrackedDirtyFilesSync(repo)).toEqual(['src/tracked.js']);
  });
});
