# Plan: resolved-ref evidence, so conservation stops being reconstructed

**Status:** ⛔ **A RECORD OF DECISIONS AND OPEN CONTROLS — NOT AN APPROVED PLAN, AND NOT PERMISSION TO
WRITE DDL.** Revision 9, 2026-09-26. Nothing is implemented. **Every control here is UNRUN and its
outcome is UNKNOWN.** The point-in-time binding class count and its residue remain **HELD**, and the
88/0 producer-collision census **cannot be independently rederived** from what is committed.

⚠ **WHETHER TO BUILD THIS AT ALL IS STEVEN'S CALL** — see the scope note at the end. Nothing is broken
if it is never built: the audit simply stays held, and the product defects this arc found are fixed
and pushed independently of it. Revision 4 exists to stop thirteen findings being re-derived, not to
advance implementation.

**Design recommendation, every counterexample, and every pre-code plan attack:** graph-senior-dev.
**One control, the write-up, and the real-subject measurements:** graph-tech-lead.

**Revision 3 repairs four defects graph-senior-dev found by reading the committed revision-2 diff —
not the summary of it, which contained none of them:**
1. pre-resolved `CONTAINS` / `DECLARES_BINDING` were misclassified as non-ref-origin
2. the `88 edges` overclaim survived at one site while corrected at another
3. lifecycle control 4 contradicted the seal rule, so a literal test of it would reject correct
   rollback behaviour
4. the repair for (1) proposed `to_label` as an alternate identity — another alternate satisfier,
   inside the fix for one

⛔ **WHAT THE EVIDENCE SUPPORTS.** Executed counterexamples disprove five join designs and a scalar
`edge.target` column, and a measured index establishes that one edge can have two producers. None of
that proves the table proposed here, nor its lifecycle. **This is a proposal to falsify.**

---

## ⛔ THE RULE THIS DESIGN IS ACCOUNTABLE TO

**Absence must never license a conclusion.** Every failure in this arc — including the ones found
*inside the repairs* — is one shape:

| the absence | what it was allowed to mean | why that was wrong |
|---|---|---|
| no matching address form | "not a module, so a binding" | an import's target is a path; the *form* was missing, not the module |
| no dot-prefix match | "a binding refinement" | a filename may contain dots; the prefix was a different real module |
| no association row | "UNKNOWN, so not a loss" | an attested generation can carry legacy edges; UNKNOWN becomes an excuse bucket |
| no association row | "not a ref-origin edge" | ⛔ **circular** — the missing association is the defect under test |
| no exact-case entry | "the file is present" | `existsSync` is case-insensitive; absence of a mismatch is not a match |
| no source-emission check | "`e` absent **and** `B` absent ⇒ edge loss" | ⛔ a ref the source **stopped emitting** produces the identical absence pattern — revision 6 |

⇒ **Every licensing fact here must be POSITIVE and EARNED**: a typed origin the extractor states, an
explicit kind the producer writes, a seal a completed rebuild issues. Nothing is inferred from
something not being there. This rule is the only thing that would have predicted all six in advance,
and any revision of this plan must meet it.

## The question, and why it is currently unanswerable

Conservation asks: *did the ref the extractor emitted end up in the graph?* Answering it requires
knowing **which node a given emitted specifier resolved to**.

⭐ **The graph does not record that.** `edges` stores `to_id` — the *result* — and discards the
specifier. `unresolved_refs` (`publication-schema.js:44`) stores `target`, the specifier, for every
ref that FAILED.

> **The graph preserves the emitted specifier only when resolution fails.**

Each design below reconstructed that discarded mapping, and each admitted an *alternate satisfier*.
That is one absence found five times, not five bugs.

## The five refuted designs, so nobody re-derives them

| # | design | refuted by |
|---|---|---|
| 1 | match emitted target against `nodes.label` only | an import's target is a repo-relative PATH; the File node's label is a basename. 4,488 phantom losses, and a *false quiet* on a planted IMPORTS drop |
| 2 | binding bucket = strip final dot-segment, check the prefix is recorded | a filename may contain dots. Losing the `./lib.js.ts` module edge was excused because prefix `src/lib.js` is a *different recorded module* |
| 3 | add `targetIsRealFile` | extension probing: emitted `src/lib.js.foo` resolves to File `src/lib.js.foo.js`. The held module also has no address form, so it reads absent with its edge present |
| 4 | add a `file_path`-minus-final-dot **stem** form | `src/base.js` and `src/base.ts` both reduce to `src/base`; deleting only the `.ts` edge left the stem satisfied by the survivor |
| 5 | exact form **UNION** same-line edge existence | two distinct module imports on ONE line give two edges at `source_line=1`; deleting one leaves the survivor satisfying the line |

