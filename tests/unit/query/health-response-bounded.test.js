// A DIAGNOSTIC THAT BREAKS WHEN THE TREE IS MESSY IS USELESS EXACTLY WHEN NEEDED.
//
// graph_health emitted its dirty-file lists in full. On a repo containing a
// 2804-file directory that turned a ~90-line response into 2,916 lines / 294,365
// characters, which blew past an agent client's tool-result limit — the primary
// diagnostic verb could not be returned inline at all.
//
// ★ The trigger was OUR OWN ADVICE. "Snapshot .aify-graph before touching it"
// creates thousands of untracked files, so every user careful enough to follow the
// safety practice broke health for themselves — and the failure surfaced as a
// client token error, which reads as their problem rather than ours.
// (ef-manager, echoes, 2026-07-30.)
//
// Counts stay exact because they are the decision-relevant part; the lists are a
// sample, and the truncation is reported rather than silent.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';

describe('graph_health response stays bounded', () => {
  let repo;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'apg-bounded-'));
    execFileSync('git', ['-C', repo, 'init', '-q']);
    execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t']);
    execFileSync('git', ['-C', repo, 'config', 'user.name', 't']);
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'a.js'), 'export const a = 1;\n');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);

    mkdirSync(join(repo, '.aify-graph'), { recursive: true });
    openDb(join(repo, '.aify-graph', 'graph.sqlite')).close();

    // The exact shape that broke it: a large snapshot-like untracked directory,
    // as produced by the safety practice this tool recommends.
    mkdirSync(join(repo, '.aify-graph.bak-test'), { recursive: true });
    for (let i = 0; i < 300; i += 1) {
      writeFileSync(join(repo, '.aify-graph.bak-test', `f${i}.json`), '{}');
    }
  });

  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch {} });

  it('caps the file lists while keeping the counts exact', async () => {
    const h = await graphHealth({ repoRoot: repo });

    expect(h.dirtyFiles.length).toBeLessThanOrEqual(25);
    // The COUNT must survive intact — it is what the reader acts on.
    expect(h.dirtyFilesTotal).toBeGreaterThanOrEqual(300);
    // `truncated` is a BOOLEAN, matching the {items,total,truncated,limit} envelope
    // used everywhere else. It previously held the omitted COUNT — a count named
    // like a boolean, which truthiness let survive. The count is still reported,
    // under a name that says what it is.
    expect(h.dirtyFilesTruncated).toBe(true);
    expect(h.dirtyFilesOmitted).toBe(h.dirtyFilesTotal - h.dirtyFiles.length);
  });

  it('reports truncation on the tracked list too, which had no signal at all', () => {
    // Same defect one step further along: trackedDirtyFiles was capped at 25 with
    // only a total to infer from and no flag of its own.
    return graphHealth({ repoRoot: repo }).then((h) => {
      expect(typeof h.trackedDirtyFilesTruncated).toBe('boolean');
      expect(h.trackedDirtyFilesTruncated).toBe(h.trackedDirtyFilesTotal > h.trackedDirtyFiles.length);
    });
  });

  it('the whole response stays small enough to return inline', async () => {
    const h = await graphHealth({ repoRoot: repo });
    const size = JSON.stringify(h).length;
    // 300 untracked files previously contributed ~30KB on their own; the real
    // report hit 294KB at 2804 files. A diagnostic must fit in a tool result.
    expect(size).toBeLessThan(20000);
  });

  it('still reports the untracked count in the verdict, just not every path', async () => {
    const h = await graphHealth({ repoRoot: repo });
    // Bounding the list must not lose the signal — the reader still needs to know
    // the tree is dirty and by how much.
    expect(h.summary).toMatch(/untracked/);
  });
});
