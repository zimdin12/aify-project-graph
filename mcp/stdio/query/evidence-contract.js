// The evidence contract's version, and the deprecations queued against it.
//
// WHY THIS EXISTS. review ruling 2026-08-25: deleting `degraded` and
// `operationallyDegraded` is APPROVED AS A TARGET and immediate silent deletion is REFUSED,
// because of one failure mode:
//
//     "After deletion, `undefined` is falsy and `if (!evidence.degraded)` becomes true —
//      the dangerous direction."
//
// A consumer asking "is this result clean?" would start getting YES for every answer. A cleanup
// that removes a field carrying no information, and in doing so manufactures a confident wrong
// answer, is the exact defect class this release exists to remove — introduced by the act of
// tidying it up.
//
// ⇒ SO THE VERSION IS THE MECHANISM, NOT A LABEL. It exists so a reader can tell a contract it
// understands from one it does not, and REFUSE rather than interpret a missing boolean as health.
// It must ship in the COMPATIBLE window — before the removal — or there is nothing for a reader to
// compare against when the breaking version lands.
//
// ⚠ ONE OWNER. Not duplicated into each verb: two copies of a version is precisely how the two
// compile-DB directory allowlists drifted apart and cost a real repo its caller sets.

/**
 * Current evidence-contract version.
 *
 * 1 — `degraded` and `operationallyDegraded` still present, both DEPRECATED (see below).
 * 2 — (not cut) both removed. `exhaustive` carries the branchable safety decision and `cause`
 *     carries the diagnosis. A reader that does not recognise a version MUST refuse.
 */
export const EVIDENCE_CONTRACT_VERSION = 1;

/**
 * Fields present but deprecated, with the reason a reader should stop consuming them.
 * Machine-readable on purpose: a consumer can assert it is not reading a deprecated field, and
 * the removal commit has a list it cannot forget to check.
 */
export const DEPRECATED_EVIDENCE_FIELDS = Object.freeze({
  degraded: 'true on EVERY successful answer under a standing cause, so it does not discriminate. '
    + 'Read `cause` (null = no known limitation) and `exhaustive` instead. Removed in contract 2.',
  operationallyDegraded: 'added 2026-08-25 as the wrong remedy to a correct diagnosis — a second '
    + 'overlapping boolean placed before the fields that govern action. Read `cause`. '
    + 'Removed in contract 2.',
});

/**
 * Can a reader that understands `understood` safely interpret a payload at `seen`?
 *
 * ⭐ FAILS CLOSED, AND THAT IS THE WHOLE POINT. An unknown version — including a NEWER one —
 * returns false. The hazard is not an old payload reaching a new reader; it is a NEW payload
 * reaching an OLD reader, where an absent `degraded` reads as falsy and therefore as healthy.
 * Refusing is the only answer that cannot be mistaken for "everything is fine".
 *
 * @param {unknown} seen        the `contractVersion` on the payload
 * @param {number} understood   the highest version this reader implements
 */
export function canInterpretEvidence(seen, understood = EVIDENCE_CONTRACT_VERSION) {
  // ⛔ A CONTRACT VERSION IS A POSITIVE IDENTITY, and `seen <= understood` alone let 0, -1 and
  // MIN_SAFE_INTEGER through as though they were older supported schemas. They name no contract
  // that has ever existed, so a forged or corrupt stamp was being interpreted under contract 1.
  // Found in review while checking the step-8 tripwire; confirmed by execution, and the
  // test above it had been ASSERTING the fail-open rather than catching it.
  if (!isRealContractVersion(seen)) return false;       // absent, malformed, or naming no contract
  if (!isRealContractVersion(understood)) return false; // a reader claiming version 0 is not a reader
  return seen <= understood;
}

/** A contract version is an integer >= 1. There is no version 0, and never a negative one. */
function isRealContractVersion(v) {
  return Number.isInteger(v) && v >= 1;
}

/** The version stamp every evidence object carries. Kept as a function so the shape has one owner. */
export function evidenceContractStamp() {
  return { contractVersion: EVIDENCE_CONTRACT_VERSION };
}
