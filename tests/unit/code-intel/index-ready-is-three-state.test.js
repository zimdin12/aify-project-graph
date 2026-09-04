// ⛔⛔ `index_ready` LICENSES DELETION, AND IT WAS BEING SET FROM AN INFERENCE.
//
// `waitForIndexReady` returns a boolean `ready` covering two different facts, and its own `reason`
// already tells them apart:
//
//     index_drained / already_ready / ready_no_index_needed  -> PROVEN: indexing was observed
//     no_progress_signalled                                  -> INFERRED: nothing was heard within
//                                                               settleMs (default 1500 ms)
//
// Both consumers collapsed it with `indexReady = !!r.ready`, and that flag is persisted
// (`importer.js:1259`) and gates the attestation (`lsp-evidence.js`:
// `collection.indexReady === true && allVerified`) that the server-instructions say licenses
// "safe to delete".
//
// ⛔ THE INFERENCE IS UNSOUND, MEASURED. Five cold starts against a real clangd, first
// `$/progress begin` after didOpen:
//
//     [744, 1041, 937, 1525, 2125] ms   — 5 of 5 signalled, WORST 2125 ms vs a 1500 ms window
//
// Two of five announced AFTER the window. So `no_progress_signalled` conflates "the index was
// already on disk, nothing to do" (ready is true) with "clangd has not announced yet" (ready is
// false), and nothing inside the window can separate them.
//
// ⇒ THE REPAIR IS THE ARC'S OWN: do not flip the boolean, give the unknown its own value. The
// storage is ALREADY three-state — `importer.js` writes `indexReady == null ? null : (…)`, the
// schema comment says older rows get NULL and are "treated as unknown readiness downstream", and
// `lsp-evidence.js` gates on `=== true`, so NULL already fails closed at the banner.
//
// ⚠ THIS COSTS RECALL AND THE COST IS ACCEPTED HERE, NOT HIDDEN: a genuinely on-disk index also
// produces `no_progress_signalled`, and it will now record NULL rather than true. A discriminator
// that could recover it — checking clangd's index cache on disk — is named in the finding as
// follow-up, not attempted here.
import { describe, it, expect } from 'vitest';
import { indexReadyFromWaitResult } from '../../../mcp/stdio/code-intel/index-readiness.js';

describe('index_ready distinguishes a proven index from an inferred one', () => {
  it('★★★ an OBSERVED drain is TRUE — the case that legitimately licenses the attestation', () => {
    expect(indexReadyFromWaitResult({ ready: true, reason: 'index_drained' })).toBe(true);
    expect(indexReadyFromWaitResult({ ready: true, reason: 'already_ready' })).toBe(true);
    expect(indexReadyFromWaitResult({ ready: true, reason: 'ready_no_index_needed' })).toBe(true);
  });

  it('★★★ `no_progress_signalled` is UNKNOWN, never true — the measured defect', () => {
    // The whole finding in one assertion: silence inside a 1500 ms window is not proof of readiness
    // when the signal arrived at 1525 and 2125 ms in 2 of 5 measured cold starts.
    expect(indexReadyFromWaitResult({ ready: true, reason: 'no_progress_signalled' })).toBeNull();
  });

  it('★★★ a PROVEN not-ready stays FALSE, and is not softened into unknown', () => {
    // ⛔ The other direction matters just as much. Turning a genuinely expired wait into `unknown`
    // would discard a real negative, and `false` is what tells a reader we watched the whole window.
    expect(indexReadyFromWaitResult({ ready: false, reason: 'index_wait_timeout' })).toBe(false);
  });

  it('★★★ `cold_no_warm` is UNKNOWN — it is the SAME silence as no_progress_signalled', () => {
    // ⛔ THIS LINE USED TO ASSERT `false`, AND IT WAS WRONG IN TWO FILES AT ONCE. lsp-client.js:540
    // returns both reasons from ONE `if`, forked only on workspaceWarmCount — a count of our own
    // didOpen calls. The server said the identical nothing in both branches, so the branch where we
    // warmed NOTHING cannot be the better-evidenced one. Warming less cannot mean knowing more.
    //
    // I got it wrong because I distrusted an unrecognised reason only where it would GRANT. Caught
    // by an outside reader, not by this suite, because both my test files described my code.
    expect(indexReadyFromWaitResult({ ready: false, reason: 'cold_no_warm' })).toBeNull();
    expect(indexReadyFromWaitResult({ ready: false, reason: 'cold_no_warm' }))
      .toBe(indexReadyFromWaitResult({ ready: true, reason: 'no_progress_signalled' }));
  });

  it('★★ POSITIVE CONTROL: the three outcomes are genuinely distinct', () => {
    // Without this, a mapper returning null for everything would satisfy the defect test above while
    // destroying the attestation for every collection — the shape this repo has shipped before.
    const outcomes = new Set([
      indexReadyFromWaitResult({ ready: true, reason: 'index_drained' }),
      indexReadyFromWaitResult({ ready: true, reason: 'no_progress_signalled' }),
      indexReadyFromWaitResult({ ready: false, reason: 'index_wait_timeout' }),
    ]);
    expect(outcomes.size, 'true / null / false must be three answers, not one').toBe(3);
  });

  it('★★★ an unrecognised or missing reason is UNKNOWN, not true', () => {
    // ⛔ FAIL CLOSED ON A REASON NOBODY ANTICIPATED. A future `reason` string added to the client
    // must not inherit `true` by default — that is the "a default written for the ordinary case is
    // inherited by a case it was not written for" shape this arc has now recorded three times.
    expect(indexReadyFromWaitResult({ ready: true, reason: 'some_future_reason' })).toBeNull();
    expect(indexReadyFromWaitResult({ ready: true })).toBeNull();
    expect(indexReadyFromWaitResult(null), 'no result at all is not readiness').toBeNull();
    expect(indexReadyFromWaitResult(undefined)).toBeNull();
  });
});
