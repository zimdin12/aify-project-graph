// One owner for every edge that terminates on an External node.
//
// ⛔ WHY THIS FILE EXISTS. `shouldMaterializeExternal` decided whether a ref was worth MINTING a
// terminal for, and `resolveRefs` consulted it only when `resolveTarget` found nothing. But
// `buildResolvers` queried the nodes table with no type restriction, so an External that already
// existed was returned by ordinary lookup and bound with no policy consulted at all.
//
// ⭐ MEASURED, and this is the defect in one line: a REFERENCES ref to a bare lowercase name gets
// 0 edges when no External exists and 1 edge when the stub is already there. Pre-existence ELEVATED
// a ref that policy refuses. The stub's existence became its own justification.
//
// ⇒ So External is excluded from ordinary concrete resolution (see mergeRows in resolver.js) and
// every External-bound edge — new terminal or existing one — crosses this function. One owner, not
// two predicates that must agree.

import { COMMON_NAMES } from './denylist.js';

export const ADMIT = 'ADMIT';
export const REFUSE = 'REFUSE';

/**
 * Relations whose External terminal carries information a reader needs.
 *
 * ⚠ EXTENDS IS HERE BY AN INTENTIONAL DECISION, NOT BY INHERITANCE FROM THE OLD RULE. The previous
 * policy fell through to `false` for EXTENDS, so every External base class existed ONLY because
 * pre-existence bypassed that policy. Closing the bypass without deciding would have deleted them
 * silently. Population inspected: 3 of 3 in a fresh index of this repository, and all three are
 * `class X extends Error` — a real base class whose loss would remove true structure. Admitted.
 */
const ADMITTED_RELATIONS = new Set(['CALLS', 'PASSES_THROUGH', 'USES_TYPE', 'EXTENDS']);

/** A REFERENCES terminal is only worth an edge when the name looks like a type, not a local. */
function referencesTypeLike(label) {
  if (/[\\.]|::/.test(label)) return true;
  const firstSegment = label.split(/[\\.::]/)[0] ?? '';
  return Boolean(firstSegment) && firstSegment[0] >= 'A' && firstSegment[0] <= 'Z';
}

// ⛔ A NAME, OR NOTHING. Nothing checked that a materialised External LOOKED like a symbol, so when
// a parser handed back a fragment the graph grew a node labelled `entries()]`, `replace(/\\/g,` or
// `join(dirOf(docPath),`. Measured on this repository: 329 of 1,104 External nodes — 29.8% — were
// fragments of that shape, about 5% of every labelled node in the graph.
//
// Those nodes are pure noise. Nothing can ever resolve to them, no edge to one is a real call, they
// appear in searches and censuses, and they were the bulk of the AMBIGUOUS tier's damage: 23.3% of
// sampled AMBIGUOUS CALLS edges pointed at one.
//
// ⚠ THE RULE IS DERIVED FROM THE OBSERVED POPULATION, not invented. Applied to the 1,104 existing
// External labels it accepts 775 — `slice`, `readFileSync`, `Map`, `createGraph` — and rejects 329,
// every one a fragment. Separators that appear in real names are allowed: `.` and `::` for members,
// `\` for PHP namespaces, `-` for CSS-ish identifiers, `@` for scoped packages.
//
// ⚠ REFUSING IS NOT LOSING. The ref stays in the unresolved list, which is the honest record. A node
// labelled `entries()]` is not more information than an unresolved ref; it is less, because it looks
// like a finding.
const PLAUSIBLE_EXTERNAL = /^[A-Za-z_$@\\][A-Za-z0-9_$@\\.:-]*$/;

export function isPlausibleExternalName(label) {
  return PLAUSIBLE_EXTERNAL.test(String(label ?? ''));
}

/**
 * Decide whether an edge to an External terminal may be asserted.
 *
 * @param ref        the unresolved ref
 * @param candidate  an External node that ALREADY EXISTS and would be reused, or null when the
 *                   decision is whether to mint a new terminal
 * @returns {{decision: string, reason: string}} — always typed, never a bare boolean, because a
 *          REFUSE has to survive into the unresolved record rather than becoming a silent absence.
 */
export function admitExternalEdge({ ref, candidate = null }) {
  if (!ref?.from_id) return { decision: REFUSE, reason: 'no-source' };
  const label = String(candidate?.label ?? ref?.target ?? '').trim();
  if (!label) return { decision: REFUSE, reason: 'empty-label' };

  // ⛔ THE ONE PLACE THE ANSWER DEPENDS ON WHICH SIDE OF THE DOOR WE ARE ON, and it is a deliberate
  // asymmetry rather than a second policy. Refusing to MINT a terminal leaves the ref in
  // `unresolved` — recoverable, and visible. Refusing an edge to a terminal that already exists
  // DESTROYS evidence, and a shape rule applied there is exactly what deleted real `operator()`,
  // `save!` and `promise.catch()` edges before it was reverted.
  //
  // ⚠ SO THE FRAGMENT RESIDUE IS STILL ADMITTED HERE WHEN IT ALREADY EXISTS, AND THAT IS THE KNOWN
  // REMAINING GAP. Separating `execFileSync('git',` from `operator()` cannot be done from a stripped
  // label — proven, at the cost of a revert. It needs the producer's typed form (constructor /
  // member / operator / qualified), which this signature already accepts as `ref.targetForm` and
  // which no producer emits yet. When they do, the check belongs here and nowhere else.
  const minting = candidate === null;
  if (minting && !isPlausibleExternalName(label)) {
    return { decision: REFUSE, reason: 'fragment-shape-not-minted' };
  }
  if (minting && COMMON_NAMES.has(label)) {
    return { decision: REFUSE, reason: 'common-name-not-worth-minting' };
  }

  if (ref.relation === 'REFERENCES') {
    return referencesTypeLike(label)
      ? { decision: ADMIT, reason: 'references-type-like' }
      : { decision: REFUSE, reason: 'references-bare-local-name' };
  }

  if (ADMITTED_RELATIONS.has(ref.relation)) {
    return { decision: ADMIT, reason: `relation-admitted:${ref.relation}` };
  }

  return { decision: REFUSE, reason: `relation-not-admitted:${ref.relation}` };
}

/**
 * A REFUSE must leave a record. Nothing in the pipeline may turn a refusal into a silent absence —
 * that is how an absent edge becomes indistinguishable from a resolved one.
 */
export function refusalRecord(ref, reason) {
  return { ...ref, refusedReason: reason };
}
