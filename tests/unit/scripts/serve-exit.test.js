// ⛔⛔ THE SCHEDULER PACES ON THE EXIT CODE, SO EACH CODE MUST MEAN ONE THING.
//
// The aify-env dashboard plugin runs serve-provider-requests.mjs every 60s per repository and decides from the exit
// code alone whether to keep going, stop until someone fixes the configuration, or try again next tick (contract
// agreed with dashboard-manager, 2026-10-01). Before this, exit 1 mixed "network down" with "missing project id" and
// exit 2 mixed "your key was rejected" with "a lease expired", so a scheduler could not tell a retry from a stop.
import { describe, it, expect } from 'vitest';
import { exitForFailure, exitForRun, SERVE_EXIT } from '../../../scripts/lib/serve-exit.mjs';

describe('one failure, one meaning', () => {
  it('★★★ configuration problems STOP: a missing setting, a rejected key, an unknown project, the wrong host', () => {
    expect(exitForFailure({ kind: 'config' })).toBe(SERVE_EXIT.stop);
    for (const status of [400, 401, 403, 404]) expect(exitForFailure({ kind: 'claim', status, code: 'x' }), String(status)).toBe(SERVE_EXIT.stop);
    expect(exitForFailure({ kind: 'result', status: 403, code: 'not_the_claimer' })).toBe(SERVE_EXIT.stop);
    expect(exitForFailure({ kind: 'result', status: 400, code: 'no_provenance' })).toBe(SERVE_EXIT.stop);
  });

  it('★★★ transient problems RETRY: unreachable, 5xx, 429, a claim 409, a queue that moved on', () => {
    expect(exitForFailure({ kind: 'network' })).toBe(SERVE_EXIT.retry);
    for (const status of [500, 503, 429]) expect(exitForFailure({ kind: 'claim', status, code: 'x' }), String(status)).toBe(SERVE_EXIT.retry);
    expect(exitForFailure({ kind: 'claim', status: 409, code: 'x' })).toBe(SERVE_EXIT.retry);
    for (const code of ['lease_expired', 'not_claimed', 'already_answered']) {
      expect(exitForFailure({ kind: 'result', status: 409, code }), code).toBe(SERVE_EXIT.retry);
    }
  });

  it('★★★ anything unclassified is UNEXPECTED, never quietly a retry', () => {
    expect(exitForFailure({ kind: 'unexpected' })).toBe(SERVE_EXIT.unexpected);
    expect(exitForFailure({})).toBe(SERVE_EXIT.unexpected);
    expect(exitForFailure(undefined)).toBe(SERVE_EXIT.unexpected);
  });
});

describe('a run with several outcomes', () => {
  it('★★★ the most severe wins: unexpected, then stop, then retry', () => {
    const retry = { kind: 'result', status: 409, code: 'lease_expired' };
    const stop = { kind: 'result', status: 403, code: 'not_the_claimer' };
    expect(exitForRun([retry])).toBe(SERVE_EXIT.retry);
    expect(exitForRun([retry, stop, retry])).toBe(SERVE_EXIT.stop);
    expect(exitForRun([stop, { kind: 'unexpected' }])).toBe(SERVE_EXIT.unexpected);
  });

  it('★★★ CONTROL: no failures is 0, which is also what "nothing was queued" returns', () => {
    expect(exitForRun([])).toBe(SERVE_EXIT.ok);
  });
});