A sixth was falsified before coding: **a scalar `edge.target` column**. `edges` is unique on
`(from_id, to_id, relation)` with `INSERT OR IGNORE`, so `./base.js` and `@/base.js` (a tsconfig
alias) resolve to the same File node and persist as **one row**. Edge-to-specifier is many-to-one, and
a first-wins scalar makes the second correct specifier a phantom loss at baseline.

⭐ **Designs 1-5 and design 6 fail DIFFERENTLY, and it matters.** 1-5 reconstruct, so they fail by
being **incomplete** — a false quiet, invisible to any reader. The scalar would **manufacture** a loss,
failing by being **confidently wrong** — which at least surfaces as a number someone can dispute. Only
one class is visible from the output. *(Distinction: dashboard-manager.)*

## Measured: one edge can have two producers

`storage/edges.js` is `INSERT OR IGNORE` plus a CODE_INTEL-only `UPDATE` that rewrites `source_file`,
`source_line`, `confidence`, `provenance` and `extractor`. So every per-producer fact stored on the
row is first-wins or overwritten.

**Forced full index of this repository, `upsertEdge` instrumented then reverted** (raw:
`docs/evidence/ref-conservation-2026-09-25/producer-collision-output.txt`):

| | |
|---|---|
| upsert **attempts** (positive control — the probe ran) | 81,093 |
| collision **attempts** (`INSERT OR IGNORE` changed 0 rows) | 45,875 |
| of which same-labelled (benign duplicates) | 45,787 |
| ⛔ **cross-labelled collision ATTEMPTS** | **88** |
| of those, attempted-vs-retained `source_file` **equal** | **88** |
| of those, attempted-vs-retained `source_file` **unequal** | **0** |

⛔ **UNIT DISCIPLINE: 88 IS A COUNT OF ATTEMPTS, NOT OF EDGES.** It is not 88 distinct triples, not 88
edges, and not 88 distinct source-owner pairs; the reduction did not deduplicate triples. An earlier
draft of this document said "88 edges have two producers" and that exceeded the measured unit.

⭐ **PRODUCER IDENTITY IS NOT ADDRESS-EVIDENCE KIND**, and the two observed pairings are different
things:

| observed pairing | what it actually is |
|---|---|
| `EXTRACTED/glsl` vs `EXTRACTED/shader-bindings` on IMPORTS | **REF/REF** — `shader_bindings.js:197-210` pushes an IMPORTS ref with a target, and `languages/glsl.js:46-49` + `generic.js:646-659` emits a second |
| `EXTRACTED/javascript` vs `LSP_VERIFIED/ts-langserver` on CALLS | **REF/DIRECT** — `code-intel/importer.js:841-887` synthesises the edge via `upsertLspEdge`, supplying no second emitted address |

Two producers may contribute one address, two addresses, or one address plus a direct edge.
**Extractor inequality alone does not identify which**, so the REF/REF example must not be allowed to
certify the REF/DIRECT mixed-producer control.

**Comparator liveness** (`comparator-liveness-output.txt`): an agreement count proves only that the
agreement branch runs. The *same* predicate was fed a deliberately unequal-source collision and an
equal-source collision in one run — `sfDisagree 1`, `sfAgree 1`. **Both branches can speak**, so the
census zero is a real negative rather than a dead branch.

- **Limb one — a deduplicated edge can receive contributions from two differently-labelled producers
  — is CONFIRMED on a real population.**
- **Limb two, bounded exactly:** *no `source_file` disagreement among the measured colliding attempts
  at this pinned full index.* That is **not** an assertion about the independently extracted owner set
  of the retained graph, about the affected-file closure for a changed target, or about historical
  incremental or live graph states.

⚠ Limb two is **absent here, not prevented**, and the reassurance that the shipped fixed-point closure
is not defeated through this door is **CONDITIONAL** on those further joins. Nothing in the schema
stops a disagreement, and a repository exercising `cmake.js`, `virtual_overrides.js` or the code-intel
importer more heavily could differ.

⚠ Still owed for a real owner-set verdict: a census reporting attempts, **distinct triples**, the
emitted ref-address identities per triple, attempted-vs-retained `source_file`, and **independently
extracted** owner files — then a comparison of those owners against the pre-delete expansion set,
followed by post-edit conservation. Equality of both writers' `source_file` is narrower than that.

⭐ A precedent the run surfaced: a promoted edge's retained extractor reads
`LSP_VERIFIED/ts-langserver#nohash|was:EXTRACTED::javascript::0.9`. The promotion path **already**
preserves the producer it replaced — the right instinct in the wrong storage, since a delimited string
is a list pretending to be a column.

## Decided, not open

**SEMANTIC 2 IS DECIDED: EXISTENTIAL PER ADDRESS.** `source_line` is **representative and explicitly
non-authoritative**, and any output printing it says so.

