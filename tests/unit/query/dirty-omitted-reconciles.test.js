// AN OMITTED-COUNT THAT DISAGREES WITH THE PAYLOAD IS WORSE THAN NO COUNT.
//
// I introduced this the same day I suppressed the untracked name list, and
// ef-manager caught it one commit later: dirtyFilesOmitted kept subtracting
// DIRTY_LIST_CAP unconditionally, so echoes reported omitted 2799 of total 2824 —
// arithmetic asserting 25 names were shown, in a response that shows none.
//
// A reader reconciles those two numbers and concludes the payload was truncated
// somewhere they cannot see. Same family as positionGuessSkipped 0 against 21
// position_unresolved records, which was fixed by explaining the disagreement in
// place; here the right fix is for the numbers not to disagree at all.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'mcp', 'stdio', 'query', 'verbs', 'health.js'),
  'utf8',
);

describe('dirtyFilesOmitted matches what was actually printed', () => {
  it('★ derives the count from whether names were emitted at all', () => {
    // The bug was an unconditional `- DIRTY_LIST_CAP`, which assumed a list that
    // the suppression branch had already removed.
    expect(src).not.toMatch(/dirtyFilesOmitted: dirtyFiles\.length - DIRTY_LIST_CAP\b/);
    expect(src).toMatch(/trackedDirtyFiles\.length > 0 \? Math\.min\(dirtyFiles\.length, DIRTY_LIST_CAP\) : 0/);
  });

  it('the suppressed case omits everything, by construction', () => {
    // trackedDirtyFiles empty → subtrahend 0 → omitted === total. Asserted on the
    // expression because the alternative is a fixture that reproduces 2824 dirty
    // files, which is slower than the thing it guards.
    const i = src.indexOf('dirtyFilesOmitted');
    expect(src.slice(i - 900, i + 300)).toMatch(/must match what was actually printed/i);
  });
});
