# Plan: resolved-ref evidence, so conservation stops being reconstructed

**Status:** design, not implemented, **not approved**. Written 2026-09-26 after **five** proposed
designs were refuted by executed counterexample. The rule this document exists to enforce: *the next
design gets written down and reviewed before it is coded.*

⛔ **WHAT THE EVIDENCE SO FAR DOES AND DOES NOT SUPPORT.** The executed sixth control disproves a
scalar `edge.target` field and demonstrates the required cardinality. It does **not** prove the
evidence table proposed here, nor its lifecycle. This document is a proposal to falsify, and should
be read as one until its own controls have been run.

**Design recommendation:** graph-senior-dev. **Counterexamples 1-5 and control 6:** graph-senior-dev.
**Write-up and the refuted-design record:** graph-tech-lead.

---

## The question, and why it is currently unanswerable

A conservation audit asks: *did the ref the extractor emitted end up in the graph?* Answering it
requires knowing **which node a given emitted specifier resolved to**.

⭐ **The graph does not record that.** `edges` stores `to_id` — the *result* of resolution — and
discards the specifier that produced it. Meanwhile `unresolved_refs` (`publication-schema.js:44`)
stores `target`, the specifier, for every ref that FAILED.

> **The graph preserves the emitted specifier only when resolution fails.**

Every design below was an attempt to reconstruct that discarded mapping. Each admitted an *alternate
satisfier* — a way for the check to find something that was not the thing it was looking for. That is
not five bugs; it is one absence, found five times.

## The five refuted designs, so nobody re-derives them

| # | design | refuted by |
|---|---|---|
| 1 | match emitted target against `nodes.label` only | an import's target is a repo-relative PATH; the File node's label is a basename. No import could ever match. 4,488 phantom losses; and in the across-run direction, a *false quiet* on a planted IMPORTS drop |
| 2 | binding bucket = strip final dot-segment, check the prefix is recorded | a filename may contain dots. `src/consumer.js` imports both `./lib.js` and `./lib.js.ts`, both real files; losing the `.ts` module edge was excused because the prefix `src/lib.js` is a *different recorded module* |
| 3 | add `targetIsRealFile` to the above | extension probing. Emitted module `src/lib.js.foo` resolves to File `src/lib.js.foo.js`; `src/lib.js.foo` is not itself a file, so the guard is false and the prefix excuse returns. Also: the **held** module has no address form at all, so it reads absent with its edge present |
| 4 | add a `file_path`-minus-final-dot **stem** address form | `src/base.js` and `src/base.ts` both reduce to `src/base`. Deleting only the `.ts` edge left the stem satisfied by the surviving `.js` edge — a false quiet |
| 5 | exact form **UNION** same-line edge existence | two distinct module imports on ONE line produce two edges both at `source_line=1`. Delete one and the survivor satisfies the line fallback for the still-emitted other |

A sixth was proposed and falsified before coding: **a scalar `edge.target` column**. See below.

⭐ **Designs 1-5 and design 6 fail in DIFFERENT ways, and the difference matters.** 1-5 reconstruct
discarded information, so they fail by being **incomplete** — a false quiet, invisible to any reader.
The scalar column would have **manufactured** a loss at baseline, failing by being **confidently
wrong** — which at least surfaces as a bad number someone can dispute. Only one of these two classes
is visible from the output. (Distinction: dashboard-manager.)

## Why a scalar column on the edge does not work either

`schema.js` keys `edges` uniqueness on `(from_id, to_id, relation)` and `storage/edges.js` uses
`INSERT OR IGNORE`. Measured: `src/consumer.js` importing `./base.js` (line 1) and `@/base.js`
(line 2, via a tsconfig path alias) emits two distinct targets, `resolveRefs` produces two IMPORTS
edges to the same File node, and **SQLite persists one row**.

⇒ **Edge-to-specifier is many-to-one.** A first-wins scalar makes the second correct, successfully
resolved specifier a phantom named loss at baseline.

## The design

Keep **resolved-ref evidence separately from the deduplicated edges.**

- One record per **distinct emitted address**, carrying its resolved `(from_id, to_id, relation)`,
  its source file and line, and its **address kind**.
- The edge table stays deduplicated. Nothing about edge semantics changes.
- Evidence is **tied to the graph generation**, and deletion or reindex of an edge invalidates the
  matching evidence **atomically**. An audit must see a live edge **and** the specific address
  association — never a surviving sibling edge, never a retained sidecar.

⭐ This is not a new mechanism. It is the missing half of one that already exists: `unresolved_refs`
is exactly this record for the failure path.

### Address kind must be TYPED, never an empty string