Forced, not preferred: `edges` is deduplicated, so the graph has no per-occurrence granularity to
conserve, and per-occurrence evidence would report control 4's second occurrence as a phantom loss.
The evidence granularity must match the granularity the subject actually has.

## The design

Keep **resolved-ref evidence separately from the deduplicated edges** — one record per **distinct
emitted address**, with its resolved `(from_id, to_id, relation)`, source, line and address **kind**.
The edge table stays deduplicated.

⭐ Not a new mechanism: `unresolved_refs` is exactly this record for the failure path.

### Origin kind is EXPLICIT, merged, and never exclusive

- Written at creation time by the producer that knows it.
- ⛔ **Never inferred from the edge having an association** — a lost association would reclassify a
  ref-origin edge as structural, making the check agree with the defect.
- ⛔ **Never derived from the retained `provenance`/`extractor`** — both are first-wins and both are
  rewritten by a CODE_INTEL promotion, so either answers for the wrong producer.
- ⛔ **Never a first-wins exclusive scalar on the row.** Limb one is measured real — 88 cross-labelled
  collision *attempts* in a full index of this repository — so insert order would decide the value.
- An edge may be ref-origin **and** structural at once; the representation must permit both.
- ⚠ **A row-level boolean is insufficient and is rejected.** It is monotonic only while that producer
  contributes: keep it set after the ref stops emitting and you get a phantom ref-origin edge with no
  association; clear it because another producer is retained and you get a false quiet for a different
  ref.
- ⛔⛔ **AND THE OWNER IS THE SEPARATELY KEYED CONTRIBUTION RECORD — NEVER THE ADDRESS RECORD ITSELF.**
  Revision 3 offered "the association's own source/provenance" as an alternative owner here, which
  contradicts the prohibition three lines above: if the address is the only origin witness, deleting
  its last row reclassifies the edge as non-ref-origin and limb (b) goes quiet — **the detector
  erases its own subject.** Third occurrence of that circularity, in the same place, and the reason
  the contribution record exists as a distinct table. Never reconstructed from scalar
  `edges.source_file` either.

### ⛔ PRE-RESOLVED REFS ARE REF-ORIGIN. They were misclassified here, and the misclassification was the opening rule broken inside this document.

Revision 2 listed pre-resolved `CONTAINS` and `DECLARES_BINDING` as **non**-ref-origin. Both producers
literally call `refs.push`:

- `generic.js:628-639` — `refs.push({ from_target, to_id, relation: 'CONTAINS', … })`
- `frameworks/shader_bindings.js:183-194` — `refs.push({ relation: 'DECLARES_BINDING', from_id, to_id, … })`,
  whose own comment explains *why* it must be a ref: a direct edge inserted in the pre-extract pass
  "would be wiped by `deleteEdgesByFile()`… Refs are resolved AFTER that loop, so the edge survives."

They are **REF-ORIGIN with a typed pre-resolved address**. I inferred "not a ref" from the absence of
a `target` *string* — the absence-licenses-a-conclusion failure, committed three sections below the
table that forbids it by name. **Invariant (b) applies to them unchanged**; they are not exempt.

**Their association identity is the resolved `(from_id, to_id, relation)`, plus source and typed
address kind.** `resolver.js:894-905` takes `ref.to_id` directly as the destination, so the resolved
ID is available at association time.

⛔ **`to_label` IS DISPLAY DATA. It is never an identity and never a join key.** Measured on this
graph: **541 distinct label strings, of 6,300 distinct label strings, name more than one node** (92
share `"git"`, 68 `"SKILL.md"`, 32 `"r"`). ⚠ That is a property of the **label domain** — *not* a
fraction of refs that would misjoin, and *not* a loss rate. It is sufficient for exactly one purpose:
disqualifying `to_label` as a key, because a non-unique domain can match the wrong node.

A future label-only ref is **resolved to a specific id, or marked explicitly UNRESOLVED/AMBIGUOUS**.
It is never satisfied by matching the name.

⚠ This repair was itself proposed with `to_label` as an alternate identity and corrected before
landing — the third time a fix written in the same breath as accepting a refutation carried the same
class of flaw as the thing it replaced.

**Genuinely non-ref-origin producers**, never expected to hold an association: structural
CONTAINS/DEFINES (`generic.js:364-374`, `615-626`), `sweep.js:403`, `cmake.js:194-198`,
`virtual_overrides.js:307-319`, and code-intel importer direct upserts such as `upsertLspEdge`
(`code-intel/importer.js:841-887`), which synthesises an edge from a reference record and supplies no
emitted address.

## Seal lifecycle: ONE principle, not a list of cases

⭐ **THE SEAL DESCRIBES A GRAPH. IF THE GRAPH IS REPLACED, THE SEAL IS REISSUED OR REVOKED IN THE SAME
TRANSACTION.** That is the whole rule. Revision 3 stated four cases and got one wrong, because cases
must be remembered and a principle does not.

