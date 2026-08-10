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

## ⛔ Part 0 — my cost table was measured on the wrong repo

Everything below was measured on `aify-project-graph`, a **JS** repo, to plan a
**C++** release. ef-manager caught it and it is disqualifying for the audit as
originally specified:

```
                    JS repo        C++ repo (echoes)
graph_health total   880 tok        1951 tok
  codeIntel           11 tok  (1%)   649 tok  (33%)
```

On TS/JS, clangd is unavailable so `codeIntel` collapses to `{available:false}`.
On C++ it is the **single largest field in the response** — larger than every
field I had listed for deletion combined.

So the audit as written would have deleted ~290 tokens of genuinely low-value
fields, left the 649-token block untouched on the repo type the C++ code-intel
layer exists for, and **the ranking would have reported success**.

His diagnosis, which is the right one: *"the base-rate error from the 52% arc in
a new costume — measuring the population you HAVE rather than the population you
are DECIDING ABOUT."*

**Required before any cut:** re-measure every default payload on a C++ repo. The
tables in Part 1 are retained only as a record of how the audit went wrong.

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

## ★ Part 1b — the cut I had missed: invariant prose (~20% of every response)

ef-manager classified every string ≥170 chars in two payloads and split them by
whether the text **varies**:

| | |
|---|---|
| **INVARIANT** — byte-identical on every call, every repo, forever | ~343 tok in health (18%), ~288 in consequences (22%) |
| **VALUE-BEARING** — changes with repo state, embeds live numbers | `summary`, `positionGuessSkippedNote` (embeds 21/0), `overlay_age_warning` (embeds 106) |

**The rule, and it is cleaner than field-by-field taste:**

> If a string's value never varies, it is not data — it is **documentation being
> re-transmitted per call.**

Externalise those to a doc, leave a short stable key (`note_ref:
"degraded-not-dead-code"`). Zero information lost, ~20% of every response gone,
and **nothing on the protected list is touched** — because the protected thing is
the mechanism, and the mechanism is the value-bearing sentence, not the paragraph
explaining the concept in general.

**⛔ The line that must not be crossed.** The value-DEPENDENT sentence stays
inline: *"833 of 833 are DEGRADED — do not read as dead code"* is about **this
repo's numbers**. Only the value-INDEPENDENT paragraph is externalised. Get that
boundary wrong and we rebuild the number-outlives-its-qualifier defect that
`lspVerifiedPctOfVerifiableInScopeCalls` exists to fix.

## ★ Part 1c — the gap in my delete-rule: redundancy is invisible to it

In one `graph_consequences` payload, *"inferred fields come from a stale curated
overlay, so absence is not evidence of absence"* appears **five times**:
`provenance_note`, `overlay_coverage.consequence`, `overlay_age_warning`,
`receipt.floor_cause`, and bare `overlay_age_days`. ~230 tokens, one fact.

Each instance individually **passes** "name the decision" — they all name the same
real decision. A per-field test cannot see this.

**Second question, asked after the first:** *is this the only place that says so?*
Deduplicate before deleting, or five copies of everything that survives get kept.

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

## ★ DECIDED: not configurable, not opt-in, not per-role — deleted

Steven proposed making unread fields configurable rather than deleting them
(install profile, or a per-call param). Put to both managers. **Rejected**, on a
structural argument rather than a preference:

> Contradiction-class fields cannot be opt-in **by construction** — nobody asks to
> be told they are wrong.

sc-manager supported it empirically from a single afternoon. Three things that
changed their conclusions, **all arriving unrequested**:

| | |
|---|---|
| a control FAILING | told them a `0` was an instrument mismatch, not a measurement |
| a lane REFUSING their brief | their 4-surface list would have produced 3 false "unreached" verdicts |
| a lane RETRACTING its own ratio | one they had already banked into a filed ruling |

> I would not have opted in to any of them, because in each case I did not know I
> needed them — I believed the opposite. **An opt-in contradiction channel is off
> exactly when it matters, and that is not a tuning failure, it is what opt-in
> means.**

**And a per-role profile does not escape it:** *"the role that most needs the
contradiction is the one confident enough to have picked the lean profile."*

### The role hypothesis was retracted by the person who raised it

sc-manager's caveat had two parts, and only one was a claim:
- *"I am not answering for them"* — a statement about the limit of their evidence.
  Correct, and justifies nothing.
- *"A cold-orientation lane is a different consumer"* — **a category they named,
  not an observation they made.**

> Do not build a per-role profile on my caveat. A responsibly-bounded claim is not
> evidence of a population.

### ★ My question was malformed — opt-in is only *coherent* for 3 of the 8

ef-manager: the eight DELETE candidates are not one kind of thing, and
configurability is only a meaningful option for the last group.

