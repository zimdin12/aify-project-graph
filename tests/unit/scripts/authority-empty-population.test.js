// ⛔ `ALL FILES COMPLETE` IS A NON-NEGOTIABLE AUTHORITY CLAIM, AND IT WAS ONE DELETION FROM BEING
// VACUOUS.
//
// The line was `complete: files.every((f) => f.complete)`. `[].every(pred)` is TRUE, so an empty
// authority population would have certified that EVERY FILE IS COMPLETE over ZERO FILES — the
// strongest possible statement on the weakest possible evidence, with nothing in the output looking
// any different. It was safe only because FILE_AUTHORITIES happens to be a six-entry module literal.
//
// ⇒ Found by the candidate-hazard inventory, which exists because `volatileShapeOk` failed in
// exactly this way: there the vacuous `true` disabled a WIRED fail path for the entire life of the
// tool. This is the same shape, in one of the three gates every slice depends on.
//
// ⚠ AN EMPTY POPULATION IS NOT "INCOMPLETE". Nothing was examined, so no verdict about completeness
// exists to give. Collapsing it to `false` would be honest about the exit code and dishonest about
// the reason — and this repository has paid before for a REFUSE reported as a FAILURE.
import { describe, it, expect } from 'vitest';
import { allFilesComplete, AUTHORITY_VERDICT, auditAll } from '../../../scripts/authority-ledger.mjs';

const complete = (file) => ({ file, complete: true });
const incomplete = (file) => ({ file, complete: false });

describe('the authority verdict seam', () => {
  it('★★★⛔ AN EMPTY POPULATION REFUSES — it does not certify', () => {
    const r = allFilesComplete([]);
    expect(r.verdict).toBe(AUTHORITY_VERDICT.REFUSED_EMPTY);
    expect(r.complete, 'and it must never read as a pass').toBe(false);
    expect(r.examined).toBe(0);
    expect(r.reason).toMatch(/vacuously true/);
  });

  it('★★★ POSITIVE CONTROL: a real, wholly complete population IS certified', () => {
    // ⛔ Without this the refusals here are satisfied by a function that never returns COMPLETE,
    // which would fail the gate on every run and get switched off within a day.
    const r = allFilesComplete([complete('a.js'), complete('b.js')]);
    expect(r.verdict).toBe(AUTHORITY_VERDICT.COMPLETE);
    expect(r.complete).toBe(true);
    expect(r.examined, 'the cardinality travels with the verdict').toBe(2);
  });

  it('★★★ one incomplete among complete is INCOMPLETE, and names which', () => {
    const r = allFilesComplete([complete('a.js'), incomplete('b.js'), complete('c.js')]);
    expect(r.verdict).toBe(AUTHORITY_VERDICT.INCOMPLETE);
    expect(r.complete).toBe(false);
    expect(r.examined).toBe(3);
    expect(r.reason, 'a verdict that cannot say WHICH file sends the reader hunting').toMatch(/b\.js/);
  });

  it('★★★⛔ REFUSED_EMPTY and INCOMPLETE are DISTINCT — both false, different claims', () => {
    // "no files were checked" and "files were checked and found wanting" are different facts. The
    // exit code is the same; the reason a human reads is not.
    expect(allFilesComplete([]).verdict).not.toBe(allFilesComplete([incomplete('a.js')]).verdict);
  });

  it('★★★⛔ a NON-ARRAY population refuses rather than throwing or passing', () => {
    // Fail closed on garbage: an authority claim must not depend on the caller having passed the
    // right type, and a throw here would be an apparatus error dressed as a gate failure.
    for (const bad of [null, undefined, {}, 'files', 0]) {
      expect(allFilesComplete(bad).verdict, JSON.stringify(bad)).toBe(AUTHORITY_VERDICT.REFUSED_EMPTY);
    }
  });
});

describe('the real ledger uses the seam', () => {
  it('★★★ auditAll reports a verdict and an examined count, not a bare boolean', () => {
    // ⚠ The production caller must go through the same function the tests above pin. A seam only
    // tested in isolation proves the seam, not the gate.
    const r = auditAll();
    expect(Object.values(AUTHORITY_VERDICT)).toContain(r.verdict);
    expect(r.examined, 'the six-entry population is PRESENTATION; the count is authority').toBe(r.files.length);
    expect(r.examined).toBeGreaterThan(0);
  });
});