| what happened | graph | seal |
|---|---|---|
| committed full rebuild, complete | replaced | **REISSUED** |
| committed full rebuild, **any skip** | replaced | ⛔ **REVOKED, in that same commit** |
| rolled-back rebuild | **not** replaced | prior seal **stands, untouched** |
| incremental that commits a previously skipped source | amended | **REVOKED** in the same transaction |

⛔ **THE WINDOW REVISION 3 LEFT OPEN, and it is reachable through an ordinary 1 MB file.** Revision 3
said "withhold now, revoke on a later incremental". But `orchestrator.js:548-550` does
`if (fullRebuild) { db.exec('DELETE FROM edges; DELETE FROM nodes;') }`, `:653-669` skips any file
over 1 MB and deletes its nodes, and `:1010-1048` publishes `status: ok` with a skipped count — then
the transaction commits. So the graph is **replaced by an incomplete one** while a prior seal
survives describing a graph that no longer exists. Withholding is not revoking, and I had applied
that rule to the incremental case only.

## The three records

| record | key | purpose |
|---|---|---|
| **CONTRIBUTION** | `(from_id, to_id, relation, PRODUCER_ID, source)` | the positive, independent origin witness |
| **ADDRESS** | `(edge, emitted address identity)` | the audit unit — **one row per logical address** |
| **LINK** | `(contribution, address)` | which producers contributed that address |

### PRODUCER_ID is required, and its absence was refuted by this document's own evidence

A key of `(from_id, to_id, relation, kind, source)` **collapses two real producers**.
`producer-collision-output.txt:9` — quoted approvingly two sections above, in revision 2 — shows
`shader-bindings` and `glsl` emitting the same IMPORTS triple from the same `source_file`, both of
kind REF. Unique, they merge; non-unique, a reindex cannot tell whose row to remove.

- `PRODUCER_ID` is recorded **by the producer at emission**.
- ⛔ It is **never** read back from the deduplicated edge's `extractor`/`provenance`, which are
  first-wins and CODE_INTEL-overwritten.
- Two producers of kind REF are **never** silently treated as one. Choosing a per-`(source, kind)`
  aggregate instead would have to be named as an aggregate and carry a proof that every producer in
  it is invalidated and recomputed atomically.

### The ADDRESS record is where deduplication happens — in storage, not in the audit

Measured on the real fixture: `generic.extractFile` on
`tests/fixtures/ingest/tiny-glsl/shaders/triangle.vert` emits `IMPORTS target="common.glsl"`
(`extractor=glsl`), and `shader_bindings.js:199` separately loops `extractGlslIncludes(content)` for
the same include. **Two REF producers, ONE logical emitted address.**

Semantic 2 already fixed the audit unit as the address, so the address is a **row**, not a projection
someone must remember to perform. Every time this design has asked the audit to project, reduce or
infer, that is where the defect went.

⛔ The address key is the **emitted address identity**. Never `source_line`. Never the `extractor`
retained on the deduplicated edge.

### No tombstones

A supported deletion removes **edge + addresses + contributions + links in one transaction**.

An origin row surviving a deleted edge would be another alternate satisfier: it must not count as a
live REF contribution for limb (b), and must not satisfy an address. Rather than add the exception
and police it with two further rules, the possibility is removed. If a consumer later needs deletion
history that is a new requirement with its own controls, not a hole left open in advance.

## The invariant is a CHECK, never a description of the write path

⛔ Revision 3 offered "remove both contributors ⇒ the address record is deleted" as though it were a
guarantee. **That describes what the writer does.** If the only thing preventing an orphan is that
the write path does not create one, there is no guard — it is an agreement with myself.

    (a) every ADDRESS record references a LIVE edge
    (b) every edge with a LIVE REF CONTRIBUTION has >= 1 ADDRESS record
    (c) every CONTRIBUTION references a LIVE edge
    (d) every ADDRESS record has >= 1 LIVE CONTRIBUTION LINK
    (e) every LINK joins a contribution and an address belonging to the SAME edge
    (f) every LIVE REF CONTRIBUTION has >= 1 LINK to an ADDRESS of the SAME edge
    (g) all of the above maintained in ONE transaction with the edge write or delete

⛔ **LIMB (f) IS NEW IN REVISION 9, AND WITHOUT IT (a)–(e) MISS A LOST PRODUCER LINK ENTIRELY.**
graph-senior-dev's counterexample, in this document's own GLSL shape: live edge `E`, one address
`A = common.glsl`, two live REF contributions `P = glsl` and `Q = shader-bindings`, links `P→A` and
`Q→A`. **Delete only `Q→A`.** Then (a) `A` still references live `E`; (b) `E` has contributions and
one address; (c) `Q` still references live `E`; (d) `A` still has `P`'s link; (e) the surviving link
is same-edge. **Every limb passes, and the store has silently lost the fact that `Q` emitted `A`.**

