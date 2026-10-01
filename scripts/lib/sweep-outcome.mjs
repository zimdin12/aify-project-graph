// What a swept run does with the service's answer: an exit code and the line that explains it. PURE.
//
// Agreed with the dashboard (DESIGN-QUIET-ANCHORS step 3): a stale sweep is reported and the run stops. It is
// never re-swept automatically, because two of this reporter's processes doing that would keep overtaking each
// other. A stale baseline or revision means this run measured against something that has since moved; running
// again reserves afresh, and that is the caller's decision, not a loop in here.

/** Exit codes, shared with the header of scripts/post-watch-signals.mjs. */
export const EXIT = Object.freeze({ ok: 0, failed: 1, refused: 2, stale: 3 });

/**
 * @param {{ reply?: object|null, refusal?: { code: string, message: string, staleSweep?: boolean, shouldReread?: boolean } }} input
 *   exactly one of: the 2xx body, or the SignalsRefused it threw
 */
export function outcomeOfPost({ reply, refusal }) {
  if (refusal !== undefined) {
    if (refusal.staleSweep) {
      return { exit: EXIT.stale, line: `STALE SWEEP: a later sweep from this reporter was applied first, so this report was kept as history and changed no mark. ${refusal.message}` };
    }
    if (refusal.shouldReread) {
      return { exit: EXIT.refused, line: `REFUSED ${refusal.code}: something moved after this sweep reserved; run again, which reserves afresh and re-measures. ${refusal.message}` };
    }
    return { exit: EXIT.refused, line: `REFUSED ${refusal.code}: ${refusal.message}` };
  }
  // ⛔ ONLY THE TWO ANSWERS THIS PROVIDER WAS TOLD ABOUT ARE SUCCESS. Anything else fails closed.
  if (reply?.kind === 'applied' || reply?.kind === 'repeat') {
    return { exit: EXIT.ok, line: `${reply.kind.toUpperCase().padEnd(13)} ${JSON.stringify(reply)}` };
  }
  return { exit: EXIT.failed, line: `UNRECOGNISED ANSWER, treated as a failure: ${JSON.stringify(reply)}` };
}
