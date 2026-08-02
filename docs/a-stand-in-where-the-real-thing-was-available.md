# A stand-in was used where the real thing was available

**Session of 2026-07-31 · graph-tech-lead + ef-manager · twenty instances in one session**

Attributed to the session and the date rather than to a person, deliberately. The
principle is worth something only because twenty independent instances landed within
one working day and someone happened to be counting. A name invites deference; twenty
instances invite you to check whether a twenty-first fits — and to say so if it doesn't.

## Read this first — why the list exists and why it will keep growing

> **A rule is not a remedy. However well phrased, a rule is a thing you read.**

This document establishes below that *awareness does not prevent this defect* —
instances 8 and 9 were committed by the two people writing the diagnosis, while
hunting for it, with the disconfirming number three lines away. The corollary took
another six hours to state, and it is the stronger form:

**A well-phrased rule fails the same way.** Instance 14 exists because one author
wrote a correct verification rule, and then — *one hour later* — asserted a
violation of his own rule, confidently, in prose. The rule did not stop him. What
stopped him was building the tool and running it, which put the two numbers on
adjacent lines where the contradiction was unmissable.

> **A claim you can execute gets tested. A claim you can only read gets believed.**

So the remedy is never a rule, a doc, or a resolution to be careful. It is
executable: **fail-closed defaults** and **forced doors** (see below). Everything
else — including this page — is a recognition aid for naming a defect you are
already looking at. Treating it as a safeguard would be another instance: a
document standing in for a mechanism.

*Instance 15 below is the predicted one, and it arrived ninety minutes after this
header was written — by its author, with the disconfirming measurement already in
hand. Authorship confers no immunity. If it did, the header would be wrong.*

## The shape

> Something derived, cheap, or approximate stood in for something real — while the
> real thing was available, and in the worst cases was **already being read**.

It is not a coding error and it is not carelessness. Every instance below was
written by someone who had the real thing within reach and did not reach, because
the stand-in was working.

## The first ten instances

**1. A filename match stood in for an include edge.**
A hand-verified include chain used `#include` as the pattern for hop 1 and a bare
filename grep for hop 2. A bare filename cannot distinguish an include *edge* from
a comment *mention*, so a mention was read as an edge and reported as verified. The
correct query had already been used one hop earlier.

**2. The idea of a teammate stood in for the teammate.**
A receipt-transport design was about to be built around a local
`.aify-graph/receipts/` directory. The two agents who would use it do not share a
repo, and the project has a standing rule that tester and coder work in separate
worktrees — so cross-filesystem is the *normal* case. "Teammate" was a word in the
designer's head rather than a constraint in the design, while an actual teammate was
in the conversation and could have been asked.

**3. A curated field stood in for the `MENTIONS` edge.**
`graph_consequences` selected contracts purely from `feature.contracts`, a curated
overlay field, and missed the contract naming the target file 22 times. `graph_pull`
found it immediately, from the same database, in the same minute. The edge was in
the schema and unqueried.

**4. An age stood in for an identity.**
`overlay_age_days` — a clock reading, `now - mtime` — sat in a pin set of content
hashes as an invalidation condition. It false-drifts daily, false-drifts on a
byte-identical regeneration, and can *false-match* when a rewritten overlay is
replayed at the moment its computed age equals the stored number. The overlay file
content was already being read to compute the age.

**5. A bare array stood in for a counted list.**
`co_consumer_files` broke out of its loop at 10 and returned a bare array — the only
list in the response with no `total`, `truncated`, or `limit` while every neighbour
had all three. The loop held every element before discarding the count. On one file
this reported 10 of 43 as though complete.

**6. A percentage stood in for coverage.**
`lspVerifiedPctOfCalls` divided by *every* `CALLS` edge, including 1458 GLSL and 1242
Python edges that clangd cannot verify in principle. 17% of the denominator was
unverifiable by construction, so the number could never reach 100 and its movement
was uninterpretable. The verifiable subset was one `GROUP BY` away.

**7. A path prefix stood in for project membership.**
Fixing instance 6 required a notion of "is this file part of the project", and the
obvious test was a path prefix — `engine/|game/|tests/`. On this repo that would
have silently excluded `tools/mcp/*.cpp` and `tools/*.py`: 1433 edges of real
first-party code, dropped while looking entirely reasonable in review. Git tracking
is the actual signal, needs no maintenance as directories are added, and excludes
vendored trees by construction. *This one was caught before it shipped, inside the
fix for instance 6.*

