// ⛔ THE CLASS THAT ENDS THE EVIDENCE CHAIN.
//
// A COMMIT_BOUND receipt certifies its PARENT, so the commit CARRYING it is never itself gated.
// That is how an evidence child shipped raw ANSI escapes and reddened the suite while its own
// receipt remained perfectly valid — it certified the parent honestly and said nothing about
// itself. The naive fix is another evidence child certifying that one, and another, forever.
//
// ⇒ the reviewer's design: bind the exact TREE OBJECT `T` about to be committed, measured
// BEFORE the commit exists, and carry the receipt in the COMMIT MESSAGE rather than inside `T`.
// A receipt inside the tree it certifies is self-reference; a receipt in the message is not part
// of the tree at all. After committing, `HEAD^{tree} === T` promotes the result to the commit.
// Finite by construction.
import { describe, it, expect } from 'vitest';
import {
  receiptVerdict, renderReceipt, RECEIPT_CLASS, VERDICT, capture, CANDIDATE_IDENTITY_KEYS,
} from '../../../scripts/lib/gate-receipt.mjs';

const T = 'a'.repeat(40);

const ident = (over = {}) => ({
  commit: 'c'.repeat(40), tree: 't'.repeat(40), porcelain: ' M staged.js',
  candidate: { tree: T, unstaged: false, untracked: 0 },
  ...over,
});

const gate = (over = {}) => ({
  label: 'vitest', argv: ['node', 'vitest.mjs', 'run'], exit: 0, signal: null, spawnError: null,
  timedOut: false, stdout: capture('out'), stderr: capture(''), countLines: [], ...over,
});

const candidate = (over = {}) => ({
  receiptClass: RECEIPT_CLASS.CANDIDATE_TREE_BOUND, before: ident(), after: ident(), gates: [gate()], ...over,
});

