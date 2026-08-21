// ⛔ THE CONTROL THAT CHECKS EVERYTHING ELSE HAD NO MECHANICAL GUARD OF ITS OWN.
//
// On 2026-08-22 a mutation control failed to apply SIX TIMES in one day. Every time, the suite then
// reported a GREEN from an UNMUTATED tree — because an inert control and a survived mutation
// produce identical output. Each was caught by a HAND-WRITTEN site-count assertion, which is the
// defect: the guard against a silent no-op depended on remembering to write the guard.
//
// ⇒ That is an ATTENTIONAL control, standing in the one tool used to verify everything else. Six
// catches prove the mechanism works and prove the hand-reproduction is the weak link.
//
// ⛔⛔ AND THERE ARE TWO FAILURE MODES, NOT ONE. Reverting this repo's P0 fix meant changing
// `return null;` in freshness/git.js — which occurs THREE TIMES there. Only one is the target. A
// replace-all mutates three sites and the experiment watches a different thing fail, while looking
// exactly like a success. An `equals` check catches both; a "did it apply?" check catches only the
// first.
import { describe, it, expect } from 'vitest';
import { runMutationControl, specProblem, OUTCOME } from '../../../scripts/lib/mutation-control.mjs';

/** An in-memory file system so these tests never touch the checkout. */
function fakeFs(initial) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    read: (p) => {
      if (!files.has(p)) { const e = new Error('no such file'); e.code = 'ENOENT'; throw e; }
      return files.get(p);
    },
    write: (p, c) => files.set(p, c),
  };
}

const execWith = (status) => () => ({ status, signal: null, stderr: '', stdout: '' });
const SPEC = { file: 'a.js', from: 'return null;', to: 'return [];', sites: 1, run: 'noop' };

describe('the count is not optional, and it must be EXACT', () => {
  it('★★★⛔ ZERO matches REFUSES — the failure that produced six false greens', () => {
    const fs = fakeFs({ 'a.js': 'return 0;' });
    const r = runMutationControl(SPEC, { ...fs, exec: execWith(1) });
    expect(r.outcome).toBe(OUTCOME.REFUSED);
    expect(r.found).toBe(0);
    expect(r.reason, 'and it says the green would mean nothing').toMatch(/NOTHING WAS MEASURED/);
  });

  it('★★★⛔ TOO MANY matches ALSO refuses — the twin hazard, measured on the real repo', () => {
    // ⛔ `return null;` appears three times in freshness/git.js and only one is the target. A
    // replace-all would mutate three sites and the experiment would watch something else fail.
    const fs = fakeFs({ 'a.js': 'return null; ... return null; ... return null;' });
    const r = runMutationControl(SPEC, { ...fs, exec: execWith(1) });
    expect(r.outcome).toBe(OUTCOME.REFUSED);
    expect(r.found).toBe(3);
    expect(fs.files.get('a.js'), 'and NOTHING was written').toBe('return null; ... return null; ... return null;');
  });

  it('★★★ POSITIVE CONTROL: the exact count APPLIES and runs', () => {
    // ⛔ Without this every refusal above is satisfied by a function that refuses unconditionally —
    // a control that never runs is not a safe control, it is an absent one.
    const fs = fakeFs({ 'a.js': 'x; return null; y' });
    const r = runMutationControl(SPEC, { ...fs, exec: execWith(1) });
    expect(r.outcome).toBe(OUTCOME.CAUGHT);
    expect(r.sites).toBe(1);
  });

  it('★★★⛔ `sites` has NO DEFAULT — an unstated expectation is the hazard itself', () => {
    const { sites, ...noSites } = SPEC;
    void sites;
    expect(specProblem(noSites)).toMatch(/no default/);
    expect(specProblem({ ...SPEC, sites: 0 })).toMatch(/positive integer/);
  });

  it('★★★⛔ an edit identical to the original is refused as a no-op BY CONSTRUCTION', () => {
    expect(specProblem({ ...SPEC, to: SPEC.from })).toMatch(/no-op by construction/);
  });
});

describe('the verdict is the exit code, and both outcomes are real', () => {
  it('★★★⛔ SURVIVED when the command still passes — nothing detects the change', () => {
    // ⚠ This is the outcome that must NOT be silently reported as success. A mutation that applied
    // and changed no test result means the suite has a hole exactly there.
    const fs = fakeFs({ 'a.js': 'return null;' });
    const r = runMutationControl(SPEC, { ...fs, exec: execWith(0) });
    expect(r.outcome).toBe(OUTCOME.SURVIVED);
    expect(r.reason).toMatch(/nothing in the suite detects this change/);
  });

  it('★★★ CAUGHT when the command fails — and both are distinguished from REFUSED', () => {
    const fs = fakeFs({ 'a.js': 'return null;' });
    expect(runMutationControl(SPEC, { ...fs, exec: execWith(1) }).outcome).toBe(OUTCOME.CAUGHT);
    // ⛔ Three outcomes, not two. "did not run" must never collapse into "passed" or "failed".
    expect(new Set([OUTCOME.CAUGHT, OUTCOME.SURVIVED, OUTCOME.REFUSED]).size).toBe(3);
  });

  it('★★★⛔ a KILLED command is CAUGHT, not survived', () => {
    const fs = fakeFs({ 'a.js': 'return null;' });
    const killed = () => ({ status: null, signal: 'SIGKILL', stderr: '', stdout: '' });
    expect(runMutationControl(SPEC, { ...fs, exec: killed }).outcome).toBe(OUTCOME.CAUGHT);
  });
});

describe('the tree is restored, and the restore is verified', () => {
  it('★★★ the file returns byte-identical after a run', () => {
    const before = 'alpha\nreturn null;\nomega\n';
    const fs = fakeFs({ 'a.js': before });
    runMutationControl(SPEC, { ...fs, exec: execWith(1) });
    expect(fs.files.get('a.js'), 'a control that leaves a mutant has become a defect').toBe(before);
  });

  it('★★★⛔ a restore that does not round-trip is RESTORE_FAILED, not a verdict', () => {
    // ⚠ Verified by HASH rather than assumed from a successful write. If the checkout holds mutant
    // bytes, the next run measures the residue instead of the code — and reporting CAUGHT there
    // would attribute a result to an experiment that has contaminated its own subject.
    const fs = fakeFs({ 'a.js': 'return null;' });
    const lying = { ...fs, write: (p, c) => fs.files.set(p, `${c} /* corrupted on write */`) };
    const r = runMutationControl(SPEC, { ...lying, exec: execWith(1) });
    expect(r.outcome).toBe(OUTCOME.RESTORE_FAILED);
    expect(r.reason).toMatch(/holds mutant bytes/);
  });

  it('★★★ a missing file refuses before anything is written', () => {
    const fs = fakeFs({});
    expect(runMutationControl(SPEC, { ...fs, exec: execWith(1) }).outcome).toBe(OUTCOME.REFUSED);
    expect(fs.files.size).toBe(0);
  });
});
