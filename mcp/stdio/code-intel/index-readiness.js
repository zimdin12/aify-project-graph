// WAS THE INDEX OBSERVED READY, OR MERELY NOT HEARD FROM? THOSE ARE DIFFERENT ANSWERS.
//
// ⛔ `index_ready` IS THE BASIS FOR AN ATTESTATION THAT LICENSES DELETION. It is persisted onto the
// collection (`importer.js`) and gates the banner in `lsp-evidence.js`
// (`collection.indexReady === true && allVerified`), which the server-instructions describe as
// granting an exhaustive caller set. `cpp-clangd.js` says it in its own words: *"only
// trustworthy-as-exhaustive when indexReady===true"*.
//
// ⛔ AND IT WAS BEING SET FROM AN INFERENCE. Both consumers wrote `indexReady = !!r.ready`, which
// collapses `waitForIndexReady`'s two very different successes:
//
//     index_drained / already_ready / ready_no_index_needed   PROVEN — indexing was observed
//     no_progress_signalled                                   INFERRED — nothing was heard within
//                                                             settleMs (default 1500 ms)
//
// The inference is unsound, and this is measured rather than argued. Five cold starts against a real
// clangd on a 24-file C++ fixture, first `$/progress begin` after didOpen:
//
//     [744, 1041, 937, 1525, 2125] ms — 5 of 5 signalled, WORST 2125 ms vs a 1500 ms window
//
// Two of five announced AFTER the window closed. So silence inside the window conflates "the index
// was already on disk, there is nothing to do" with "clangd has not announced yet", and nothing
// available inside the window separates them.
// See docs/evidence/m2-contract/FINDING-the-settle-window-is-shorter-than-the-signal-it-waits-for.md
//
// ⭐ THE REPAIR IS NOT TO FLIP THE BOOLEAN. Flipping would discard the genuinely-on-disk case, which
// really is ready. The unknown gets its own value, exactly as `graphCurrency` and `briefUnreadable`
// did earlier in this arc — and the storage was ALREADY three-state waiting for it: `importer.js`
// writes `indexReady == null ? null : (…)`, the schema records that older rows are NULL and
// "treated as unknown readiness downstream", and the banner gates on `=== true`, so NULL fails
// closed with no downstream change required.
//
// ⚠ THE RECALL COST IS REAL AND IS ACCEPTED HERE. A genuinely on-disk index also reports
// `no_progress_signalled` and will now record NULL rather than true, losing an attestation it
// deserved. Recovering it needs a discriminator this function does not have — whether clangd's index
// cache exists on disk for the project — which is named as follow-up in the finding rather than
// guessed at here.

/** Reasons that mean indexing was OBSERVED, not merely un-heard. Anything else fails closed. */
const PROVEN_READY = new Set(['index_drained', 'already_ready', 'ready_no_index_needed']);

/**
 * Map a `waitForIndexReady` result onto the three-state `index_ready`.
 *
 * @param {{ready?: boolean, reason?: string}|null|undefined} result
 * @returns {true|false|null}
 *   true  — readiness was OBSERVED; may license the exhaustive attestation.
 *   false — not ready, and that was established (a timeout, or a cold workspace).
 *   null  — UNKNOWN. Silence inside a window too short to contain the signal, an unrecognised
 *           reason, or no result at all.
 *
 * ⛔ AN UNRECOGNISED REASON IS UNKNOWN, NOT READY. A `reason` string added to the client later must
 * not inherit `true` by default — that is the "a default written for the ordinary case is inherited
 * by a case it was not written for" shape this arc has now recorded three times.
 */
export function indexReadyFromWaitResult(result) {
  if (!result || typeof result !== 'object') return null;
  // A stated NOT-ready is a real negative and is preserved. Softening it to `unknown` would throw
  // away information the wait actually established.
  if (result.ready !== true) return false;
  return PROVEN_READY.has(result.reason) ? true : null;
}
