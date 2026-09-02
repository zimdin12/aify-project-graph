# FINDING — I shipped a claim I had not observed, and it was half wrong

## The claim

`c883793` added a construct-coverage caveat to every C/C++ absence. It said:

> …no #if/#ifdef is evaluated, and clangd resolves ONE compile configuration, so an inactive branch
> is **invisible to BOTH tiers**.

I derived that from the compile-database model — one command per file, therefore one macro
configuration — and shipped it into product output without ever watching it happen. The reasoning
was sound for clangd and I extended it to a tier it does not describe.

## What was measured

`tests/fixtures/conditional-compilation`: `driver()` calls `hiddenCall()` inside `#ifdef FEATURE_X`
and `visibleCall()` unconditionally. The generated compile command defines no `FEATURE_X`, so the
first branch never compiles. `visibleCall` is the positive control — without it, "no edge for
hiddenCall" is indistinguishable from "clangd produced nothing".

```
collect: status=ok records=8 edges=1

POSITIVE CONTROL demo::visibleCall
   EDGE driver→demo::visibleCall CALLS src/lib.cpp:5 conf=0.95 [lsp✓]
UNDER TEST       demo::hiddenCall
   EDGE driver→demo::hiddenCall CALLS src/lib.cpp:5 conf=0.60
```

- **clangd**: produced exactly ONE edge, to the always-compiled call. The inactive branch is absent
  from compiler-verified evidence. **That half of the claim held.**
- **tree-sitter**: produced an edge for the inactive-branch call at conf=0.60, no `lsp✓`. It parses
  TEXT and never evaluates the preprocessor, so it reports a call **that can never execute**.

⇒ **"Invisible to BOTH tiers" is false.** The tiers do not share this blind spot — they fail in
**opposite directions**: the heuristic set OVERCOUNTS (contains uncompiled calls), the verified set
UNDERCOUNTS (omits them).

## Why the corrected version is more useful than the one I shipped

An agent told "both tiers are blind here" distrusts the heuristic caller set for the wrong reason
and cannot act on the warning. Told the direction, it can: a heuristic caller that does not appear
under `code_intel_references` may be a call that never compiles, and a symbol that looks unused
under clangd may be used in a configuration this build does not select. Those are different
actions.

Shipped wording now:

> the heuristic tier does not evaluate #if/#ifdef so it counts calls in INACTIVE branches
> (overcount), while clangd compiles ONE configuration and omits them (undercount). The two tiers
> disagree in opposite directions here.

## ⛔ Two instrument failures in the run that found this

1. **My probe classified a listed caller set as `NO_CALLERS`.** The matcher was
   `/NO CALLERS/i` against the whole response — and the TRUST caveat contains the phrase
   `before any "no callers" / delete`. The verb's own safety prose contaminated a classifier reading
   it. The fix is the one this repo keeps relearning: parse the `EDGE ` lines, never the prose.
2. **The probe printed a confident verdict from contradictory fields** — `NO_CALLERS` and
   `driver listed: true` on the same line. That contradiction was visible in the output and I nearly
   read past it to the verdict underneath. A probe whose own fields disagree is not evidence.

## What is now locked, and what is not

- **Locked by test** (`tests/integration/m2-heuristic-counts-uncompiled-calls.test.js`, no clangd
  required): the heuristic tier reports the uncompiled call, and that edge carries no `lsp✓`. This
  is OUR behaviour and the half that could silently rot into a false claim in shipped text.
- **Reproducible on demand** (`scripts/m2-conditional-compilation-probe.mjs`): the clangd half. Not
  a test, because it is third-party behaviour and needs an LLVM install.
- **NOT established:** how often this matters in real C++. One fixture, one construct, one compiler.
  Nothing here says inactive branches are common or that any real absence has been wrong because of
  one.

## The rule this came from, restated

The caveat was *derived* and shipped. Deriving is fine; shipping a derived claim as an observation
is not. The check cost four minutes and changed the text.
