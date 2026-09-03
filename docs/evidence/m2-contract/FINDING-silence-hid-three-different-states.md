# The relevance gate had four silent returns meaning three different things

**Date:** 2026-09-03
**Probes:** `scripts/probe-relevance-scan-cost.mjs`
**Status:** DEFECT CONFIRMED by reading, cost MEASURED with controls.
**Age:** hours — shipped earlier the same day.

## The defect

`uncommittedMentionClause` returned `''` on four paths:

| path | what it means | is silence honest? |
|---|---|---|
| `files.length === 0` | nothing uncommitted | ✅ yes |
| `files.length > RELEVANCE_SCAN_CAP` | **we did not look** | ⛔ no |
| `catch { return '' }` on a read error | **we could not look** | ⛔ no |
| `hits.length === 0` | looked, found nothing | ✅ yes |

Two of them are *the check did not happen* wearing the costume of *the check found nothing*. And the
cap case fires precisely when the working tree is dirtiest — exactly when an agent is most likely to
be holding the uncommitted caller the clause exists to name. **The disclosure disabled itself in its
own motivating scenario.**

⛔ **The identical lesson is written three functions above, in this same file**, on
`uncommittedSourceClause`:

> null IS A MEASUREMENT THAT FAILED, AND IT USED TO READ AS SILENCE. A mutant that made an
> unobserved tree report `[]` instead of `null` SURVIVED ... because both produced the same empty
> string — the distinction the producer works to preserve died one function later.

I wrote the new function hours after reading that comment and reproduced it. Second instance in one
file, one day.

⚠ **The read-error path had a second bug inside it:** `return ''` abandoned the WHOLE scan on one
unreadable file, discarding the other files' results rather than skipping the bad one.

## The cost measurement that decided the remedy

There were two ways out and they trade against each other: emit a "not checked" note (which on a busy
repo fires on every result and rebuilds the warning wall), or raise the cap until exceeding it is
genuinely exceptional. Only a cost number chooses.

Measured on 891 real source files, **largest-first so the estimate is pessimistic**, timer and zero
controls passing in the same pass:

| N files | wall | per file |
|---|---|---|
| 25 | 5.6 ms | 0.223 ms |
| 50 | 8.7 ms | 0.174 ms |
| 100 | 13.2 ms | 0.132 ms |
| **200** | **21.4 ms** | 0.107 ms |
| 400 | 37.2 ms | 0.093 ms |

Preregistered rule: *under 50 ms at 200 files ⇒ the cap at 25 is not justified by cost.* It is 21.4 ms.

⇒ **The cap was chosen by intuition and cost 20x more in coverage than it saved in time.** Raised to
200, where exceeding it is exceptional, so the note that now fires there is rare enough to mean
something.

## Ceiling

One repo, one platform, warm OS file cache. A cold cache or a network filesystem would be slower and
is not measured here. The per-file cost falls with N because the largest files come first.