**8. A `head -20` stood in for the population — with the total in the same output.**
An attack was written claiming all 379 Python files in a repo were vendored. The
command was `find . -name "*.py" ... | head -20`, and `find` traverses
dot-directories first, so all 20 visible results were vendored while the 359
first-party scripts were never seen. `(total: 379)` was printed on the next line.
The stand-in and the real thing were **three lines apart**, and the claim was
written by the person who had, two messages earlier, diagnosed exactly this defect
in someone else's code.

**9. A 500-item sample stood in for 4853 unresolved edges.**
The fix for instance 10 — publishing the filter rule behind `trust` — was first
computed over `manifest.dirtyEdges`, which is a capped sample. It reported
"trust_relevant: 0 of 500" against a true 402 of 4853: a *published rule computed
over a hidden subset*, inside the field built to expose hidden subsets. The full set
was on disk the entire time. Caught only because the printed total disagreed with a
number three lines above it.

**10. A filtered count stood in for a rule.**
`trust` was computed over 402 of 4853 unresolved edges, with the filter unpublished.
The filter is defensible; an invisible one is indistinguishable from a hidden
population. Same shape as instance 6, on the field that gates whether an agent
believes anything else.

## The second wave — ten more, three of which cost real data

**11. Recency stood in for authority, and destroyed 8530 records.**
`pruneOldCollections` kept the newest collection row per provider by `collected_at`
alone. A converged collect that walked **zero files** correctly announced "authority
over nothing" — and that guard worked, preserving every edge, node, and spine entry
byte-identical. But it was implemented as *do not invalidate*, and the run still
**authored a collection row**. That empty row won on recency and pruned a real
8530-record collection out from under it, on a live repo. The real signal — does
this collection contain anything — was one `COUNT(*)` away.

★ This is the most instructive instance in the document because **neither half is
wrong alone.** "Do not invalidate" was correct. "Keep the newest" was correct. The
*composition* destroys data, which means the review that catches it has to be
reading two files at once. Every other instance here is visible from one screen.

**12. A legitimate zero stood in for a missing value.**
Binding a caveat to its number required detecting that the qualifier was gone. The
obvious check — `positionGuessSkipped == null` — never fires, because a wiped
collection row returns **0**. "0 symbols skipped because nothing was asked" is
byte-identical to "0 symbols skipped because nothing was skipped." The subtlest
instance here: the stand-in is a *valid value*, not an absent one, so there is no
missing field to detect. The only signal that a plausible zero cannot forge is the
**contradiction between two sources** — 1507 verified edges existing while the
session that produced them reports examining zero symbols.

**13. An instruction about custody stood in for custody.**
On learning that a teammate's backup was the sole copy of an irreplaceable dataset,
the response was "please don't move or re-use that directory." The behaviour was
secured; the substrate was never examined. The directory was in
`AppData\Local\Temp` — cleanable, session-scoped, one cleanup away from gone, while
both parties were being careful about it.

**15. An instruction stood in for the condition it depends on — and this one
authorised a write.**
The predicted instance, and it arrived within ninety minutes of the header above
being written. The sequence matters more than the error:

1. A third party agreed to restart an agent.
2. The author **measured** the target's `-shm` file, found it present, and wrote —
   to that third party, in the same message — that the state was ambiguous and he
   would not guess at it.
3. The third party said **"Done."**
4. The author sent the agent: *"That restart IS the server-down window. Run the
   restore as your first action."*

The agent had **not** been restarted; its session was continuous. `"Done"` was a
narrative; `-shm` present was the measurement; the author had the measurement in
hand, had written down that he would not guess, and preferred the narrative
anyway.

The instruction was *correct for the session it was written for* and arrived at
one where its premise was false. Unlike every other instance here, the action it
authorised was a **write to a live SQLite file** — so the failure mode is
corruption, not a misleading number. It was caught only because the receiving
agent's script carried the condition as an executable refusal.

> **A conditional instruction must carry its condition as an executable
> precondition.**
> *"Run this after the restart"* is read. *"Refuse unless `-shm` is absent"* is run.

**16. A proxy for liveness stood in for a lock test.**
Two agents spent an evening waiting for a "server-down window" to restore a
database, inferring from the presence of SQLite's `-shm` file that a process held
it. One exclusive-open attempt showed nothing held it — the window had been open
the whole time, and the `-shm` was a leftover from *their own read-only
verification*. Confirming this reproduces it: a read-only connect recreates `-shm`
within seconds. **`-shm` presence is a byproduct of observation, never a signal
about occupancy.**

> **Fail-closed is a correct default *and a prompt to go measure* — not a resting
> state.** Refusing to act under an unknown is right, and it is why nothing was
> lost. The defect is not converting the unknown into a known when it costs one
> command. Without this half, "forced doors" reads as *refuse and wait*.

