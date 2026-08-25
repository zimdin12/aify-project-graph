// What KIND of limitation is a `cause`? The classification the sticky-degraded tracker needs.
//
// graph-senior-dev, step 5 of the evidence-contract migration: "migrate sticky telemetry to named
// cause classification, not either boolean."
//
// ⛔ I FIRST CLAIMED THIS WAS A TERM DELETION AND IT IS NOT. The census said the tracker could drop
// its `degraded &&` term "because cause is non-null exactly when degraded is true". MEASURED: 336
// of 1,134 combinations violate that — `cause: 'unknown'` carries `degraded: false`. I had read the
// invariant, not run it.
//
// ⭐ WHAT RUNNING IT ACTUALLY SHOWED, and this is the real finding: the split is TOTAL. Across
// 1,782 combinations of both verbs, no cause ever appears with both values —
//
//     12 causes        always degraded:true
//     'unknown'        always degraded:false   (336 of 336)
//
// So `degraded` IS derivable from `cause`, just not by the rule I guessed. It needs a
// classification over the vocabulary, which is what dev asked for.
//
// ⚠ THE CLASSES ARE THE TRACKER'S, NOT THE BOOLEAN'S. This says which causes should PIN a session
// as degraded. It deliberately does not redefine `degraded`, which is deprecated and leaving.

/**
 * `index_population_unattested` is true of EVERY call — the compile DB never reports which TUs
 * clangd actually indexed. Treating it as an incident would (a) overwrite a real prior cause like
 * `cold_index` so it never surfaces, and (b) pin the session degraded forever with a fact that
 * describes the tool rather than the request. That bug was caught by a test, not by reading.
 */
const STANDING = new Set(['index_population_unattested']);

/**
 * Explicitly SELECTED behaviour. Nothing happened *to* the request.
 *
 * dev, reviewing b396c0a: "bounded mode is not an incident — it never waits for the index by
 * design. Calling it an operational incident repeats the standing-limit problem at a smaller
 * scope." A bounded response can be healthy-for-bounded, precise on every returned node, and
 * incomplete: three separate facts.
 */
const SELECTED = new Set(['bounded_mode']);

/**
 * A named reason that is NOT a degradation. `unknown` means "usable result; readiness signal
 * missing" — `exhaustive` is withheld and the reason is named, but nothing went wrong. This class
 * is the one the measurement revealed; a two-way standing/transient split could not express it.
 */
const NOT_A_DEGRADATION = new Set(['unknown']);

/**
 * @returns {'standing'|'selected'|'none'|'transient'}
 *   standing   — a permanent epistemic limit; never pins, never clears
 *   selected   — chosen behaviour; not an incident
 *   none       — no limitation, or one that is not a degradation
 *   transient  — a real incident a later good result can clear. THE ONLY CLASS THAT PINS.
 */
export function classifyCause(cause) {
  if (cause === null || cause === undefined) return 'none';
  if (NOT_A_DEGRADATION.has(cause)) return 'none';
  if (STANDING.has(cause)) return 'standing';
  if (SELECTED.has(cause)) return 'selected';
  return 'transient';
}

/** Should this cause pin the session as degraded? Only a real incident does. */
export function pinsStickyDegraded(cause) {
  return classifyCause(cause) === 'transient';
}

/**
 * ⚠ DEFAULTS TO `transient`, WHICH IS THE CAUTIOUS DIRECTION AND THE DELIBERATE ONE.
 *
 * An unrecognised cause is treated as a real incident, so a NEW cause added without touching this
 * file pins the session and surfaces, rather than being silently classified as harmless. The
 * opposite default would make every future cause invisible to the tracker — the fail-open shape
 * this codebase keeps removing.
 *
 * Exported so a test can assert the default rather than infer it.
 */
export const UNRECOGNISED_CAUSE_CLASS = 'transient';
