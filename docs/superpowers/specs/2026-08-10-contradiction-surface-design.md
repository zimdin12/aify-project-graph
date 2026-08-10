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

1. **Positive control scope.** Per-call (find a control in the same TU, costs a
   query) or per-session (probe once at warmup, cache the verdict)? Per-session is
   cheaper and staler; per-call is honest and slower. Leaning per-session with the
   probe's age reported, but this is the main design decision in the release.
2. **Deletion is a breaking change.** Fields agents may read disappear. Given
   only Sand Castle uses APG and both managers report ignoring the candidates, I
   propose deleting outright rather than deprecating — but that is Steven's call.
