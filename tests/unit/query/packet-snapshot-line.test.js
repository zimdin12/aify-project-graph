// THE COMPENSATING INVARIANT FOR THE REFACTOR GUARD'S ONE EXCLUSION.
//
// `scripts/refactor-guard.mjs` compares packet output byte-for-byte across a slice, EXCEPT for
// one named line:
//     SNAPSHOT: indexed=<sha> head=<sha> dirty=<n> trust=<tier>
// It has to be excluded because `head` moves on every commit and `dirty` on every edit, so a
// guard that included it would decay under the very work it is guarding and get switched off.
//
// ⛔ BUT AN EXCLUSION IS A BLIND SPOT, AND I PROVED IT ON MYSELF. My first liveness probe made
// `shortSha` return a constant. The guard reported UNCHANGED — correctly, because that function's
// only output is inside the excluded line. I had tested the instrument with a probe aimed at the
// one place the instrument cannot see, and would have concluded it was live.
//
// ⇒ So the excluded line gets its own check HERE, on content rather than shape. The guard pins
// the line's shape and its presence; this pins what it actually says. Between them the exclusion
// costs nothing. Delete this file and the guard silently stops covering snapshot rendering.
import { describe, it, expect } from 'vitest';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { graphPacket } from '../../../mcp/stdio/query/verbs/packet.js';
// The producer itself, so the STALE invariant is checked against what the code emits rather than
// against whatever state this repo's graph happens to be in.
import { snapshotLine } from '../../../mcp/stdio/query/verbs/packet-input.js';

const REPO = process.cwd();
const snapshotOf = (text) => text.split('\n').find((l) => l.startsWith('SNAPSHOT:')) || '';

