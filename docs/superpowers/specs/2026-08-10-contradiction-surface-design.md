# v0.6.0 — contradiction surface, and a deletion audit

**Status:** design, awaiting review
**Evidence base:** two C++ manager agents, measured across 2026-08-09/10

## The finding this is built on

ef-manager, asked which changes altered what he actually *did*, answered with
counterfactuals against errors he had published — not opinion:

> Every single behaviour change came from a field that CONTRADICTED MY
> CONFIDENCE. Not one came from a field that gave me more information. The tool
> has never changed my behaviour by knowing something; it has changed my
> behaviour by telling me I did not know something I thought I knew.

Every confirmed behaviour change in the record fits:

| field | what it changed |
|---|---|
| `evidence.exhaustive` | reversed a **published** "C++ deletion safety: NO" verdict. Cold and warm returned the same six results; only the attestation differed |
| `staleProcess` | turned a report from "current behaviour" into "166f7ef's behaviour, retest needed" |
| `coverageIsFloor` | sc-coder excluded code-intel from a population proof **unprompted** |
| timeout ≠ not-found | he escalated instead of concluding "unmapped" — observed, same session |

Nothing on that list gave anyone new information. Every item told a reader that
something they already believed was unsafe to believe.

**Build rule: more data surface buys cheaper-same. More contradiction surface
buys behaviour change.** Only the second moves the quality number.

## The corollary, which indicts part of v0.5.0

> A cheaper useless field is slightly WORSE than an expensive one, because cost
> was the one honest pressure to delete it. Token reduction on an ignored field
> converts a visible problem into an invisible one.

Of eight changes shipped 2026-08-09/10, **two changed behaviour and two were
cheaper-versions-of-ignored-things**. The second pair should not have been
shrunk. They should have been questioned.

So this release opens with deletion, not optimisation.

---

## Part 1 — the deletion audit (do this first)

For every field in the DEFAULT payload of every listed verb, answer one question:

> If this field were deleted, what decision would become impossible or wrong?

Three outcomes:
- **Names a decision** → keep. Optimise only if it is expensive.
- **Names no decision** → delete. Do not shrink it, do not make it opt-in.
- **Unknown** → ask the managers. Do not default to keeping.

Named by the field already, as starting candidates for deletion rather than
shrinking: `overlay_quality`, and the overlay block inside `graph_consequences`
— "I ignored it at whatever it used to cost and I will ignore it at 1,494
tokens."

### ★ DECIDED: the overlay fields go — and the reason is granularity, not staleness

I asked sc-manager the disambiguating question: *if your overlay were fresh and
complete, would `features_touching` / `contracts_potentially_affected` change a
decision?* Answer: **no**, and the reason matters more than the verdict:

> Every load-bearing question today resolved at line-, blob-, or
> table-membership granularity. A feature name cannot answer it.

Their examples: a conjunctive source search across 134 files; membership of one
row in a 105-row table; and — closest to `features_touching` — "what consumes
`UnifiedFluidScatterResult`", where the lane still needed exact carriers and
coordinates and **rejected a clangd answer on its own evidence banner**.

So a fresh overlay would be *a correct answer at one resolution coarser than the
decision being made*. The source read happens either way; the field is a step
skipped, not a step that narrows.

**Delete:** `features_touching`, `contracts_potentially_affected`,
`open_tasks_on_those_features`, `overlay_age_days`, `overlay_age_warning`.

**⚠ NOT `spec_docs` — judged separately.** Their argument, and it is a good one:
it is a *pointer to authority*, not a derived summary, and their whole failure
mode this session was **failing to retrieve authority they already had**.
Different object from the other five. Delete it on its own evidence or not at all.

### ⚠ Bounds on that verdict, which they supplied unprompted

1. **Role-scoped.** They are a manager on a safety-class arc where every claim
   needs epoch binding. *"A lane doing cold orientation on an unfamiliar subsystem
   is a different consumer, and I am not answering for them."* One respondent is
   not the population.
2. **It is a counterfactual they cannot measure.** What they *can* report: ~10
   hours of exactly the work those fields target — impact, consumers,
   what-touches-this — with zero overlay consultation and no moment of wanting it.

Before deleting, get ef-manager's verdict on the same list. Two managers agreeing
is a pattern; one is a data point, and this spec has already been wrong once by
generalising from a single reading.

**Deliverable:** a table of every default field, its verdict, and the decision it
serves. Fields with no named decision are removed in this release.

