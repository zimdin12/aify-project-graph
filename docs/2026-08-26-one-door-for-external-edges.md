# One door for External edges

2026-08-26. The successor to two withdrawn guards, built to the design the reviewer ruled after
falsifying them.

## The defect, restated precisely

`shouldMaterializeExternal` decided whether a ref was worth **minting** a terminal for, and
`resolveRefs` consulted it only when `resolveTarget` returned nothing. But `buildResolvers` queried
the `nodes` table with **no type restriction**, so an External that already existed came back from
ordinary lookup and was bound with no policy consulted at all.

    REFERENCES to a bare lowercase name, no stub present  ->  0 edges
    the same ref with the stub already there              ->  1 edge

**Pre-existence elevated a ref that policy refuses.** The stub's existence became its own
justification.

## Why it is structural rather than a check at the bind site

The reviewer's ruling, and it is the right one: an External is an *unresolved terminal*, not
declaration evidence, so it must not compete in the same candidate pool as a File/Function/Method/
Class node. A bind-site `if` would leave every future lookup branch able to hand back a stub before
policy runs — which is how the original defect arose in the first place.

So `mergeRows` — the single funnel every row-returning lookup passes through — drops External rows,
and a dedicated `findExternalCandidate` feeds one `admitExternalEdge` decision:

    resolveConcreteTarget(ref)        // External excluded
      found  -> bind the real declaration
      absent -> findExternalCandidate(ref) -> admitExternalEdge({ ref, candidate })
                  ADMIT  -> reuse the existing terminal, or mint one
                  REFUSE -> a TYPED record in `unresolved`, carrying its reason

`shouldMaterializeExternal` was **deleted**, not left beside the new owner. Two rules that must agree
are how they stop agreeing.

## Reuse, not blind re-minting

The code-intel importer creates External nodes with qname-derived ids while the tree-sitter path
derives them from family+label. "Filter External out, then always call `createExternalNode`" would
fork one real target into two stubs and discard the higher-provenance identity. `findExternalCandidate`
matches on the ref's label and prefers a same-language-family candidate.

## EXTENDS, decided rather than inherited

The old policy fell through to `false` for EXTENDS, so **every External base class existed only
because pre-existence bypassed that policy**. Closing the bypass without deciding would have deleted
them silently.

Population inspected: **3 of 3** in a fresh index, and all three are `class X extends Error`
(`util/json.js:35`, `scripts/lib/arm-workspace.mjs:20`, `tests/helpers/handle-inventory.js:32`) — a
real base class whose loss removes true structure. **Admitted.** The measured effect is that EXTENDS
into External *rose* 3 → 6, because admitted relations may now mint as well as reuse.

## Effect, on identical input

⛔ **The first A/B was contaminated and is discarded.** It compared indexes built before and after this
change — but the repository itself had gained files in between (`external-admission.js`, its test,
the measurement script), so nodes rose by 11 and `CONTAINS`/`DEFINES`/`IMPORTS` all drifted. Different
input, so no magnitude was attributable.

Redone with the tree held fixed and **only the External exclusion toggled**:

| | bypass (arm A) | excluded (arm B) | delta |
|---|---|---|---|
| nodes | 5,241 | 5,241 | **0 — input held fixed** |
| REFERENCES | 2,883 | 2,703 | **−180** |
| CALLS → External | 5,821 | 5,821 | 0 |
| EXTENDS → External | 6 | 6 | 0 |
| USES_TYPE → External | 2 | 2 | 0 |

A single effect: 180 REFERENCES edges, all of them into External, and nothing else moves.

**What was removed**, by label: `entries` (40), `from` (22), `r` (18), `match` (11), `all`, `now`,
`end`, `values`, `res`, `slice`. `Object.entries`, `Array.from`, `Date.now`, and bare locals — the
class the local-scope filter exists to drop, which only survived because a stub made them look
resolvable. Sampled, not individually adjudicated: the claim is the mechanism and the top of the
distribution, not a verdict on each of the 180.

## The anti-targets, because this is the second attempt

An earlier attempt at this refused edges using a label pattern presented as a universal truth and
deleted real `promise.catch()`, `operator()` and `save!` edges. Those are now pinned as names that
must keep working, and the shape rule applies **only when minting**:

- refusing to mint leaves the ref in `unresolved` — visible and recoverable;
- refusing an edge to a terminal that already exists **destroys evidence**.

That asymmetry is a parameter of one decision, not a second policy.

Four mutants, each parse-checked before running so none could be a syntax-error false kill:
exclusion removed, EXTENDS dropped from the admitted set, the shape rule leaked onto the binding
path, and the refusal reason discarded. All four killed.

## What is still open

A fragment that **already exists** is still admitted on the binding path. Separating
`execFileSync('git',` from `operator()` cannot be done from a stripped label — that was proven at the
cost of a revert. It needs the producer's typed form (`constructor` / `member` / `operator` /
`qualified`), which `admitExternalEdge` already accepts as `ref.targetForm` and which no producer
emits yet. A test pins this gap as open, so the successor gets a failing marker rather than a silent
regression.
