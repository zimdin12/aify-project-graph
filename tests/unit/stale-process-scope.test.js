// THE STALENESS IS A PROPERTY OF THE PROCESS, NOT OF THE REPO YOU ASKED ABOUT.
//
// ⛔ FIELD REPORT (ef-manager, 2026-08-19), catching themselves mid-error:
//   "I assumed I could at least test discovery on echoes, since echoes' checkout has not moved.
//    It does not work that way: ONE MCP process serves both repos, so a stale process poisons
//    every repo it answers for. The staleness field is scoped to the repo you ask about; the
//    defect is scoped to the process."
// The old text said "...but the checkout is now <sha>" — singular, and that is the sentence that
// invites a reader with two repos to test the other one and believe the result. Three of their
// last four rounds opened blocked on this.
//
// ⚠ MY FIRST VERSION OF THIS TEST GREPPED THE SOURCE for the new phrase. That is the exact
// "gate on spelling rather than behaviour" defect graph-senior-dev had already caught in two of
// my instruments this week — committed inside the fix for a scope defect, and flagged by the
// suite-composition guard. The warning is now a pure function and this CALLS it.
import { describe, it, expect } from 'vitest';
import { buildStaleWarning } from '../../mcp/stdio/server-build.js';

const stale = (over = {}) => buildStaleWarning({
  loadedCommit: 'aaa1111',
  startedAt: '2026-08-19T00:00:00.000Z',
  treeCommit: 'bbb2222',
  staleDelta: { executable_files_changed: 3, files_changed: 3, sample: ['mcp/x.js'] },
  ...over,
});

describe('the stale-process warning', () => {
  it('★★★ states that the staleness applies to EVERY repo this process serves', () => {
    expect(stale(), 'a reader with two checkouts must not conclude the other one is safe')
      .toMatch(/EVERY REPO THIS PROCESS SERVES/);
  });

  it('★★★ still carries the values that make it worth printing', () => {
    // This string is VALUE-BEARING — it embeds the loaded commit, the start time and the
    // checkout — which is why it is printed rather than externalised into a skill. A widened
    // scope that dropped the specifics would trade one blind spot for another.
    const w = stale();
    expect(w).toContain('aaa1111');
    expect(w).toContain('bbb2222');
    expect(w).toContain('2026-08-19T00:00:00.000Z');
  });

  it('★★★ still tells a peer agent it can restart the session itself', () => {
    // The earlier defect in this same sentence asserted the reader could NOT self-restart, and
    // ef-manager asked the operator twice for something they could do in one call. Pinned so the
    // scope fix cannot quietly drop it.
    expect(stale()).toMatch(/comms_restart|restart/i);
  });

  it('★★★ a behaviourally-current delta says so instead of demanding a restart', () => {
    // The graded verdict ef-manager called "the best thing in this build": distinguishing stale
    // from stale-in-a-way-that-can-change-an-answer is what turns a blocking condition into a
    // scoped one. Still true after the scope widening.
    const w = stale({ staleDelta: { behaviourally_current: true, files_changed: 1, sample: [], executable_files_changed: 0 } });
    expect(w).toMatch(/BEHAVIOURALLY CURRENT/);
    expect(w).toMatch(/restart is not\s+required/);
  });

  it('★★★ an uncomputable delta fails CLOSED — assume it matters', () => {
    expect(stale({ staleDelta: null })).toMatch(/assume it matters/i);
  });
});