⚠ **Constraint:** doubt clauses are never deleted on cost grounds. `exhaustive`,
`disconfirming_test`, truncation markers, provenance labels — these are the
mechanism. Anything from the contradiction table above is out of scope for the
audit.

## Part 2 — contradiction surface

### 2.1 Positive controls on absence claims

`evidence.exhaustive` attests that *coverage* was complete. It does **not**
demonstrate the query WORKS on this repo, in this session, right now. A
silently-broken index and a genuinely empty result produce identical output —
the defect shape this project exists to remove, sitting inside the flagship claim.

sc-manager's lanes solved it by hand and their sentence is the spec:

> the same query that found no simulation consumers DID find the known renderer
> consumption at Render.cpp:733-735, so the absence was demonstrably a real
> absence rather than a broken query

So an absence claim carries evidence the machinery was live: "this query resolved
N references for other symbols in the same TU." That turns *"I got zero"* into
*"I got zero from a query that demonstrably returns non-zero elsewhere."*

Applies to `code_intel_references`, `code_intel_hierarchy`, and `graph_callers`.

### ★ DECIDED: per-call, and staleness was the wrong axis

I put per-call vs per-session to sc-manager as a freshness tradeoff. That framing
was wrong, and their answer is measured rather than argued — **six extraction
failures in one afternoon, none of them index failures**:

```
1  ^symbol anchor (x3)      query form wrong        index fine
2  multi-colon capture      query form wrong        index fine
3  comparator pattern set   query form wrong        index fine
4  single-line TEST_CASE(   query form wrong        index fine
5  kC0CertMembers row form  query aimed at wrong LAYER (macro indirection)
6  span boundary            query aimed at wrong RANGE (471 lines vs 58)
```

**A per-session index probe would have been GREEN for all six.** Four produced a
flattering wrong value — twice in opposite directions on the same subject.

The two attest different objects:

| | attests |
|---|---|
| per-session (b) | THE INDEX WORKS on this repo/session |
| per-call (a) | THIS QUERY, AS AIMED, CAN SEE ITS SUBJECT |

An absence claim is a claim about **one query's reach**, so only (a) controls for
it. (b) is not wrong — it is *insufficient*, and the danger is that it **looks
sufficient**: a green session probe attached to an absence claim reads as
vindication.

Their case 6 belongs in the release notes: the extractor was *the same instrument
that had worked correctly minutes earlier on a different range*. Nothing
degraded. **A perfect reader over the wrong range returns the wrong answer just
as confidently.** No session-level probe can reach that, because what broke was
per-query scope.

**Therefore:**
- Per-call control at every absence claim: a known-positive of the same query
  shape in the same TU, reported inline.
- **Report the control when it FAILS**, not only when it passes. Twice today a
  failing control *was* the finding — it made a `0` legible as an instrument
  mismatch rather than a measurement.
- Keep a session-level probe only if it is cheap, name it **`index_health`**,
  never `control`, and **forbid it from satisfying an absence claim.**

### ⚠ And the limit of (a), stated so it is not oversold

A same-TU positive proves the query reaches *a* positive of that shape. It does
**not** prove the query's SCOPE matches the claim's scope — failures 5 and 6 were
scope errors that a same-TU positive could still have passed.

So the honest wording is *"this query demonstrably reaches its subject class in
this TU"* — **not** *"this absence is exhaustive."* Selling (a) as complete would
reproduce, one level up, the exact defect it was built to fix.

### 2.2 Truncation markers, everywhere a list is capped

ef-manager's priority call, and it outranked the ranking work I had planned:

> a ranking warning says the ORDER is unreliable and I must still go looking; a
> truncation marker says the LIST IS INCOMPLETE — a different and load-bearing
> claim.

Measured: `GpuMaterial` printed "16 concrete candidates found:" then five bullets
and stopped. The sole C++ declaration was in the silent eleven.

**Deliverable:** an audit of every capped list in every default payload, and a
disclosure on each. The idiom already exists here — `documents_mentioning_note`,
`co_consumer_files {items,total,truncated,limit}` — and is applied
inconsistently. Inconsistency is the bug; a reader cannot learn to trust a
convention that holds only sometimes.

### 2.3 Denominators travel in names

> a caveat stored beside a number protects the reader looking at the response and
> abandons the reader who COPIES THE NUMBER OUT

He read `refsNotFoundBreakdown.note`, correct and well-worded, and days later
still published "833/833, recall effectively zero". The number travelled; the
note did not.

