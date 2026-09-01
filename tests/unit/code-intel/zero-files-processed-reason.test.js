// ⛔ A ZERO WITH NO CAUSE IS THE TEST AND THE PRODUCT SHARING ONE AMBIGUOUS FAILURE STRING.
//
// `graphCollectCodeIntel` could return `status: 'partial'` having collected nothing, with no field
// saying why, and the integration test then asserted `expected 0 to be greater than 0`. A starved
// clangd and a broken graph join surface identically, so the assertion cannot say which occurred
// and no number of reruns separates them. This is M2's contract in the collect path.
//
// ⚠ EVERY VALUE DERIVES FROM AN EXPLICIT PRODUCER ASSERTION, never from a scalar. Three values I
// first proposed were struck for exactly that: `filesTotal === 0` is this call's REMAINDER and is
// also 0 on a converged resume; `resumedFrom` is a resume count, not a completion assertion; and
// `indexReady === false` is a state, not a demonstrated cause of zero files.
//
// Preregistration: docs/evidence/typed-zero-reason/PREREGISTRATION.md
import { describe, it, expect } from 'vitest';
import { zeroFilesProcessedReason } from '../../../mcp/stdio/code-intel/zero-files-reason.js';

const note = (code) => ({ code, message: `${code} note` });

describe('zeroFilesProcessedReason — derived only from producer assertions', () => {
  it('⛔ a typed already_collected note with complete state yields ALREADY_COMPLETE', () => {
    expect(zeroFilesProcessedReason({ filesProcessed: 0, notes: [note('already_collected')], complete: true }))
      .toEqual({ reason: 'ALREADY_COMPLETE', authority: 'producer_note:already_collected' });
  });

  it('⛔ already_collected WITHOUT complete state does NOT claim completion', () => {
    // The producer's own comment: a truncated walk means there are files this pass was never
    // shown, so "nothing pending" describes the LIST, not the repository.
    expect(zeroFilesProcessedReason({ filesProcessed: 0, notes: [note('already_collected')], complete: false }).reason)
      .toBe('ZERO_FILES_CAUSE_UNKNOWN');
  });

  it('⛔ a typed no_files note yields NO_FILES_IN_REQUESTED_SCOPE, naming the scope not the repo', () => {
    expect(zeroFilesProcessedReason({ filesProcessed: 0, notes: [note('no_files')] }).reason)
      .toBe('NO_FILES_IN_REQUESTED_SCOPE');
  });

  it('⛔ budget exhaustion with ZERO files processed is the starvation case', () => {
    expect(zeroFilesProcessedReason({ filesProcessed: 0, notes: [note('budget_exhausted')] }).reason)
      .toBe('BUDGET_EXHAUSTED_BEFORE_FIRST_FILE');
  });

  it('⛔ NEGATIVE CONTROL: budget exhaustion AFTER work is not a zero at all', () => {
    // The discriminator the whole design rests on. My repaired differential measured every
    // SUCCESSFUL run reporting budgetExhausted: true — exhaustion is the normal end state, so a
    // reason keyed on it alone would fire on healthy runs, which is what made the first probe's
    // `partial_no_files` meaningless.
    expect(zeroFilesProcessedReason({ filesProcessed: 3, notes: [note('budget_exhausted')] }))
      .toBeUndefined();
  });

  it('⛔ two contradictory producer reasons yield UNKNOWN_CONFLICT, never a winner', () => {
    // Picking one would mean choosing which explanation to believe. A precedence order here would
    // be a flattering noun with extra steps.
    expect(zeroFilesProcessedReason({ filesProcessed: 0, notes: [note('already_collected'), note('no_files')], complete: true }).reason)
      .toBe('UNKNOWN_CONFLICT');
  });

  it('an unrecognised note leaves the cause explicitly unknown', () => {
    expect(zeroFilesProcessedReason({ filesProcessed: 0, notes: [note('compile_db_all_filtered')] }).reason)
      .toBe('ZERO_FILES_CAUSE_UNKNOWN');
  });

  it('no notes at all still yields an explicit unknown, not silence', () => {
    expect(zeroFilesProcessedReason({ filesProcessed: 0, notes: [] }).reason).toBe('ZERO_FILES_CAUSE_UNKNOWN');
  });
});

describe('the field is OMITTED when the population itself is not established', () => {
  // ⛔ MY FIRST RULE SAID "UNKNOWN, never coerced to zero", AND THAT WAS STILL WRONG.
  // ZERO_FILES_CAUSE_UNKNOWN *asserts that zero files were processed* and only leaves the cause
  // open. If the wrapper cannot establish the population it cannot assert the population, so it
  // must say nothing here at all.
  for (const bad of [undefined, null, 'zero', 1.5, NaN, {}]) {
    it(`filesProcessed = ${JSON.stringify(bad) ?? String(bad)} omits the field entirely`, () => {
      expect(zeroFilesProcessedReason({ filesProcessed: bad, notes: [note('no_files')] })).toBeUndefined();
    });
  }

  it('POSITIVE CONTROL: integer 0 with the same notes DOES produce a reason', () => {
    // Without this, a function that returned undefined unconditionally would pass every
    // assertion above while the feature did nothing.
    expect(zeroFilesProcessedReason({ filesProcessed: 0, notes: [note('no_files')] })).toBeDefined();
  });

  it('POSITIVE CONTROL: a healthy nonzero run omits the field', () => {
    expect(zeroFilesProcessedReason({ filesProcessed: 7, notes: [] })).toBeUndefined();
  });
});

describe('the schema discriminator travels with the value', () => {
  it('every emitted reason carries its authority, so a reader can tell what asserted it', () => {
    const r = zeroFilesProcessedReason({ filesProcessed: 0, notes: [note('no_files')] });
    expect(r.authority).toBe('producer_note:no_files');
  });

  it('the unknown value names its own lack of authority rather than inventing one', () => {
    const r = zeroFilesProcessedReason({ filesProcessed: 0, notes: [] });
    expect(r.authority).toBe('none');
  });
});
