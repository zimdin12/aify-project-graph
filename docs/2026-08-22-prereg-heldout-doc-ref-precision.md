# Preregistration — held-out precision for the doc→symbol admission rules

**Status: POPULATION FROZEN, NOT GRADED.** Written before any verdict exists, including mine.

## Why the existing number had to be replaced

`doc-refs.js` says it about itself, at the rule-4 site:

> ⛔ THIS IS THE THIRD CHANGE TO RULE 4 AFTER GRADING IT, AND THE PRECISION FIGURE IS THEREFORE NO
> LONGER INDEPENDENT. 32/33 = 0.970 at 420147b was measured by two graders on code neither of them
> had tuned. Whatever this scores on the same corpus is a fit to data that shaped it. The honest
> claim is narrower: the ONE known false-positive mechanism is closed, and precision must be
> re-measured **somewhere this corpus did not reach**.

⚠ Note what is and is not wrong with 0.970. The **graders** were independent — two people, neither
of whom wrote the rule. The **corpus** was not: every one of the three post-grading changes was made
after looking at failures in it. Swapping in a fresh grader on the same corpus fixes nothing. The
contamination is in the data, so the data is what has to change.

## The corpora, and why they qualify

Nothing on this machine had a second graph. The vendored `reference/` trees did not have one either
— they had never been indexed, which is exactly what makes them clean.

| corpus | commit | licence | docs | source | why it is held out |
|---|---|---|---|---|---|
| `graphify` | `b14b52e9` | Apache-2.0 | 363 md | 332 | never indexed until today |
| `agent-understand-anything` | `32944829` | — | 118 md | 225 | never indexed until today |
| `codegraph` | `c6aaa203` | — | 82 md | 433 | never indexed until today |

⛔ `reference/agent-code-intel` is **UNLICENSED** and is deliberately excluded, even though this is
measurement rather than copying.
⚠ `understory` produced **zero** admitted edges and the sampler **REFUSED to freeze it** — *"a
frozen empty population proves nothing."* Recorded because a fourth corpus in the table with a
silent 0 would have read as coverage.

## The population

    doc_ref:path-scoped      89     (was 9 on graphify alone — see the note below)
    doc_ref:qualified        36
    doc_ref:shaped          337
    TOTAL                   462

Frozen with commit, graph hash and the **source line text** of every edge, so a grader judges the
sentence the author wrote rather than the resolution the extractor chose. Artifacts:
`docs/evidence/doc-refs-heldout-{graphify,agent-understand-anything,codegraph}.json`.

⛔ **WHY THREE CORPORA AND NOT ONE.** graphify alone gave **9** path-scoped edges. At n=9 a perfect
score still leaves a 95% lower bound near 0.66, so it could not have established a 0.95 floor no
matter how it graded — and a "0.95 precision" headline over nine rows would have been a number
doing the work of a measurement. Pooling three corpora is what makes the floor answerable at all.

⚠ And 89 is adequate, not comfortable: 85/89 = 0.955 has a lower bound near 0.89. **A pass here is
evidence the rule clears the floor, not proof of it.** Whoever reports the result must say so.

## What I predict, recorded before the grading exists

⛔ Preregistered so it can be scored against me, not so it can guide anyone. **The grader must not
read this section before returning verdicts** — it is here to be checked afterwards.

1. `doc_ref:shaped` will score **below** its 0.972 on APG/echoes, most likely 0.85–0.95. Its 337
   edges are the bulk of the population and it is the rule most exposed to prose that merely
   *contains* a code-shaped token.
2. `doc_ref:path-scoped` will hold **≥0.95**. Its one known false-positive mechanism was closed.
3. `doc_ref:qualified` will be the strongest per-edge and is the smallest population (36), so its
   interval will be too wide to certify either way.
4. **A concrete failure mode I expect to see**, from the first row I happened to look at:
   `codegraph` `CHANGELOG.md:32` admits `ImageMetadata` (rule: shaped) against a `.d.ts` test
   fixture, from a sentence that lists it as an EXAMPLE of a commonly-declared name. If that grades
   WRONG, the class is *"a backticked token used as an exemplar of a naming pattern, not as a
   reference"* — which no amount of shape analysis can see, and which would be an argument for
   restricting rule 3 rather than tuning it.

## Falsification, registered before the result

- Any rule below **0.95** on its own held-out population → **that rule is deleted, not ranked, not
  demoted, not rescued.** dev's ruling, and it applies to my prediction 2 as readily as to 1.
- If `shaped` scores at or above its 0.972 → prediction 1 was wrong and I should say so plainly
  rather than reinterpret the number.
- If the grader's per-rule totals do not match the frozen counts above (89 / 36 / 337), the sample
  they graded is not the sample that was frozen and **no number from it counts**.
- ⛔ If I grade any part of this myself, the result is void regardless of what it says. The claimant
  is the last person who should certify the claim.

## Status of each rule after this run

Nothing here changes a rule. The output is a number per rule plus a decision owed on any rule that
misses the floor. Rule changes, if any, are a separate slice with their own controls — **and any
rule changed in response to these verdicts is contaminated by this corpus too, which retires it as
a held-out set.** There is a fourth corpus left (`agent-code-intel`, licence-blocked) and not much
else, so this sample should be spent once, carefully.
