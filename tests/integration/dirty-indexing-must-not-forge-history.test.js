// ⛔ AN UNCOMMITTED EDIT COULD REWRITE THE HISTORY OF A COMMIT THAT NEVER HELD IT.
//
// `structural_digest` is keyed by commit sha and written `ON CONFLICT DO UPDATE`, on the stated
// premise — in the store's own header — that "a commit names one graph state, so re-indexing it is
// an idempotent overwrite rather than a second history entry."
//
// That premise is false for this indexer. `ensureFresh` reads HEAD and then reads the DIRTY FILES,
// indexes the working tree it actually finds, and captures the digest under the HEAD sha. So:
//
//     index at commit C, clean            -> digest(C) describes C
//     edit a tracked file, do not commit  -> HEAD is still C
//     index again                         -> digest(C) is REPLACED by a graph of uncommitted bytes
//
// The delta then compares against a "before" that no commit ever produced, and the extractor-version
// guard cannot see it because the extractor did not change. A wrong before is worse than a missing
// one: a missing before REFUSES, and a wrong one answers.
//
// ⛔ AND THE HONEST BINDING IS OUT OF REACH TODAY, WHICH THE SOURCE ITSELF SAYS. orchestrator.js
// states: "there is no per-file hash in the manifest or the schema. `structural_fp` is per NODE and
// computable only by re-parsing… That is a schema addition, not a tweak, and it must not ride along
// on a correctness fix." So the digest cannot be bound to the bytes that were consumed. What it CAN
// do is refuse to publish history it cannot attribute — and say plainly what that refusal misses.
//
// ⚠ WHAT THIS GUARD CANNOT SEE, stated here and in docs/known-limitations.md rather than implied:
// a tree that is clean at the start, edited and restored DURING the run, and clean at the end.
// Endpoint checks are blind to it. Closing that needs the consumed-input manifest above.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureFresh } from '../../mcp/stdio/freshness/orchestrator.js';
import { openExistingDb } from '../../mcp/stdio/storage/db.js';
import { readStructuralDigest, listDigestCommits } from '../../mcp/stdio/storage/structural-digest-store.js';

const created = [];
afterEach(() => {
  while (created.length) {
    const d = created.pop();
    try { rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch { /* win lock */ }
  }
});

const git = (r, ...a) => execFileSync('git', ['-C', r, ...a], { encoding: 'utf8' }).trim();

function repoWithOneCommit() {
  const repo = mkdtempSync(join(tmpdir(), 'apg-dirty-history-'));
  created.push(repo);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@t.t');
  git(repo, 'config', 'user.name', 'T');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'a.js'), 'export function alpha() { return 1; }\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'one');
  return repo;
}

/**
 * Read the stored digests through the real store, on a fresh handle.
 *
 * ⛔ EAGERLY, NEVER AS A CLOSURE OVER THE HANDLE. The first version returned
 * `forCommit: (sha) => readStructuralDigest(db, sha)` after `finally { db.close() }` had already
 * run, so every read hit a closed database and came back null — and the dirty-tree assertion
 * PASSED, because it compared two nulls. A harness that returns nothing compares equal to itself.
 */
function digests(repo) {
  const db = openExistingDb(join(repo, '.aify-graph', 'graph.sqlite'));
  try {
    const commits = listDigestCommits(db);
    const byCommit = new Map(commits.map((sha) => [sha, readStructuralDigest(db, sha)]));
    return { commits, forCommit: (sha) => byCommit.get(sha) ?? null };
  } finally { db.close(); }
}

describe('history is published only for a state a commit actually named', () => {
  it('★★★ THE POSITIVE CONTROL: a clean tree DOES get a digest', async () => {
    // ⛔ FIRST, BECAUSE EVERY ASSERTION BELOW IS ABOUT SOMETHING NOT HAPPENING. If capture were
    // simply broken, the refusal tests would pass for the wrong reason and this file would certify
    // a dead feature. This is the one that proves the instrument speaks.
    const repo = repoWithOneCommit();
    await ensureFresh({ repoRoot: repo });
    const head = git(repo, 'rev-parse', 'HEAD');

    const { commits, forCommit } = digests(repo);
    expect(commits, 'a clean index publishes exactly one digest').toEqual([head]);
    expect(forCommit(head)?.commit).toBe(head);
  }, 60_000);

  it('★★★ THE REAL CASE: re-indexing with a DIRTY tree leaves the stored digest untouched', async () => {
    const repo = repoWithOneCommit();
    await ensureFresh({ repoRoot: repo });
    const head = git(repo, 'rev-parse', 'HEAD');
    const before = JSON.stringify(digests(repo).forCommit(head));

    // A tracked file changes and is NOT committed. HEAD still names the old content.
    writeFileSync(join(repo, 'src', 'a.js'),
      'export function alpha() { return 1; }\nexport function beta() { return 2; }\n');
    expect(git(repo, 'status', '--porcelain'), 'the fixture must actually be dirty').toContain('src/a.js');
    expect(git(repo, 'rev-parse', 'HEAD'), 'and HEAD must not have moved').toBe(head);

    await ensureFresh({ repoRoot: repo });

    const after = digests(repo);
    expect(after.commits, 'no second row for the same commit').toEqual([head]);
    expect(JSON.stringify(after.forCommit(head)), 'the historical before is byte-identical')
      .toBe(before);
  }, 60_000);

  it('★★★ THE DISCRIMINATING CONTROL: committing that same edit DOES publish a new digest', async () => {
    // Without this, "no digest was written" is satisfied by a guard that disabled capture outright.
    // The refusal has to be about attribution, not about giving up on history.
    const repo = repoWithOneCommit();
    await ensureFresh({ repoRoot: repo });
    const first = git(repo, 'rev-parse', 'HEAD');

    writeFileSync(join(repo, 'src', 'a.js'),
      'export function alpha() { return 1; }\nexport function beta() { return 2; }\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'two');
    const second = git(repo, 'rev-parse', 'HEAD');
    expect(second).not.toBe(first);

    await ensureFresh({ repoRoot: repo });

    const { commits, forCommit } = digests(repo);
    expect(commits, 'both commits now have history').toContain(second);
    expect(commits).toContain(first);
    expect(forCommit(second)?.commit).toBe(second);
  }, 60_000);

  // ⛔ THERE IS NO "REFUSED CAPTURE DOES NOT PRUNE" TEST HERE, AND THAT IS DELIBERATE.
  // I wrote one. It set up two digests, went dirty, re-indexed, and asserted the count was
  // unchanged — and it passed identically with and without the guard, because retention is 50 and
  // two rows are never pruned at either setting. A test that cannot fail manufactures confidence,
  // so it is gone rather than kept as decoration.
  //
  // The property still holds, structurally rather than by assertion: pruning lives INSIDE
  // `writeStructuralDigest`, and `captureStructuralDigest` is what calls it. Declining to capture
  // therefore cannot upsert and cannot prune, because neither statement is reached. That is an
  // argument about reachability, and it is stated here so a reader does not mistake its absence
  // for an untested claim.
});
