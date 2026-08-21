// ⛔ A GATE NUMBER MUST COME FROM THE PROCESS THAT PRODUCED IT — AND ONLY A CLEAN EXACT-COMMIT RUN
// MAY CONCLUDE PASS.
//
// `cba6c24`'s commit message says "vitest 2456 passed / 318 files EXIT 0". The run immediately
// before it reported exit 1, one failed file, one failed test. I had the exit code in front of me
// and typed the passing figures anyway. The referee's ruling: *"the right procedural consequence is
// not 'be more careful typing.'"*
//
// ⛔⛔ AND MY FIRST TRANSPORT REPEATED THE SHAPE ONE LEVEL UP. It printed
// `porcelain DIRTY (3 entries)` and then, on the next line, `VERDICT all gates exited 0`. The dirt
// was DISCLOSED beside the verdict instead of DEGRADING it — and commit/tree identity does not bind
// uncommitted bytes, so those green processes certify a tree nobody named.
//
// ⇒ **A disclosure the reader must act on is not a control. The verdict has to move.**
import { describe, it, expect } from 'vitest';
import {
  identityMovement, IDENTITY_KEYS, gatePassed, renderReceipt, receiptVerdict,
  RECEIPT_CLASS, VERDICT,
} from '../../../scripts/lib/gate-receipt.mjs';

const ident = (over = {}) => ({ commit: 'c'.repeat(40), tree: 't'.repeat(40), porcelain: '', ...over });

const gate = (over = {}) => ({
  label: 'vitest', argv: ['node', 'vitest.mjs', 'run'], exit: 0, signal: null, spawnError: null,
  timedOut: false, stdoutSha256: 'a'.repeat(64), stderrSha256: 'b'.repeat(64),
  countLines: ['  Tests  10 passed (10)'], ...over,
});

/** A clean, commit-bound context — the only shape allowed to conclude PASS. */
const bound = (over = {}) => ({
  receiptClass: RECEIPT_CLASS.COMMIT_BOUND, before: ident(), after: ident(), gates: [gate()], ...over,
});

describe('a gate passes only when its PROCESS said so', () => {
  it('★★★ exit 0, no signal, no spawn error, no timeout is the only pass', () => {
    // ⛔ POSITIVE CONTROL FIRST: if gatePassed returned false always, every assertion below passes
    // while the receipt calls every green run a failure.
    expect(gatePassed(gate())).toBe(true);
  });

  it('★★★ every non-zero outcome is a FAILURE, including the ones that are not exit codes', () => {
    expect(gatePassed(gate({ exit: 1 })), 'nonzero exit').toBe(false);
    expect(gatePassed(gate({ exit: null })), 'no exit at all').toBe(false);
    expect(gatePassed(gate({ signal: 'SIGKILL' })), 'killed').toBe(false);
    expect(gatePassed(gate({ spawnError: 'ENOENT' })), 'never even started').toBe(false);
    expect(gatePassed(gate({ timedOut: true })), 'never finished').toBe(false);
  });

  it('★★★ a TIMEOUT is typed apart from an exit failure', () => {
    // "The suite said no" and "the suite never finished" are different facts. Collapsing them would
    // let a hang read as a verdict.
    expect(renderReceipt(bound({ gates: [gate({ timedOut: true })] }))).toMatch(/TIMED OUT/);
  });

  it('★★★ a gate that could not START did not pass — the EINVAL case, pinned', () => {
    // The transport's first real execution produced exactly this: exit null, spawn error EINVAL,
    // and it refused to render green for a gate that never ran.
    const einval = gate({ exit: null, spawnError: 'spawnSync npx.cmd EINVAL' });
    expect(gatePassed(einval)).toBe(false);
    const receipt = renderReceipt(bound({ gates: [einval] }));
    expect(receipt).toMatch(/spawn-error=spawnSync npx\.cmd EINVAL/);
    expect(receipt).toMatch(/VERDICT {4}FAILED/);
  });
});