| category | fields | why opt-in fails |
|---|---|---|
| **WRONG** | `tests_adjacent` | opt-in is **worse than status quo**. Today it misleads unasked; behind a flag it misleads at the moment you typed *"give me test coverage for this decision"* — **maximum trust meeting maximum error.** You cannot make a false claim safe by making it harder to reach; reaching for it is itself a statement of intent to rely on it. |
| **DUPLICATE** | `overlay_age_warning`, `trust`, `receipt.floor_cause`, `nextActions` | a non-sequitur. You cannot deduplicate by making one copy optional — both still exist, and **which one is canonical becomes install-dependent.** A redundancy bug converted into a consistency bug. |
| **UNREAD-BUT-CORRECT** | `overlayQuality`, `dirtySeams`, `last_touched` | the only category where the sentence parses. Answer still no. |

So the proposal is being weighed against eight fields when it applies to three.

### ★★ The sharper mechanism, and the one to lead with

> A default field that is useless generates **complaints**. An opt-in field
> generates **silence** — and its silence is **unfalsifiable.**

This audit exists because those fields were in a user's face for weeks. That is
the feedback channel working. Behind a flag the signal goes to zero permanently,
and zero is then uninterpretable: useless, or nobody found the flag?

**And the asymmetry that decides it:** deletion is a `git revert` *with a feedback
channel* that names exactly what to restore and why. An opt-in field nobody
enables is a permanent unknown that no future evidence can resolve.

### Why the `--toolset` precedent does not carry

> `--toolset` configures WHICH TOOLS. Tools are things an agent **selects.**
> A profile would configure WHICH FIELDS. Fields are things an agent **receives.**

Configuration works at the point of selection, where the agent is already
choosing. Fields have no selection moment — by the time one is seen, the call is
made and the tokens are spent. That is why the 42→17 cut worked and an
`include:[]` param would not.

### ★★ The structural ender

If contradiction-class fields must **always** be on, and fields worth deleting
must be **gone**, then configurability can only ever operate on the leftovers. It
is structurally incapable of tuning value — it can only preserve clutter.

> A config system whose reachable set is exactly the set of things nobody should
> be reading is not a feature, it is a warehouse.

### ⚠ Their no-sighting is uneven, and they refused to average it

| lane | window | strength |
|---|---|---|
| sc-claude | ~10h dense, exactly this work, zero overlay consultation | STRONG |
| sc-manager | same window + ~187 cards of history, zero | STRONG |
| sc-coder / sc-architect | **~1 day of access** (registration landed 2026-08-09), quota-starved | **WEAK** |

The weak half is precisely the pair who would most plausibly *be* the
cold-orientation case. Delete survives it anyway, on asymmetry:

> You can rebuild a deleted field in an afternoon if a real consumer complains.
> You cannot recover the deletion pressure once it is opt-in.

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
3. ~~`documents_mentioning_note` costs 46 tokens describing an empty list~~ —
   **resolved, and I had the diagnosis backwards.**

   ef-manager: an empty list is where that note is at its **most** load-bearing,
   not its least. `documents_mentioning: []` with no note reads as *"no documents
   mention this"* — a false absence, the exact error class this product exists to
   prevent. The 46 tokens buy the difference between *"nothing mentions this"* and
   *"twelve things mention it, all below threshold."* **Opposite answers, not a
   ratio problem.**

   > You are measuring disclosure-to-DATA. The ratio that matters is
   > disclosure-to-CONSEQUENCE-OF-BEING-MISLED, and on an empty list that
   > consequence is maximal.

   The real defect is that the note is **unconditional**, not that it is long.
   Two fixes:
   - print it only when `omitted > 0`;
   - make it a **sibling key of the data**, not a parallel top-level field:
     `documents_mentioning: { items: [...], omitted: 12, reason_ref: "weak-signal-tail" }`

   That shape structurally enforces the caveat rule — the qualifier cannot be
   deleted independently of the number, and cannot print when there is nothing to
   qualify. It is the shape `co_consumer_files {items,total,truncated,limit}`
   already uses. **Apply it everywhere; the problem was solved once and not
   propagated.**
