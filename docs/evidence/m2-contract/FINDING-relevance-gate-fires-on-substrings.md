# The relevance gate fires on substrings — the exact hazard this product warns its users about

**Date:** 2026-09-03
**Probe:** `scripts/probe-mention-substring.mjs`
**Status:** DEFECT CONFIRMED on this repository's own symbol names, both controls passing.
**Age of the defect:** hours. It shipped earlier today across seven verbs.

## The defect

`uncommittedMentionClause` decides relevance with `text.includes(name)`. That is a SUBSTRING test, so
a symbol named `get` matches a file containing `budget`, `target` or `widget`, and the clause then
tells an agent that the file "mentions get" when it contains no such identifier.

⛔ **The codebase already documents this exact hazard, in the trust line printed beside the clause:**

> resolves calls BY NAME, so a common name (has, get, writeFile) OVERCOUNTS with unrelated
> same-named calls — `lsp-evidence.js:158`

I wrote a name-matching gate the same day, in the same file family, and reproduced the failure the
product warns its users about. **Adjacent knowledge does not stop the defect it describes.**

## Measurement

| | |
|---|---|
| `(name, file)` pairs where `includes()` says RELEVANT | 3942 |
| ...a real identifier mention | 2072 |
| **...SUBSTRING ONLY — false relevance** | **1870 = 47.4%** |

Controls passed in the same pass: a whole-identifier mention matches both the loose and strict tests;
an absent name matches neither.

Sample false relevances, with the text they actually matched:

```
"c"    ...import createGraph from 'n...
"q"    ... better partition quality than Louvai...
"dir"  ...l }); } // Undirected, deduped edg...
"ins"  ...phify (the design inspiration) uses...
```

⚠ **The population was deliberately skewed toward short names, and the percentage must be read that
way.** It is 200 labels of length <= 12, sorted shortest-first, against 60 real `mcp/` files. So
47.4% is *"the share of relevance decisions that are false among this repo's SHORT symbol names"* —
**not** "47% of agent queries would be wrong". The honest claim is that the hazard is REAL and
REALISED on names this graph actually holds, including several single-character labels.

## The fix, and why it is not a regex

An occurrence must be bounded by non-identifier characters on both sides. Implemented by index scan
rather than `\b`, because a regex needs the symbol escaped and `\b` is wrong or unbuildable for names
carrying `::`, `~` or `operator<<` — all of which exist in C++ graphs this product indexes.

## Ceiling

A TEXTUAL measurement about substring versus identifier-boundary matching on one repository's symbol
names. It says nothing about which symbols agents actually query, and nothing about other repos.

## Fixed, and cross-checked against an independent implementation

`mentionsIdentifier` (index scan for non-identifier neighbours) replaced `includes()`. The probe now
runs THREE tests over the same 3942 pairs: the old `includes()`, its own independently written
reference, and the SHIPPED production function imported from `read_freshness.js`.

    SHIPPED-CODE CROSS-CHECK: 0 disagreement(s) with this probe's independent implementation  AGREE

⭐ That is worth more than the unit tests alone: the two implementations were written separately, so
agreement is evidence rather than one reader consulting itself. And the check is load-bearing going
forward — if production ever regresses to a substring test, the probe's reference stays correct and
the disagreement count goes non-zero, instead of the whole finding quietly reading as "fixed".

Run: `RUN-mention-substring.txt`. Three mutants killed on the production function: reverting to
`includes()`, stopping at the first occurrence (which fails SILENT — the hard direction to notice),
and checking only the left-hand boundary.
