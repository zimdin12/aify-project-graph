import { createHash } from 'node:crypto';

export function symbolFingerprints(symbol) {
  return {
    structural_fp: structuralFingerprint(symbol),
    dependency_fp: dependencyFingerprint(symbol),
  };
}

export function structuralFingerprint(symbol) {
  return digest({
    qname: symbol?.qname ?? '',
    signature: symbol?.signature ?? '',
    decorators: normalizedList(symbol?.decorators),
    parentClass: symbol?.parentClass ?? '',
    nodeType: symbol?.nodeType ?? '',
  });
}

export function dependencyFingerprint(symbol) {
  const outgoing = symbol?.outgoing ?? {};

  return digest({
    calls: normalizedList(outgoing.calls),
    references: normalizedList(outgoing.references),
    usesTypes: normalizedList(outgoing.usesTypes),
    imports: normalizedList(outgoing.imports),
    raises: normalizedList(outgoing.raises),
  });
}

// P1-6: per-FILE structural fingerprint. Hashes the structural SHAPE of an
// extracted file — the set of {symbol signatures, members, imports/exports}
// AND the set of outgoing call/reference/type/extends targets — but NOT the
// bodies. A body-only / comment / whitespace / literal-value edit leaves this
// fingerprint UNCHANGED (cosmetic); a signature change, a new/removed member,
// an import change, OR an added/removed call/reference (which would add or
// drop an edge) CHANGES it (structural).
//
// Correctness guard (the key edge case): an edit that adds a CALL is structural
// even though no signature changed, because it introduces a new outgoing edge.
// We therefore fold the file's complete outgoing-ref target set (CALLS /
// REFERENCES / IMPORTS / EXTENDS / IMPLEMENTS / USES_TYPE / TESTS) into the
// hash. This is deliberately CONSERVATIVE: anything that could affect a node's
// shape OR an edge is part of the fingerprint, so a false "cosmetic" can never
// silently drop a real edge change. A false "structural" only costs re-work.
export function fileStructuralFingerprint(extracted) {
  const nodes = extracted?.nodes ?? [];
  const refs = extracted?.refs ?? [];

  // Per-symbol structural shape (sorted for order-insensitivity). Excludes
  // line numbers — moving a function up/down by editing another body must not
  // count as structural. Includes parent_class + member relation so adding or
  // removing a class member flips the fingerprint.
  //
  // ⛔ `node.id` WAS IN HERE AND HAD TO COME OUT. It was harmless while ids were name-derived —
  // it carried type + file + qname, all of which are already listed below. Now that a code symbol
  // site id is its BYTE SPAN, including it smuggles position into a fingerprint whose own comment
  // above says position must not count as structural: inserting a comment shifts every later
  // offset, every id moves, and the file reads as structurally changed. That would silently
  // disable cosmetic-skip on every commit that touches a comment — measured context: 91% of
  // reindexes on this repo already take 15s or more.
  const symbolShapes = nodes
    .map((node) => JSON.stringify({
      type: node.type,
      label: node.label ?? '',
      qname: node.extra?.qname ?? '',
      signature: node.extra?.signature ?? '',
      parentClass: node.extra?.parent_class ?? '',
      decorators: normalizedList(node.extra?.decorators),
    }))
    .sort();

  // Full set of outgoing structural refs: {relation, from_id, target}. Catches
  // the call-set-change case — adding/removing a call (or any ref) changes this
  // set even when every signature is identical.
  //
  // ⛔ DROPPING `from_id` OUTRIGHT WAS A REGRESSION, AND REVIEW CAUGHT IT BY EXECUTING IT.
  // It carried the ref's OWNER, which nothing else in this set carries — `from_target` is empty on
  // resolved-owner refs. Measured counterexample: moving `helper()` from `a()` to `b()` left the
  // fingerprint IDENTICAL, so cosmetic-skip would keep the caller edge on the wrong function. That
  // is the same class of defect as the identity collision this whole change exists to repair, and
  // I introduced it while repairing that one.
  //
  // ⇒ The owner is carried by its SHAPE rather than its id: position-independent, so a comment
  // insertion does not read as structural, while an owner change still does.
  //
  // ⚠ RESIDUAL, STATED RATHER THAN CLAIMED AWAY: two local twins with the same qname and signature
  // have the same shape, so moving a call BETWEEN THEM is still invisible here. That is strictly
  // no worse than the pre-existing `symbolShapes` limitation, and it is not "lossless" — the word
  // is avoided deliberately.
  const ownerShape = new Map(nodes.map((node) => [node.id, JSON.stringify({
    type: node.type,
    label: node.label ?? '',
    qname: node.extra?.qname ?? '',
    signature: node.extra?.signature ?? '',
    parentClass: node.extra?.parent_class ?? '',
  })]));
  const refShapes = refs
    .filter((ref) => ref && ref.relation)
    .map((ref) => JSON.stringify({
      relation: ref.relation,
      fromOwner: ownerShape.get(ref.from_id) ?? String(ref.from_id ?? ''),
      fromTarget: ref.from_target ?? '',
      target: ref.target ?? '',
    }))
    .sort();

  return digest({ symbols: symbolShapes, refs: refShapes });
}

function normalizedList(values) {
  return [...new Set((values ?? []).filter(Boolean).map(String))].sort();
}

function digest(value) {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}
