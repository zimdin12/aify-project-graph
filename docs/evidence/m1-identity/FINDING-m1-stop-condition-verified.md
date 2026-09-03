# M1's stop condition, verified on running code — and a defect found while verifying it

**Date:** 2026-09-03
**Probe:** `scripts/probe-m1-stop-condition.mjs`
**Status:** M1 stop condition **HOLDS**, anti-vacuity control passing.

## Why re-verify something already reported closed

I have reported M1 closed for many cycles from a summary. Last cycle I discovered M2 was **not**
closed when I said it was, so the same scepticism applies — and this particular check has produced a
false pass before.

⛔ **The first M1 verification was VACUOUS.** It compared two caller sets that were both EMPTY, which
are trivially disjoint: the positive control used a direct function call while the case under test
was a method call through a variable, so nothing resolved and "the sets do not merge" was true of
nothing. The non-empty control is the entire reason this run can be believed.

## Result

Fixture: `render` defined in `src/alpha.js` and `src/beta.js`, each with its own caller.

| check | result |
|---|---|
| the graph holds two distinct symbols | `src.alpha.render`, `src.beta.render` |
| **ANTI-VACUITY + CORRECTNESS** — each set non-empty and holds its OWN caller | **PASS** |
| **★ THE SETS DO NOT MERGE** (both directions) | **PASS** |
| bare name names both candidates | PASS |
| bare name carries their CALLER SETS — M1's actual ask | PASS |

The bare-name answer is not a dead end:

```
AMBIGUOUS MATCH for "render". 2 concrete candidates found:
- src::alpha::render src/alpha.js:1
    -> 1 caller: alphaCaller
- src::beta::render src/beta.js:1
    -> 1 caller: betaCaller
⚠ Caller counts come from the heuristic graph and are a FLOOR, not an exhaustive set. ...
Retry with a qualified symbol (Class::method / Namespace::Class::method) or use a file-specific query.
```

⇒ **M1's stop condition is met, with evidence rather than recollection.**

## ⛔ A defect found while diagnosing my own instrument

My first run failed the anti-vacuity control: both sets came back empty. The instrument was wrong,
not the feature — I passed `symbol` AND `file` together:

```
graphCallers({ symbol: 'src.alpha.render' })                        -> EDGE alphaCaller→src.alpha.render
graphCallers({ symbol: 'render', file: 'src/alpha.js' })            -> AMBIGUOUS MATCH ... 2 candidates
```

⚠ **Adding a MORE specific constraint produced a LESS specific answer.** An agent that helpfully
supplies the file alongside a name gets a worse result than one that supplies the name alone — and
the product's own bare-name message ends by suggesting exactly that: *"or use a file-specific
query"*. The remedy the tool recommends leads to the degraded path.

Recorded here; not fixed in this run. Whether the file filter should narrow the candidate set is a
behaviour question that deserves its own measurement rather than a same-breath change.

## Ceiling

One language, one fixture shape, this extractor version. It says nothing about C++ overloads or
cross-language name collisions.