The consequence is not cosmetic: reindex `P` next, and the writer's *last link removed ⇒ delete the
address* rule can delete `A` **while `Q` is still emitting it** — the exact erroneous state the
both-insert-orders GLSL control exists to prevent.

⚠ **AND (g) CANNOT RESCUE IT.** Transactional write intent says how records are written; it cannot
make a static preflight notice a link that is *already* missing. Every limb from (a) to (e) is an
obligation on addresses, contributions or links that **exist** — none is a positive obligation that
a contribution **have** a link. That is the asymmetry (f) closes, and it is the same
alternate-satisfier shape as the rest of this arc: `P→A` satisfies the address's requirement, so
`Q→A` can vanish unobserved.

⛔ **THE PREFLIGHT MUST NAME EVERY VIOLATED LIMB, NOT THE FIRST.** With (f) present, more than one
limb legitimately fires on the same planted state — control 5a below trips (b) *and* (f) together.
A checker that short-circuits on the first failure would let 5a's limb-specific assertion pass or
fail for the wrong reason, which is the defect this plan has now produced three times.

The audit runs these as a **precondition** and REFUSES, naming the limb, rather than reporting a
figure over a broken store.

**Planted-violation arms — because an invariant nobody can violate in a test is an invariant nobody
has tested:** planted orphan ADDRESS ⇒ refuse (a)/(d); planted orphan CONTRIBUTION ⇒ refuse (c);
planted CROSS-EDGE LINK ⇒ refuse (e); planted ORPHAN LINK ⇒ refuse (e); **planted LINKLESS REF
CONTRIBUTION on a still-addressed edge ⇒ refuse (f)** — the shared-address case above, and the one
arm that fails if (f) is ever dropped. Each is a distinct shape and none may rely on another
control's refusal for its coverage.

## Control 5 is two populations, not one test

⛔ **AND THE FIRST SPEC OF IT WOULD HAVE PASSED FOR THE WRONG REASON.** Revision 4 said "delete the
address record **alone**". But LINK rows sit on every address, `storage/db.js:46` sets
`foreign_keys = OFF`, and limb (e) requires every link to join a live contribution *and* a live
address. A literal deletion therefore **strands links**:

- 5a would have **REFUSED for limb (e), not the intended limb (b)** — a control passing for the wrong
  reason. The refusal would have been logged and the design would have looked validated by a limb
  with nothing to do with what was being tested.
- 5b could not have passed `(a)`–`(e)` at all, so it could never do its one job: distinguishing
  address loss from link corruption.

⚠ **A control that refuses for the wrong limb is worse than one that fails**, because the refusal
resembles the design working. Found by reading the committed diff and noticing two rules written in
different sections interact — not by executing anything.

**Corrected:**

- **5a.** single-address ref edge; delete the address **and all its LINK rows ATOMICALLY**, retaining
  the edge and the independent CONTRIBUTION witness ⇒ the edge is still ref-origin with no address,
  so **limb (b) fails**, and the retained contribution now has no link, so **limb (f) fails too**.
  The audit **REFUSES**, not a quiet UNKNOWN, and must **NAME BOTH**. ⚠ **Revision 9 changed what
  this arm may assert:** before (f) existed, 5a claimed (b) fails *specifically*. It can no longer
  claim (b) is the ONLY limb — the assertion is that **(b) is among the named limbs**, which is why
  the preflight must report the complete set rather than short-circuit.
- **5b.** edge with addresses `A` and `B`; delete `B` **and all of `B`'s LINK rows atomically**,
  **with every contribution retaining a link to `A`** ⇒ `A` and its links remain and `(a)`–`(g)`
  genuinely pass. ⚠ **That construction is now load-bearing:** a contribution linked only to `B`
  would be left linkless and trip (f), so 5b would refuse instead of passing and could not do its
  one job. ⚠ **And the pass is NOT the finding.** It establishes only that the store is consistent;
  attribution requires *source-still-emits-`B`* plus the across-run baseline `(B, e)`. 5b is the case
  that proves the preflight is a floor, not the measurement.
- **limb (e) gets its OWN arm:** a planted **orphan LINK** (pointing at a deleted address or
  contribution) ⇒ **REFUSAL naming (e)**. It must not borrow 5a's refusal for its coverage.

## The GLSL control: source state is an explicit variable

⛔ "Remove both contributors ⇒ one NAMED missing address" is only a **loss** if the source STILL
EMITS `common.glsl`. If the `#include` was legitimately deleted the correct verdict is
REMOVED_AT_SOURCE, and naming it would be a false alarm — which is ARM A of the across-run audit, the
arm that decides whether anyone ever uses the result. Revision 3 specified the loss arm without
freezing its source.

