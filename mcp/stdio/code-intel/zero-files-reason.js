// WHY DID A COLLECTION PROCESS ZERO FILES? — a typed answer, or an honest silence.
//
// ⛔ THE DEFECT THIS CLOSES. `graphCollectCodeIntel` could return `status: 'partial'` having
// collected nothing, with no field saying why, and the integration test then asserted
// `expected 0 to be greater than 0`. A starved clangd and a broken graph join surface identically,
// so neither the test nor an agent can say which occurred, and no number of reruns separates them.
// This is M2's contract — "no callers" versus "no callers in indexed scope" — in the collect path,
// which is where an agent meets it first.
//
// ⛔ EVERY VALUE DERIVES FROM AN EXPLICIT PRODUCER ASSERTION, NEVER FROM A SCALAR. Three values in
// my first design were struck for exactly that, and each would have been wrong in a way no test of
// mine was going to catch:
//   · `filesTotal === 0` is THIS CALL'S REMAINDER, and is also 0 on a converged resume;
//   · `resumedFrom` is a resume COUNT, not a completion assertion — deriving completion from it is
//     the hole that made a collect a permanent no-op reporting success (Sand Castle, 2026-08-20);
//   · `indexReady === false` is a STATE, not a demonstrated cause of zero files.
//
// ⛔ AND THE SUMMARY LAYER DOES NOT RECONSTRUCT LEDGER VALIDITY. The provider owns
// `readLedger(..., graphEvidenceWitness(...))` and must emit its typed note AFTER that verified
// read. This maps the provider's assertion; it never re-derives it. Inferring here would erase the
// authority boundary the whole design rests on.
//
// Preregistration: docs/evidence/typed-zero-reason/PREREGISTRATION.md

/** The contract version for this machine-readable field. Bump when the value set changes. */
export const ZERO_FILES_REASON_SCHEMA = 'zero-files-reason/1';

// Producer note codes this mapper recognises as authoritative. A code absent from here leaves the
// cause explicitly UNKNOWN rather than being guessed at from surrounding scalars.
const AUTHORITATIVE = new Set(['already_collected', 'no_files', 'budget_exhausted']);

/**
 * @param {object}  input
 * @param {*}       input.filesProcessed  the producer's count. Must be the INTEGER 0 for any
 *   reason to be emitted at all — see the omission rule below.
 * @param {{code?:string}[]} [input.notes]  the producer's typed notes.
 * @param {boolean} [input.complete]  the producer's explicit "the enumerated list was not
 *   truncated" state. Required before `already_collected` may claim completion.
 * @returns {{reason:string, authority:string}|undefined}
 *
 * ⚠ RETURNS `undefined` — the field is OMITTED — WHENEVER `filesProcessed` IS NOT THE INTEGER 0.
 * My first rule said "UNKNOWN, never coerced to zero", and that was still wrong:
 * `ZERO_FILES_CAUSE_UNKNOWN` *asserts that zero files were processed* and only leaves the cause
 * open. If the caller cannot establish the population it must not assert the population. An
 * unknown-population signal belongs on a separate channel, not on a field whose name claims zero.
 */
export function zeroFilesProcessedReason({ filesProcessed, notes, complete } = {}) {
  if (!Number.isInteger(filesProcessed) || filesProcessed !== 0) return undefined;

  const codes = (Array.isArray(notes) ? notes : [])
    .map((n) => n?.code)
    .filter((c) => AUTHORITATIVE.has(c));
  const distinct = [...new Set(codes)];

  // ⛔ CONFLICT IS NOT RESOLVED BY PRECEDENCE. Choosing between two contradictory producer claims
  // would mean choosing which explanation to believe, then presenting the choice as a finding.
  if (distinct.length > 1) {
    return { reason: 'UNKNOWN_CONFLICT', authority: `producer_notes:${distinct.sort().join('+')}` };
  }

  const code = distinct[0];
  // `already_collected` may only claim completion when the producer ALSO states the enumerated
  // list was not truncated. Otherwise "nothing pending" describes the list, not the repository —
  // the producer's own words, and the distinction the empty-collection incident turned on.
  if (code === 'already_collected' && complete === true) {
    return { reason: 'ALREADY_COMPLETE', authority: 'producer_note:already_collected' };
  }
  if (code === 'no_files') {
    return { reason: 'NO_FILES_IN_REQUESTED_SCOPE', authority: 'producer_note:no_files' };
  }
  if (code === 'budget_exhausted') {
    return { reason: 'BUDGET_EXHAUSTED_BEFORE_FIRST_FILE', authority: 'producer_note:budget_exhausted' };
  }
  return { reason: 'ZERO_FILES_CAUSE_UNKNOWN', authority: 'none' };
}
