// ★ THE NUMBER WITHOUT THE CONSEQUENCE IS HALF AN ANSWER.
//
// sc-manager, field-testing on a repo nobody tuned the tool against:
//
//   "It told me the fact (44 commits stale) but not the consequence. For
//    orientation, 44 stale is harmless. For 'is #96 linked to this file', 44 stale
//    was fatal. A per-field staleness-consequence hint would close the gap between
//    knowing the number and knowing whether it matters for the question in hand."
//
// His own session shows why the split is not obvious: the TASK OVERLAY missed a card
// that the GIT LAYER found, in the same call. Those layers do not age together —
// last_touched/activity shell out to `git log` at query time, while the task and
// feature overlay is a stored artifact ageing on its own clock. One boolean `stale`
// flag cannot express that, so a reader either over-trusts everything or discards
// everything.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const health = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../mcp/stdio/query/verbs/health.js'),
  'utf8',
);

describe('★ staleness reports its consequence, not only its magnitude', () => {
  it('only builds the block when the graph is actually stale', () => {
    // A permanent advisory is noise, and noise on the trust surface is what makes
    // real banners ignorable — the same argument that deleted filler nextActions.
    expect(health).toMatch(/const stalenessImpact = stale \? \(\(\) => \{/);
    expect(health).toMatch(/\}\)\(\) : null;/);
  });

  it('computes how far behind rather than just saying "stale"', () => {
    expect(health).toMatch(/rev-list', '--count'/);
    expect(health).toMatch(/commits_behind/);
  });

  it('★ names what staleness does NOT affect — the half a reader gets wrong', () => {
    // Discarding a whole answer because one flag was set is as costly as trusting it.
    expect(health).toMatch(/unaffected/);
    expect(health).toMatch(/query the language server, not this snapshot/);
    expect(health).toMatch(/git log` LIVE|`git log` at query time/);
  });

  it('names what it DOES affect, in question-shaped terms', () => {
    expect(health).toMatch(/a "not found" may mean "not indexed yet"/);
    expect(health).toMatch(/degraded/);
  });

  it('separates commit-distance staleness from overlay age, which is a different clock', () => {
    // The exact confusion in his report: the task overlay missed what git found.
    expect(health).toMatch(/age on their OWN clock/);
  });

  it('does not let the consequence read as an absence claim', () => {
    expect(health).toMatch(/an absence here is not evidence of absence/);
  });
});