Not every edge originates from a ref with a target string, and an empty target must **not** read as a
loss. Producer census (graph-senior-dev, file:line theirs):

- ref-originated, **pre-resolved, no target**: `generic.js:628-639` CONTAINS by `to_id`;
  `shader_bindings.js:183-194` DECLARES_BINDING by `to_label`
- **not ref-originated at all**: `generic.js:364-374`, `generic.js:615-626` structural edges;
  `sweep.js:403`; `cmake.js:194-198`; `virtual_overrides.js:307-319`; code-intel importer direct
  upserts

⛔ Conflating pre-resolved, synthetic and legacy into one falsy value is the defect class this arc has
already shipped twice. `refTargetName`'s `target -> to_label -> to_id` fallback
(`scripts/lib/ref-keys.mjs:43-50`) is the standing warning that these already look alike in our code.

### FROZEN SEMANTIC 1 — a missing association is not UNKNOWN by default

⛔⛔ **This is the rule that stops the repair becoming a third excuse bucket.** "No association ⇒
UNKNOWN" would make a planted loss quiet again — precisely the binding-bucket failure, rebuilt inside
its own fix. (Caught by graph-senior-dev *before* the plan was written.)

| the generation that built the row | emitted ref with no association | verdict |
|---|---|---|
| **attested NEW** — had association capability | the association should exist and does not | **candidate LOSS** |
| **LEGACY** — no association capability | nothing could have written one | **UNKNOWN** |

⇒ The discriminator is a **generation/capability receipt**, not the absence of a row. A row's silence
means nothing until you know whether its generation was *able* to speak. This must be decidable
before any percentage is computed.

### FROZEN SEMANTIC 2 — "per distinct address" and "record its line" disagree

They conflict exactly when the identical address is emitted on **two lines** (control 4). One of these
must be declared, not left to the implementation:

- **existential per address** — conservation asks only whether the address is associated anywhere.
  Then `source_line` is **representative and explicitly non-authoritative**, and must be labelled so
  in the schema and in any output that prints it.
- **per-occurrence lineage** — the line is load-bearing evidence about a specific site. Then evidence
  is retained **per occurrence**, not per distinct address, and the record count changes accordingly.

⛔ What is forbidden is the middle: a first-wins line that silently claims to cover both sites. That is
the same shape as the scalar `edge.target` this plan already rejected.

### The UNKNOWN denominator

- Rows typed UNKNOWN under semantic 1 are **neither lost nor conserved**.
- The UNKNOWN denominator is **published beside any figure**.
- **No percentage at all until a proven full rebuild.** Otherwise legacy rows drop silently out of the
  denominator and the number improves for the wrong reason — the same direction as the standing limit
  that *widening a recorded set can only move conservation up*.

## Acceptance: six controls, frozen before implementation

| # | control | required outcome |
|---|---|---|
| 1 | edge present, extension-probed module | recorded/present; binding still separately classified |
| 2 | delete that edge, source unchanged, no unresolved row | **NAMED** module loss |
| 3 | `base.js` + `base.ts`, drop ONLY the `.ts` edge | the TS-resolved ref NAMED lost; the JS ref conserved |
| 4 | same module imported on two lines | **no** phantom loss |
| 5 | two distinct modules on ONE line, drop one edge | that one NAMED; the other conserved |
| 6 | two distinct specifiers resolving to ONE edge | neither lost at baseline; deleting that edge names **both** |

Controls 1-3 and 5-6 are graph-senior-dev's; 4 is graph-tech-lead's, from the measured dedup trap
(same module on two lines yields one edge row, so a pure line key reports a phantom loss).

**Typed extractor origin is a separate, additional mechanism.** It removes the binding-vs-module
*inference* entirely: a binding ref never produces an edge, so without the flag every binding reads
as a named loss. Two problems, two mechanisms; neither substitutes for the other.

## What is held until this lands

- The point-in-time **binding class count** — do not quote it.
- The point-in-time **residue** — do not read it as a measurement of unexplained loss. It may be
  understated in both directions: by held modules the join cannot address, and by real losses the
  predicate excuses.
- Preserved as separately scoped and NOT held: the across-run arms (A/B/C), the final-segment rename
  arm, the parent-directory arm (F), and the C++ CONTAINS detector witness.

## Scope note

This is a schema change to the product, driven by an instrument defect. It is worth stating plainly
that the investment now exceeds the defect that prompted it. The argument for doing it anyway: the
missing association is not only an audit problem — "which import produced this edge" is unanswerable
today for any consumer, including anyone debugging resolution or explaining an edge to a reader. The
argument against: nothing outside the audit has asked for it yet. Recorded so the decision is visible
rather than implied by a commit.
