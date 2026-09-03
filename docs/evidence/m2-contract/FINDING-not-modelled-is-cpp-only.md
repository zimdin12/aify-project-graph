# "What was NOT modelled" is stated for 2 of 12 languages

**Date:** 2026-09-03
**Probes:** `scripts/probe-dynamic-dispatch-blindspots.mjs`
**Status:** gap MEASURED against the real registry; blind spots VERIFIED by fixture before any clause
was written.

## The gap

M2's stop condition says a result must *"state what was NOT modelled (indirection, macros,
conditional compilation, extern-without-header, included .cpp, **cross-language**)"*.

`constructCoverageClause` does that — and returns `''` for anything that is not C or C++. Measured
against `LANGUAGE_CONFIGS`, the real registry, with both controls passing:

| | |
|---|---|
| POSITIVE CONTROL `cpp` | a clause exists |
| NEGATIVE CONTROL `zzq-not-a-language` | stays silent |
| **languages stating what was NOT modelled** | **2 of 12** (`c`, `cpp`) |
| silent | python, javascript, typescript, php, go, rust, ruby, java, glsl, css |

⛔ It is used **only** in `buildAbsenceTrustLine` — the "no callers" / "no path" answer, which is
precisely the answer that licenses a deletion. So on ten languages, including this product's own
primary ones, an agent is told a symbol has no callers with nothing said about what the analysis
cannot see.

⚠ **This is not a per-result banner**, which is why extending it does not rebuild the warning wall:
absence answers are the minority, and they are the ones that authorise action.

## The blind spots were verified, not assumed

Declaring "dynamic dispatch is invisible" is a SEMANTIC claim. Writing it from intuition would be the
textual-to-semantic slide this repo forbids, so each construct got a fixture indexed by the real
pipeline. Identity rule: BLIND means no edge from caller to callee, while an ordinary direct call in
the same file DOES produce one.

```
--- javascript
  [PASS] CONTROL: direct call controlCaller -> sink produces an edge
  [BLIND] dynamicCaller -> sink        (table[name]())
  [BLIND] computedCaller -> sink       (o[k]())
--- python
  [PASS] CONTROL: direct call control_caller -> sink produces an edge
  [BLIND] dynamic_caller -> sink       (getattr(obj, name)())
```

## ⛔ My first measurement of this was an artifact

The first run reported "0 of 12 languages" — including cpp. `LANGUAGE_CONFIGS` is an **array**, and I
called `Object.keys` on it, so the loop tested the strings `"0".."11"`. **The positive control is what
exposed it:** cpp passed standalone while every "language" failed, and that collision is the only
reason the wrong number was not written down. Third instrument-shape error in this session (the
others: `String()` on a structured verb result, and a substring test read as a word match).

## Ceiling

Each clause licenses ONE sentence about ONE construct in ONE language on this extractor version. It
says nothing about the clangd/pyright-verified tiers, and the eight languages not fixtured here
remain **measured as silent but not investigated** — recorded, not fixed.
