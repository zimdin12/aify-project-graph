# Fail-open catches — adjudicated, 2026-08-21

The candidate-hazard inventory (`ec9e9c5`) found **28** `catch` blocks whose entire body returns a
success-shaped literal: 9 return `0`, 13 return `[]`, 3 `{}`, 3 `''`.

⛔ **A count is not a defect total.** Most are correct: zero really is the answer, or the empty list
really is. This page reads each of the 13 `[]` cases and says which is which, so the work can be
sequenced instead of swept.

## The axis that decides severity

> **Does the empty value assert a FACT ABOUT THE REPOSITORY, or does it merely omit a HINT?**

An empty list that means *"there is nothing there"* is a claim about the repo, manufactured by an
instrument failure — the absence-claim defect class this project has paid for repeatedly. An empty
list that means *"I have no extra detail to add"* costs the reader a hint and asserts nothing.

The two are not the same defect and must not be fixed with the same urgency.

## HIGH — the empty value asserts a fact about the repository

| site | `[]` reads to the caller as | why it matters |
|---|---|---|
| `freshness/git.js:106` | **"nothing changed"** | feeds the freshness/staleness machinery, which decides whether an indexed graph can still be believed. A trust claim, not a display one. ⚠ **DOCUMENTED AS INTENTIONAL** — "returns [] on any git failure … so callers can degrade gracefully instead of throwing". Needs a RULING, not a patch. |
| `query/verbs/find.js:35` | **"no tasks match"** | `loadTasks()` on a corrupt `tasks.json`. A search verb reporting an absence about the repository because it could not read a file. |
| ~~`query/verbs/collect_code_intel.js:106`~~ | ~~"no call edges"~~ | ⛔ **DEMOTED TO LOW — see the correction below. I was wrong.** |

⚠ `safeDirtyCount` (returns `0`, not `[]`) belongs in this tier and already has its own
preregistration at `docs/2026-08-21-prereg-safedirtycount.md`.

## MEDIUM — asserts a fact on a secondary surface

| site | `[]` reads as | note |
|---|---|---|
| `ingest/sweep.js:199` | **"this config has no keys"** | `extractConfigKeys` on malformed JSON. The Config node is created claiming zero keys and nothing records that the file was unparseable — graph content is missing and the graph cannot say why. |
| `code-intel/prewarm/cpp.js:74, 94, 151` | "no C++ files here" | affects prewarm scope; a failed enumeration is indistinguishable from an empty tree. |
| `brief/extract.js:235, 265` | "no recent commits" | carries the comment *"Not a git repo — skip section"*, so the intent is real; the reader still cannot distinguish a quiet repo from an unreadable one. |
| `query/verbs/pull.js:425` | "no commits" | same shape as the brief extractors. |

## LOW — omits a hint, asserts nothing about the repository

| site | what is lost |
|---|---|
| `query/miss-scope.js:35` | which declaration types were empty. ⚠ Carries an explicit and CORRECT justification: *"A disclosure must never turn a clean not-found into an error. Losing the empty-type detail is survivable; losing the answer is not."* The population sentence still renders. |
| `query/miss-scope.js:64` | the "you searched X, the graph also holds Y" hint. |
| `query/did-you-mean.js:155` | suggestions. Advisory by construction; their absence claims nothing. |

⇒ The LOW tier is where I would NOT spend a slice. Fixing them would add typed-unknown plumbing to
paths whose empty value is already honest, and a reviewer trained to expect noise from this
inventory stops reading it.

## ⛔ CORRECTION — I graded `collect_code_intel.js:106` HIGH and it is LOW

I wrote that its `[]` reads as **"no call edges"** and called it an ANSWER. That is wrong, and I
found it by reading the function instead of the inventory row.

The catch is inside `sampleLspEdges`, whose own header says:

> a SMALL sample (≤ cap) of created LSP_VERIFIED CALLS edges, read back from the DB after import so
> the agent sees concrete evidence the collect produced edges **without the full records[] flood.
> Best-effort: never throws.**

and it surfaces as `sampleEdges` — named as a sample, capped at 10, labelled "concrete evidence".
An empty sample says *"here are up to ten examples"*, not *"there are none"*. The AUTHORITATIVE
counts live elsewhere in the same file and already carry the right discipline:

> ⚠ NULL ON FAILURE OR EMPTY, NEVER 0. A zero denominator makes any ratio read as total coverage.

⇒ So this file had already learned the lesson where it mattered, and I mistook a deliberately
best-effort display sample for a coverage claim.

⚠ **HOW I GOT IT WRONG, because the shape repeats:** I adjudicated from the inventory's one-line
output — "returns `[]` on catch" — without reading the function's purpose or what the value is
CALLED at the boundary. That is the same error as the brief-surface false alarm earlier the same
day: reading the artifact rather than the producer's contract.

⇒ **The rule this adds:** severity is decided at the BOUNDARY, by what the value is named and
claimed to be, not at the `catch` where it originates. `sampleEdges: []` and `hits.tasks: []` are
the same syntax and different claims — and only one of them sits beside a field asserting the layer
was searched.

⇒ **Remaining HIGH is two, not three:** `freshness/git.js:106` (documented-intentional, needs a
ruling) and `query/verbs/find.js:35` (fixed — see the layers_searched slice).

## What I am NOT doing here

- **No fixes.** This is adjudication, and the inventory that produced it is report-only by ruling.
- **No claim that the HIGH tier is broken today.** Each needs the same treatment `safeDirtyCount`
  got: establish that the induction can actually reach the catch, and preregister a control that
  differs between the honest and hostile worlds, BEFORE editing.
  ⚠ That step is not ceremony. Writing `safeDirtyCount`'s preregistration is what revealed that its
  neighbour `getChangedFilesSync` swallows errors while `getDirtyFileEntriesSync` propagates them —
  had `safeDirtyCount` wrapped the swallowing one, its control could never have discriminated and
  would have "confirmed" a fix that fixed nothing.
- **No sequencing decision.** `git.js:106` is documented-intentional and changing it alters every
  caller that relies on graceful degradation. That is a ruling, not a refactor.
