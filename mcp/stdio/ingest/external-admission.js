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
// The fragments among them are noise: nothing resolves to them and they inflate searches and
// censuses. They were the bulk of the AMBIGUOUS tier's damage — 23.3% of sampled AMBIGUOUS CALLS
// edges pointed at one. ⚠ But "rejected by this pattern" and "noise" are not the same set; see the
// limit stated below.
//
// ⚠ THE RULE IS DERIVED FROM THE OBSERVED POPULATION of THIS repository, not from any language's
// grammar, and that is its limit. Applied to the 1,104 External labels present when it was written it
// accepted 775 and rejected 329, all fragments HERE.
//
// ⛔ IT ALSO REJECTS LEGITIMATE NAMES, and saying otherwise is what got an earlier guard reverted:
// `operator()`, `operator<<`, `~Widget` (C++), `save!`, `empty?`, `[]` (Ruby), `café` (Python),
// `#private` (JavaScript) and `@scope/pkg` — the last despite an earlier version of this comment
// claiming scoped packages were allowed, when `/` is not in the character class at all. So a
// rejected label is NOT "noise" as a class; it is a label this pattern cannot vouch for.
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
export function admitExternalEdge({ ref, candidate = null, symbolicChain = false, side = 'target' }) {
  // ⛔ A symbolic chain used to skip this function entirely, which made "one door for every
  // External-bound edge" false: its target got an unconditional ADMIT and its missing source owner
  // was minted with no shape policy at all, so a NEW fragment could enter the graph that way. It is
  // now an INPUT to the one decision rather than a detour around it — the same pattern as `minting`.
  if (!symbolicChain && !ref?.from_id) return { decision: REFUSE, reason: 'no-source' };
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
  // member / operator / qualified).
  //
  // ⛔ AND `targetForm` IS NOT AN IMPLEMENTED SEAM. Nothing reads it, no producer writes it, and
  // JavaScript silently accepting an extra property on a ref object is not a contract. Saying "the
  // signature already accepts it" overstated a plan as a mechanism; it is a plan.
  const minting = candidate === null;
  if (minting && !isPlausibleExternalName(label)) {
    return { decision: REFUSE, reason: 'fragment-shape-not-minted' };
  }
  if (minting && COMMON_NAMES.has(label)) {
    return { decision: REFUSE, reason: 'common-name-not-worth-minting' };
  }

  // ⚠ THE RELATION TABLE IS EXEMPTED FOR A SYMBOLIC CHAIN, AND THAT EXEMPTION IS NAMED RATHER THAN
  // IMPLICIT. A chain names its own source (Qt `emit signal()`, framework route hops), and its
  // relation set — PASSES_THROUGH / INVOKES / CALLS — is an execution story that predates this
  // table. What it does NOT get is an exemption from the shape policy above, which is the half that
  // was letting new fragments in.
  if (symbolicChain) {
    return { decision: ADMIT, reason: `symbolic-chain:${side}` };
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