| arm | source state | expected |
|---|---|---|
| baseline | emits `common.glsl` | **ONE** address counted |
| remove one contributor, other still emitting | unchanged | **CONSERVED**, still one address |
| supported deletion of edge + records | **bytes frozen, ref population asserted unchanged** | **ONE** candidate loss, NAMED |
| source edit removing the `#include` | import deleted | **NONE** named — **AND** the recorded key is **absent post-edit**, **AND** the classifier returns REMOVED_AT_SOURCE |
| **5th, revision 9: `Q→A` link deleted, THEN `P` reindexed** | **both still emit `common.glsl`** | **step 1:** preflight **REFUSES naming (f)** before any reindex runs. **step 2, if the reindex is forced past it:** `A` must **still exist**, because `Q` emits it — an `A` deleted here is the two-step producer-link loss, NOT a legitimate cleanup |

Both insert orders for the two producers. The fourth arm is the negative control that proves the
third is not simply a check that shouts whenever a record disappears. The denominator counts
**addresses** and never producers, so producer count cannot move it.

⛔ **THE FIFTH ARM IS THE ONLY ONE THAT EXERCISES THE CONSEQUENCE, AND IT IS NOT REDUNDANT WITH LIMB
(f).** (f) catches the *state* — a contribution with no link — at the next preflight. The fifth arm
asks the separate question of whether that state, if it survives a preflight, **destroys an address
a live producer is still emitting**. Step 1 and step 2 fail differently: a checker that never runs
(f) passes step 1 by silence, so step 2 forces the reindex anyway and asserts on `A` itself. ⚠ Both
steps required — step 1 alone would be satisfied by a refusal for any reason, and step 2 alone
cannot tell a missing guard from a working one that simply was not reached.

⛔ **WHY THE FOURTH ARM NEEDS ALL THREE ASSERTIONS, AND WHY "NONE NAMED" ALONE IS A FALSE PASS.**
Revision 7 wrote this arm as "NONE named — REMOVED_AT_SOURCE" without requiring that the store
actually dropped the address. If reindex retains the key, the unchanged classifier takes the
**second cell** and returns `SURVIVED` — which *also* names no loss. So an assertion on "NONE
named" **passes**, while the stated verdict REMOVED_AT_SOURCE is **false**. The arm would certify
the design while exercising a different cell.

⇒ If the key is **still recorded** after the edit, the arm is **NOT a successful negative control**.
It is the documented over-retention gap, or a failed cleanup, and must be reported as one.

⚠ **This is the same condition added to the transition row in the very commit that added it**, and
this site did not receive it — revision 7 wrote the "five sites must move together" warning and
then moved one site and left four. It is also the **third** control in this plan found to pass for
the wrong reason (control 5a tripped limb (e) instead of (b); ARM B/C needed rewriting against the
invariant). ⭐ **A control that still passes after the thing it tests has broken is the failure mode
this document keeps reproducing** — so for every arm, state the observation that must ALSO hold,
not only the headline count. Found by graph-senior-dev.

## Population and transitions

**Row states:** `REF_EDGE_ADDRESSED` · `REF_EDGE_UNADDRESSED` (a defect under a valid seal, UNKNOWN
without one) · `NON_REF_EDGE` · `ORPHAN_ADDRESS` · `ORPHAN_CONTRIBUTION` · `CROSS_EDGE_LINK` · `ORPHAN_LINK` ·
`LINKLESS_REF_CONTRIBUTION` (**the last five** violate the invariant — the audit must REFUSE; the
last two were omitted here until revision 9 while their planted arms already existed, which is the
same inventory-drift the limb count had) · `LEGACY_UNSEALED` (UNKNOWN; never lost, never
conserved) · `MULTI_PRODUCER_EDGE` (≥2 contributions, possibly of the same kind).

| transition | seal | rows |
|---|---|---|
| full rebuild, completed | **reissued** | every ref-origin edge addressed |
| full rebuild, **committed with any skip** | ⛔ **revoked in that commit** | graph replaced and incomplete |
| full rebuild, rolled back | prior seal **stands** | graph not replaced |
| incremental, clean | preserved | reprocessed files' records replaced; untouched triples carried intact |
| incremental committing a skipped source | **revoked**, same transaction | affected rows UNKNOWN |
| one producer reindexed, another still emitting | unchanged | that producer's contribution+link replaced; the address survives via the other link |
| all producers of an address stop emitting | unchanged | address REMOVED_AT_SOURCE, not lost — ⚠ **only if the store actually drops it**; a retained record is the over-retained *second cell*, an open gap |
| edge delete (`nodes.js:37-39`, `edges.js:48-68`, wipe `orchestrator.js:548-550`, analysis deletes) | unchanged | edge + addresses + contributions + links removed in ONE transaction |
| node delete | unchanged | as above per incident edge — ⚠ `deleteNodesForFile` can **over-delete** edges owned by other files |
| owner-set computation | unchanged | seeded from **independently extracted** contributions, never from scalar `edges.source_file` |

