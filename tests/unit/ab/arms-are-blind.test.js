// ⛔ AN UNBLINDED PILOT IS NOT A PILOT — AND AN OVER-BLINDED ONE MEASURES A DIFFERENT TASK.
//
// Two defects, both mine, both in this one file's subject:
//
//   1. Excluding `server` from the mechanical contrast fixed the SCORER's view and left the AGENT's
//      view exposed. The real mutant arm told the agent buildId "<SHA>+1dirty", named
//      publication-schema.js in loadedDirtyFiles, and warned it not to diff its own behaviour. That
//      names the mechanism under test.
//   2. My fix then deleted every key whose NAME matched a list, recursively. Measured on a real
//      graph_health response that removed SIX paths where only TWO are the identity carrier —
//      including the TOP-LEVEL `commit`, which is the commit the graph was indexed from. Erasing it
//      changes the task rather than hiding the arm.
//
// Shape equality is necessary; content non-overreach is the other half. Both are tested here.
import { describe, it, expect } from 'vitest';
import {
  blindArmCues, findArmCues, assertNativeTierClean, IDENTITY_CARRIER_PATHS,
} from '../../../scripts/lib/ab-blind.mjs';

// The shape actually observed on the mutant arm, not an invented one.
const MUTANT_RESPONSE = {
  commit: 'feedface',                       // the GRAPH's indexed commit — task evidence
  summary: 'nodes=24 edges=23',
  server: {
    version: '0.7.1',
    commit: 'abc1234',
    buildId: 'abc1234+1dirty',
    loadedDirtyFiles: ['mcp/stdio/storage/publication-schema.js'],
    loadedDirtyNote: '⚠ This process loaded 1 UNCOMMITTED file(s), so it is running code that exists in no commit.',
    staleSignals: { commitMoved: false, sourceEdited: true },
  },
};

const CLEAN_RESPONSE = {
  commit: 'feedface',
  summary: 'nodes=24 edges=23',
  server: {
    version: '0.7.1',
    commit: 'abc1234',
    buildId: 'abc1234',
    staleSignals: { commitMoved: false, sourceEdited: false },
  },
};

describe('blinding removes the arm identity and nothing else', () => {
  it('POSITIVE CONTROL: the detector finds every cue in the real mutant response', () => {
    // ⛔ FIRST, because every assertion below is "no cues found". A detector that cannot see a cue
    // reports the same clean result as a correctly blinded payload.
    const cues = findArmCues(MUTANT_RESPONSE);
    expect(cues).toContain('+Ndirty build id');
    expect(cues).toContain('loadedDirtyFiles');
    expect(cues).toContain('loadedDirtyNote');
    expect(cues).toContain('uncommitted-file note');
  });

  it('⛔ blinding removes every cue from the FINAL SERIALISED BYTES', () => {
    const { blinded } = blindArmCues(MUTANT_RESPONSE);
    expect(findArmCues(JSON.stringify(blinded))).toEqual([]);
  });

  it('⛔ NEGATIVE CONTROL: legitimate lookalike keys and prose SURVIVE', () => {
    // ⭐ THE HALF I GOT WRONG. A blinder that erases task evidence looks identical to one that works.
    // Every field here resembles a carrier and is legitimate content an agent may need.
    const legitimate = {
      commit: 'feedface',                                  // graph's indexed commit
      manifestCommit: 'cafebabe',
      headCommit: 'deadbeef',
      latestCollection: { indexedCommit: '0badf00d', filesProcessed: 3 },
      server: { version: '0.7.1', commit: 'abc1234', staleSignals: { commitMoved: false } },
      summary: 'The worktree is dirty and 2 files changed since the collection.',
      trustBasis: { total_unresolved: 7 },
      generationState: 'generation_mismatch',
    };
    const { blinded, removedPaths } = blindArmCues(legitimate);
    expect(removedPaths, 'nothing here is an identity carrier').toEqual([]);
    expect(blinded).toEqual(legitimate);
    // Named individually, because an equality check would pass if the whole object were returned
    // untouched for the wrong reason.
    expect(blinded.commit).toBe('feedface');
    expect(blinded.latestCollection.indexedCommit).toBe('0badf00d');
    expect(blinded.server.commit).toBe('abc1234');
    expect(blinded.summary, 'legitimate prose about a dirty worktree must survive')
      .toMatch(/worktree is dirty/);
    expect(blinded.trustBasis.total_unresolved).toBe(7);
    expect(blinded.generationState).toBe('generation_mismatch');
  });

  it('⛔ the removed population is EXACTLY the preregistered carrier, and it is audited', () => {
    // The audit trail is what makes "we only removed the arm identity" checkable rather than
    // claimed. My recursive version could not have produced this list.
    const { removedPaths } = blindArmCues(MUTANT_RESPONSE);
    expect(removedPaths.sort()).toEqual(
      ['server.buildId', 'server.loadedDirtyFiles', 'server.loadedDirtyNote'].sort());
    for (const p of removedPaths) expect(IDENTITY_CARRIER_PATHS).toContain(p);
  });

  it('⛔ the TOP-LEVEL commit survives — this is the over-reach that was measured and fixed', () => {
    const { blinded } = blindArmCues(MUTANT_RESPONSE);
    expect(blinded.commit, 'the graph indexed commit is task evidence, not arm metadata').toBe('feedface');
    expect(blinded.server.commit, 'equalising build commits is the runner\'s job, not the blinder\'s').toBe('abc1234');
    expect(blinded.server.staleSignals).toEqual({ commitMoved: false, sourceEdited: true });
  });

  it('pre/post hashes are reported so a change can be proven rather than asserted', () => {
    const r = blindArmCues(MUTANT_RESPONSE);
    expect(r.hashBefore).toMatch(/^[0-9a-f]{64}$/);
    expect(r.hashAfter).toMatch(/^[0-9a-f]{64}$/);
    expect(r.hashBefore).not.toBe(r.hashAfter);

    const untouched = blindArmCues({ summary: 'nothing to remove' });
    expect(untouched.hashBefore, 'a no-op must leave the hash identical').toBe(untouched.hashAfter);
  });

  it('⛔ NATIVE TIER: a dirty payload is VOID, not silently normalised', () => {
    // Clean separate builds are mandatory there. If the blinder has real work to do, the arms were
    // not built clean, and normalising it away would hide that rather than fix it.
    const verdict = assertNativeTierClean(MUTANT_RESPONSE);
    expect(verdict.clean).toBe(false);
    expect(verdict.reason).toMatch(/were not built clean|void/);
  });

  it('POSITIVE CONTROL: a genuinely clean payload passes the native-tier gate', () => {
    // ⛔ Without this the gate could be permanently closed, which is off rather than fail-closed.
    const verdict = assertNativeTierClean(CLEAN_RESPONSE);
    expect(verdict.clean).toBe(true);
    expect(verdict.reason).toBeNull();
  });

  it('blinding does NOT touch the fields the benchmark measures', () => {
    const withFinding = {
      summary: 'nodes=24',
      trustBasis: { total_unresolved: 7 },
      generationState: 'generation_mismatch',
    };
    const { blinded, removedPaths } = blindArmCues(withFinding);
    expect(removedPaths).toEqual([]);
    expect(blinded).toEqual(withFinding);
  });
});
