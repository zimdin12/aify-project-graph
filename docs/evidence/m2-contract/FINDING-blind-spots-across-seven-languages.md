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
