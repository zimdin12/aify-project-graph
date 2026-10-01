// What a run of serve-provider-requests tells whoever schedules it: one exit code, chosen by the most severe outcome.
// PURE. The contract was agreed with dashboard-manager on 2026-10-01; the aify-env plugin paces on it every 60s.
//
//   0  fine: every claimed call answered and stored, including none claimed. Keep the normal cadence.
//   3  try again next tick: the dashboard unreachable, a 5xx or 429, a claim refused with 409, or a result refused
//      because the queue moved on (lease_expired, not_claimed, already_answered).
//   2  stop calling until someone fixes the configuration: no project or key, a bad argument, a claim refused with
//      400/401/403/404, a result refused as not_the_claimer (wrong host key) or no_provenance (a bug here).
//   1  unexpected: an error nobody classified. A bug, not a condition, so stop and report.
// Several outcomes in one run: the most severe wins, 1 then 2 then 3 then 0.

export const SERVE_EXIT = Object.freeze({ ok: 0, unexpected: 1, stop: 2, retry: 3 });

/** Severity order, most severe first. Derived from this list, never restated. */
const SEVERITY = Object.freeze([SERVE_EXIT.unexpected, SERVE_EXIT.stop, SERVE_EXIT.retry, SERVE_EXIT.ok]);

/** Result refusals that mean the queue moved on: the next claim picks up whatever is still queued. */
const RESULT_RETRY_CODES = Object.freeze(['lease_expired', 'not_claimed', 'already_answered']);

/**
 * Classify one failure. `failure` is one of:
 *   { kind: 'config' }                          a missing setting or a bad argument
 *   { kind: 'network' }                         the request never got an HTTP answer
 *   { kind: 'claim', status, code }             the claim was refused
 *   { kind: 'result', status, code }            one result was refused
 *   { kind: 'unexpected' }                      anything else
 */
export function exitForFailure(failure) {
  switch (failure?.kind) {
    case 'config': return SERVE_EXIT.stop;
    case 'network': return SERVE_EXIT.retry;
    case 'claim': return transient(failure.status) || failure.status === 409 ? SERVE_EXIT.retry : SERVE_EXIT.stop;
    case 'result':
      if (transient(failure.status) || RESULT_RETRY_CODES.includes(failure.code)) return SERVE_EXIT.retry;
      return SERVE_EXIT.stop;
    default: return SERVE_EXIT.unexpected;
  }
}

/** The run's exit code: the most severe of its failures, or 0 with none. */
export function exitForRun(failures) {
  const codes = failures.map(exitForFailure);
  return SEVERITY.find((code) => codes.includes(code)) ?? SERVE_EXIT.ok;
}

function transient(status) {
  return status === 429 || (Number.isInteger(status) && status >= 500);
}
