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

⛔ **THIS PARAGRAPH WAS WRONG AND IS SUPERSEDED BY THE MEASUREMENT BELOW.** It read: adding the
signature to the canonical key "would also change grouping for **every** symbol in the graph".
Measured, it would change **5 of 3,842 groups (0.13%)** — I asserted a blast radius instead of
measuring one, in a document about unearned claims. The conclusion (do not ship it) survives, but
for a DIFFERENT and better reason: signature-in-key re-forks decl/def. Left visible rather than
deleted.

⚠ Nothing here says overload collapse is common in real code, or that it has ever misled an agent.
One fixture, built to be hostile. What it establishes is that the stop condition is not met.

## The cheaper fix was explored and DOES NOT WORK — measured, not assumed

I first recorded "needs a design decision" as a judgement. Then I looked for a smaller, reversible
fix and measured whether it holds. It does not, and the reason is specific.

**Blast radius, measured first** (the plan set this precedent at "11 newly-ambiguous labels"):
**5 of 3,842 canonical groups (0.13%)** contain members with differing signatures, and 4 of the 5
are test/fixture symbols. Positive control: 2,244 rows carry a signature, so the scan was not blind.
Small enough to be safe — but the measured benefit *on this repo* is near zero, and 0.13% in a Node
repo is **not** evidence that overloads are rare in the C++ the tool targets. Different noun.

**The attractive fix: add the signature to the canonical key.** Overloads differ by signature, so
they would split; decl/def would survive if they shared one. Measured on `identity-callers`:

```
def   src/widgets.cpp:4   signature="Widget::render()"   ← carries the written qualifier
decl  src/widgets.h:8     signature="render()"           ← bare
```

⛔ **They do NOT share a signature.** Adding it to the key would re-fork decl/def, undoing `6372aae`.

**The refinement — key on the parameter list only** (`()` vs `()` matches; `(int value)` vs
`(double value)` differs) — is fragile for a C++-specific reason: parameter NAMES may legitimately
differ between declaration and definition (`int clamp(int value);` vs `int clamp(int v) {...}`),
which forks decl/def again. Matching parameter TYPES would be correct, and that is parsing, not
string comparison.

⇒ **Still open, now for a measured reason.** The next attempt does not need to rediscover that
signature-in-key breaks decl/def, or that parameter-name divergence defeats the text-based
shortcut. What it needs is a type-level parameter identity, or a different authority for
equivalence — which is what step C ("proven equivalence + linkage") was always for.