describe('the packet SNAPSHOT line', () => {
  it('★★★ is emitted at all — the guard pins its shape, not its existence per route', async () => {
    // ⛔ THE `$` ANCHOR MADE THIS TEST UNPASSABLE ON A STALE GRAPH. `snapshotLine` appends
    // ` STALE` when the indexed commit differs from HEAD, so the old pattern
    //     /^SNAPSHOT: indexed=\S+ head=\S+ dirty=\d+ trust=\S+$/
    // could only match when the graph happened to be fresh. It was reported as flakiness; it is
    // deterministic, and it fails in EXACTLY the state the SNAPSHOT line exists to announce.
    //
    // ⇒ A shape assertion that excludes the interesting case is not a weak test, it is a test of
    // the uninteresting one.
    const out = await graphPacket({ repoRoot: REPO, target: 'graphPacket', mode: 'orient' });
    expect(snapshotOf(out), 'no snapshot line means the guard is excluding nothing and covering nothing')
      .toMatch(/^SNAPSHOT: indexed=\S+ head=\S+ dirty=\d+ trust=\S+( STALE)?$/);
  }, 20_000);

  it('★★★ STALE is present exactly when indexed differs from head — the case the shape check hid', () => {
    // ⛔ THE BLIND SPOT, NOW COVERED. Nothing asserted the STALE marker at all: the shape check
    // silently excluded it and no other case mentioned it. So the field that tells an agent its
    // map is out of date was, itself, unwitnessed.
    //
    // Exercised through the real producer with both worlds constructed, rather than through
    // whatever state this repo's graph happens to be in — which is what made the original
    // assertion's outcome depend on the weather.
    // ⛔⛔ AND THE FIRST VERSION OF THIS VERY TEST WAS VACUOUS. I wrote `snapshotLine(REPO)`, but
    // the signature is (brief, manifest, repoRoot) — so REPO landed in `brief`, both fields came
    // back `?`, `differs` was ALWAYS false, and the assertion reduced to `false === false`. The
    // STALE path was never once exercised by the test written to close the STALE blind spot, and I
    // reported the marker as witnessed on the strength of it.
    //
    // ⇒ Both worlds are now CONSTRUCTED and each is checked. Staleness is decided against the real
    // HEAD, so "fresh" means the manifest commit IS that HEAD — not a sha I picked.
    const head = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const fresh = snapshotLine({ graph_commit: head }, { commit: head }, REPO);
    const stale = snapshotLine({ graph_commit: head }, { commit: 'b'.repeat(40) }, REPO);

    expect(stale, 'a differing indexed commit MUST be marked').toMatch(/ STALE$/);
    expectAbsentWithLiveMatcher(
      / STALE$/,
      { forbidden: stale, allowed: 'SNAPSHOT: indexed=x head=x dirty=0 trust=strong' },
      fresh,
      'a snapshot whose indexed commit equals HEAD must not be marked stale',
    );

    // And the two must genuinely differ, or one of them is not the world it claims to be.
    expect(/indexed=(\S+)/.exec(fresh)?.[1]).not.toBe(/indexed=(\S+)/.exec(stale)?.[1]);
  });

  it('★★★ its `indexed` really is the manifest commit, abbreviated', () => {
    // This is the assertion the guard structurally cannot make. A shortSha that returned a
    // constant would pass every shape check and every byte comparison, and be wrong here.
    //
    // ⛔ IT USED TO READ THE LIVE `.aify-graph/manifest.json`, AND THAT WAS AN AMBIENT DEPENDENCY
    // A RACE WAS SATISFYING. `.aify-graph` is gitignored, so a clean checkout legitimately has no
    // graph and this threw ENOENT there. It only passed inside the commit gate's materialized
    // worktree because a backgrounded post-checkout hook reindexed that worktree and won the race —
    // the same hook whose output the gate then refused as unexpected ignored state.
    //
    // ⇒ So its result depended on which of two unmanaged background processes got there first. It
    // was asserting about the ENVIRONMENT, not about the tree under test.
    //
    // Driven from a synthetic manifest instead: hermetic, runs in any checkout, and a constant
    // shortSha still fails it — which is the whole point of the assertion.
    const commit = '0123456789abcdef0123456789abcdef01234567';
    const line = snapshotLine({ graph_commit: commit }, { commit }, REPO);
    const indexed = /indexed=(\S+)/.exec(line)?.[1];
    expect(indexed, 'the abbreviation must be a real prefix of the recorded commit')
      .toBe(commit.slice(0, indexed.length));
    expect(indexed.length, 'and it must actually abbreviate, not pass the whole sha through')
      .toBeLessThan(commit.length);

    // NEGATIVE CONTROL: a DIFFERENT manifest commit must move the field. Without this, a
    // constant-returning shortSha whose constant happened to prefix-match would still pass.
    const other = 'fedcba9876543210fedcba9876543210fedcba98';
    const otherIndexed = /indexed=(\S+)/.exec(snapshotLine({ graph_commit: other }, { commit: other }, REPO))?.[1];
    expect(otherIndexed).not.toBe(indexed);
    expect(otherIndexed).toBe(other.slice(0, otherIndexed.length));
  });

  it('★★★ its `head` really is git HEAD, abbreviated', async () => {
    const head = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const out = await graphPacket({ repoRoot: REPO, target: 'graphPacket', mode: 'orient' });
    const shown = /head=(\S+)/.exec(snapshotOf(out))?.[1];
    expect(shown).toBe(head.slice(0, shown.length));
  }, 20_000);

  it('★★★ `dirty` tracks TRACKED changes, and the scope is the point', async () => {
    // ⚠ MY FIRST VERSION OF THIS TEST WAS WRONG, NOT THE CODE. I compared against
    // `git status --porcelain`, which counts untracked files too, and it failed on my own two new
    // files. `safeDirtyCount` uses `getTrackedDirtyFilesSync` — the same tracked-only scope the
    // rest of the freshness machinery uses, which is what makes health and the packet agree.
    // ⇒ Asserting against the wrong definition of the same word is how a correct implementation
    // gets "fixed" into a wrong one. The contract is tracked-dirty; that is what is pinned.
    // ⚠ Named scope limit, so it is visible rather than discovered: a NEW UNTRACKED source file
    // is absent from this count, and it is also absent from the graph. That gap is real and is
    // out of scope for this test.
    const tracked = execFileSync('git', ['-C', REPO, 'diff', '--name-only'], { encoding: 'utf8' })
      .split('\n').filter(Boolean).length;
    const staged = execFileSync('git', ['-C', REPO, 'diff', '--cached', '--name-only'], { encoding: 'utf8' })
      .split('\n').filter(Boolean).length;
    const out = await graphPacket({ repoRoot: REPO, target: 'graphPacket', mode: 'orient' });
    const shown = Number(/dirty=(\d+)/.exec(snapshotOf(out))?.[1]);
    if (tracked + staged === 0) {
      expect(shown, 'no tracked change means the count must be zero, not merely small').toBe(0);
    } else {
      expect(shown, 'a tracked-dirty tree must not render as clean').toBeGreaterThan(0);
    }
  }, 20_000);
});
