# Three scope statements, two under one label

**Date:** 2026-09-03
**Probe:** `scripts/probe-absence-surface-redundancy.mjs`
**Status:** MEASURED, four controls passing.

## Why this probe exists

Last cycle measured the absence caveat surface at 1057 B and I declined to trim, because choosing
WHICH clause to cut depends on what agents actually read — unmeasured, and not mine to decide alone.

⭐ That reasoning holds for CONTENT and not for DUPLICATION. Text repeated verbatim, and two
different clauses filed under one label, are defects whatever a reader prefers. So this looks for
exactly those and nothing else.

## Result

| surface | finding |
|---|---|
| composed line, cpp + uncommitted (1042 B) | none |
| composed line, javascript (641 B) | none |
| **LIVE answer via `graph_callers` (1157 B)** | **label collision: `SCOPE` x2** |

The two clauses sharing the label state different facts:

```
SCOPE: the newest code-intel collection is typescript, which processed 73 of 627 eligible files ...
SCOPE: this verb searched the strict call graph (CALLS/INVOKES/PASSES_THROUGH) and did NOT search
       REFERENCES — of which this graph holds 1 REFERENCES pointing at "MANIFEST" ...
```

With `INDEXED SCOPE:` that is **three scope statements under two labels**.

## ⛔ My first population could not have found it

The initial run measured only the COMPOSED trust line and reported "no redundancy". The second
`SCOPE:` is emitted by the VERB, not by `buildAbsenceTrustLine`, so the collision was structurally
outside what I was looking at. **A clean result from a population that excludes the defect is not
evidence of absence** — the live arm was added and the finding appeared immediately.

## The remedy, and why it needs no reader theory

Rename so each label names its own fact: the collection-coverage clause becomes `LSP SCOPE`, and the
relations clause becomes `RELATIONS`. No content is removed and no judgement about what an agent
values is required.

⚠ **The renames cost bytes, and the budget gate refuses growth** — which is the gate working. Paid
for from an EXISTING measurement rather than a new opinion: the BRIEF indexed-scope wording was
already established last cycle as carrying the limit adequately (that is why it ships on `NO MATCH`).
Using it on both surfaces frees more than the renames cost, so the surface ends up SMALLER.

## Ceiling

Textual duplication only. Two clauses that say the same thing in different words are NOT detected,
and no claim of semantic overlap is made from this.
