// What a swept run does with the service's answer: an exit code and the line that explains it. PURE.
//
// Agreed with the dashboard (DESIGN-QUIET-ANCHORS step 3): a stale sweep is reported and the run stops. It is
// never re-swept automatically, because two of this reporter's processes doing that would keep overtaking each
// other. A stale baseline or revision means this run measured against something that has since moved; running
// again reserves afresh, and that is the caller's decision, not a loop in here.
//
// ⛔ ONE CODE PER RECOVERY, NOT PER CAUSE. The aify-env schedule acts on the code alone (agreed with
// dashboard-manager 2026-10-19). Exit 2 used to cover every refusal and an unanswered request exited 1, so a wrong
// key was retried for ever and a dashboard restart read as a bug. Each code now names one thing to do:
//   2 run again now · 5 back off and try again · 6 stop this head; running again cannot fix it

/** Exit codes, shared with the header of scripts/post-watch-signals.mjs. */
export const EXIT = Object.freeze({ ok: 0, failed: 1, reread: 2, stale: 3, dirty: 4, unavailable: 5, refused: 6 });

/** The service busy or failing: nothing about this sweep was judged, so the same sweep can be tried later. */
function unavailableStatus(status) {
  return status === 429 || (Number.isInteger(status) && status >= 500);
}

/**
 * A refusal from either step, the reservation or the post. The line starts `REFUSED <status> <code>:` so a
 * scheduler can quote it; the service's text follows, and it never holds the key.
 * @param {{ status: number, code: string, detail?: string|null, staleSweep?: boolean, shouldReread?: boolean }} refusal
 */
export function outcomeOfRefusal(refusal) {
  const said = `${refusal.status} ${refusal.code}: ${refusal.detail ?? 'no message'}`;
  if (refusal.staleSweep) {
    return { exit: EXIT.stale, line: `STALE SWEEP: a later sweep from this reporter was applied first, so this report was kept as history and changed no mark. ${refusal.detail ?? ''}` };
  }
  if (refusal.shouldReread) {
    return { exit: EXIT.reread, line: `REFUSED ${said} (something moved after this sweep reserved; run again, which reserves afresh and re-measures)` };
  }
  if (unavailableStatus(refusal.status)) return { exit: EXIT.unavailable, line: `UNAVAILABLE ${said}` };
  return { exit: EXIT.refused, line: `REFUSED ${said}` };
}

/** No HTTP answer at all (dashboard-signals-client.mjs isNoAnswer). Names the socket error, never the URL's key. */
export function outcomeOfNoAnswer(error) {
  const cause = error?.cause?.code ?? error?.cause?.message ?? error?.message;
  return { exit: EXIT.unavailable, line: `UNAVAILABLE no answer: ${cause}` };
}

/**
 * @param {{ reply?: object|null, refusal?: { status: number, code: string, detail?: string|null, staleSweep?: boolean, shouldReread?: boolean } }} input
 *   exactly one of: the 2xx body, or the SignalsRefused it threw
 */
export function outcomeOfPost({ reply, refusal }) {
  if (refusal !== undefined) return outcomeOfRefusal(refusal);
  // ⛔ ONLY THE TWO ANSWERS THIS PROVIDER WAS TOLD ABOUT ARE SUCCESS. Anything else fails closed.
  if (reply?.kind === 'applied' || reply?.kind === 'repeat') {
    return { exit: EXIT.ok, line: `${reply.kind.toUpperCase().padEnd(13)} ${JSON.stringify(reply)}` };
  }
  return { exit: EXIT.failed, line: `UNRECOGNISED ANSWER, treated as a failure: ${JSON.stringify(reply)}` };
}