**Rule:** any RATIO or SUBSET count carries its denominator in its identifier.
`lspVerifiedPctOfVerifiableInScopeCalls`, not `lspVerifiedPctOfCalls` beside a
separate denominator field. Ugly on purpose — a name cannot be separated from its
value. The adjacent note stays for the reader who is looking; the name protects
the one who is not.

One already shipped. **Deliverable:** the rest, found by audit.

## Non-goals

- **No new tools.** Settled: we cut 42→17 listed verbs because agents under-pick
  from big lists, and contradiction only works UNREQUESTED — "I never call a tool
  to be told I am wrong, because at that moment I do not think I am." Splitting
  attestation into its own verb gates the only proven quality mechanism on the
  agent already suspecting a problem.
- **No shrinking as a primary activity.** See the corollary. Shrink only what
  survives Part 1.
- **Not the overlay.** Both managers report not consulting it; sc-manager's
  project knowledge lives in ~187 cards and comms threads. Do not invest until
  someone reads it.
- **No ranking heuristics** where a truncation marker or a better resolution path
  does the job. Fixing `graph_packet`'s cheap path made `resolveSymbol` order the
  C++ declaration first for free; a hand-written relevance heuristic would have
  been worse and unfalsifiable.

## Testing

Every change ships with a test that FAILS with the change reverted — not
negotiable, and stated because this repo has shipped tests asserting the buggy
invariant they were written to catch, and I have written two more this week.

Specific to this release:
1. **Positive controls:** an absence with a live control reads differently from
   an absence with a dead one. Both cases asserted, on a fixture where the index
   is deliberately broken.
2. **Truncation:** for each capped list, a fixture that exceeds the cap and
   asserts the disclosure names both numbers. And one asserting NO marker appears
   when nothing was omitted — a notice on a complete list trains readers to
   ignore it.
3. **Denominators:** a parity test asserting no ratio field exists whose
   denominator lives only in an adjacent field.
4. **Deletion audit:** for each deleted field, a test asserting it is gone, so a
   later well-meaning re-add has to argue with a named decision.

## The measurement this release is judged on

Not token counts. sc-manager's answer to *"name one time the tool changed what
you did"* was **zero** — and unbounded: they retracted the reachability excuse
themselves after testing, so it was not "I couldn't reach it" but *"I could reach
it and did not reach for it."*

That question, re-asked after a stretch of real use on a fresh graph, is the
verdict. If it is still zero after this release, the contradiction theory is
wrong and the next cycle should not be more fields of any kind.

⚠ Stated so it cannot be quietly dropped: a favourable token number is **not** a
pass. Two of eight changes last cycle were cheaper-same, and reporting those as
quality wins is exactly the error this spec exists to avoid.

## Open questions for review

1. ~~Positive control scope~~ — **decided: per-call.** See §2.1. My framing
   (freshness) was the wrong axis; six measured failures settled it.
2. ~~Deletion vs deprecation~~ — **decided: delete outright.** Steven: APG is a
   prototype, every team knows it, clutter goes.
3. **Still open: `documents_mentioning_note` costs 46 tokens describing an EMPTY
   list.** The disclosure is larger than the data. Disclosure is right in
   principle, but a 46-token sentence about nothing is its own clutter. Probably:
   suppress the note when the filtered list is empty AND nothing was omitted;
   keep it whenever something was actually dropped. Wanted a manager reading
   before deciding.
4. **Still open: whether the overlay deletion generalises past one role.**
   sc-manager bounded their own verdict to a safety-class manager, explicitly not
   speaking for a lane doing cold orientation. Awaiting ef-manager.

## ⚠ Measurement hygiene for this release

sc-manager flagged that Steven's machine is currently running a MiniMax H3 video
generator on the GPU. **Any timing- or GPU-shaped benchmark taken from this
machine while that is live is contaminated** — and a contended GPU returns a
plausible number, not an error, which is the same failure class as everything in
§2.1.

Affects one figure already in the record: the 601ms / 4316ms `graphConsequences`
round-trips that motivated the cheap-path fix. Those are CPU/SQLite work rather
than GPU, and the fix stands independently — ef-manager measured 3 of 3 bare
symbols timing out, and the architectural argument (do not compute callers,
importers, docs, tasks and a receipt to answer "which feature owns this symbol")
does not depend on the exact milliseconds. But the specific numbers should not be
quoted as precise, and no timing claim should enter this release without
re-measuring on a quiet machine.
