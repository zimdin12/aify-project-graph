// The negotiation boundary: a consumer PROVES it understands a contract before it receives one.
//
// WHY THIS EXISTS, and it is not the reason I first gave. Step 8 of the evidence-contract
// migration deletes `degraded` and `operationallyDegraded`. It rests on a fail-closed guard,
// `canInterpretEvidence`, which was measured to have ZERO production callers — against a positive
// control of 4 live sites for the producer stamp, so the zero is a fact about the code and not a
// broken search. A guard no reader invokes cannot protect an old reader from `!undefined === true`.
//
// ⛔ MY PROPOSED FIX WAS WIRING AN INTERNAL CALLER, AND IT WAS REFUSED IN REVIEW:
//
//     "A producer-side adapter that stamps v2 and immediately calls its own v2 guard proves only
//      self-consistency. It does not make an old external reader inspect the version."
//
// It would have produced a non-zero call count — the exact metric I was reaching for — and no
// protection whatsoever. A CALL COUNT IS NOT A CONSUMER, the same way a stamped field is not a
// protocol. The hazardous reader sits outside this boundary.
//
// ⇒ SO SILENCE IS NOT CONSENT. An omitted request keeps contract 1 forever. Contract 2 is
// reachable only by asking for it by number, which is mechanically stronger than publishing prose
// and does not depend on any client noticing that a field appeared.

import { DEPRECATED_EVIDENCE_FIELDS } from './evidence-contract.js';

/**
 * What each contract DOES, as data rather than as branches scattered through the code.
 *
 * ⭐ THE SUPPORTED SET IS DERIVED FROM THIS TABLE. Adding a contract here makes it negotiable
 * everywhere at once; there is no second list to remember. A list you must remember to update is a
 * defect with a delay on it, and this repo removed three of them in a single day — two hardcoded
 * compile-DB directory allowlists and a hardcoded roster of our own skills.
 */
export const CONTRACT_BEHAVIOURS = Object.freeze({
  1: Object.freeze({ carriesDeprecatedFields: true }),
  2: Object.freeze({ carriesDeprecatedFields: false }),
});

/** Derived from the table above — never spelled a second time. */
export const SUPPORTED_EVIDENCE_CONTRACT_VERSIONS = Object.freeze(
  Object.keys(CONTRACT_BEHAVIOURS).map(Number).sort((a, b) => a - b),
);

/**
 * What a caller gets when it asks for nothing.
 *
 * ⚠ STAYS AT 1 UNTIL v2 REQUESTS ARE MEASURED. Flipping this on the assumption that clients
 * adopted v2 would be wrong by roughly the margin every previous adoption assumption on this
 * project has been wrong by: 17 skills installed, 9 invocations ever, 12 never invoked once.
 */
export const DEFAULT_EVIDENCE_CONTRACT_VERSION = 1;

const isRealVersion = (v) => Number.isInteger(v) && v >= 1;

/**
 * Negotiate the contract for one request.
 *
 * @param {unknown} requested  the caller's `acceptEvidenceContractVersion`, or undefined
 * @returns {{ok: true, version: number} | {ok: false, error: string, supported: number[]}}
 */
export function negotiateEvidenceContract(requested) {
  if (requested === undefined) {
    // Silence is not consent — an old client keeps the contract it was built against.
    return { ok: true, version: DEFAULT_EVIDENCE_CONTRACT_VERSION };
  }
  const supported = [...SUPPORTED_EVIDENCE_CONTRACT_VERSIONS];
  if (!isRealVersion(requested)) {
    return {
      ok: false,
      error: `acceptEvidenceContractVersion must be one of ${supported.join(', ')}; received ${describe(requested)}`,
      supported,
    };
  }
  if (!Object.hasOwn(CONTRACT_BEHAVIOURS, String(requested))) {
    // ⛔ A FUTURE VERSION REFUSES RATHER THAN DOWNGRADING. Handing v2 back to a client that asked
    // for v3 leaves it believing it holds a contract nobody emitted — the fail-open direction.
    return {
      ok: false,
      error: `acceptEvidenceContractVersion ${requested} is not implemented; supported: ${supported.join(', ')}`,
      supported,
    };
  }
  return { ok: true, version: requested };
}

/** Render an unusable value for the error text without letting it throw. */
function describe(v) {
  if (v === null) return 'null';
  if (typeof v === 'object') return Array.isArray(v) ? 'an array' : 'an object';
  if (typeof v === 'string') return `the string ${JSON.stringify(v)}`;
  if (Number.isNaN(v)) return 'NaN';
  return String(v);
}

/**
 * Render an evidence object under a negotiated contract, and stamp the version it was rendered as.
 *
 * ⚠ THROWS on a version that did not come from `negotiateEvidenceContract`. A second, weaker gate
 * that quietly accepted anything would let a caller bypass the first one, which is how a
 * negotiated boundary becomes decoration.
 */
export function applyEvidenceContract(evidence, version) {
  const behaviour = isRealVersion(version) ? CONTRACT_BEHAVIOURS[String(version)] : undefined;
  if (!behaviour) {
    throw new TypeError(`applyEvidenceContract: ${describe(version)} is not a negotiated contract version`);
  }
  const out = { ...evidence, contractVersion: version };
  if (!behaviour.carriesDeprecatedFields) {
    // ⚠ READS THE DECLARATION, never a copy of it. Two lists of "which fields are deprecated" is
    // exactly how the two compile-DB allowlists drifted apart and cost a real repository its
    // caller sets.
    for (const field of Object.keys(DEPRECATED_EVIDENCE_FIELDS)) delete out[field];
  }
  return out;
}
