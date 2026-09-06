// ⛔ A VERDICT THAT NAMES A COMMIT IT NEVER MEASURED, 2026-09-06.
//
// `run-suite.mjs` REFUSES to start on a tracked-dirty tree. That door works, and it guards the
// ENTRY ONLY. Nothing re-checks during a run that takes about eleven minutes.
//
// Measured: I edited four skill files, ran sync-skills across four runtime trees, committed twice,
// and started a second suite, all while one was executing. It finished and printed
// `verdict is for commit 8d1288b1` — a commit three commits and eight files behind the tree it had
// actually measured. `VITEST_EXIT=1`, five failures.
//
// ⭐ AND A VOID RUN IS NOT A HARMLESS RUN. Four of those five did not reproduce in isolation; one
// was real. The void run hid a genuine finding inside four false ones, and the log was on its way to
// being committed as evidence about a commit it had never seen.
//
// ⇒ The remedy is a door, not a resolution to be careful. Every rule kept in this session had a
// mechanical door; every rule broken was one trusted to memory, and "do not modify the tree while a
// suite runs" was doorless.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyRunIntegrity } from '../../../scripts/lib/suite-run-integrity.mjs';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

describe('a suite verdict is void unless the tree held still for the whole run', () => {
  it('★★★ THE REAL CASE: HEAD moved during the run, so the verdict names a commit it never measured', () => {
    const r = classifyRunIntegrity({ headAtStart: SHA_A, headAtEnd: SHA_B, dirtyAtEnd: [] });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/HEAD moved/i);
    // Both ends named, because a reader has to see WHICH commits to understand what happened.
    expect(r.reason).toContain(SHA_A.slice(0, 7));
    expect(r.reason).toContain(SHA_B.slice(0, 7));
  });

  it('★★★ the tree going tracked-dirty mid-run also voids it', () => {
    // The entry check already refuses a dirty START. This is the other half: clean at the door and
    // dirty by the end means files moved underneath the run.
    const r = classifyRunIntegrity({
      headAtStart: SHA_A, headAtEnd: SHA_A, dirtyAtEnd: ['mcp/stdio/query/verbs/callers.js'],
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/tracked/i);
    expect(r.reason, 'name the file so the reader can see what moved').toContain('callers.js');
  });

  it('★★★ THE POSITIVE CONTROL: a quiet run is valid — a check that never passes is not a check', () => {
    const r = classifyRunIntegrity({ headAtStart: SHA_A, headAtEnd: SHA_A, dirtyAtEnd: [] });
    expect(r.valid).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('★★★ THE RUN\'S OWN LOG DOES NOT VOID THE RUN', () => {
    // ⛔ CAUGHT BEFORE SHIPPING, AND IT WOULD HAVE VOIDED EVERY RUN. run-suite copies the finished
    // log to a TRACKED path and only then reads the end state, so `latest.log` is always dirty at
    // that moment. A guard that fires on every run is worse than no guard: it trains the reader to
    // ignore it, and this repository has torn out an always-on caveat before.
    const r = classifyRunIntegrity({
      headAtStart: SHA_A,
      headAtEnd: SHA_A,
      dirtyAtEnd: ['docs/evidence/suite/latest.log'],
      expectedWrites: ['docs/evidence/suite/latest.log'],
    });
    expect(r.valid, 'the log the run writes by design is not evidence the tree moved').toBe(true);

    // ⭐ AND ONLY THAT FILE IS FORGIVEN. Anything else changing alongside it still voids, or the
    // exemption would be a hole wide enough to hide the original defect in.
    expect(classifyRunIntegrity({
      headAtStart: SHA_A,
      headAtEnd: SHA_A,
      dirtyAtEnd: ['docs/evidence/suite/latest.log', 'mcp/stdio/query/verbs/callers.js'],
      expectedWrites: ['docs/evidence/suite/latest.log'],
    }).valid).toBe(false);
  });

  it('★★★ an UNKNOWABLE end state voids rather than passes', () => {
    // ⛔ If git cannot be read at the end, the run is not thereby clean. Unknown fails closed here
    // like every other gate in this repository: a verdict is an attested fact, and this one could
    // not be attested.
    expect(classifyRunIntegrity({ headAtStart: SHA_A, headAtEnd: 'unknown', dirtyAtEnd: [] }).valid)
      .toBe(false);
    expect(classifyRunIntegrity({ headAtStart: 'unknown', headAtEnd: SHA_A, dirtyAtEnd: [] }).valid)
      .toBe(false);
    expect(classifyRunIntegrity({ headAtStart: SHA_A, headAtEnd: SHA_A, dirtyAtEnd: null }).valid)
      .toBe(false);
  });

  it('★★★ THE WIRING: run-suite consults it and says VOID rather than printing a verdict', () => {
    // The pure function is worth nothing if the script still prints "verdict is for commit X" after
    // the tree moved. That sentence is what got filed as evidence.
    const src = read('../../../scripts/run-suite.mjs');
    expect(src, 'the script must consult the guard').toContain('classifyRunIntegrity');
    expect(src, 'and must have an end-state reading to give it').toContain('headAtEnd');
    expect(src, 'a void run must say so').toMatch(/VOID/);
    // Live control: a name the file does not carry, proving these searches can fail.
    expect(src).not.toContain('classifyRunIntegrityZzq');
  });
});
