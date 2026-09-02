# Preregistration — can a NEW disclosure constant be added without anyone noticing?

**Written:** 2026-09-02, before the gate was built.

## Why

Twice now I have had to re-close a gap I opened myself:

- *"cannot be driven by this fixture"* — asserted without trying, and false for all three verbs.
- *"reachability verified"* — true when `contracts-reach-the-agent.test.js` was written, then quietly
  outgrown by four cycles of new disclosures I never added to it.

The second is the shape that matters: **a gate documents the moment it was written, not the
invariant.** `ABSENCE_TRUST_UNAVAILABLE` and `RESULTS_TRUST_UNAVAILABLE` were both shipped after that
gate and neither was ever forced into it. Nothing would have complained.

## Question

If someone exports a new disclosure constant tomorrow, does anything fail until its coverage is
decided?

## Population — derived at RUNTIME, not listed

Every export of `mcp/stdio/query/lsp-evidence.js` whose name ends `_UNAVAILABLE`. Obtained by
**importing the module**, so the population grows by itself. A hand-written list is the very defect
this closes.

⚠ Deliberately runtime-derived rather than source-scanned: the suite-composition ratchet refused a
source-text gate this week, with evidence that such checks "cannot fail when the behaviour breaks,
and CAN fail when a line is reflowed".

## Identity rule

Each such constant must be classified in exactly one of two sets declared in the test:

- **COVERED** — a reachability assertion in that file exercises it across `tools/call`.
- **NOT_REACHABLE_HERE** — it cannot be exercised through a spawned server, with the reason stated.

Unclassified ⇒ **failure**. That is the whole mechanism: the cost of adding a constant is deciding
which it is.

## Finding schema

`{ constant, classified: 'covered' | 'not-reachable' | 'UNCLASSIFIED' }`.

## Controls, same pass

- **POSITIVE — the population is non-empty.** An import that yielded nothing would pass vacuously,
  which is exactly the failure mode being fixed.
- **POSITIVE — the known constants are found** (both `*_TRUST_UNAVAILABLE`), or the naming rule does
  not match what the module actually exports.
- **NEGATIVE — an unclassified name is rejected.** Proven by classifying a fake constant and
  confirming the check flags it, so the gate is shown able to fail.

## Claim ceiling

This forces a **decision**, not coverage. A constant parked in `NOT_REACHABLE_HERE` is not tested —
it is only prevented from being forgotten silently. It also covers one naming convention in one
module; a disclosure added elsewhere, or named differently, is outside it.

## Decided in advance

- **All classified** → the gate holds today and grows on its own from here.
- **Any unclassified** → I shipped a disclosure nobody checks; classify it and say so.
