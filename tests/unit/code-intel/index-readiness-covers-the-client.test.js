// A LIST YOU MUST REMEMBER TO UPDATE IS A DEFECT WITH A DELAY ON IT. THIS IS THE THING THAT CHECKS.
//
// `indexReadyFromWaitResult` classifies `waitForIndexReady`'s reasons with an ALLOWLIST of the ones
// that mean readiness was OBSERVED. Our standards say derive allowed values rather than list them,
// and ef-manager was mid-review on exactly this when their session blocked.
//
// ⭐ THE ALLOWLIST IS RIGHT HERE, AND THE REASON IS THE FAILURE DIRECTION. The obvious derivation is
// "proven unless the reason is an inference", with `no_progress_signalled` as the only inference.
// That FAILS OPEN: a reason added to the client later would be treated as proven and could earn the
// banner that licenses "safe to delete". The allowlist fails CLOSED, mapping anything unrecognised to
// unknown. For a flag that authorises deletion, fail-closed beats derived.
//
// ⇒ So the list stays, and this test is what stops it going stale: every reason the client can
// actually emit must be classified, and a NEW one must make this go red rather than sit unnoticed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { indexReadyFromWaitResult } from '../../../mcp/stdio/code-intel/index-readiness.js';

const CLIENT = fileURLToPath(new URL('../../../mcp/stdio/code-intel/lsp-client.js', import.meta.url));

/** Every `{ ready, reason }` pair returned inside waitForIndexReady, harvested from its source. */
function emittedOutcomes() {
  const src = readFileSync(CLIENT, 'utf8');
  const start = src.indexOf('async waitForIndexReady');
  expect(start, 'waitForIndexReady not found — the harvester is looking at the wrong file').toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('\n  }', start));
  const literal = [...body.matchAll(/ready:\s*(true|false)[^}]*?reason:\s*'([a-z_]+)'/g)]
    .map((m) => ({ ready: m[1] === 'true', reason: m[2] }));
  // The tail return picks its reason with a ternary, so both arms count as emittable.
  const ternary = [...body.matchAll(/reason:\s*ready\s*\?\s*'([a-z_]+)'\s*:\s*'([a-z_]+)'/g)]
    .flatMap((m) => [{ ready: true, reason: m[1] }, { ready: false, reason: m[2] }]);
  return [...literal, ...ternary];
}

describe('index-readiness classifies every reason the client can emit', () => {
  it('★★★ POSITIVE CONTROL: the harvester can see reasons at all', () => {
    // ⛔ WITHOUT THIS THE SUITE BELOW CERTIFIES AN EMPTY SET. This repo has already shipped a
    // vocabulary checker that went blind after a refactor and passed vacuously over zero findings.
    const found = emittedOutcomes().map((o) => o.reason);
    expect(found, 'harvester found nothing — it is blind, and the assertion below is vacuous')
      .toContain('no_progress_signalled');
    expect(found).toContain('index_drained');
    expect(found.length, 'the client emits more than a couple of outcomes').toBeGreaterThanOrEqual(5);
  });

  // ⭐⭐ THE EXPECTATION BELOW COMES FROM A DIFFERENT SOURCE THAN THE CODE IT CHECKS, ON PURPOSE.
  //
  // My previous version of this file derived its invariant by reading `indexReadyFromWaitResult`
  // minutes after writing it, so it described what the function DID rather than what it SHOULD do.
  // It then encoded a real defect as an invariant, with a failure message asserting I was right:
  // `cold_no_warm` was pinned to `false` because that is what the code happened to return.
  //
  // ⇒ A ratchet's expectation must come from a DIFFERENT SOURCE than the thing it ratchets. This one
  // has two, and neither is the classifier:
  //   1. THE PRODUCER — the reason literals are harvested from lsp-client.js (above).
  //   2. THE DISCRIMINATOR — a stated principle that decides which bucket each reason belongs in.
  //
  // ⭐ THE DISCRIMINATOR (ef-manager): CAN TIME ALONE CHANGE THE ANSWER, WITH NOBODY DOING ANYTHING?
  //     yes -> we did not establish anything, the index may be building right now  -> null
  //     no  -> we watched the whole window, or the state is a decision             -> true / false
  //
  // The test for whether this is an assertion or a description: COULD IT HAVE BEEN WRITTEN BEFORE
  // THE CODE? This one could. Every row is justified from the client's own source, not from mine.
  const DISCRIMINATOR = [
    // reason, expected, why — argued from lsp-client.js, never from index-readiness.js
    ['already_ready', true,
      'navigationFreshness() was already fresh. OBSERVED, and time cannot un-observe it.'],
    ['ready_no_index_needed', true,
      'freshness went fresh DURING the poll. We watched it happen.'],
    ['index_drained', true,
      'indexing was seen to start and then finish. The strongest evidence available.'],
    ['no_progress_signalled', null,
      'silence inside settleMs, with files warmed. Time can change it: 2 of 5 measured cold starts '
      + 'announced at 1525 and 2125 ms, after a 1500 ms window.'],
    ['cold_no_warm', null,
      'THE SAME `if` AS no_progress_signalled (lsp-client.js:540-546), forked only on '
      + 'workspaceWarmCount, which counts OUR didOpen calls. The server said the identical nothing. '
      + 'Warming less cannot mean knowing more.'],
    ['index_wait_timeout', false,
      'we waited the FULL timeout and it did not drain. Established, and the timeout knob is the '
      + 'remedy that fits.'],
  ];

  it('★★★ every reason is classified by the DISCRIMINATOR, not by what the code returns', () => {
    // ⛔ THE `ready` FLAG COMES FROM THE PRODUCER, NEVER FROM THE EXPECTATION. My first draft wrote
    // `const ready = expected !== false`, which fabricates the input from the answer: `cold_no_warm`
    // is emitted with ready:false, but the table expects null, so it built {ready:true} — a pair the
    // client never emits — and passed over the very defect it was written to catch. Same circularity
    // as the bug above, one level down, inside the fix for it.
    const emitted = new Map(emittedOutcomes().map((o) => [o.reason, o.ready]));
    for (const [reason, expected, why] of DISCRIMINATOR) {
      expect(emitted.has(reason), `${reason} is not emitted by the client at all`).toBe(true);
      const outcome = { ready: emitted.get(reason), reason };
      expect(indexReadyFromWaitResult(outcome), `${reason}: ${why}`).toBe(expected);
    }
  });

  it('★★★ the producer emits NOTHING the discriminator has not judged', () => {
    // This is the drift the ratchet is actually for: a reason added to lsp-client.js that nobody
    // classified. It fails here rather than silently inheriting a bucket.
    const judged = new Set(DISCRIMINATOR.map(([r]) => r));
    const emitted = [...new Set(emittedOutcomes().map((o) => o.reason))];
    expect(emitted.filter((r) => !judged.has(r)),
      'a reason exists in lsp-client.js that this table does not judge').toEqual([]);
    // And the reverse, so the table cannot rot into judging reasons that no longer exist.
    expect(judged.size, 'the table judges a reason the producer never emits').toBe(emitted.length);
  });

  it('★★★ the two branches of ONE silence are classified the same way', () => {
    // The defect this file previously enshrined, stated as its own assertion so it cannot come back
    // by a different route. These two returns share a condition; only our bookkeeping differs.
    expect(indexReadyFromWaitResult({ ready: true, reason: 'no_progress_signalled' }))
      .toBe(indexReadyFromWaitResult({ ready: false, reason: 'cold_no_warm' }));
  });
});