**17. `?? 0` manufactured the very zero the comment above it warned about.**
The only instance here that names a *code construct* rather than a reasoning
failure — which makes it the only one enforceable by a lint rule instead of a
habit.

The contradiction check written to defeat instance 12 read
`(codeIntel.refsFoundSymbols ?? 0) + (codeIntel.refsNotFoundSymbols ?? 0)`. Those
fields live at `codeIntel.operations._session.*` and are `undefined` on that
object, so the expression yields `0` and the branch fired on *every* populated
collect. The comment three lines above it explains the legitimate-zero trap in
detail.

> **`?? 0` applied to a field you are about to test for zero destroys the
> distinction you are testing.**

Here *absent* and *zero* mean opposite things — absent is "I could not look", zero
is "I looked and found none" — and `?? 0` collapses them while looking like
defensive coding. It is "unknown is not untruncated" expressed as a language
operator rather than a data-flow rule.

**18. The lint written from instance 17 could not catch instance 17.**
The check was specified as *"a default feeding a later equality test on the same
variable"* and returned **1 candidate out of 92 uses** — a small number that read
as *risk contained*, and ended the inquiry.

But the motivating bug defaults two operands, **sums them**, and tests the *sum*:

```js
const sessionExamined = (a ?? 0) + (b ?? 0);
… || (verified > 0 && sessionExamined === 0);
```

The defaults never touch an equality test. They are **arithmetic-mediated**, and
the criterion walked straight past the one case known to have bitten. Re-run
allowing an intervening arithmetic expression: **156 files, 173 default uses, 15
candidates — 6 of them arithmetic-mediated**, including the descendant of the
original bug.

> **The first test of any new check should be the bug that inspired it.** If it
> does not fire there, the check is measuring something else.

*The conclusion survived and the basis did not.* All 15 were inspected: six are the
idiomatic sort comparator `(b.confidence ?? 0) - (a.confidence ?? 0)` where
treating a missing confidence as 0 **is** the intent; `compile-db.js:963` defaults
toward refusing exhaustiveness; the rest are presence tests where 0 and absent
genuinely coincide. So "risk contained" was right — but reached by a search that
could not find what it was searching for, which is a coincidence rather than
evidence, and would not have survived the file growing.

⚠ **`health.js:765` is a true positive for the pattern and a false positive for the
risk.** It still reads `(refsFound ?? 0) + (refsNotFound ?? 0)`, but a separate
`sessionPresent` variable now carries the absent/zero distinction explicitly rather
than hoping the default preserved it. That is the correct repair shape — restore
the distinction in a variable, don't rely on the default. **Do not "fix" it on a
future re-run.**

**19. A description of coverage stood in for coverage — three times, always in the
same direction.**
Three scope claims, each one hop wider than its evidence: *"verifies persistence"*
when the test seeded the collection row directly; *"instrumented, awaiting data"*
when nothing had walked a file; *"92 uses, 1 candidate, contained"* when the
criterion could not see its own motivating bug. The third hop in the first case
contained a live bug — `refs_degraded` read the session counter and nothing else,
so a collection whose records carried `cause` summarised as `null`.

**Every overclaim ran toward *covered*, never *uncovered*.** A random
miscalibration goes both ways; a one-directional one is a bias with a mechanism.
The likely mechanism: *a scope statement is written at the moment of finishing,
when the thing you just built is vivid and the thing you did not build is
invisible.*

> **State scope by naming the hops and marking each one proven or on-report.**
> Enumerate the chain, and the gap appears as a link with no test — rather than as
> a sentence you have to doubt.

That reformulation is what surfaced the bug: writing
`records → importer → row → reader → surfacing` immediately exposed one link with
nothing behind it. "Be more careful" would not have.

*The paired error is worth recording because it is the same failure aimed
elsewhere.* The other author's systematic bias ran the opposite way — stating
**mechanisms** more confidently than measured (transitive-include, query-position,
the single-cause `-shm` story), each retracted within a message. One overstates
coverage, the other overstates explanation; both are a failure to distinguish what
was *checked* from what was *assumed*.

