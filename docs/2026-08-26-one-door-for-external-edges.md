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

---

## Two of the three named gaps, now closed

When this shipped I listed what the hostile matrix still lacked rather than implying it was covered.
Two of those are now tested.

### Identity is not forked between producers

The two producers derive External ids differently — code-intel from `hash([qname])`, tree-sitter from
`sha1(family:label)` — so the same conceptual target can exist under two ids. The naive repair for
excluding External from resolution ("filter them out, then always call `createExternalNode`") would
mint a twin beside the collection-imported node and discard the higher-provenance one.

`tests/unit/ingest/external-identity-is-not-forked.test.js` drives the **real importer**, not an
imitation of it, so the fixture matches a shape a producer actually emits.

⭐ **The control that makes the file non-vacuous** is the first test: it mints the tree-sitter id in a
separate graph and asserts it differs from the code-intel id. If those two happened to coincide,
"reused" and "re-minted" would be indistinguishable and every other assertion would pass against a
broken implementation.

Then: the edge lands on the collection-imported node, nothing new is minted, the graph holds exactly
one terminal for that label, and the `qname` the collection carried survives the reuse. Two mutants —
never reuse, and mint over the candidate — both killed.

### The change survives a real incremental re-index

The unit tests call `resolveRefs` directly and the effect measurement was a whole-index A/B. Neither
exercises `ensureFresh`, which is what actually runs when a file changes.

`tests/unit/freshness/external-admission-through-reindex.test.js` plants the exact shape the old
bypass produced — a stub plus an edge to it — then makes a structural edit and re-indexes:

- a refused REFERENCES terminal keeps no edge, and is then **collected** by the orphan sweep;
- ⭐ a control confirms an *admitted* terminal survives the same re-index, so the first result cannot
  be satisfied by a re-index that wipes every External indiscriminately;
- ⭐ **liveness is asserted before anything else in both arms** (`processedFiles` contains the file).
  A re-index that silently does nothing produces exactly the same "the edge is gone" reading as one
  that worked, and this repository has already published one void result from that confusion.

The sweep was correct all along but had been **starved**: refs kept re-binding to stubs and
refreshing their edges, so the node never became an orphan. A mutant disabling the sweep kills the
test, which is what proves the node's disappearance is that sweep and not an incidental deletion.

### Still not covered

Nothing exercises a *symbolic-chain* owner-miss through the real pipeline. That branch is recorded as
producing zero here, and the control I once offered for it was withdrawn as invalid — it counted
relation use, not branch execution. It remains reasoned, not tested.


---

# REVISED after review: four doors were still open, and one claim was false

`graph-senior-dev` reviewed `970ed13` and found five blockers. I reproduced every executable one
before acting. **The architecture survived; the implementation did not.**

## The claim that was false

> "REFUSE -> a TYPED record in `unresolved`, carrying its reason"

Executed, a bare lowercase REFERENCES gave **edges 0 AND unresolved 0**. The admission owner made a
typed decision and the old local-scope filter then `continue`d past `refusalRecord`, erasing it. The
module comment, the commit message and this document all asserted refusals were never silent.

⛔ **And the test that "proved" it passed for the wrong reason.** It used an unlisted `TESTS`
relation, whose uppercase target sidesteps the local-scope filter entirely — so it exercised a path
where the claim happened to hold, and never touched the load-bearing REFERENCES case.

The fix keeps the record and moves the exclusion to where exclusions already live: a new
`external-by-design:admission-refused` bucket in the categorizer, so the trust denominator is
unchanged **and** `explainTrustExclusions` publishes the count. *Not trust-relevant must not be
implemented as did not happen.*

## Three more doors

| | what happened | now |
|---|---|---|
| **cross-family reuse** | a JavaScript ref reused a **PHP** terminal named `Shared` | no cross-family reuse when the ref's family is known; mint the family-canonical terminal |
| **qname identity** | a C++ ref for `std::vector::push_back` missed the collection's node (which stores the *leaf* as `label`) and **minted a duplicate** | match `extra.qname` exactly first, then a *unique* label; ambiguity mints the canonical terminal rather than picking an arbitrary first row |
| **symbolic chain** | skipped admission entirely — unconditional ADMIT, source owner minted with no shape policy, so a **new** fragment could enter | crosses the same owner, with `symbolicChain` and `side` as explicit inputs |
| **pre-resolved `to_id`** | emitted without checking whether the target was External | ids naming an External go through admission; the `external:` prefix convention is now pinned by a test |

⛔ **My cross-family fallback was rationalised backwards.** I wrote that a wrong reuse was safer than
a duplicate because it shares a stub. A wrong reuse *asserts that two languages' APIs are one symbol*.
A duplicate never claims anything false.

## And my identity test dodged the hard case

`external-identity-is-not-forked.test.js` used the **leaf** (`push_back`) as the ref target — which
the importer stores as `label`, so it matched and passed. A C++ ref carries the qualified name. The
review probe used that and the fork was live underneath a green test.

⇒ **Choosing the input that makes a test pass is not testing.** Both cases are pinned now.

## Two existing tests were pinning the defect

`local-scope-references.test.js` and `resolver.test.js` both asserted `unresolved` was empty, by name:
*"silently drops"*. They were updated to assert retention plus a trust-relevant count of zero — the
invariant that actually justifies the behaviour.

Four mutants, each parse-checked first: cross-family reuse restored, qname match removed, `to_id`
door reopened, symbolic chain skipping the shape policy. All four killed.

## Open gaps, now stated symmetrically

The earlier "what is still open" named one. The full set:

1. a fragment that **already exists** is still admitted when binding — needs the producer's typed form;
2. legitimate punctuation/Unicode/private/scoped names **without** a pre-existing terminal are refused
   by the mint-time shape rule and never become edges (`operator()`, `save!`, `café`, `#private`,
   `@scope/pkg`) — the symmetric cost of (1), which the previous version did not state;
3. `targetForm` is **not an implemented seam**. Nothing reads it and no producer writes it. JavaScript
   accepting an extra property on an object is not a contract, and saying "the signature already
   accepts it" overstated a plan as a mechanism.
