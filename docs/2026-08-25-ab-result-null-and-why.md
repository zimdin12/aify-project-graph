# A/B result — NULL, and the three reasons are all mine

**Gate:** `docs/2026-08-25-prereg-ab-discovery-impact.md`, committed at `1a4e330` **before** any
arm ran. 5 tasks × 2 arms = 10 fresh agents, carrier `C:/Docker/aify-project-graph` @ `1a4e330`.

## The headline

**The experiment did not test its hypothesis.** Three independent invalidations, none of them
the tool's fault and all of them mine.

## Invalidation 1 — the manipulation was never applied

Measured from the subagent transcripts, `tool_use` blocks counted by name:

| arm | graph calls | tool uses | verdict |
|---|---|---|---|
| BASE-D1 | 0 | 14 | clean |
| **AUG-D1** | **0** | 10 | ⛔ never used the tools |
| BASE-D2 | 0 | 19 | clean |
| AUG-D2 | 1 | 15 | used tools |
| BASE-D3 | 0 | 6 | clean |
| **AUG-D3** | **0** | 6 | ⛔ never used the tools |
| BASE-I1 | 0 | 13 | clean |
| AUG-I1 | 1 | 12 | used tools |
| BASE-DS1 | 0 | 8 | clean |
| **AUG-DS1** | **0** | 8 | ⛔ never used the tools |

Isolation held **perfectly** in the direction I preregistered — zero baseline contamination. It
failed completely in the direction I did not: **3 of 5 augmented agents never called a graph verb
at all**, and the other two made exactly one call each. The "augmented" arm was, in the majority
of cells, a second baseline.

⛔ **THIS VOIDED A RESULT I HAD ALREADY REPORTED.** BASE-D1 asserted that `packet-input.js` and
`packet-verify.js` "no longer exist at those paths" — a **false absence claim**, verified false
(205 and 135 lines). AUG-D1 made no such claim. I reported that as the preregistered falsifier
firing. **AUG-D1 made zero graph calls.** The difference was ordinary variance between two agents
doing identical grep-and-read work. I was one step from publishing a product win with no product
in it, and a mechanical check stopped me rather than judgement.

⇒ **The manipulation check belongs in every arm-based design, in BOTH directions.** "The control
arm didn't cheat" is half a check. The other half is "the treatment arm actually received the
treatment."

## Invalidation 2 — I committed the answer key into the carrier

The preregistration, containing ground truth for all five tasks, was committed to the repository
the agents were searching. AUG-DS1 disclosed it unprompted:

> *"you should know an answer key exists in-repo, and my answer is therefore not a clean blind
> measurement."*

BASE-I1 and BASE-DS1 both cite the file too. ⇒ I followed "evidence lives where the work lives"
without asking **who else reads the repo**. For an eval, the gate must live outside the carrier or
be committed after the arms run.

## Invalidation 3 — the tools were stale

`graph_health` at run time: server `374ce41`, started 2026-08-24T15:39:28, checkout `1a4e330`,
**26 files changed, 16 executable** — including every fix made that day. The augmented arm was
pointed at yesterday's code. AUG-I1 tried `graph_consequences` and was refused.

## What survives, and it is not nothing

**1. Told to use the tools, in a repo where they are installed, agents mostly did not.**
3 of 5 never tried. This is adoption failure measured at the **decision** level, and it agrees
with the 0.7% subagent figure measured the same day from an entirely different substrate
(`docs/2026-08-25-adoption-is-an-install-problem.md`). Two independent instruments, same finding.

**2. The stale-process refusal worked.** AUG-I1 was refused rather than served a stale answer.
Verified independently via `graph_health`. That is roadmap 6b behaving exactly as designed in a
live setting, observed by a third party rather than asserted by its author.

**3. My ground truth was wrong, and both arms corrected it.** I wrote "5 files" for
`prepareCompileDb`; there are **7 production files**, plus an in-module call at
`compile-db.js:1112` and **two** calls in `code_intel_analyze.js`. AUG-DS1 also corrected "4
assertions" to 3 — the fourth token was a `describe` title.
⇒ **I audited the chain and not the anchor, in the document whose entire job was to be the
anchor.**

**4. Both arms ran controls unprompted.** Positive and negative controls appear in BASE-I1,
BASE-DS1 and AUG-DS1 without being asked for — including negative controls with fabricated symbol
names to prove the search could return ABSENT.

## Prediction accounting

Predicted: no correctness advantage on any of the five. **Held** — but not for the stated reason.
It held because the independent variable was never applied, which is not a result about the tool.

## What a valid re-run requires

1. **Gate outside the carrier** (or committed after the arms finish).
2. **Server restarted** and `startedAt` verified — not the commit, per the stale warning's own
   caveat that a failed restart and a restart onto the same commit are indistinguishable.
3. **Manipulation enforced or the cell discarded** — an augmented run with zero graph calls is not
   an augmented run.
4. **A carrier whose filenames do not encode its topics.** This repo names documents after their
   incidents, so `ls | grep` answers discovery questions outright. That weakness was named in the
   gate and remains unaddressed.
