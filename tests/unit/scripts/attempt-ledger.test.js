// ⛔ RE-RUNNING UNTIL GREEN IS HOW A REAL REFUSAL GETS LAUNDERED INTO A RECEIPT.
//
// The failure this prevents is mine. The candidate class refused; my instinct was to run it again;
// it passed; the run after that refused. Under an uncontrolled environmental variable that is a
// coin flip reported as a verdict, and nothing in the receipt would have shown earlier attempts.
//
// ⛔⛔ AND THE FIRST VERSION OF THE LEDGER LAUNDERED HISTORY THROUGH THREE DOORS, each with a
// comment promising it did not — every one found by the referee reading the source:
//
//   1. `Array.isArray(parsed) ? parsed : []` — `{}` is VALID JSON, so it read as EMPTY HISTORY and
//      granted a clean first attempt, directly under a comment saying an unreadable ledger is not
//      an empty one.
//   2. The attempt was appended after the GATE, so a gate PASS whose transaction later failed left
//      `PASS` on the record — the same laundering, one layer later.
//   3. Read-modify-write of one shared file — two processes lose each other's attempts.
import { describe, it, expect } from 'vitest';
import {
  retryPermission, renderAttempts, parseSupersession, messageProblem, OUTCOME,
} from '../../../scripts/lib/attempt-ledger.mjs';

const row = (o, over = {}) => ({ id: `id-${o}`, at: '2026-08-21T10:00:00Z', tree: 't'.repeat(40), outcome: o, ...over });
const published = row(OUTCOME.PUBLISHED_EXACT_TREE);
const refuse = row(OUTCOME.GATE_REFUSE, { reason: 'unexpected ignored state at entry' });
const failed = row(OUTCOME.GATE_FAILED);
const auth = (ids) => JSON.stringify({
  supersedes: ids, reason: 'servers quiesced', approver: 'graph-senior-dev', approvalMessageId: 'msg-1',
});

describe('a refusal cannot be retried away', () => {
  it('★★★ POSITIVE CONTROL: a first attempt is allowed', () => {
    // Without this, everything below is satisfied by a function that refuses unconditionally, and
    // the tool could never commit anything at all.
    const p = retryPermission([]);
    expect(p.allowed).toBe(true);
    expect(p.blocking).toEqual([]);
  });

  it('★★★⛔ a plain retry after a refusal is REFUSED', () => {
    const p = retryPermission([refuse]);
    expect(p.allowed).toBe(false);
    expect(p.reason).toMatch(/re-running until green launders a refusal/);
    expect(p.blocking.length).toBe(1);
  });

  it('★★★⛔ A GATE PASS FOLLOWED BY A FAILED TRANSACTION STILL BLOCKS', () => {
    // ⛔ THE LAUNDERING ONE LAYER LATER. Retry permission now turns on the TERMINAL TRANSACTION
    // outcome, never on what the gate alone said.
    expect(retryPermission([row(OUTCOME.GATE_PASS_CUSTODY_REFUSE)]).allowed).toBe(false);
    expect(retryPermission([row(OUTCOME.GATE_PASS_CAS_REFUSE)]).allowed).toBe(false);
  });

  it('★★★⛔ an INCOMPLETE attempt blocks — a crash is not silence', () => {
    // An attempt that started and never concluded is unknown, not absent. Treating it as absent
    // would let a killed run be retried as though it had never happened.
    expect(retryPermission([row(OUTCOME.INCOMPLETE)]).allowed).toBe(false);
  });

  it('★★★ a prior successful publication does not block', () => {
    expect(retryPermission([published]).allowed).toBe(true);
  });

  it('★★★ published-then-dirtied does NOT block', () => {
    // ⚠ Publication and working-copy custody are separate facts. The commit's tree is exactly T;
    // another process dirtying the checkout afterwards must not force the tree to be re-attempted.
    expect(retryPermission([row(OUTCOME.WORKTREE_POSTCONDITION_REFUSE)]).allowed).toBe(true);
  });

  it('★★★⛔ AN UNREADABLE HISTORY IS NOT AN EMPTY ONE', () => {
    const p = retryPermission(null);
    expect(p.allowed).toBe(false);
    expect(p.reason).toMatch(/unreadable or malformed/);
  });
});

describe('supersession must be authority, not a sentence', () => {
  it('★★★⛔ FREE TEXT IS NOT AUTHORITY', () => {
    // ⛔ My first version accepted any string, so the same operator typing "retry" satisfied it —
    // which is not independent approval of anything.
    expect(parseSupersession('retry').invalid).toMatch(/must be JSON/);
    expect(parseSupersession(JSON.stringify({ reason: 'x' })).invalid).toMatch(/supersedes must be/);
    expect(parseSupersession(JSON.stringify({ supersedes: ['a'], reason: 'x' })).invalid).toMatch(/approver/);
    expect(parseSupersession(JSON.stringify({ supersedes: [], reason: 'x', approver: 'y', approvalMessageId: 'z' })).invalid)
      .toMatch(/non-empty array/);
  });

  it('★★★ a structured supersession naming every blocking attempt is allowed', () => {
    const p = retryPermission([refuse, failed], parseSupersession(auth([refuse.id, failed.id])));
    expect(p.allowed).toBe(true);
    expect(p.reason).toMatch(/superseding 2 attempt/);
    expect(p.reason).toMatch(/graph-senior-dev/);
  });

  it('★★★⛔ a supersession that does not name a blocking attempt is REFUSED', () => {
    // ⛔ Superseding "whatever went before" would let one approval cover attempts nobody had seen
    // when it was granted.
    const p = retryPermission([refuse, failed], parseSupersession(auth([refuse.id])));
    expect(p.allowed).toBe(false);
    expect(p.reason).toMatch(/does not name 1 blocking attempt/);
  });
});

describe('the receipt carries the whole history, and the message is preflighted', () => {
  it('★★★ ALL attempts travel, not just the successful one', () => {
    const rendered = renderAttempts([refuse, failed, published]);
    expect(rendered).toMatch(/3 on this exact candidate tree/);
    expect(rendered).toMatch(/GATE_REFUSE/);
    expect(rendered).toMatch(/GATE_FAILED/);
    expect(rendered).toMatch(/PUBLISHED_EXACT_TREE/);
  });

  it('★★★⛔ an unreadable history renders as UNKNOWN, never as none', () => {
    expect(renderAttempts(null)).toMatch(/UNREADABLE/);
    expect(renderAttempts([]), 'and genuinely empty says so separately').toMatch(/none recorded/);
  });

  it('★★★⛔ MESSAGE PREFLIGHT: the placeholder that actually got committed', () => {
    // ⛔ My wrapper committed a message reading "placeholder". The mechanism did exactly what it was
    // built to do; I handed it a throwaway file while exercising the ledger. This control runs
    // BEFORE the expensive gate, so an operator error cannot become published history.
    expect(messageProblem('placeholder')).toMatch(/placeholder/);
    expect(messageProblem('')).toMatch(/no subject/);
    expect(messageProblem('wip')).toMatch(/placeholder|too short/);
    expect(messageProblem('fix: a real and adequately descriptive subject')).toBe(null);
  });

  it('★★★ a message already containing a receipt is refused — it would embed twice', () => {
    const doubled = ['fix: something real', '', 'GATE RECEIPT [CANDIDATE_TREE_BOUND] — ...'].join('\n');
    expect(messageProblem(doubled)).toMatch(/already contains a receipt/);
  });
});
