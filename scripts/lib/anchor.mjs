// ANCHOR RESOLUTION FOR THE MUTATION APPARATUS — three states, never two.
//
// ⛔ THE GAP THIS CLOSES WAS DECLARED OPEN BY THE TOOL ITSELF. `self-review.mjs` mutated with:
//
//     const after = before.replace(m.from, m.to);
//     if (after === before) { record(VERDICT.INVALID, 'anchor missing — nothing was mutated'); }
//
// `String.replace` with a STRING argument replaces only the FIRST occurrence. So:
//
//     0 occurrences  ->  after === before  ->  INVALID, correctly fails closed
//     1 occurrence   ->  the intended mutation
//     2+ occurrences ->  the FIRST site is mutated, after !== before, and the arm proceeds as
//                        though the mutation were the one the spec described
//
// ⇒ **A missing anchor failed closed; a duplicated anchor did not fail at all.** The arm would
// then attribute a red test to a site nobody chose. self-review's own header listed
// "single-occurrence anchor enforcement" under OPEN — honestly declared, and then not closed.
//
// ⚠ LATENT, NOT FIRING: the 35 declared specs currently contain zero duplicate anchors, so this
// has never mis-mutated anything. Closing it in production is warranted; inflating its historical
// impact is not.
//
// ⇒ THE RESOLVER AND THE MUTATOR ARE SEPARATE. `String.replace` was both, which is how one search
// could decide "found" and a different search decide "where". Resolution returns exact byte
// offsets and the mutation is applied AT those offsets — never by a fresh second search that
// could disagree.

/**
 * The state of an anchor within a source, as a typed result.
 *
 * ⛔ NEVER `-1`/null CARRYING TWO MEANINGS. "not found" and "found in several places" demand
 * different remedies — retarget the spec, versus disambiguate it — so they are different states.
 *
 * @returns {{state:'unique', index:number} | {state:'absent'} | {state:'duplicate', occurrences:number[]}
 *          | {state:'invalid', reason:string}}
 */
export function resolveAnchor(source, anchor) {
  // ⛔ FAIL CLOSED ON A DEGENERATE ANCHOR. An empty string is "found" at every position, so a
  // spec with an empty `from` would resolve as duplicate-everywhere or, worse, mutate at 0.
  if (typeof source !== 'string') return { state: 'invalid', reason: 'source is not a string' };
  if (typeof anchor !== 'string' || anchor.length === 0) {
    return { state: 'invalid', reason: 'anchor is empty or not a string' };
  }

  // NON-OVERLAPPING BY DEFINITION, stated because it changes the count: searching for `aa` in
  // `aaa` yields ONE occurrence here, not two. Overlapping counts are not deterministic to apply
  // — replacing one would destroy the other — so the semantics that matter for mutation are the
  // ones used to count.
  const occurrences = [];
  let pos = 0;
  for (;;) {
    const idx = source.indexOf(anchor, pos);
    if (idx === -1) break;
    occurrences.push(idx);
    pos = idx + anchor.length;
  }

  if (occurrences.length === 0) return { state: 'absent' };
  if (occurrences.length === 1) return { state: 'unique', index: occurrences[0] };
  return { state: 'duplicate', occurrences };
}

/** Human-readable reasons, distinct per state so an INVALID arm says which problem it hit. */
export const ANCHOR_REASON = {
  absent: 'anchor_absent',
  duplicate: 'anchor_ambiguous',
  invalid: 'anchor_invalid',
};

/**
 * Apply a replacement, but ONLY when the anchor resolves uniquely.
 *
 * ⛔ THE NON-APPLIED PATHS RETURN THE SOURCE UNCHANGED, BYTE FOR BYTE. A caller that writes
 * `result.after` unconditionally must not be able to corrupt the file by doing so — the guard
 * cannot rely on every future caller checking `applied` first.
 *
 * @returns {{applied:boolean, after:string, state:string, reason?:string, occurrences?:number[]}}
 */
export function applyAnchor(source, anchor, replacement) {
  const resolved = resolveAnchor(source, anchor);

  if (resolved.state !== 'unique') {
    return {
      applied: false,
      after: source,                        // byte-identical: nothing was touched
      state: resolved.state,
      reason: ANCHOR_REASON[resolved.state] ?? ANCHOR_REASON.invalid,
      ...(resolved.occurrences ? { occurrences: resolved.occurrences } : {}),
    };
  }

  // Applied at the RESOLVED offset. Slicing at a known index cannot select a different site than
  // the one the resolution reported, which a second `indexOf` or `replace` could.
  const { index } = resolved;
  const after = source.slice(0, index) + replacement + source.slice(index + anchor.length);
  return { applied: true, after, state: 'unique', index };
}
