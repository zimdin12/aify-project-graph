# PREREGISTRATION — can a normalized PARAMETER LIST split overloads without re-forking decl/def?

Written **before** any product change, 2026-09-02. M1b's open half: two `alpha::clamp` overloads are
answered as one symbol (`NO_CALLERS`, 0 candidates) because `canonicalSymbolKey` groups by qname and
the signature is not in it.

## What the previous FINDING got wrong, corrected by measurement

`docs/evidence/m1b-overloads/FINDING.md` rejected signature-in-key because decl and def do **not**
share a signature. Re-measured on `tests/fixtures/identity-hostile` (indexed fresh, 6 rows):

```
clamp   Function  src/shapes.cpp:14  qname="src.shapes.alpha.clamp"        signature="clamp(int value)"
clamp   Function  src/shapes.cpp:15  qname="src.shapes.alpha.clamp"        signature="clamp(double value)"
render  Method    src/shapes.cpp:6   qname="alpha.Widget.render"           signature="Widget::render()"
render  Method    src/shapes.h:7     qname="src.shapes.alpha.Widget.render" signature="render()"
```

Two things the earlier document did not record:

1. **The overloads DO carry distinguishing signatures.** The material to split them is already in
   the graph; nothing needs to be collected.
2. **The decl/def divergence is confined to the QUALIFIER PREFIX** (`Widget::render` vs `render`).
   The parenthesised parameter list is `()` on both sides. A key built from the parameter list
   alone is therefore immune to the divergence that killed the whole-signature idea.

⚠ Also observed and NOT yet explained: the `clamp` **declarations** at `src/shapes.h:15,16` produced
no nodes at all — only the definitions were extracted. That is a separate coverage question, out of
scope here; it is recorded because it means this fixture does not exercise a free-function decl/def
pair, so the fixture alone cannot clear the regression risk. The C++ method fixture must.

## Population

- **Primary:** every canonical group in this repo's own graph (`.aify-graph/graph.sqlite`, ~3,842
  groups at last count). Mostly JavaScript — stated as a limit, not treated as representative.
- **Fixtures:** `tests/fixtures/identity-hostile` (overloads) and `tests/fixtures/identity-callers`
  (C++ decl/def pairs, the regression risk).

## Identity rule — fixed before implementation

`normalizedParamList(signature)` returns the text between the FIRST `(` and the LAST `)`, with
parameter names stripped (the trailing identifier of each comma-separated part, only when that part
has two or more tokens, so an unnamed `int` survives) and whitespace collapsed. A signature with no
parentheses yields `null`, and a `null` contributes NOTHING to the key — absence must not create a
new group.

Proposed key: the current key, plus the normalized parameter list when one is available.

## Finding schema

One row per canonical group whose membership changes:
`{ key, members_before, groups_after, files, verdict }` where verdict is `SPLIT_CORRECT` (distinct
symbols that were merged) or `SPLIT_WRONG` (members are the same symbol, e.g. a decl/def pair).

## Controls, required in the same pass

- **POSITIVE on the zero:** the number of scanned rows carrying a parenthesised signature must be
  `> 0`. If it is zero the scan is blind and any "no groups split" result is void.
- **POSITIVE on the mechanism:** `identity-hostile`'s `clamp` group MUST split into 2.
- **NEGATIVE (the regression):** `identity-callers`' `alpha::Widget::render` decl/def pair MUST
  remain ONE group. A parameter-list key that forks it undoes `6372aae`.
- **DISCRIMINATION:** the normalizer must return DIFFERENT values for `(int value)` and
  `(double value)` and the SAME value for `(int value)` and `(int v)` — the parameter-name
  divergence hazard named in the earlier FINDING, now an assertion rather than a worry.

## Claim ceiling

This measures **splitting behaviour on this repo's graph plus two fixtures**. It can show the rule
is safe or unsafe here. It says nothing about prevalence of overloads in real C++, nothing about
templates, default arguments, or `const`/ref-qualified overloads, and nothing about scale.

## Abandon rule — preregistered

If **any** group splits whose members are the same symbol (a decl/def pair, or a definition counted
twice), the approach is **abandoned and reported as abandoned**, not loosened until the fixture goes
green. The regression direction is the dangerous one: refusing to merge two genuinely identical
symbols produces a false AMBIGUOUS refusal on every qualified query.

If the blast radius on the primary population exceeds **1%** of groups, the result is reported and
the change is held for review rather than shipped in the same cycle.