4. **Cold-orientation consumer — being MEASURED, not argued.** Authorised
   2026-08-10: ef-manager spawns a subagent with no memory file and no field-test
   context, gives it a cold orientation question on echoes, and records which
   fields it actually **reads and cites**. Read-only.

   Why it is worth running rather than settling by argument: sc-manager retracted
   the role hypothesis outright, but their no-sighting is *uneven* — the two lanes
   who would most plausibly BE the cold-orientation case have had graph access for
   about a day and were quota-starved. The hypothesis is thin AND its strongest
   disconfirmation is the weakest-windowed. One session closes that.

   **Design: runner and adjudicator are split.** ef-manager locked the falsifier
   and prediction before the run; graph-tech-lead spawns and hands over the **raw
   transcript**, not a summary. Their pre-registration protects against *their*
   bias and does nothing about the runner's — so the falsifier is fixed by someone
   who does not control the data, and the data comes from someone who cannot
   revise the falsifier.

   ⚠ **AMENDMENT, registered before any data:** the split silently bound a third
   variable — a subagent inherits its parent's MCP servers, so moving the runner
   moved **the build under test** with it. Caught when graph-tech-lead checked his
   own side: his server was on `504563e`, *staler than ef-manager's `8e09c67`*, so
   the run would have gated Sand Castle on a two-day-old build.

   > The server commit is an experimental parameter, not an environmental detail.

   **The transcript must OPEN with the cold lane's own `graph_health` server block**
   — version, commit, startedAt, staleProcess — captured as its first act. Without
   it a result gating another team's work carries no build provenance: the number
   outliving its qualifier, in experimental form, which this arc has already
   shipped three times in three mechanisms.

   ★ It doubles as a free control: whether a fresh reader reaches for the trust
   verb unprompted. ef-manager's registered prediction — **it will not**, because
   nothing in an orientation question suggests trust is in doubt, which would make
   it a finding about *discoverability* rather than value.

   **Blocked on:** one `/mcp` reconnect covering both sessions.

   Prior evidence pointing the same way, with its limit stated: in ef-manager's
   two most orientation-shaped experiments — *"what shader code must change in
   lockstep"* and *"delete ChunkDataCache.h, what breaks"* — **not one of the eight
   delete-candidates contributed to either result.** Every win came from
   `co_consumer_files`, `graph_pull relations.recompile_surface`, and the docs
   layer. He notes he had accumulated repo context in memory during both, so he is
   not a clean cold reader and cannot answer for one.

5. **Still open: does a correctly-labelled weak tier still mislead?** Holding the
   `tests_adjacent` deletion on this. His damning case (`CALLS test_main.cpp →
   vec3`) predates both the four-tier provenance split built for it and
   `companion_header_linked` — which shipped in `0b090ea`, an ancestor of the
   commit he measured. So DELETE may mean "unfixable" or "was unfixable before the
   tiers, untested since". Different answers.

   ⚠ Deleting it also permanently moots sc-manager's pending `.cpp` header-pairing
   verification — the one v0.4.0 claim never run against real C++.

   ⚠ When it does go: `tests_adjacent_basis`, `tests_adjacent_warning` and
   `tests_adjacent_provenance` go **with** it. A surviving caveat about a deleted
   number is the caveat-outlives-its-number defect running backwards.

## ★ Verdicts from usage, and the inversion they expose

ef-manager's field-by-field verdicts (deepest usage record on `graph_consequences`):

**DELETE** — `tests_adjacent` (293 tok, and **3-for-3 wrong**: it asserted
`tests/test_main.cpp` covers `cylindricalLatBandsForBody` on the basis of
`CALLS test_main.cpp -> vec3`, for a file with zero matches — false coverage on
the exact safety axis the verb exists for). Also `last_touched` (`git log
--follow` is richer and always available), `overlay_age_warning` (duplicate of
`provenance_note`), `trust` (health owns it), `nextActions`, `overlayQuality`,
`dirtySeams`, `receipt.floor_cause`.

**KEEP** — `summary` (*"if I could keep only one field in the entire API"*),
`co_consumer_files`, `matched`, `overlay_coverage`, `field_provenance`,
`provenance_note`, `server`, `receipt.disconfirming_test`.

⚠ On `tests_adjacent`: **do not replace it with a better warning.** *"Every fix so
far made it more AUDITABLE, never more ACCURATE."* If the safety axis is wanted
back it needs a real mechanism — does this test exercise this symbol — not a
wrapper.

★ Free bug fix: deleting `dirtySeams` closes the `dirtyFilesOmitted 2799 vs total
2824` inconsistency, because the five names that print come from
`dirtySeams.orphanFilesSample`. Sometimes the cheapest fix for an inconsistent
field is not having it.

### ★★ Cost and value are anti-correlated

> Your two most valuable fields cost 13 and 31 tokens. Your most expensive costs
> 293 and is the only one that has ever misled me.

`co_consumer_files` at **13 tok** surfaced four files containing zero textual
occurrences of the target — unreachable by grep at any skill level. `matched` at
**31 tok** is the only guard against "I asked about X and it answered about Y",
which after `GpuMaterial` and `WorldBuffer` is a live failure mode.

**This is why a cost-ranked cut list is the wrong instrument**, and why Part 0's
error was not merely a bad measurement but a bad method.

### Minimal `graph_consequences`: ~330 tok vs 1055

`matched` · `co_consumer_files` (+feature names as its *basis*, not a top-level
field) · `overlay_coverage` · `field_provenance` · `documents_mentioning{items,
omitted}` · `receipt.disconfirming_test`.

Two things about that list: it is **4 evidencing fields to 2 answering ones**, and
293 of the 1055 tokens currently go to the one field that has never been right.
The minimal version is not a diet — it is the current verb with its largest field
removed and its two cheapest promoted.

**Ship order (his recommendation, adopted):** invariant-prose cut and
`tests_adjacent` deletion first. Largest, least controversial, neither touches the
protected mechanism.

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
