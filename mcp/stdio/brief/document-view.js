// THE DOCUMENT VIEW-MODEL — populations, counts and state. No rendering, no presentation.
//
// ⛔ THESE LIVED IN `render.js` AND `generator.js` IMPORTED THEM FROM THERE. "Renderers present,
// they do not derive" was true in the comments and false in the dependency graph: the composition
// root reached into the presentation layer for domain construction.
//
// ⇒ the reviewer's ruling, and the reason it is a move rather than a preference — a boundary
// that exists only in prose is a boundary the next edit crosses without noticing.

/**
 * One count, normalized once — value or diagnostic, never both, never a lie.
 *
 * ⛔⛔ THE FIRST CODEC FIX COVERED THE SITE THE WITNESS NAMED AND NOT THE CLASS. A malformed
 * CANDIDATE total got a JSON-safe `{type, repr}` diagnostic; the malformed INDEXED count did not,
 * and it crosses the same serializer. the reviewer executed the wire artifact:
 *
 *     NaN       -> indexed_document_count: null    indistinguishable from ABSENT
 *     Infinity  -> indexed_document_count: null    same
 *     1.5       -> indexed_document_count: 1.5     violates numeric-or-null
 *     '3'       -> indexed_document_count: "3"     a STRING in a count field
 *
 * ★ An instance-shaped fix for a class-shaped defect — the exact pattern that cost this repo 62,066
 * records earlier today, when a documented guard was applied to edge invalidation and not to the
 * record prune 600 lines away. I had the general lesson written down and still repaired one site.
 *
 * ⇒ So both counts go through THIS function and neither caller restates the rule. A count is a
 * non-negative integer or null; anything else travels as a diagnostic that survives JSON.
 */
export function normalizeCount(raw) {
  if (raw == null) return { value: null, invalid: null };
  if (Number.isInteger(raw) && raw >= 0) return { value: raw, invalid: null };
  // `String(NaN)` is 'NaN' and `String(Infinity)` is 'Infinity' — both survive serialization, which
  // the raw values do not.
  return { value: null, invalid: { type: typeof raw, repr: String(raw) } };
}

/**
 * THE canonical document view-model. Built ONCE, in the generator, before any renderer runs.
 *
 * ⛔ EVERY SURFACE USED TO RECONSTRUCT THIS FROM LOOSE SCALARS AND A MIXED ARRAY — filtering
 * `readFirstArr` by `kind` and calling `documentEvidence()` itself. Four surfaces reconstructing the
 * same state from the same raw parts is four chances to reconstruct it differently, and they did:
 * one surface of four carried the state, two counts crossed the codec differently, and a new kind
 * fell into whichever bucket an inequality did not name.
 *
 * ⇒ Renderers now consume this object. They present; they do not derive.
 */
export function buildDocumentView({ linkedCandidates, positionalFallback = [], documentCount = null } = {}) {
  const items = linkedCandidates?.items ?? [];
  const total = linkedCandidates?.total ?? null;
  return {
    evidence: documentEvidence(items, documentCount, total),
    linkedCandidates: { items, total },
    positionalFallback,
  };
}

export function documentEvidence(linkedItems = [], documentCount = null, candidateTotal = null) {
  // ⛔ CUSTODY, NOT A TAG. This read `items.filter(r => r.kind === 'doc').length` — a mixed-array
  // habit surviving inside the canonical builder. `linkedItems` IS the linked-candidate carrier;
  // membership was established when the producer built it. Re-checking a redundant tag meant a
  // carrier holding one rendered row could report "showing 0 of 1" if that tag were absent or
  // mutated — the population disagreeing with itself, one layer below where anyone would look.
  const shown = linkedItems.length;

  // ⚠ SYMMETRIC. Both inputs are normalized by the same rule before anything compares them, so a
  // comparison can never run against a string, a fraction or a NaN.
  const indexed = normalizeCount(documentCount);
  const linked = normalizeCount(candidateTotal);

  // ⛔ CONTRADICTIONS, and a malformed input is one of them. Observed inconsistency is not absence:
  // collapsing them to `unknown` would be the two-state collapse this file has been corrected for
  // repeatedly. The raw values travel as diagnostics so the contradiction is auditable.
  const inconsistent = Boolean(indexed.invalid) || Boolean(linked.invalid)
    || (indexed.value != null && linked.value != null && linked.value > indexed.value)
    // Shown cannot exceed the population it was drawn from — this is what the positional fallback
    // produced: 2 shown against a linked total of 0.
    || (linked.value != null && shown > linked.value);

  const state = inconsistent ? 'inconsistent'
    : (linked.value != null ? linked.value > 0 : shown > 0) ? 'candidates_present'
      : linked.value == null ? 'unknown'
        : indexed.value == null ? 'unknown'
          : indexed.value === 0 ? 'graph_empty'
            : 'indexed_without_link_candidates';

  return {
    indexed_document_count: indexed.value,
    linked_candidate_count: linked.value,
    // ⚠ Present ONLY when malformed, so a consumer can distinguish "absent" from "given, and wrong".
    ...(indexed.invalid ? { invalid_indexed_document_count: indexed.invalid } : {}),
    ...(linked.invalid ? { invalid_linked_candidate_count: linked.invalid } : {}),
    // Both, always. "showing 2 of 89" is only sayable if the artifact carries both.
    shown_candidate_count: shown,
    state,
  };
}