⛔ **No cascade gate.** `storage/db.js:46` sets `foreign_keys = OFF`, so a claimed cascade is an
agreement rather than a guard. Each route performs its own transactional cleanup, and the audit runs
the seven limbs as a precondition.

## Controls — ALL UNRUN

⚠ **Every control below is UNRUN and its outcome is UNKNOWN.** None has been implemented, none has
been executed, and no result from any of them may be cited.

**Detector controls (six).** 1-3 and 5-6 graph-senior-dev's; 4 graph-tech-lead's.

1. edge present, extension-probed module ⇒ recorded/present, binding still separately classified
2. delete that edge, source unchanged, no unresolved row ⇒ **NAMED** module loss
3. `base.js` + `base.ts`, drop ONLY the `.ts` edge ⇒ TS-resolved ref NAMED lost, JS conserved
4. same module imported on two lines ⇒ **no** phantom loss
5. two distinct modules on ONE line, drop one edge ⇒ that one NAMED, the other conserved
6. two distinct specifiers resolving to ONE edge ⇒ neither lost at baseline; deleting it names **both**

⛔ **The planted-loss arms must be rewritten, and the invariant must NOT be weakened to keep them
green.** A raw `DELETE FROM edges` leaving records behind violates limbs (a) and (c), so the audit
must **REFUSE**, not report the named loss the current ARM B and ARM C expect.

| arm | how | expected |
|---|---|---|
| planted loss | delete edge + addresses + contributions + links atomically | **NAMED LOSS** |
| orphan address | plant an address whose edge is gone | **REFUSAL**, naming (a) — **and (d)** if its links went with the edge |
| orphan contribution | plant a contribution whose edge is gone | **REFUSAL**, naming (c) |
| cross-edge link | plant a link joining records of different edges | **REFUSAL**, naming (e) |
| orphan link | plant a link pointing at a deleted address or contribution | **REFUSAL**, naming (e) — its **own** arm, not borrowing 5a's |
| **linkless REF contribution (revision 9)** | delete one producer's LINK on a **shared** address, leaving the address linked by the other | **REFUSAL**, naming **(f)** — the arm that fails if (f) is dropped |

