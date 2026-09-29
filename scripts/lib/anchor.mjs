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
  //
  // ⛔⛔ AND THE MATCH HAPPENS IN THE FILE'S OWN LINE ENDINGS, NOT THE ANCHOR'S.
  //
  // Named by dashboard-manager 2026-09-29, from a live instance on their tree: two anchors stopped
  // resolving with THE CODE THEY NAME COMPLETELY UNCHANGED, because the file had become CRLF and every
  // `\n` in a committed multi-line span matched nothing.
  //
  // ⇒ THE VERDICT IS WHAT MAKES IT EXPENSIVE, not the miss. `absent` reads as "a stale spec pointing at
  // deleted code". It sends you looking for a refactor that never happened, and the honest-looking
  // response is to re-aim the anchor at whatever is there now — which silently replaces one measurement
  // with a different one.
  //
  // ⚠ MEASURED HERE, AND IT WAS LATENT RATHER THAN FIRING — stated at that size deliberately. 10 of the
  // 35 declared specs carry multi-line anchors and every one of them happens to target an LF file, so
  // all 35 resolved `unique`. The repo is MIXED: 122 pure-CRLF tracked .js/.mjs files, 799 LF, 6 mixed.
  // So the green was luck about which files those ten anchors point at, and one Windows editor touching
  // any of them turns a passing spec into a false "stale spec" report. Proven by re-resolving a real
  // multi-line anchor against a CRLF copy of its own file: `unique` -> `absent` -> `unique` again once
  // the anchor is converted.
  //
  // ⇒ Both variants are counted into ONE occurrence list, rather than trying the raw form and falling
  // back. A fallback would accept whichever form matched first and could report `unique` for a span that
  // appears once as LF and once as CRLF in a mixed file — the duplicate-anchor hazard this module exists
  // to close, re-entering through the fix for a different one. Normalising to LF first makes the
  // conversion idempotent: an anchor already carrying `\r\n` must not become `\r\r\n`.
  const variants = new Set([anchor]);
  const anchorAsLf = anchor.replace(/\r\n/gu, '\n');
  variants.add(anchorAsLf);
  variants.add(anchorAsLf.replace(/\n/gu, '\r\n'));

  const seen = new Set();
  for (const variant of variants) {
    let pos = 0;
    for (;;) {
      const idx = source.indexOf(variant, pos);
      if (idx === -1) break;
      // Keyed by offset AND length: the same start offset can only belong to one variant in practice,
      // but a set keyed on the offset alone would silently merge a genuine overlap.
      seen.add(`${idx}:${variant.length}`);
      pos = idx + variant.length;
    }
  }

  const occurrences = [...seen]
    .map((k) => ({ index: Number(k.split(':')[0]), length: Number(k.split(':')[1]) }))
    .sort((a, b) => a.index - b.index);

  if (occurrences.length === 0) return { state: 'absent' };
  if (occurrences.length === 1) {
    // ⭐ THE MATCHED LENGTH TRAVELS WITH THE INDEX. `applyAnchor` splices at `index` and must remove
    // exactly what was found — using the ORIGINAL anchor's length there would leave a stray `\r` per
    // line behind when the file is CRLF and the anchor was written with `\n`.
    return { state: 'unique', index: occurrences[0].index, matchedLength: occurrences[0].length };
  }
  return { state: 'duplicate', occurrences: occurrences.map((o) => o.index) };
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
  //
  // ⛔ AND AT THE RESOLVED *LENGTH*, NOT `anchor.length`. When the file is CRLF and the anchor was written
  // with `\n`, the matched span is LONGER than the anchor by one byte per line ending in it. Splicing
  // `anchor.length` bytes then removes k bytes too few and LEAVES THE LAST k BYTES OF THE SPAN IN PLACE —
  // a mutation that reports `applied: true` and corrupts the file, which is worse than the `absent` this
  // fix removes, because `absent` is at least loud. `matchedLength` falls back to `anchor.length` only for
  // the exact-match case, where they are equal by construction.
  //
  // ⚠ MEASURED, BECAUSE MY FIRST DESCRIPTION OF THIS WAS WRONG AND I NEARLY SHIPPED IT. This comment said
  // the bug "would leave a stray \r behind on every line". It does not: with one CRLF in the span,
  // matchedLength 30 against anchor.length 29 leaves the span's final `;`, giving
  // `  const merged = 3;;`. There is NO lone CR, so the lone-CR assertion I had written could never have
  // caught it — a comment describing one failure and a test checking a different one, both looking right.
  // The arm that catches it compares the whole resulting string against an independently built expectation.
  const { index, matchedLength } = resolved;
  const span = matchedLength ?? anchor.length;
  const after = source.slice(0, index) + replacement + source.slice(index + span);
  return { applied: true, after, state: 'unique', index };
}
