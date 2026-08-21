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
import { createHash } from 'node:crypto';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';
import {
  identityMovement, IDENTITY_KEYS, gatePassed, renderReceipt, receiptVerdict,
  RECEIPT_CLASS, VERDICT, capture, MAX_CAPTURE,
} from '../../../scripts/lib/gate-receipt.mjs';

const ident = (over = {}) => ({ commit: 'c'.repeat(40), tree: 't'.repeat(40), porcelain: '', ...over });

const gate = (over = {}) => ({
  label: 'vitest', argv: ['node', 'vitest.mjs', 'run'], exit: 0, signal: null, spawnError: null,
  timedOut: false, stdout: capture('gate output'), stderr: capture(''),
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

  it('★★★ FULL 64-hex hashes are printed, not prefixes', () => {
    // ⛔ THE FIRST EVIDENCE COMMIT CARRIED 16-HEX PREFIXES IN PROSE AND NO BYTES. A prefix is not
    // an immutable content carrier: nothing can be re-hashed against it, so it names bytes nobody
    // kept. The referee refused it as an incomplete carrier and was right to.
    const receipt = renderReceipt(bound());
    const full = createHash('sha256').update('gate output').digest('hex');
    expect(receipt, 'the whole digest travels').toContain(full);
    expect(full.length).toBe(64);
  });

  it('★★★ capture() records ORIGINAL bytes, and says when it truncated', () => {
    const small = capture('abc');
    expect(small.truncated).toBe(false);
    expect(small.originalBytes).toBe(3);
    expect(small.capturedBytes).toBe(3);
    expect(small.fullHash).toBe(small.capturedHash);
    expect(small.text).toBe('abc');
  });

  it('★★★⛔ A TRUNCATED ARTIFACT SAYS SO, and carries BOTH hashes', () => {
    // ⚠ A truncated artifact that does not declare itself is a lie by omission: a reader re-hashes
    // the file, gets a different value, and cannot tell whether the evidence was clipped or
    // tampered with. Both digests travel so the two cases stay distinguishable.
    const big = 'x'.repeat(MAX_CAPTURE + 1000);
    const cap = capture(big);
    expect(cap.truncated, 'it declares the bound').toBe(true);
    expect(cap.originalBytes).toBe(MAX_CAPTURE + 1000);
    expect(cap.capturedBytes).toBe(MAX_CAPTURE);
    expect(cap.fullHash, 'the whole output is still identified').toBe(createHash('sha256').update(big).digest('hex'));
    expect(cap.capturedHash, 'and so is what was kept').toBe(createHash('sha256').update(cap.text).digest('hex'));
    expect(cap.fullHash).not.toBe(cap.capturedHash);
    expect(renderReceipt(bound({ gates: [gate({ stdout: cap })] }))).toMatch(/TRUNCATED to \d+/);
  });

  it('★★★ the captured text re-hashes to its recorded capturedHash — the preimage contract', () => {
    // This is what the first evidence commit could not offer: a hash WITH bytes a reader can check.
    for (const sample of ['', 'one line', ['multi', 'line', 'output'].join(String.fromCharCode(10))]) {
      const cap = capture(sample);
      expect(createHash('sha256').update(cap.text).digest('hex')).toBe(cap.capturedHash);
    }
  });

  it('★★★ CONTROL: a tampered artifact does NOT re-hash', () => {
    // Without this, "it re-hashes" is satisfied by a comparison that always agrees.
    const cap = capture('evidence');
    expect(createHash('sha256').update(`${cap.text} `).digest('hex')).not.toBe(cap.capturedHash);
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

// AN AMBIENT SIDE EFFECT WE SUPPRESS MUST TRAVEL WITH THE RECEIPT.
//
// The carrier is materialized with repository hooks disabled, because post-checkout ran a
// background reindex INTO the new worktree and raced the entry sample -- the mechanism behind three
// refused commits. Suppressing it is correct; suppressing it SILENTLY would make the receipt
// describe an environment it did not run in.
describe('the receipt discloses that checkout hooks were disabled', () => {
  const base = { receiptClass: RECEIPT_CLASS.CANDIDATE_TREE_BOUND, after: { commit: 'a'.repeat(40), tree: 'b'.repeat(40), porcelain: '' }, gates: [] };

  it('★★★ the disclosure appears when hooks were disabled', () => {
    const out = renderReceipt({ ...base, before: { commit: 'a', tree: 'b', porcelain: '', checkoutHooks: 'DISABLED for materialization via -c core.hooksPath=X' } });
    expect(out).toMatch(/hooks\s+DISABLED for materialization/);
  });

  it('★★★ POSITIVE CONTROL: the whole LINE is absent when nothing was suppressed', () => {
    // ⛔ MY FIRST VERSION OF THIS CONTROL DID NOT CATCH THE THING IT EXISTED FOR. It asserted the
    // absence of /hooks\s+DISABLED/, so a renderer printing the line UNCONDITIONALLY emitted
    // renderer printing the line UNCONDITIONALLY emitted the row with the value "undefined" and
    // sailed straight through -- I ran that exact mutation and got 21 passed, EXIT 0.
    //
    // ⇒ The claim is that the LINE is absent, so that is what must be asserted. Testing for the
    // word rather than the row is how a disclosure turns into a decoration that says 'undefined'.
    const out = renderReceipt({ ...base, before: { commit: 'a', tree: 'b', porcelain: '' } });
    expectAbsentWithLiveMatcher(
      /^ *hooks +/m,
      { forbidden: '    hooks      DISABLED for materialization via -c core.hooksPath=X', allowed: '    deps       node_modules JUNCTION' },
      out,
      'a run that suppressed nothing must not carry a hooks row at all',
    );
  });
});
