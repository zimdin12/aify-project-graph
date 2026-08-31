# apg-pilot-06 — task answer (arm sealed)

**Prompt:** Does anything call normalizeInput? List what you find and say what you checked.

**Answer: yes — but `normalizeInput` is TWO unrelated symbols here, one per language,
each with exactly one in-repo caller.**

  COPY 1 (JS)   src/entry.js:1 defined, called at src/entry.js:2 by runNormalize
  COPY 2 (C++)  src/normalize.h:2 declared, src/normalize.cpp:2 defined,
                called at src/stage.cpp:2 by a DIFFERENT runNormalize

> "Any answer that says 'runNormalize calls it' without naming the language is half an
> answer, because there are two different runNormalize functions too."

## ⛔ MY GROUND TRUTH WAS UNDER-SPECIFIED, AND THE AGENT CAUGHT IT

The sealed key says C6 truth = "YES, stage.cpp calls normalizeInput via normalize.h." That
is true and INCOMPLETE. I added `src/entry.js` to every workspace as filler — so the graph
would have resolvable JS edges — and gave it a function with the SAME NAME and the same body
as the C++ one. I created an accidental cross-language homonym and did not notice while
writing the answer key.

It does not flip the verdict (both copies are called, so "yes" stands either way), but a
scorer marking strictly against my key would have marked the MORE complete answer as
containing something unexpected. The key is the defective artifact, not the answer.

## ⭐ THE FIRST PLACE THE GRAPH ADDED SOMETHING GREP DID NOT

> "graph_callers('normalizeInput') refused the bare name as AMBIGUOUS and flagged the
> cross-language duplicate itself."
>
>   src::entry::normalizeInput      <- runNormalize CALLS src/entry.js:2   conf=0.90
>   src::normalize::normalizeInput  <- runNormalize CALLS src/stage.cpp:2  conf=0.60

grep found the same four lines, but the graph *structured* them — it refused a bare name it
could not disambiguate and named the collision, rather than returning a merged list.

## Limits it stated itself
- `absenceAuthority=false`, `codeIntel.available=false` (no_collection),
  **`attestation=generation_mismatch`** — the torn state, seen and reported
- *"my 'nothing else calls it' rests on having read all 9 files, NOT on the graph having
  looked and found nothing"*
- both copies externally visible (JS `export`, C++ external linkage); no package.json,
  tsconfig, Makefile or CMakeLists, so no build/link graph exists here to rule out an
  outside consumer
- no tests, so neither copy is guarded; the duplicated literal `9` can silently desync
