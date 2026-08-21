// ⛔ RE-RUNNING UNTIL GREEN IS HOW A REAL REFUSAL GETS LAUNDERED INTO A RECEIPT.
//
// The failure this prevents is mine, and I nearly committed it. The candidate class refused; my
// immediate instinct was to run it again. It passed the next time, and the run after that refused.
// Under an uncontrolled environmental variable that sequence is not "eventually correct" — it is a
// coin flip reported as a verdict, and nothing in the receipt would have shown that earlier
// attempts existed.
//
// ⇒ A PASS is therefore no longer self-describing. A PASS that is the third attempt is a different
// fact from a PASS that is the first, and the receipt must say which.
import { describe, it, expect } from 'vitest';
import { retryPermission, renderAttempts } from '../../../scripts/lib/attempt-ledger.mjs';

const pass = { at: '2026-08-21T10:00:00Z', verdict: 'PASS' };
const refuse = { at: '2026-08-21T10:05:00Z', verdict: 'REFUSE', reason: 'unexpected ignored state at entry' };
const failed = { at: '2026-08-21T10:10:00Z', verdict: 'FAILED', reason: '1 gate(s) failed' };

describe('a refusal cannot be retried away', () => {
  it('★★★ POSITIVE CONTROL: a first attempt is allowed', () => {
    // Without this, every assertion below is satisfied by a function that refuses unconditionally,
    // and the tool could never commit anything at all.
    const p = retryPermission([]);
    expect(p.allowed).toBe(true);
    expect(p.priorFailures).toBe(0);
  });

  it('★★★⛔ a plain retry after a REFUSE is REFUSED', () => {
    const p = retryPermission([refuse]);
    expect(p.allowed).toBe(false);
    expect(p.reason).toMatch(/re-running until green launders a refusal/);
    expect(p.priorFailures).toBe(1);
  });

  it('★★★ a FAILED counts too — it is not only refusals that must not be retried away', () => {
    // A gate that said the code did not pass is as unretryable as one that said it could not judge.
    expect(retryPermission([failed]).allowed).toBe(false);
  });

  it('★★★ a prior PASS does not block a later attempt', () => {
    // Only non-PASS attempts constitute history that must be superseded.
    expect(retryPermission([pass]).allowed).toBe(true);
    expect(retryPermission([pass]).priorFailures).toBe(0);
  });

  it('★★★ an EXPLICIT supersession is allowed, and says what it supersedes', () => {
    const p = retryPermission([refuse, refuse], { supersedes: 'MCP servers quiesced, transition recorded' });
    expect(p.allowed).toBe(true);
    expect(p.priorFailures).toBe(2);
    expect(p.reason).toMatch(/superseding 2 prior non-PASS attempt/);
    expect(p.reason).toMatch(/MCP servers quiesced/);
  });

  it('★★★⛔ AN UNREADABLE LEDGER IS NOT AN EMPTY ONE', () => {
    // ⛔ Returning "no history" for a ledger that could not be parsed would grant a clean first
    // attempt to a tree that may already carry refusals — the exact laundering this prevents,
    // reached through a corrupted file rather than a retry.
    const p = retryPermission(null);
    expect(p.allowed).toBe(false);
    expect(p.reason).toMatch(/unreadable/);
  });

  it('★★★ ALL attempts travel into the receipt, not just the successful one', () => {
    // A reader must see that a PASS was the third try, and what the first two said, without going
    // looking for a file they do not know exists.
    const rendered = renderAttempts([refuse, failed, pass]);
    expect(rendered).toMatch(/3 on this exact candidate tree/);
    expect(rendered).toMatch(/1\. .*REFUSE/);
    expect(rendered).toMatch(/2\. .*FAILED/);
    expect(rendered).toMatch(/3\. .*PASS/);
  });

  it('★★★ CONTROL: an empty history renders as none, not as silence', () => {
    expect(renderAttempts([])).toMatch(/\(none recorded\)/);
  });
});
