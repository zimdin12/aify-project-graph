# M1b is NOT met: overloads collapse. My "M1 complete" claim was an overclaim.

## What I claimed, and what is actually true

I reported **"M1 complete on both arms"** after closing the C++ caller-set arm. That was right about
the loop's M1 condition and **wrong about the plan's M1b**, which is stricter:

> **M1b — Stop when:** a hostile fixture proves overloads do **NOT collapse** *and* decl/def pairs do
> **NOT fork**.
> ⚠ My original acceptance test was too weak: a same-name-different-symbol fixture passes while a
> renderer still collapses overloads and forks decl/def.

I closed the decl/def half (`6372aae`) using a same-name-**different-namespace** fixture — **exactly
the test the plan warns is too weak** — and drew exactly the conclusion it cautions against.

## Measured on the hostile fixture

`tests/fixtures/identity-hostile` exists for this, with ground truth stating
*"alpha::clamp(int) vs alpha::clamp(double) must NOT merge"*.

| query | result | ground truth | verdict |
|---|---|---|---|
| `render` | REFUSED_AMBIGUOUS, 2 candidates (alpha, beta) | must not merge | ✅ |
| `alpha::Widget::render` | NO_CALLERS — one identity | decl/def must not fork | ✅ |
| **`clamp`** | **NO_CALLERS, 0 candidates** | `clamp(int)` ≠ `clamp(double)` | ❌ **COLLAPSED** |
| `alpha::clamp` | NO_CALLERS, 0 candidates | — | ❌ |

Two distinct overloads produce **no ambiguity signal at all**. An agent asking about `clamp` is
answered as though one symbol exists.

## Cause, and it is NOT my change — measured, not cited

`canonicalSymbolKey` groups by **qname**, and overloads share a qname: the signature is not part of
it. So the two `clamp` rows key identically no matter what the module-prefix rule does.

Bisected against the same fixture, both arms:

```
PRE  (b5a7138, before the decl/def fix)   clamp -> NO_CALLERS  candidates=0
POST (current HEAD)                       clamp -> NO_CALLERS  candidates=0
```

Identical. The plan already recorded it (*"clamp (two overloads) fires none"*), but a document is
not evidence about current code, so it was re-measured.

## What this means for the milestone

- **M1a's caller-set condition: MET.** Same-name-different-symbol sets are disjoint in JS and C++.
- **M1b's condition: HALF MET.** decl/def do not fork; **overloads still collapse.**
- ⇒ **"M1 complete" is withdrawn.** The correct statement is: M1a is closed; M1b is open on the
  overload half.

## Not fixed here, and why

Adding the signature to the canonical key would separate overloads — and would also change grouping
for **every** symbol in the graph, which is the blast radius the plan measured at "11 newly-ambiguous
labels repo-wide" for a much smaller change. That is a design decision with a migration, not a
reversible default, and the reviewer is unavailable. Recorded as the open half rather than
half-attempted.

⚠ Nothing here says overload collapse is common in real code, or that it has ever misled an agent.
One fixture, built to be hostile. What it establishes is that the stop condition is not met.
