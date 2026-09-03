# Blind spots fixtured across seven languages — and two that nearly went unrecorded

**Date:** 2026-09-03
**Probe:** `scripts/probe-dynamic-dispatch-blindspots.mjs`
**Status:** MEASURED, every language's direct-call control passing.

## Why

`constructCoverageClause` stated what the analysis cannot see for 5 of 12 configured languages, with
7 recorded as **measured-silent-but-uninvestigated**. That is an honest placeholder, not a resting
place: on the absence path — the "no callers" answer that licenses a deletion — silence reads as
"everything was modelled".

Declaring a blind spot is a SEMANTIC claim, so each one gets a fixture indexed by the real pipeline.
Identity rule: BLIND means no caller→callee edge while an ordinary direct call in the same file DOES
produce one.

## Result

| language | construct | verdict |
|---|---|---|
| javascript / typescript | `table[name]()`, `o[k]()` | BLIND |
| python | `getattr(obj, name)()` | BLIND |
| php | `$name()`, `call_user_func('sink')` | BLIND |
| ruby | `send(name)` | BLIND |
| java | `Class.getMethod("sink").invoke(null)` | BLIND |
| **go** | function value **received as a parameter** | **BLIND** |
| **rust** | function value **received as a parameter** | **BLIND** |

Every direct-call control passed, so no "BLIND" above is an artifact of a dead extractor.

## ⛔ go and rust first came back SEEN — and that reading was wrong

My first fixtures wrote the indirection as `f := sink; f()`. Both languages reported the edge
`valueCaller -> sink`, and the verdict printed **SEEN (no clause)**.

⚠ **The name `sink` appears textually in that caller's body.** A mention-based extractor produces
that edge without understanding the indirection at all — the edge is right by accident. Accepting it
would have recorded "go and rust have no blind spot here" on evidence that does not support it.

Re-fixtured so the callee is never named in the caller:

```go
func indirectCaller(f func() int) int { return f() }   // sink appears nowhere in this body
func wire() int { return indirectCaller(sink) }
```

Both languages then report **PARTIAL** — `valueCaller` SEEN, `indirectCaller` BLIND. So the blind
spot is real, and the clause must name the construct that is actually invisible: **a function value
the caller received as a parameter**, not "function pointers" generally, since the same-file
assignment case IS reported.

⇒ **An edge that exists for the wrong reason is not coverage.** The probe's own SEEN verdicts are
what made this checkable; a detector that only ever returns BLIND would have hidden it.

## What remains uninvestigated

`glsl` and `css` keep a recorded `null`. No fixture has established what our extractor misses for
them, and a clause asserting a blind spot without one would be invented.

## Ceiling

Each clause licenses ONE sentence about ONE construct in ONE language on this extractor version. It
says nothing about the clangd / pyright / tsserver verified tiers, which resolve some of these.

---

## ⛔ TWO INSTRUMENT DEFECTS FOUND WHILE CLOSING THE LAST TWO LANGUAGES

Adding `glsl` and `css` exposed both. Neither reached a shipped claim, and the corrected instrument
**validated** the five clauses already written — but that was the DIRECTION of the error, not care on
my part, and the distinction is the point.

### 1. `[].every()` certified a clause for a language with nothing tested

`glsl` and `css` were given `blind: []` — no dynamic-dispatch construct to test. The verdict logic
read `blindResults.every((b) => !b.seen)`, which is **vacuously true on an empty list**, so both
reported **"BLIND (clause justified)"**: a justification for writing a caveat when NOTHING had been
measured. An empty list now yields its own verdict, `NO CONSTRUCT TESTED (no clause)`.

⚠ This repo already has `[].every()` certifying a wired gate's own failure on record. It reappeared
inside the instrument built specifically to stop claims being invented.

### 2. The identity rule matched on LABEL alone, across every fixture in one repo

All fixtures share the names `controlCaller` and `sink` by design. `edgeExists(db, from, to)` matched
anywhere in the graph, so **one language's edge satisfied another language's check**.

The tell was CSS: its direct-call control **PASSED** — and CSS has no function calls at all. It was
finding the JavaScript fixture's edge.

⭐ **The direction of that error is what saved the shipped clauses.** Extra cross-language edges can
manufacture a false CONTROL PASS or a false SEEN; they **cannot** manufacture a false BLIND. So:

| verdict class | could contamination have faked it? |
|---|---|
| BLIND (what every clause rests on) | **no** |
| control PASS (evidence the language is parsed at all) | **yes** |
| SEEN (go/rust `f := sink`) | **yes** |

⛔ A false control pass is the dangerous one: it would have let a language that is **not parsed at
all** report BLIND everywhere, and BLIND-because-unparsed is the ABANDON condition, not a blind spot.

Re-run with both endpoints scoped to the language's own file: every clause-bearing language's control
still passes, so the five shipped clauses are sound on the corrected instrument.

## Final disposition of all twelve

| languages | disposition |
|---|---|
| javascript, typescript, python, php, ruby, java, go, rust | clause, each fixtured |
| c, cpp | the richer tier-dependent clause |
| **glsl** | parsed, but core GLSL has **no dynamic-dispatch construct** to declare — silence is a correctness argument, not an unfilled gap |
| **css** | **UNMEASURED**: the extractor produces no call edges for CSS, as expected for a language with no calls. The *caller* concept does not apply, so there is nothing to caveat |

⇒ Both remaining silences are now exclusions with an argument about the **hazard**, not about effort.
