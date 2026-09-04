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

  it('★★★ every emittable outcome maps to true, false or null, and NONE is an accident', () => {
    for (const outcome of emittedOutcomes()) {
      const verdict = indexReadyFromWaitResult(outcome);
      expect([true, false, null], `${outcome.reason} produced ${verdict}`).toContain(verdict);
      if (outcome.ready === false) {
        expect(verdict, `${outcome.reason} is a stated NOT-ready and must stay false`).toBe(false);
      }
    }
  });

  it('★★★ a ready:true reason this file has never seen fails CLOSED, not open', () => {
    // The whole justification for keeping an allowlist. If the client gains a reason and nobody
    // updates index-readiness.js, the new reason must not inherit the attestation.
    const emitted = new Set(emittedOutcomes().map((o) => o.reason));
    expect(emitted.has('zzq_hypothetical_new_reason'), 'control: this must NOT be a real reason').toBe(false);
    expect(indexReadyFromWaitResult({ ready: true, reason: 'zzq_hypothetical_new_reason' })).toBeNull();
  });

  it('★★ exactly one ready:true reason is an INFERENCE, and it is the measured one', () => {
    // If a second inference-shaped reason ever appears, that is a design change worth noticing here
    // rather than discovering from a false attestation in the field.
    const inferred = emittedOutcomes()
      .filter((o) => o.ready === true && indexReadyFromWaitResult(o) === null)
      .map((o) => o.reason);
    expect(inferred).toEqual(['no_progress_signalled']);
  });
});