**And prefer a control to a prediction — within a boundary.** The prediction
contract for this fix (*"after a restart, expect {833, 833, 0}; null is the
finding"*) would have caught the bug — eventually, behind a restart nobody could
perform. The control caught it immediately. *A prediction tells you something is
wrong once you can finally run it; a control tells you now.*

> ⚠ **The boundary, because the rule above over-applies without it.** A control
> tests **the plumbing you built**; a prediction tests **reality**. They are not
> substitutes.
>
> **Prefer a control when every input is one you can author.** Seeding a record
> with `cause="definition_only"` tests your *handling* of that value — it cannot
> test whether the language server's silence on that symbol genuinely means
> definition-only. That is a claim about the world, and only a real run settles it.
>
> When the claim is external, a prediction is not a weaker control — it is the only
> instrument. The rule is not *"controls beat predictions"*; it is **"a prediction
> is what you use when you have run out of controls, and most people reach for it
> long before that point."**

The narrower lesson underneath: this session spent hours waiting on a restart for
checks that never needed one — twice. The lock test and the seeded control both ran
without the thing being waited for.

> **The first question about any blocked verification is whether it is actually
> blocked.**

**20. An anecdote stood in for a test — inside the file about untested claims.**
Caught by the project owner, not by either author. The second-agent document stated
*"auditing improves correctness, not prioritisation"* as a rule, in a blockquote,
twice. Evidence: **one** observation — a list of unread fields sat for two days,
then a third party changed the goal, then it got done.

It fails its own document's standard three ways: n=1; the alternative explanation
(those two days were spent on a live data-loss incident, which outranked a token
cleanup on any sensible ordering) was never considered; and most damningly, **the
two agents never audited each other's priorities at all.** Every exchange audited
*claims*. So the rule was inferred from the absence of an outcome nobody attempted.

Both authors had spent three days documenting exactly this, and both signed off on
it. It survived because it was *phrased as a conclusion* — the same property that
let *"instrumented, awaiting data"* survive for weeks.

## Two rules about method, both learned the hard way

**"The ritual felt like rigor."**
Two people pre-registered falsifiable ranges in opposite directions, used raw
integers to avoid rounding, partitioned rather than gapped, and agreed a both-wrong
outcome in advance — on a metric that could never have discriminated the
hypotheses. The base rate dominated it, and underneath that the data had already
lost the field that made it interpretable. **Pre-registration disciplines the
answer and does nothing about whether the metric has power.** Doing the first well
makes the second feel handled. Before registering any proportion, compute it over
the whole population first; if they are close, register a *rate*, not a share.

**"The arithmetic felt like proof."**
Two discrepancies appeared together in a backup verification. One party explained
them separately and stopped; the other reconciled both to a single cause that
closed *to the byte*. The single-cause reconciliation was the better method — and
it was still wrong, because the quantity was not stable: SQLite `-shm`/`-wal` files
appear and vanish with connections, and the act of verifying moved the thing being
measured.

> **Closure is only evidence if the measurand is stable. Measure twice.**

Note the inverted failure mode: closing to the byte is what made it feel decisive.
A sloppy reconciliation would have prompted a harder look. **Precision was the
thing that stopped the inquiry.**

**14. And then a stable measurement stood in for a diagnostic one.**
The fix for the above was stated as "verify by content *plus the main file's
size*", since `graph.sqlite` was byte-identical across every copy and therefore
stable. It is stable. It is also **not diagnostic**: SQLite does not reclaim pages
on `DELETE` — they go on the free list and the file never shrinks. Measured, the
intact 8530-record database and the catastrophically wiped 0-record one are
**both exactly 26,468,352 bytes.**

> **Stable and diagnostic are different properties.** Stability makes a
> measurement trustworthy *as a measurement*; it says nothing about whether it can
> distinguish the states you care about. A number that reads identically in the
> healthy case and the disaster is worse than no number, because its stability is
> what makes it reassuring.

Corrected rule, and it is now content-only: `PRAGMA integrity_check` + record count
+ a known row. Nothing else verifies a SQLite set.

Worth recording *how* it surfaced: not by thinking harder, but by **building the
restore script and dry-running it.** The dry run printed both sizes on adjacent
lines and the equality was unmissable. The wrong rule had been asserted
confidently in prose one hour after the "arithmetic felt like proof" lesson, and
prose did not catch it. Constructing the artifact did.

## Why it generates bugs rather than being one

Instances 3–10 share a second property that makes them self-perpetuating:
**the failure defaults toward the reassuring answer.**

`exhaustive` was computed by AND-ing conditions, so a *missing* truncation flag
evaluated falsy, read as "not truncated", and was permissive. A dropped flag
therefore produced a *false* claim rather than a conservative one. That is a
generator: it emits new instances faster than they can be fixed individually, which
is exactly the observed rate.

The structural fix is to flip the default so the stand-in fails closed:

- **Unknown is not untruncated.** A field whose truncation state is absent forces
  `exhaustive: false`, naming the field.
- **Unknown is not clean.** A worktree whose dirty state could not be read is not a
  clean worktree.
- **An edge nobody could have verified is not an edge that failed verification.**
- **A pin must be an identity, never a measurement.**

## The corollary about reporting

Instance 5 carries a lesson the others don't, and it is the reason this document
exists rather than a commit message.

The finding that `co_consumer_files` produced — four dependents with zero textual
mention of the target, unreachable by grep at any skill — was **correct**. The list
was not truncated in that case; 10 was the true count.

But at the time it was reported, the old code emitted **a bare array of 10 in both
the complete case and the truncated case**. They were byte-identical in output. So
the result was reported as established evidence when the output could not have
justified that status, and it was confirmed only two days later by a mechanism that
did not exist when the claim was made.

The result survived by **coincidence, not by evidence.**

Recording it as an unqualified win would teach that the reporting was sound. It
wasn't; it was lucky. The finding survives either framing, so recording it honestly
costs nothing — and it preserves the distinction between *a claim that was right*
and *a claim that was justified*, which is the distinction this entire codebase
exists to make legible.

## The wrong finding that was worth keeping

One of the ten attacks that produced this list was **factually wrong on every
claim it made**. It asserted that a repo's Python edges came from vendored code
inside a gitignored worktree, that the indexer was reading through `.gitignore`,
and that a pending backend would import bogus coverage debt. Measured: zero nodes
from those paths, the indexer honours `.gitignore`, and the files were first-party.

It is in the record deliberately, and it produced more than most of the
confirmations did:

- It closed a **real latent defect** — scope and verifiability were conflated, and
  on a repo where vendored trees *do* leak, the fix for instance 6 would have
  silently imported their coverage debt the day a backend landed.
- It produced **instance 7**, which was caught before shipping.
- It is the only entry where the separation between **finding** and **diagnosis**
  is visible. Everywhere else they arrived together, so the distinction is
  invisible — and that distinction is the transferable skill.

The load-bearing reason to record it, in the words of the agent who got it wrong:

> A hit-rate-only record creates an incentive to attack only where you are already
> confident — which is precisely where latent defects are not. If the record
> rewards being right, the rational strategy is to stop probing the things you
> cannot see into, and those are the only things worth probing.

Instances 8 and 9 above are also self-inflicted: 8 was committed by the person
writing the attacks, while writing them; 9 was committed inside the remedy for 10.
That is not incidental to the document. **Its own examples section contains
instances of its own principle, committed by both authors, while documenting it.**
A reader who doubts that the principle generalizes has to explain that away.

## ★ Why this document is not the remedy

The natural conclusion from ten instances is *be more careful*. This session is
direct evidence that being more careful does not work.

Instances 8 and 9 were committed by the two people who had just spent hours writing
this diagnosis, while actively hunting for instances of it, **with the
disconfirming number visible in the same output** — `(total: 379)` three lines
below one; `4853` three lines above the other. Both were inside the code
implementing the remedy. Both failed anyway.

That is not evidence about how *often* the defect occurs. It is evidence about
**detectability**: it survives the strongest priming its authors will ever have.
Two people, maximally primed, three lines from the answer, both wrong.

So this document is a **recognition aid, not a control**. It is valuable after the
fact — for naming a defect you are already looking at, and for deciding whether a
new one is the same shape. It is close to worthless before the fact, and treating
it as a safeguard would be the eleventh instance: a document standing in for a
mechanism.

The only things that actually prevented instances today were structural, and they
share one property — **they work whether or not anyone is paying attention**, which
is now demonstrably the binding constraint:

- **Fail-closed defaults.** Unknown is not untruncated; unknown is not clean;
  unreadable git is scope-unknown, not scope-everything. A dropped flag produces a
  conservative claim instead of a false one.
- **Forced doors.** `openReceiptBody(head, body)` is the only way to read claims,
  so the integrity check cannot be skipped. A `{items, truncated}` pair must cross
  the boundary together, so half of it cannot be dropped en route.

A verification step you have to *remember* is one that gets skipped — including by
the person who wrote it, on the day they wrote it. Prefer the default and the door.
Fix the generator, not the instances.

## How to use this

When you are about to derive, approximate, summarize, or cache — ask what the real
thing is and whether you already have it. If you have it, the stand-in needs a
reason beyond "it was working."

But do not stop there, because the section above says that asking is not reliable.
When you find an instance, the fix is not to correct it and move on — it is to ask
**what default or missing door let it be written in the first place**, and change
that instead. Ten instances in one day is not ten mistakes; it is a small number of
permissive defaults, each emitting instances faster than anyone can catch them.