describe('CANDIDATE_TREE_BOUND binds staged bytes, not a commit', () => {
  it('★★★ POSITIVE CONTROL: a fully staged, stable candidate tree with green gates PASSES', () => {
    // ⛔ Without this, every assertion below is satisfied by a class that refuses everything — and
    // a class that can never pass is not a transport, it is a wall.
    const v = receiptVerdict(candidate());
    expect(v.verdict).toBe(VERDICT.PASS);
    expect(v.reason).toMatch(new RegExp(`candidate tree ${T}`));
  });

  it('★★★ A DIRTY PORCELAIN IS EXPECTED HERE — that is the whole point of the class', () => {
    // COMMIT_BOUND refuses dirt because dirt means the commit does not name the bytes. A candidate
    // run is gating STAGED evidence, so porcelain is non-empty BY CONSTRUCTION. Its stability is
    // enforced by the tree hash instead, which is strictly stronger: porcelain says WHICH paths
    // differ, T says exactly WHAT the bytes are.
    expect(ident().porcelain, 'the fixture really is dirty').not.toBe('');
    expect(receiptVerdict(candidate()).verdict, 'and it still passes').toBe(VERDICT.PASS);
    expect(CANDIDATE_IDENTITY_KEYS, 'porcelain is deliberately not an identity key here').toEqual(['commit']);
  });

  it('★★★⛔⛔ TERMINAL unstaged REFUSES — the fail-open the referee executed', () => {
    // ⛔ MY FIRST VERSION CHECKED ONLY THE ENTRY SAMPLE. `git write-tree` names the INDEX, so a gate
    // that creates an unstaged edit DURING the run does not move T — and the class returned PASS
    // while the gates had read or produced bytes T does not name.
    //
    // ⇒ I built this class around "sample both ends", applied it to the tree hash, and then checked
    // the working state at entry only. **An entry condition is not an exit condition.**
    const v = receiptVerdict(candidate({
      after: ident({ candidate: { tree: T, unstaged: true, untracked: 0 } }),
    }));
    expect(v.verdict).toBe(VERDICT.REFUSE);
    expect(v.reason).toMatch(/unstaged changes at exit/);
  });

  it('★★★⛔⛔ TERMINAL untracked REFUSES — same hole, other field', () => {
    const v = receiptVerdict(candidate({
      after: ident({ candidate: { tree: T, unstaged: false, untracked: 3 } }),
    }));
    expect(v.verdict).toBe(VERDICT.REFUSE);
    expect(v.reason).toMatch(/3 untracked file\(s\) at exit/);
  });

  it('★★★ a missing TERMINAL candidate sample refuses — fail closed at both ends', () => {
    const v = receiptVerdict(candidate({ after: ident({ candidate: {} }) }));
    expect(v.verdict).toBe(VERDICT.REFUSE);
    expect(v.reason).toMatch(/no terminal candidate tree/);
  });

  it('★★★ the receipt DISCLOSES both samples, so a reader can see which end failed', () => {
    const receipt = renderReceipt(candidate());
    expect(receipt).toMatch(/at entry unstaged=false untracked=0/);
    expect(receipt).toMatch(/at exit  unstaged=false untracked=0/);
  });

  it('★★★⛔ UNSTAGED CHANGES REFUSE — the gates would read bytes T does not name', () => {
    const v = receiptVerdict(candidate({ before: ident({ candidate: { tree: T, unstaged: true, untracked: 0 } }) }));
    expect(v.verdict).toBe(VERDICT.REFUSE);
    expect(v.reason).toMatch(/unstaged changes at entry/);
  });

  it('★★★⛔ UNTRACKED FILES REFUSE — the candidate tree is not the whole working state', () => {
    const v = receiptVerdict(candidate({ before: ident({ candidate: { tree: T, unstaged: false, untracked: 2 } }) }));
    expect(v.verdict).toBe(VERDICT.REFUSE);
    expect(v.reason).toMatch(/2 untracked file\(s\) at entry/);
  });

  it('★★★⛔ A TREE THAT MOVED MID-RUN REFUSES, and names both hashes', () => {
    // ⚠ The carrier lesson at the tree level: a multi-minute suite gives someone time to stage
    // something else, and then the receipt would certify a tree that no longer exists.
    const moved = ident({ candidate: { tree: 'b'.repeat(40), unstaged: false, untracked: 0 } });
    const v = receiptVerdict(candidate({ after: moved }));
    expect(v.verdict).toBe(VERDICT.REFUSE);
    expect(v.reason).toMatch(/candidate tree moved during the run/);
    expect(v.reason).toContain(T);
  });

  it('★★★ a missing candidate tree REFUSES rather than defaulting to something', () => {
    // Fail closed: a run that cannot name what it gated must not conclude anything.
    const v = receiptVerdict(candidate({ before: ident({ candidate: {} }) }));
    expect(v.verdict).toBe(VERDICT.REFUSE);
    expect(v.reason).toMatch(/no candidate tree was recorded/);
  });

  it('★★★ a failing gate on a stable candidate tree is FAILED, not REFUSE', () => {
    // The distinction stays load-bearing: REFUSE is "cannot attribute", FAILED is "the code did not
    // pass". Collapsing them would hide a real red behind a carrier complaint.
    const v = receiptVerdict(candidate({ gates: [gate({ exit: 1 })] }));
    expect(v.verdict).toBe(VERDICT.FAILED);
  });

  it('★★★ the receipt DISCLOSES the tree it binds and its staging state', () => {
    const receipt = renderReceipt(candidate({ boundTo: `CANDIDATE TREE ${T} (not yet committed)` }));
    expect(receipt).toContain(`candidate  tree ${T}`);
    expect(receipt).toMatch(/unstaged=false untracked=0/);
    expect(receipt).toMatch(/\[CANDIDATE_TREE_BOUND\]/);
    expect(receipt, 'and says the tree is not yet a commit').toMatch(/not yet committed/);
  });

  it('★★★ COMMIT_BOUND still refuses the same dirty state — the classes are not interchangeable', () => {
    // ⛔ If dirt were tolerated by both, the two classes would collapse and the candidate class
    // would become a way to get a passing commit-bound receipt on an unnamed tree.
    const v = receiptVerdict({ ...candidate(), receiptClass: RECEIPT_CLASS.COMMIT_BOUND });
    expect(v.verdict).toBe(VERDICT.REFUSE);
    expect(v.reason).toMatch(/requires a clean tree/);
  });
});
