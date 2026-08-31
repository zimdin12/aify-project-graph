// ⛔ AN UNBLINDED PILOT IS NOT A PILOT.
//
// Excluding `server` from the mechanical contrast was correct for computing whether the mutant
// changes a route, and it said NOTHING about what the agent sees. The agent sees the real tool
// response, and on the real mutant arm that response read:
//
//   buildId "<SHA>+1dirty", loadedDirtyFiles ["mcp/stdio/storage/publication-schema.js"],
//   and a note saying the process loaded uncommitted files and its behaviour should not be diffed.
//
// That names the modified file, and the modified file IS the mechanism under test. Every one of
// these cases exists because I did not think of this until review named it.
import { describe, it, expect } from 'vitest';
import { blindArmCues, findArmCues, ARM_IDENTIFYING_FIELDS } from '../../../scripts/lib/ab-blind.mjs';

// The shape actually observed on the mutant arm, not an invented one.
const MUTANT_RESPONSE = {
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

const CONTROL_RESPONSE = {
  summary: 'nodes=24 edges=23',
  server: {
    version: '0.7.1',
    commit: 'abc1234',
    buildId: 'abc1234',
    staleSignals: { commitMoved: false, sourceEdited: false },
  },
};

describe('no agent-visible payload identifies its arm', () => {
  it('POSITIVE CONTROL: the detector finds every cue in the real mutant response', () => {
    // ⛔ FIRST, because every assertion below is "no cues found". A detector that cannot see a cue
    // reports the same clean result as a correctly blinded payload, and this exact failure — a
    // probe that cannot return PRESENT — is why the pilot needs it proven before it is trusted.
    const cues = findArmCues(MUTANT_RESPONSE);
    expect(cues).toContain('+Ndirty build id');
    expect(cues).toContain('loadedDirtyFiles');
    expect(cues).toContain('loadedDirtyNote');
    expect(cues).toContain('uncommitted-file note');
  });

  it('⛔ blinding removes every cue from the mutant response', () => {
    expect(findArmCues(blindArmCues(MUTANT_RESPONSE))).toEqual([]);
  });

  it('⛔ the SAME rule is applied to the control — normalising one arm only swaps one cue for another', () => {
    // If blinding ran only on the treatment arm, "this response has no buildId" would itself
    // identify the arm. Symmetry is the whole property.
    const blindedMutant = blindArmCues(MUTANT_RESPONSE);
    const blindedControl = blindArmCues(CONTROL_RESPONSE);
    // Identifying fields are REMOVED from both, so neither arm can be told apart by their presence,
    // their absence, or their value.
    expect(Object.keys(blindedMutant.server).sort()).toEqual(Object.keys(blindedControl.server).sort());
    expect('buildId' in blindedMutant.server).toBe(false);
    expect('loadedDirtyFiles' in blindedMutant.server).toBe(false);
    expect(blindedMutant.server.version).toBe(blindedControl.server.version);
  });

  it('⛔ after blinding, the two arms are INDISTINGUISHABLE outside the mechanism', () => {
    // The remaining difference must be graph behaviour, not build metadata. Here the two responses
    // carry identical summaries, so blinded they must be byte-identical.
    expect(JSON.stringify(blindArmCues(MUTANT_RESPONSE)))
      .toBe(JSON.stringify(blindArmCues(CONTROL_RESPONSE)));
  });

  it('⛔ cues hidden in PROSE are caught, not just in fields', () => {
    // The dirty note is a sentence. A rule that only knows field names would leave it in a summary
    // string, and the agent reads the summary.
    const prose = 'Everything looks fine. ⚠ This process loaded 2 UNCOMMITTED file(s) — abc1234+2dirty.';
    expect(findArmCues(prose).length).toBeGreaterThan(0);
    expect(findArmCues(blindArmCues(prose))).toEqual([]);
  });

  it('⛔ blinding is RECURSIVE — a cue nested anywhere is still a cue', () => {
    // `server` is nested inside graph_health today. A rule that only knows one path stops working
    // the moment the response shape changes, silently and in the unblinding direction.
    const nested = { a: { b: { c: { buildId: 'deadbeef+3dirty' } } } };
    expect(findArmCues(blindArmCues(nested))).toEqual([]);
  });

  it('blinding does NOT touch the fields the benchmark actually measures', () => {
    // ⛔ A blinding rule that erased the answer would make every arm look identical and the pilot
    // would report no effect — a null produced by the instrument rather than by the world.
    const withFinding = { summary: 'nodes=24', trustBasis: { total_unresolved: 7 }, generationState: 'generation_mismatch' };
    const blinded = blindArmCues(withFinding);
    expect(blinded.trustBasis.total_unresolved).toBe(7);
    expect(blinded.generationState).toBe('generation_mismatch');
    expect(blinded.summary).toBe('nodes=24');
  });

  it('the identifying-field list is non-empty and names what was actually observed', () => {
    expect(ARM_IDENTIFYING_FIELDS.length).toBeGreaterThan(4);
    for (const f of ['buildId', 'loadedDirtyFiles', 'loadedDirtyNote']) {
      expect(ARM_IDENTIFYING_FIELDS).toContain(f);
    }
  });
});
