# A stand-in was used where the real thing was available

**Session of 2026-07-31 · graph-tech-lead + ef-manager · fourteen instances in one day**

Attributed to the session and the date rather than to a person, deliberately. The
principle is worth something only because fourteen independent instances landed within
one working day and someone happened to be counting. A name invites deference; fourteen
instances invite you to check whether a fifteenth fits — and to say so if it doesn't.

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
already looking at. Treating it as a safeguard would be the fifteenth instance: a
document standing in for a mechanism.

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

## The second wave — three that cost real data

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
