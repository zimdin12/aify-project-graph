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


---

# Third review: the trust signal was dead, and both my A/B runs were void

`graph-senior-dev` accepted the four resolver fixes and both production evidence arms, and blocked on
the trust consumer. He was right, and the production magnitude was worse than his probe showed.

## I killed the trust signal and said the opposite

The refusal bucket tested `Boolean(refusedReason)` — every refusal, present and future, removed from
the trust denominator. **Measured on a full index of this repository:**

| classifier | `trustDirtyEdgeCount` |
|---|---|
| blanket bucket (as shipped in `40bc05a`) | **0** — the signal was dead |
| no bucket at all | 27,957 — inflated by local names |
| one named reason (correct) | **38** |

`trust` is the field that gates whether an agent believes anything else in the product, and a commit
of mine zeroed it while its message asserted the denominator was unchanged.

⛔ **And it was fail-OPEN in the worst place**: any reason the admission owner might add later would
leave the denominator before anyone judged whether it marked a defect.

**The correct rule is narrow, and measurement is why.** Of the four reasons currently emitted, the
pre-existing classifiers already handle three:

| reason | count | trust-relevant under the existing rules |
|---|---|---|
| `references-bare-local-name` | 28,070 | 27,919 — needs the exclusion |
| `common-name-not-worth-minting` | 5,057 | 0 (`denylisted-by-design:common-name`) |
| `relation-not-admitted:IMPORTS` | 4,739 | 2 (`external-by-design:npm` / `node-builtin`) |
| `fragment-shape-not-minted` | 833 | 36 (mostly `external-by-design:node-builtin`) |

So the bucket names **one** reason; everything else falls through, and an unclassified future reason
stays trust-relevant. A test pins that directly.

## "explainTrustExclusions publishes the count" was false

It collapsed every `external-by-design:*` bucket into a single row, so an admission refusal was
indistinguishable from an npm package. Admission refusals now keep their full bucket name — the
reader sees `external-by-design:admission-refused-local-name  28,072` — while other families keep the
summary row they already had.

## Both A/B runs were void, and the harness committed the failure it warns about

The carrier I built ran two arms in one process. **Node loads a module once per process**, so both
arms executed the code as it was at startup. The edit landed on disk, the probe found it there, the
file parsed — and the measurement was of nothing.

That is the "mutation landed but changed nothing" failure named in the harness's own header, three
lines above the code that committed it. **A probe that checks the FILE does not establish that the
RUNNING code changed.** Each arm now runs in its own process (`scripts/ab-arm-worker.mjs`).

With that fixed, the same spec measures a real effect:

| arm | nodes | edges | REFERENCES → External |
|---|---|---|---|
| A: admit every REFERENCES terminal | 8,144 | 27,241 | 10,435 |
| B: as committed (type-like only) | 5,280 | 17,459 | 653 |

**+9,782 edges and +2,864 stub nodes** that the rule prevents — with 0 edges present only in arm B,
so the effect is one-directional.

## The −180 claim is withdrawn

That figure came from toggling the `mergeRows` exclusion, and it is not reproducible at this commit —
correctly, because `e9ec81a` removed the fabricated stubs that the bypass used to elevate. The two
defects were coupled, so that transport is no longer a single meaningful variable. It is withdrawn as
an unbound observation rather than restated, and the receipt in
`docs/evidence/ab-references-admission.json` carries what replaced it: arm objects, exact commit and
tree, transports, probes, reset verification by hash, liveness, and raw counts.


---

# Fourth review: the carrier itself was unsafe and unbound

The narrow trust classifier and the source payload were **approved**. The A/B carrier was blocked on
three counts, all correct.

## It mutated the checkout the team works in

The harness wrote the transported file into the main working tree and restored it afterwards,
verifying by hash. **A hard kill between those two points leaves mutant production bytes in main**,
and a check that only runs after the child returns cannot close that.

This repository already had the answer — `scripts/lib/arm-workspace.mjs`, whose `mainRepoWorkspace`
has *no working write at all*, so a mutation aimed at main throws rather than being discouraged. I
built a weaker second transport beside it instead of using it. Arms are now disposable detached
worktrees opened through that machinery, which also disables hooks (this repo's post-checkout
reindexes a new worktree and would race the arm).

## The receipt named a commit the run did not execute

It claimed commit `40bc05a`, tree `6d3daf12` — while the run happened on a **dirty checkout whose
seven uncommitted paths included the harness itself and all three source files under measurement**.

⇒ **A commit id plus a list of dirty paths is disclosure, not identity.** "Exact commit+tree" was
false. The harness now refuses a dirty subject (exit 3, verified firing on its own uncommitted bytes)
and records a sha256 for every governed file *as the arm executed it*, plus node version and
platform. The sequence is now: commit the harness, run from that exact object, commit the receipt as
a child naming its measured parent.

## It discarded the populations it compared

It committed totals and ten samples, then deleted the scratch holding the sets — so `edgesOnlyInB=0`
could not be checked by anyone. Each arm now writes canonical **sorted** membership for nodes and
edges with a sha256 apiece, and the set differences are written and hashed the same way.

## And chasing a single node found the harness labelling itself

The first bound run reported **one** node present only in arm B. It was
`Directory | ab-B-type-like-only` — the arm's own worktree root. Each arm indexes its own worktree,
and the roots were named after the arms, so **the two inputs differed by the harness's own labels**.

One node in 8,150 changes no conclusion, but "both arms index the same input" is the invariant this
harness exists to enforce, and it was false. Fixed with a constant leaf name under a per-arm parent.
Found only because every counter that moved had to be explained.

## The measurement, now bound

Subject `fa10019a19b0`, tree `43621261542f`, **clean at run**, node v22.20.0 / win32 / x64.

| arm | exit | nodes | edges | REFERENCES → External |
|---|---|---|---|---|
| A: admit every REFERENCES terminal | 0 | 8,151 | 27,259 | 10,451 |
| B: as committed (type-like only) | 0 | 5,278 | 17,461 | 653 |

`nodesOnlyInA` 2,873 · `nodesOnlyInB` **0** · `edgesOnlyInA` 9,798 · `edgesOnlyInB` **0**, each set
written out and hashed. Governed-file hashes differ between the arms in exactly one file — the
transported one — which is the control that the arms differed in nothing else. Both arms disposed
completely; no worktree registration survived.
