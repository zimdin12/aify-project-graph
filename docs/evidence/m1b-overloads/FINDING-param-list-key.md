# FINDING — M1b's overload half CLOSES. The approach the earlier document rejected works.

Preregistered at `PREREGISTRATION-param-list-key.md`, 2026-09-02. Every disposition, control and
threshold below was fixed before the product changed.

## The defect, restated from the artifact

`graph_callers clamp` on `tests/fixtures/identity-hostile` returned **NO CALLERS with zero
candidates**. Two distinct overloads — `alpha::clamp(int)` and `alpha::clamp(double)`, which the
fixture's ground truth says *"must NOT merge"* — were answered as though one symbol existed.

That is the worst shape in the M1 defect class: not a refusal an agent can act on, but a **false
SPECIFIC answer it cannot tell from a true one**.

## What the earlier FINDING got wrong

`FINDING.md` closed this option with *"they do NOT share a signature… adding it to the key would
re-fork decl/def"*. True of the WHOLE signature, and I generalised it to the parameter list without
measuring. Re-measured on the fixture, indexed fresh:

```
clamp   Function  src/shapes.cpp:14  qname="src.shapes.alpha.clamp"         signature="clamp(int value)"
clamp   Function  src/shapes.cpp:15  qname="src.shapes.alpha.clamp"         signature="clamp(double value)"
render  Method    src/shapes.cpp:6   qname="alpha.Widget.render"            signature="Widget::render()"
render  Method    src/shapes.h:7     qname="src.shapes.alpha.Widget.render" signature="render()"
```

The decl/def divergence is **entirely in the qualifier prefix**, before the parenthesis. The
parameter list is `()` on both sides. So the part that identifies an overload is exactly the part
that does not carry the divergence — and the earlier document had the evidence for this on the page
(it printed both signatures) without reading it that way.

## Result — all preregistered controls, same pass

```
PRIMARY (this repo's graph, 6,566 rows / 6,272 groups)
  rows with a parenthesised signature: 2,254        POSITIVE ON THE ZERO -> PASS
  groups that fragment: 3 of 6,272 (0.048%)         threshold was 1%     -> under

CONTROL identity-hostile   clamp splits into 2      MECHANISM            -> PASS
CONTROL identity-callers   decl/def stays ONE group REGRESSION           -> PASS
```

Every one of the three fragmenting groups was inspected individually, because the abandon rule fires
on a **single** wrong split:

| group | members | verdict |
|---|---|---|
| `alpha.clamp` | `clamp(int value)` / `clamp(double value)` | SPLIT_CORRECT — the target |
| `…absence-names…test.get` | `(sql, params)` / `()` | SPLIT_CORRECT — two different mock objects |
| `…structural-coverage…test.get` | `(sql, params)` / `()` | SPLIT_CORRECT — same shape |

**Zero wrong splits. The abandon rule did not fire.**

## ⭐ The measurement changed the design, which is the reason to run it before shipping

A **fourth** group fragmented on the first pass and it was the useful one:
`writeDb` 3 → 2, because our extractor records a signature for `function writeDb(rel, entries)` and
an **empty** one for `const writeDb = (rel, entries) => {…}`. Those three were distinct symbols so
the outcome was harmless — but the *cause* was arbitrary, and the same asymmetry across a C++
decl/def pair would fork one real symbol and undo `6372aae`.

⇒ `paramListSubKeys` now treats a missing signature as **no information about the group** rather
than as a distinct value: a group subdivides only when EVERY member states its parameters. The
fourth split disappeared and the three real ones remained. The hazard is unconstructible instead of
being a caveat someone has to remember.

## ⛔ Splitting was only half the bar, and the first working version failed the other half

With the split in and the display untouched, `clamp` refused with two candidates that rendered
**identically**:

```
- src::shapes::alpha::clamp src/shapes.cpp:14
- src::shapes::alpha::clamp src/shapes.cpp:15
```

…under the standing hint *"add more namespace qualification"* — advice **no C++ program can
follow** for an overload set. `alpha::clamp` refused too. M1's condition is explicitly that the
refusal must not be a **DEAD END**, so passing the group count would have met the letter of the
stop condition while missing its point. Fixed: the parameter types appear in the candidate list,
and an overload set gets its own hint pointing at `file=` and `code_intel_references`.

## Mutants — 12 run, 11 killed, 1 informative survivor

Helper (9): names-not-stripped, builtin guard, whole-signature, absence-yields-a-value, naive comma
split, default arguments, partial-coverage guard, agreement check — all KILLED.
**M-9 SURVIVED and was correct to**: a `length < 2` guard is subsumed by the agreement check, since
a one-member group yields a one-element set. A guard that cannot fail is decoration; it was deleted,
not kept.

Consumer (3): subdivision disabled, discriminator dropped from the display, overload hint removed —
all KILLED. These exist because a mutant deleting `structural_coverage` from `graph_consequences`
survived earlier in this arc: testing a helper proves nothing about the verb meant to call it.

## Claim ceiling — what this does NOT establish

- **One fixture, three files, one compiler.** It shows the mechanism works. It says nothing about
  how often overloads are merged in real C++.
- **The primary population is a JavaScript repo.** 0.048% here is not a prediction for a C++
  codebase, where overloads are common. The blast radius there is UNMEASURED.
- **Not covered:** templates, default arguments beyond the text-stripping rule, `const`/ref-qualified
  overloads, and overloads differing only by return type (which is not legal C++ anyway).
- **`unsigned int` and friends** are handled by a closed set of builtin type words. A type whose
  final word is an identifier we do not recognise as builtin and that is written unnamed in one
  place and named in another would still normalize differently. No instance was observed; none was
  looked for beyond the two fixtures.
- ⚠ The `clamp` **declarations** at `src/shapes.h:15,16` produce no graph nodes at all. That is a
  separate extractor-coverage question, unexplained, and it means this fixture never exercised a
  free-function decl/def pair. The method pair in `identity-callers` is what carries the regression
  control.

## Milestone state

**M1b's overload half CLOSES.** With the decl/def half already closed at `6372aae`, the plan's M1b
stop condition — *a hostile fixture proves overloads do NOT collapse and decl/def do NOT fork* — is
met on this fixture, with both halves asserted in the same test file so neither can be traded for
the other.
