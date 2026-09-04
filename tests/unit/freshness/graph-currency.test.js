// ⛔⛔ AN UNREADABLE HEAD MADE EVERY VERB GO SILENT ABOUT STALENESS.
//
// `server.js` compared the manifest's commit to HEAD in TWO places, both spelled the same way:
//
//     const head = await getHeadCommit(repoRoot).catch(() => null);
//     if (manifest?.commit && head && manifest.commit !== head) { ... }
//
// The `&& head &&` term collapses three states into two. When HEAD cannot be read — a repo that is
// not a git checkout, a broken .git, git absent from PATH — the predicate is false and the reader is
// told nothing. Not "currency unknown". Silence, on the choke point every string-returning verb
// returns through, which the comment beside it says exists precisely so an agent "who never calls
// health would never learn".
//
// ⚠ THIS IS THE THIRD INSTANCE OF ONE SHAPE IN ONE FILE-FAMILY. The trust banner had it twice
// (`stale` as a boolean set from two causes, and the currency probe), and both were repaired by
// giving the value a third state and a cause. Finding the same collapse at the server choke point
// is what turned it from two defects into a class — and the fix is the same fix.
//
// ⚠ AND THE TWO CALL SITES WANT DIFFERENT THINGS FROM THE SAME FACT. One triggers an auto-reindex;
// one emits a warning. Not reindexing on an unknown is defensible — do not spend work you cannot
// justify. Saying NOTHING on an unknown is not. Splitting the DECISION from the FACT is what lets
// those differ on purpose instead of by accident, and is why this is a pure function rather than a
// third inline branch.
import { describe, it, expect } from 'vitest';
import { graphCurrency } from '../../../mcp/stdio/freshness/graph-currency.js';

describe('graph currency is a fact with three states, not a boolean', () => {
  it('★★★ an unreadable HEAD is UNKNOWN, never current', () => {
    const c = graphCurrency({ indexedCommit: 'a'.repeat(40), head: null });
    expect(c.state, 'the defect: this used to be indistinguishable from current').toBe('unknown');
    expect(c.reason, 'and it names which side could not be read').toMatch(/HEAD/);
  });

  it('★★★ a manifest with no recorded commit is UNKNOWN, with its own reason', () => {
    // The other side of the same comparison. Both are unknowns; a reader chasing one needs to know
    // which, so the states match and the reasons do not.
    const c = graphCurrency({ indexedCommit: null, head: 'b'.repeat(40) });
    expect(c.state).toBe('unknown');
    expect(c.reason, 'the graph side, not the HEAD side').toMatch(/indexed commit|manifest/i);
    expect(c.reason).not.toBe(graphCurrency({ indexedCommit: 'a'.repeat(40), head: null }).reason);
  });

  it('★★★ differing commits are STALE', () => {
    const c = graphCurrency({ indexedCommit: 'a'.repeat(40), head: 'b'.repeat(40) });
    expect(c.state).toBe('stale');
  });

  it('★★ POSITIVE CONTROL: matching commits are CURRENT, so the warning still means something', () => {
    // ⛔ Without this, a change that returned 'unknown' unconditionally would satisfy every
    // assertion above while making the warning fire on every healthy repo — and a warning that
    // always fires is discarded exactly as completely as one that never fires.
    const sha = 'a'.repeat(40);
    const c = graphCurrency({ indexedCommit: sha, head: sha });
    expect(c.state).toBe('current');
    expect(c.reason, 'nothing to explain when the answer is clean').toBeNull();
  });

  it('★★ neither side readable is UNKNOWN, and does not crash', () => {
    expect(graphCurrency({ indexedCommit: null, head: null }).state).toBe('unknown');
    expect(graphCurrency({}).state).toBe('unknown');
    expect(graphCurrency().state, 'called with nothing at all').toBe('unknown');
  });

  it('★★★ only CURRENT licenses silence — the decision reads the state, not a boolean', () => {
    // The property the two server call sites depend on. A caller asking "may I say nothing?" gets a
    // single answer derived from the state, so the auto-reindex site and the warning site cannot
    // drift into disagreeing about what an unknown means.
    const sha = 'a'.repeat(40);
    expect(graphCurrency({ indexedCommit: sha, head: sha }).state === 'current').toBe(true);
    for (const c of [
      graphCurrency({ indexedCommit: sha, head: 'b'.repeat(40) }),
      graphCurrency({ indexedCommit: sha, head: null }),
      graphCurrency({ indexedCommit: null, head: sha }),
    ]) {
      expect(c.state === 'current', `${c.state} must not read as current`).toBe(false);
      expect(typeof c.reason, 'every non-current state explains itself').toBe('string');
    }
  });
});
