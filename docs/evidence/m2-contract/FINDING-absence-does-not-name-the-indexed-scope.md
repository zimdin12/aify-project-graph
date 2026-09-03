# An absence never names the indexed scope — M2's second half, unmet

**Date:** 2026-09-03
**Probe:** `scripts/probe-absence-names-indexed-scope.mjs`
**Status:** GAP CONFIRMED, both controls passing.

## What M2 asks for

> separate "no callers in indexed scope" from "no callers" and **NAME the scope**

`spineScopeClause` does this well for the **compiler-verified** tier: *"the newest code-intel
collection is cpp, which processed 73 of 627 eligible files; anything outside it is heuristic only."*
Numerator, denominator, and a stated limit.

The tier underneath it — the heuristic graph, which is the ONLY tier for a repo with no collection,
i.e. the ordinary JS/Python case — names nothing.

## Measured

| absence shape | names an indexed population? |
|---|---|
| `NO MATCH` (symbol unknown) | **NO** |
| `NO CALLERS` (symbol known, empty set) | **NO** |

Controls in the same pass: a symbol WITH callers returned them (the graph is real and populated), and
both absence shapes were produced (the verbs can emit them at all).

The `NO CALLERS` answer carries TRUST, SCOPE and NOT MODELLED — and its SCOPE sentence names what is
**missing** ("no code-intel collection exists"), which is not the same as naming what was
**searched**.

⚠ The detector was deliberately generous — four different phrasings of a file/symbol count would all
have counted as naming a population — so the negative is not an artifact of a narrow pattern.

## Why it matters

"No callers" from a graph that indexed 881 of 881 files is a strong absence. The **identical
sentence** from a graph that indexed 200 — an interrupted index, an ignore rule, an unindexed
language — is nearly worthless. An agent deciding whether to delete cannot tell them apart, which is
precisely the distinction M2 exists to draw.

## Scope of the fix, and what is deliberately left open

The clause is being added to `buildAbsenceTrustLine`, where SCOPE already lives and the answer is
~700B, so a ~75B addition is proportionally small.

⛔ **`NO MATCH` is left OPEN and measured, not fixed.** That message is ~96 bytes; the same clause
would be +78% of it, and this repo has already had to trim a 359B caveat that was 79% of a NO MATCH.
Whether the population belongs there is a separate byte/value question that deserves its own
measurement rather than being carried along.

## Ceiling

One repo, JavaScript, no code-intel collection. It measures what these two verbs say on this path;
it is not a claim about every verb or every tier.
