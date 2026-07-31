# A stand-in was used where the real thing was available

**Session of 2026-07-31 · graph-tech-lead + ef-manager · six instances in one day**

Attributed to the session and the date rather than to a person, deliberately. The
principle is worth something only because six independent instances landed within
one working day and someone happened to be counting. A name invites deference; six
instances invite you to check whether a seventh fits — and to say so if it doesn't.

## The shape

> Something derived, cheap, or approximate stood in for something real — while the
> real thing was available, and in the worst cases was **already being read**.

It is not a coding error and it is not carelessness. Every instance below was
written by someone who had the real thing within reach and did not reach, because
the stand-in was working.

## The six instances

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

## Why it generates bugs rather than being one

Instances 3–6 share a second property that makes them self-perpetuating:
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

Instance 5 carries a lesson the other five don't, and it is the reason this document
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

## How to use this

When you are about to derive, approximate, summarize, or cache — ask what the real
thing is and whether you already have it. If you have it, the stand-in needs a
reason beyond "it was working."
