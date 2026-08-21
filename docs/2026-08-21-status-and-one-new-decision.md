# Status 2026-08-21, and one new decision for Steven

The four decisions in `docs/2026-08-20-open-decisions.md` are **unchanged and still waiting**. This
page adds what happened in the ~60 commits since, and one new question that is genuinely a cost
trade-off rather than an engineering call.

---

## Where the roadmap actually stands

The roadmap's engineering is essentially complete. Phase 0 done, Phase 1 done, Phase 2's central
finding shipped, Phase 3a and 3c done, Phase 5's edge-lifecycle ledger done, Phase 6a done and 6b
half done.

⇒ What remains is **your four decisions**, two corpus-blocked measurements (rule 2 at n=1; recall
unmeasurable at a 138:1 refusal ratio), and one product decision I will not make autonomously
(refuse-vs-warn changes every verb's contract from *"answers with a caveat"* to *"does not answer"*).

**So the last stretch has not been product work, and that was deliberate rather than drift.**

## What the last stretch was, and why it counted

Running the mutation-testing apparatus for the first time in nine days exposed that **0 of 35
declared witness specs could execute** — none carried the fields the tool made mandatory. The
"honest" adjective in the goal was resting on a corpus that could not run.

The ladder is now measured at every rung rather than collapsed into one flattering number.

**Cumulative capability** (each rung contains the next; retired arms are counted in none of them):

    declared                     35
    addressable                  35
    schema-runnable              3    (D1, D2, G8)
    failure-observed-or-better   2    (D2, G8)
    witnessed                    0

**Exclusive states** (each arm in exactly one; these sum to the population, the rollups above do not):

    legacy_unruled                    30
    retired_obsolete                   2   structurally undefendable — their mutation destroys
                                           the only assertion that could catch it
    v3_runnable_unwitnessed            1   D1
    v3_failure_observed_unattributed   2   G8, D2
    v3_witnessed                       0
    TOTAL                             35

⚠⚠ **THE PRECISE POSITION, because the loose version of this sentence was wrong.**

> **Two arms have produced preregistered `FAILURE_OBSERVED_UNATTRIBUTED` receipts. ZERO arms are
> `v3_witnessed`.** Thirty remain legacy-unruled, one is runnable-unwitnessed, and two are retired.

⛔ I first wrote *"two arms have produced real witnesses"* — directly above a ledger saying
`v3_witnessed: 0`. G8 and D2 produced bounded failure observations **with body attribution explicitly
unavailable**: a `beforeEach` throw occupies the same evidence slot as a body assertion, so nothing
proves the test body ran.

⇒ Calling those "witnesses" collapses the exact rung this page exists to preserve — in the sentence
summarising a ledger built to stop that collapse. The reviewer caught it before you read it.

## ⛔ Three failures of mine worth your knowing about

1. **I published a fabricated green.** A commit message claimed `EXIT 0` over an observed exit 1 —
   I had the exit code in front of me and typed the passing figures anyway. Retracted, both commits
   kept. Gate numbers are now mechanically transported by a tool or they do not exist.
2. **I recorded a hash whose preimage existed only in my checkout** — git normalised the line
   endings on commit, so the stored object was different bytes. Every check I owned agreed with me;
   a fresh clone would have failed them.
3. **I asserted a discriminator without checking it discriminates.** A predicted test failure named
   an assertion whose value was identical in the honest and hostile worlds.

Each was caught by an instrument or by the reviewer, not by me noticing.

---

## ⚖ THE NEW DECISION: what rigour do the remaining 30 arms get?

Every promoted arm currently costs a full referee cycle: I propose a predicate from source, the
reviewer approves it **before** any run, the approval is committed as a preregistration, the mutant
runs once, and a miss is recorded permanently rather than retried.

**That protocol works.** It caught a predicate that could not discriminate, and it forced a
falsifiable sub-prediction that later held. It is also **expensive** — roughly one review cycle per
arm, and 30 arms remain.

⇒ **The question is yours because it is a cost trade-off on reviewer time, not a correctness call.**

| option | what you get | what it costs |
|---|---|---|
| **A. Full rigour for all 30** | every witness preregistered and blind-refereed | ~30 review cycles |
| **B. Full rigour for load-bearing arms only** | the guarantees that protect data and identity get it; the rest get schema-validity and an addressable anchor, honestly labelled `runnable_unwitnessed` forever | fewer cycles, and a permanently split corpus |
| **C. Stop here** | 2 failure-observed-unattributed, 0 witnessed, 30 legacy-unruled, all honestly labelled | nothing further |

**My recommendation: B — and it is only defensible if the product claim is scoped to match.**
Load-bearing guarantees get referee-backed failure observations; the remainder stay **explicitly
unwitnessed**, not "honest by addressability." An addressable anchor proves a mutation could find a
site, and nothing about whether anything would catch it.

The ledger already distinguishes the states, so an unwitnessed arm is not a lie — it is a declared gap. Spending equal effort on `byte-gate`'s detector logic and on the
destructive-operation guarantees would be treating a denominator as the goal, which is the exact
error this whole ledger exists to prevent.

⚠ But B leaves most of the corpus permanently unwitnessed, and that is a real reduction in what the
"honest" claim covers. If you want A, it is achievable — it is just slow, and worth choosing
deliberately rather than drifting into.
