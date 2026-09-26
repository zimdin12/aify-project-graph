# Plan: resolved-ref evidence, so conservation stops being reconstructed

**Status:** design, not implemented, **NOT APPROVED**. Revision 3, 2026-09-26.

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

⇒ **Every licensing fact here must be POSITIVE and EARNED**: a typed origin the extractor states, an
explicit kind the producer writes, a seal a completed rebuild issues. Nothing is inferred from
something not being there. This rule is the only thing that would have predicted all five in advance,
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
  ref. The **association's own source/provenance**, or a separately keyed producer-contribution
  record, is the owner — never reconstructed from scalar `edges.source_file`.

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

## The invariant (replacing "tied to generation")

`evidence.generation == currentGeneration` is **dropped**: it would falsely lose every carried ref
after each incremental unless the whole table is retagged.

    (a) every association row references a LIVE edge
    (b) every REF-ORIGIN edge has at least one association row
    (c) (a) and (b) are maintained in the SAME TRANSACTION as the edge write or delete

An incremental preserves the seal only if it maintains this for reprocessed files and leaves untouched
edge/association **pairs** alone together. Untouched rows stay valid because the invariant is
referential, not generational.

⚠ **IT DOES NOT CERTIFY PER-ADDRESS COMPLETENESS.** One live edge `e` with associations `A` and `B`:
delete only `B`'s. `A` still references a live `e`, `e` still has an association, so (a) and (b) pass
while `B` is unrepresented. **The preflight is a floor, not a proof.**

## Authority: what each audit may claim

| | may NAME a missing address | may ATTRIBUTE the cause |
|---|---|---|
| **point-in-time**, under a valid seal | yes | ⛔ **no** — edge loss and evidence loss are indistinguishable from (a) and (b) alone |
| **across-run**, holding baseline `(B, e)` | yes | **yes**: `e` present + `B` absent ⇒ evidence corruption / UNKNOWN; `e` absent + `B` absent ⇒ **edge loss** |

A division of labour between the two audits, not a limitation of one. No figure may claim attribution
its audit cannot support.

## Seal lifecycle: withholding is NOT revoking

- Issued **only** by a **successfully completed full rebuild under the evidence-writing code**. Not
  table existence, not an `ALTER`/default, not manifest status, not a generation advance — all four
  can be true over legacy rows. **Measured:** an attested generation 2 carried an untouched edge at
  the same rowid from generation 1, with `skippedFileCount 0` and `processedFiles [src/a.js]`.
- The governing schema/extractor version bumps so old manifests force `fullRebuild`.
- **A rebuild that skips a source ⇒ NO SEAL ISSUED by that run.** `orchestrator.js:1010-1048` can
  publish status `ok` with files skipped; a globally-complete seal cannot cover files nobody read.
- **A rolled-back rebuild ⇒ no seal issued by that run either, and the PRIOR seal is untouched.**
- ⛔ **An incremental that COMMITS a skipped source must REVOKE or downgrade the seal IN THE SAME
  TRANSACTION.** Withholding a new seal leaves the old one licensing an answer about unread files.
- ⛔ **A ROLLED-BACK run must NOT revoke a valid old seal** — the old graph is unchanged and its seal
  still describes it. The manifest may separately report indexing until recovery, gating reads.
- No seal, or an **INVALID** one ⇒ **UNKNOWN and no percentage**, with the UNKNOWN denominator
  published beside any figure.

⚠ **"OLD SEAL" IS AMBIGUOUS AND THE AMBIGUITY IS DANGEROUS.** Two different things:

| | meaning | effect |
|---|---|---|
| **INVALID seal** | obsolete governing schema/extractor version, or a receipt that does not verify | UNKNOWN, no percentage |
| **still-valid PRIOR seal** | issued by a completed rebuild, and nothing since has invalidated it — including a rolled-back run | **remains in force** |

⛔ **WITHHOLDING IS NOT REVOKING.** A run that issues no seal leaves whatever was there before. So a
later incremental that COMMITS a previously skipped source must **actively REVOKE** in the same
transaction — otherwise the prior seal keeps licensing an answer about files nobody read. And a
rolled-back run must **NOT** revoke, because the graph it would have replaced is unchanged and its
seal still describes it accurately.

## Population and transitions

**Row states:** `REF_EDGE_ASSOCIATED` · `REF_EDGE_UNASSOCIATED` (a defect under a valid seal, UNKNOWN
without one) · `NON_REF_EDGE` · `ORPHAN_ASSOCIATION` (violates (a) — the audit must REFUSE) ·
`LEGACY_UNSEALED` (UNKNOWN; never lost, never conserved) · `MIXED_PRODUCER_EDGE` (ref-origin **and**
another producer).

