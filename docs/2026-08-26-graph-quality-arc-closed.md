# The graph-quality arc, closed

21 commits, 70 files, +5,397 lines. Suite: **378 files, 3,056 passed, 4 skipped, 0 failed.**

This consolidates sixteen separate documents written during the arc. It states what shipped, what
was measured, **what was abandoned and why**, and what is still open and whose call it is.

---

## What shipped

Every finding below has a named test, and all of them were verified by **running** them, not by
assuming — 15 guard files, 131 tests, green.

| # | Defect | Fix |
|---|---|---|
| F1 | `trust: "strong"` on a graph with **0** compiler-verified edges — `computeTrustLevel` is a function of unresolved-edge count alone | `capabilities` reported separately: `orientationUsable` / `compilerVerifiedEdges` / `absenceAuthority` / `reason` / `nextAction` |
| F2 | Collection budget-exhausted with no remainder stated | Remainder and resume state reported; `positionGuessSkipped` documented with its unit |
| F3 | C++ uncollectable from a clean checkout, silently | Typed, non-fatal compile-DB preflight at project init |
| F4 | PHP permanently second-class | **Not fixed — blocked on a licence, not engineering.** See below |
| F5 | Orphan nodes | **Not a defect** — structural types that participate in no edge by nature |
| F6 | `EXTRACTED` and `AMBIGUOUS` indistinguishable | Closed by F12, at the two verbs that bypass the shared renderer |
| F7 | A killed index leaves a lock naming no cause, expiry or remedy | The error now states age, expiry and remedy |
| F8 | An interrupted index leaves a silently degraded graph — every check agreed it was fine | `reason: 'index_incomplete'`; manifest and database compared for the first time |
| F10 | Collection wrote out-of-repo `file://` URIs into the graph | `relativizeUri` returns null; skipped targets counted, not silently dropped |
| F11 | `NO CALLERS` was an absence claim whose population was invisible | A `SCOPE` line naming what was searched and what was not |
| F12 | Confidence ranked above evidence tier; provenance dropped at two verbs | Tier-first ordering; the shared provenance tag restored |

**Framework layer** — every framework now binds routed targets to real symbols, with third-party and
undefined targets correctly staying `External`: Express, FastAPI, Django, Laravel, NestJS, Qt, Rails,
Spring. Three root causes: a framework tag read as a language, a `CALLS` ref forbidden from naming
its source, and Rails discarding the controller it already had.

**Adoption** — skill descriptions synced across four trees and three installed roots (the field that
decides whether an agent invokes at all was exempt from the sync check); a safe installer for the
deletion-guard hook; and the hook's fire rate made re-derivable on any repository.

---

## What was abandoned, and why

Six hypotheses died. Each cost less than the work it prevented.

1. **"Skill descriptions are entry-point-shaped, blocking mid-task reach."** Measured all 17: the 5
   keyed on *"when the user asks"* are genuinely user-initiated operations where that is correct.
   Description content cannot solve mid-task reach — an agent mid-task does not re-scan descriptions.
   A rewording pass would have measured nothing.
2. **"`graph_callers` returns zero callers for high-traffic symbols."** It returns a correct
   *refusal*. My instrument counted rendered caller lines, and a refusal renders zero of them.
3. **"`graph_impact` hides an unsearched relation."** What it does not search on a `NO IMPACT` symbol
   is `DEFINES` (28), `CONTAINS` (12), `IMPORTS` (1) — structural containment, correctly excluded.
4. **"Historical replay can measure the hook's benefit."** `callersOf` counts only `LSP_VERIFIED`
   edges, and a freshly-indexed graph has **zero**. Seven silent replays would have been silence by
   construction — I would have reported "the hook catches nothing" from a harness that could not
   catch anything.
5. **"Incremental reindexing leaves stale nodes."** False for every node type but one: 4,525 nodes,
   100% shared, zero residue. The real finding is narrower — the residue is confined to `External`
   and is 98.8% garbage.
6. **"The importer's `upsertExternalNode` needs the same guard."** It is reachable but has produced
   zero External nodes here, and its label comes from an LSP qname rather than tree-sitter text. No
   evidence, so no speculative guard.

---

## What the numbers say

**Evidence tiers are empirically ordered.** Sampling 400 `CALLS` edges per tier and asking whether
the callee name appears in the caller's source at all:

    callee label is not a name    LSP_VERIFIED 0.0%   EXTRACTED 0.8%   AMBIGUOUS 23.3%
    definitely wrong, of the rest LSP_VERIFIED 0      EXTRACTED 0      AMBIGUOUS 1/307

That is the trust model working, and it is the empirical case for F12's tier-first ranking.

**The hook's value is a property of the graph, not the feature.** It counts only compiler-verified
edges: a freshly-indexed graph has 0; this repository's collected graph has 2,379 of 15,426 (15.4% as measured on 2026-08-26; the
share moves with every reindex, so re-derive it rather than quoting this). Cost side:
≤2.2% of production file-changes reach its text stage.

**The corpus paid for itself.** Five defect classes were structurally invisible on our own
repository — F10 (we collect JavaScript here, so pyright never runs), F1 (needs a PHP arm), F12
(needs a real trust spine), F11, F8.

---

## Still open

- **F4 — PHP.** Blocked on a licence, not engineering. No PHP runtime here eliminates every
  PHP-implemented server; intelephense's licence limits use to an individual with an IDE and forbids
  distribution, and this project bundles its language servers. The engineering is two lines. The two
  options — detect-or-guide, or buy a licence — are **Steven's call**.
- **Enabling the deletion-guard hook.** `node scripts/install-agent-hook.mjs`. Not run against his
  settings; `--check` is read-only and reports NOT installed. **His call.**
- **Whether any of this changes what an agent does.** The audit's own third non-establishment, and
  still true. It needs the hook enabled to measure.
- **Recall.** Unmeasurable here by prior measurement, not by neglect.

---

## The methodological cost, stated plainly

Roughly a third of the elapsed effort went into instruments that were wrong before the code was.
The ones worth remembering:

- A probe returning **100%** is as suspicious as one returning 0% — mine checked `.size` on an array.
- **Two numbers can both be correct and their difference meaningless** if the pipelines differed. A
  before/after needs the before measured under the after's conditions.
- **A gate cannot be tested while everything works.** The mutant deleting a control-gate survived
  until a test mocked the thing it guarded into failure.
- **An idempotence test is satisfied by a no-op** — mine passed while the script did nothing at all.
- **A control that fails is not automatically a broken harness**; mine picked the one symbol the code
  is designed to reject.
- **A second regex is a second chance to be wrong** — import the predicate under test.
- Three separate features were silently inert because a `catch {}` ate the reason.