**Lifecycle controls (graph-senior-dev's).**

1. legacy-attested DB + migration + unrelated incremental ⇒ legacy ref **UNKNOWN**, no percentage
2. successful full rebuild ⇒ **seal present**, positive association
3. then an unrelated incremental ⇒ old edge **and** address **still conserved**
4. **split, because the single form contradicted the seal rule and a literal test would reject
   correct behaviour:**
   - 4a. **committed** full rebuild with a deliberate skip ⇒ **no valid seal immediately**, revoked
     in that commit; and a later incremental committing that source ⇒ revoked in the same transaction
   - 4b. **rolled-back** rebuild ⇒ baseline seal **preserved**; the manifest may gate reads separately
5. see *Control 5 is two populations* above — 5a trips (b) and REFUSES; 5b passes (a)/(b) and is
   attributable only across-run

**Deletion challenges (four).** Direct `DELETE` of the edge; delete of its node; reindex of its
source; a retained **wrong-sibling** edge. None may leave records able to satisfy a missing edge, and
none may silently orphan an untouched edge's valid addresses.

## Authority: what each audit may claim

⛔ **CURRENT SOURCE STATE IS THE FIRST GATE ON A LOSS VERDICT, AND IT IS CHECKED BEFORE THE PRESENCE
PATTERN.** Revision 5 wrote that requirement into control 5b and left this table stating the
unqualified rule, so the document carried both at once. Found by graph-senior-dev, reading the
committed revision-5 diff.

⚠ **REVISION 6 THEN OVERSHOT IT AND REVISION 7 PULLS IT BACK.** Revision 6 wrote step 0 as
"REMOVED_AT_SOURCE **whatever `e` and `B` are doing**" — a claim over all four
(recorded × emitted) cells. It is wrong in one of them, and the shipped classifier does not
implement it. See *What the shipped classifier actually enforces* below.

| step 0 | asked BEFORE any LOSS verdict | if the answer is no |
|---|---|---|
| source emission | the address is **absent from the store** — does the source **still emit** it? | ⛔ **REMOVED_AT_SOURCE, not a loss. Stop.** |

⛔ **No absence may reach a loss verdict without step 0**, because a lost address and one the source
stopped emitting are **both absent from the store** and indistinguishable from the store alone. Step
0 is the only thing that separates them. This is the plan's opening rule applied to its own
conclusion — absence licensing nothing.

Only refs that pass step 0 reach this table:

| | may NAME a missing address | may ATTRIBUTE the cause |
|---|---|---|
| **point-in-time**, under a valid seal, address **currently emitted** | yes | ⛔ **no** — edge loss and evidence loss are indistinguishable from (a) and (b) alone |
| **across-run**, baseline `(B, e)` held, source **still emits `B`** | yes | **yes**: `e` present + `B` absent ⇒ evidence corruption / UNKNOWN; `e` absent + `B` absent ⇒ **edge loss** |

A division of labour between the two audits, not a limitation of one. No figure may claim attribution
its audit cannot support.

### What the shipped classifier actually enforces

⛔ **REVISION 6 CLAIMED THIS GATE WAS "ALREADY IMPLEMENTED". THE CLAIM WAS FALSE.** It is the sixth
correction in this arc where the sentence leaned toward the stronger result, and it was written
inside the revision that congratulated itself for checking the code before trusting the prose — the
branch that agreed was checked and the branch that did not was not. Found by graph-senior-dev
reading `7c4c415a` against the classifier at that same tree; reproduced here by extracting the
exact function bytes and running all four cells:

| recorded after | source still emits | `classify()` returns | |
|---|---|---|---|
| yes | yes | `SURVIVED` | correct |
| **yes** | **no** | **`SURVIVED`** | ⚠ **the second cell — see below** |
| no | yes | `LOST` | correct |
| no | no | `REMOVED_AT_SOURCE` | correct |

`classify` (`scripts/audit-ref-conservation-across-run.mjs:159-166`) tests `recordedAfter` **first**
and returns `SURVIVED` without ever consulting `emittedAfter`. It asks the extractor **only when the
record is absent**. What is implemented is therefore the **narrow** rule — *when an address is
missing from the store, consult current emission before calling it lost* — which is exactly what the
step 0 table above now says, and **not** a universal source-first gate.

⛔ **The broken-subject receipt does not cover the second cell.** The 6-losses-at-`871a1d65` / 0
result exercises the **record-absent** branch only. A control proves the branch it exercises.

Step 0 does need the emitted set on both sides, and both audits already build one:
`audit-ref-conservation.mjs:175` and `audit-ref-conservation-across-run.mjs:103` each call
`extractFile`. That part of revision 6 was checked and stands.

### The second cell: recorded, no longer emitted — and why step 0 must NOT be made universal

An address still in the store whose source has stopped emitting it is an **over-retained recorded
key**: a *candidate* stale address. This audit does not decide it.

⛔ **Making step 0 universal — as revision 6 wrote it — would relabel that cell REMOVED_AT_SOURCE,
which is worse than the current label.** REMOVED_AT_SOURCE means *correctly gone*. Applying it to a
row that is **still present** would mark a candidate stale address as a legitimate removal and
silence the gap entirely. So the choice was never "narrow prose versus a principled code change":
the universal form is a defect, and narrowing the prose is the correct repair rather than the cheap
one.

⚠ **AND IT IS ONLY A CANDIDATE — the edge is NOT thereby stale.** A deduplicated edge can carry
other legitimate producers, so one producer ceasing to emit does not make the edge stale; this
document's own transition *one producer reindexed, another still emitting* says exactly that.
Calling the second cell edge-level over-retention would be another alternate-satisfier error, inside
the repair for one. (graph-senior-dev, correcting both this and my off-by-one "fourth cell".)

⚠ `SURVIVED` is nonetheless the wrong word for that cell, because it reads as a good outcome and
masks the gap. **Recorded here as an OPEN GAP with no control, no implementation and no receipt**,
out of this plan's scope. Nothing in this document may be read as claiming the audit detects
over-retention at either key or edge level.

⚠ **Source state governs five places in this document** — the GLSL control's fourth arm, the
transition *all producers of an address stop emitting*, control 5b, the step 0 table, and this
section. **As of revision 8 they agree; in revisions 5, 6 and 7 they did not.** Each is read alone,
and that duplication has now produced the same defect three times running: revision 5 changed one
site of four, revision 6 over-generalised a sixth, and revision 7 added the store-dropped condition
to the transition row while leaving the GLSL arm without it — **in the same commit that wrote this
warning.** Changing any one of them changes all five, and a revision that touches one must say
which of the other four it checked.

## Scope note

This is a schema change to the product, driven by an instrument defect, and the investment now exceeds
the defect that prompted it. For: the missing association is unanswerable for any consumer, not just
the audit — "which import produced this edge" cannot be answered today, and limb one shows an edge can
have two producers with no way to say so. Against: nothing outside the audit has asked for it.
Recorded so the decision is visible rather than implied by a commit.