| transition | seal | rows |
|---|---|---|
| full rebuild, completed | **issues** | every ref-origin edge associated |
| full rebuild, rolled back | **kept** | old graph unchanged |
| full rebuild with a skipped source | **withheld** | skipped files' rows unproven |
| incremental, clean | **preserved** | reprocessed evidence replaced; untouched pairs carried together |
| incremental committing a skipped source | **revoked**, same transaction | affected rows UNKNOWN |
| **mixed-producer insert, either order** | unchanged | ref contribution retained independently of which row won |
| **owner-set computation** | unchanged | seeded from independently extracted contributions, **never** from scalar `edges.source_file` |
| edge delete (`nodes.js:37-39`, `edges.js:48-68`, wipe `orchestrator.js:548-550`, analysis deletes) | unchanged | associations deleted in the same transaction, else `ORPHAN_ASSOCIATION` |
| node delete | unchanged | as above for every incident edge — note `deleteNodesForFile` can **over-delete** edges owned by other files |
| source reindex | unchanged | that file's evidence replaced wholesale; must remove **that** ref contribution without deleting another producer's |

⛔ **No cascade gate.** `storage/db.js:46` sets `foreign_keys = OFF`, so a claimed cascade is an
agreement rather than a guard. Each route performs its own transactional cleanup, **and the audit runs
the invariant as a precondition**, refusing to emit any percentage if (a) or (b) fails and naming
which limb.

## Controls

**Detector controls (six).** 1-3 and 5-6 graph-senior-dev's; 4 graph-tech-lead's.

1. edge present, extension-probed module ⇒ recorded/present, binding still separately classified
2. delete that edge, source unchanged, no unresolved row ⇒ **NAMED** module loss
3. `base.js` + `base.ts`, drop ONLY the `.ts` edge ⇒ TS-resolved ref NAMED lost, JS conserved
4. same module imported on two lines ⇒ **no** phantom loss
5. two distinct modules on ONE line, drop one edge ⇒ that one NAMED, the other conserved
6. two distinct specifiers resolving to ONE edge ⇒ neither lost at baseline; deleting it names **both**

⛔ **The planted-loss arms must be rewritten, and the invariant must NOT be weakened to keep them
green.** A raw `DELETE FROM edges` leaving its association behind violates (a), so the audit must
**REFUSE**, not report the named loss the current ARM B and ARM C expect.

| arm | how | expected |
|---|---|---|
| planted loss | delete the edge **and** its associations atomically (or via a real SQL `DELETE` trigger) | **NAMED LOSS** |
| orphan injection | plant an association with no live edge | **REFUSAL**, naming limb (a) |

**Lifecycle controls (five, graph-senior-dev's).**

1. legacy-attested DB + migration + unrelated incremental ⇒ legacy ref **UNKNOWN**, no percentage
2. successful full rebuild ⇒ **seal present**, positive association
3. then an unrelated incremental ⇒ old edge **and** address **still conserved**
4. **split, because the single form contradicted the seal rule and a literal test of it would reject
   correct behaviour:**
   - 4a. rebuild with a deliberate skipped source ⇒ **no seal issued by that run**; and a later
     incremental that COMMITS that source ⇒ prior seal **actively REVOKED in the same transaction**
   - 4b. rolled-back rebuild ⇒ no seal issued by that run, and the **still-valid prior seal is
     PRESERVED**; the manifest may separately gate reads until recovery
5. planted edge removal vs planted association removal ⇒ **distinguishable**: named LOSS versus
   UNKNOWN, never conflated

**Mixed-producer control (graph-senior-dev's, with their oracle constraint).** Must reach **real
extraction and indexing**, not a direct `upsertEdge` call: a synthetic collision would certify only
the synthetic case. Assert both attempted contributions and their **independently extracted** owner
files, then the **pre-deletion owner set** and post-edit conservation, **in both insert orders**. With
the ref association removed, a still-live mixed edge must not silently become "structural-only".
⛔ The expected owner set must **never** be built from `edges.source_file` — that is the value under
test, and the control would agree with the defect.

**Deletion challenges (four).** Direct `DELETE` of the edge; delete of its node; reindex of its
source; a retained **wrong-sibling** edge. None may leave evidence able to satisfy a missing edge, and
none may silently orphan an untouched edge's valid addresses.

## Scope note

This is a schema change to the product, driven by an instrument defect, and the investment now exceeds
the defect that prompted it. For: the missing association is unanswerable for any consumer, not just
the audit — "which import produced this edge" cannot be answered today, and limb one shows an edge can
have two producers with no way to say so. Against: nothing outside the audit has asked for it.
Recorded so the decision is visible rather than implied by a commit.