describe('the verdict is derived — dirt and class degrade it, they do not sit beside it', () => {
  it('★★★ only a CLEAN COMMIT_BOUND run with green gates may say PASS', () => {
    // ⛔ POSITIVE CONTROL for the whole verdict function: without this, everything below is
    // satisfied by a function that refuses unconditionally.
    expect(receiptVerdict(bound()).verdict).toBe(VERDICT.PASS);
  });

  it('★★★⛔ STABLE DIRT REFUSES — this is the defect in my own first transport', () => {
    // It printed the dirt and then "all gates exited 0". The processes ran; they certify a tree
    // nobody named. Green gates on a dirty tree must not bind a commit.
    const dirty = ident({ porcelain: ' M a.js' });
    const v = receiptVerdict(bound({ before: dirty, after: dirty }));
    expect(v.verdict).toBe(VERDICT.REFUSE);
    expect(v.reason).toMatch(/requires a clean tree/);
  });

  it('★★★ a PRECOMMIT diagnostic NEVER passes, even clean with every gate green', () => {
    // It does not run on an exact-commit detached carrier, so it cannot certify a commit however
    // tidy the tree happens to be. Author feedback only, unquotable as proof.
    const v = receiptVerdict({
      receiptClass: RECEIPT_CLASS.PRECOMMIT_DIAGNOSTIC, before: ident(), after: ident(), gates: [gate()],
    });
    expect(v.verdict).toBe(VERDICT.UNBOUND_DIRTY);
    expect(v.reason).toMatch(/binds no commit/);
  });

  it('★★★ IDENTITY MOVEMENT outranks everything, including a clean start and green gates', () => {
    // ⚠ The carrier lesson applied to evidence transport: a receipt naming a commit claims the gates
    // ran against THAT commit, and a multi-minute suite gives the tree time to move.
    const v = receiptVerdict(bound({ after: ident({ porcelain: ' M src/x.js' }) }));
    expect(v.verdict).toBe(VERDICT.REFUSE);
    expect(v.reason).toMatch(/identity moved during the run: porcelain/);
  });

  it('★★★ a failing gate on a clean bound carrier is FAILED, not REFUSE', () => {
    // The two must stay distinguishable: REFUSE means "cannot attribute", FAILED means "the code
    // did not pass". Collapsing them would hide a real red behind a carrier complaint.
    const v = receiptVerdict(bound({ gates: [gate({ exit: 1 })] }));
    expect(v.verdict).toBe(VERDICT.FAILED);
    expect(v.reason).toMatch(/1 gate\(s\) failed: vitest/);
  });

  it('★★★ identityMovement fails closed on every field, and on absence', () => {
    expect(identityMovement(ident(), ident()), 'a settled identity').toEqual([]);
    for (const k of IDENTITY_KEYS) {
      expect(identityMovement(ident(), ident({ [k]: 'CHANGED' })), `${k} moved`).toEqual([k]);
    }
    expect(identityMovement({}, {}), 'absent on both sides is not agreement').toEqual(IDENTITY_KEYS);
    expect(identityMovement(null, null), 'and neither is nothing at all').toEqual(IDENTITY_KEYS);
  });
});

describe('the receipt transports rather than authors', () => {
  it('★★★ counts are carried through, and absent when the run produced none', () => {
    const receipt = renderReceipt(bound({ gates: [gate({ countLines: ['  Tests  2460 passed | 4 skipped (2464)'] })] }));
    expect(receipt).toContain('2460 passed | 4 skipped (2464)');
    // The renderer must not be able to produce a count that was not in the run's own output.
    expect(renderReceipt(bound({ gates: [gate({ countLines: [] })] })), 'no counts in, no counts out')
      .not.toContain('passed (');
  });

  it('★★★ argv is carried as an ARRAY, not reassembled into shell prose', () => {
    // A reconstructed command line is a CLAIM about what ran; the array is the thing passed.
    const receipt = renderReceipt(bound({ gates: [gate({ argv: ['node', 'x y.mjs', '--flag'] })] }));
    expect(receipt).toContain('["node","x y.mjs","--flag"]');
  });

  it('★★★ raw output hashes are preserved so a quoted count ties back to bytes', () => {
    expect(renderReceipt(bound())).toMatch(/outHash {4}a{16} \/ b{16}/);
  });

  it('★★★ a dirty tree is disclosed with its entry count AS WELL AS refusing', () => {
    // Disclosure is still worth having — it is just not sufficient on its own, which was the bug.
    const dirty = ident({ porcelain: ' M a.js\n M b.js' });
    const receipt = renderReceipt(bound({ before: dirty, after: dirty }));
    expect(receipt).toMatch(/porcelain {2}DIRTY \(2 entries\)/);
    expect(receipt, 'and the verdict moved too').toMatch(/VERDICT {4}REFUSE/);
  });

  it('★★★ the receipt states WHAT IT BINDS, or says it binds nothing', () => {
    expect(renderReceipt(bound({ boundTo: 'abc123 / tree def456' }))).toMatch(/binds {6}abc123 \/ tree def456/);
    expect(renderReceipt({
      receiptClass: RECEIPT_CLASS.PRECOMMIT_DIAGNOSTIC, before: ident(), after: ident(), gates: [gate()],
    }), 'a diagnostic says so in its own header').toMatch(/binds {6}\(nothing — diagnostic\)/);
  });
});
