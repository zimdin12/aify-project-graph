# Preregistered: does the overcount warning change what an agent CONCLUDES?

**Written 2026-09-07 before any agent is spawned.** Four agents, two arms, one task.

## Why this question and not the obvious one

The obvious small A/B is "does the graph beat grep on a task". ⛔ **It is not worth running at this
size.** The 12-run design was already computed at 10.9% power against a coin and 42% against a
genuinely useful 70% tool. Two paired cells is far worse, and a null would mean nothing at all.
Spending four agents to learn nothing is worse than not spending them.

So this asks something a tiny sample CAN answer, because the prior is near zero and the effect is
qualitative: **when the tool warns, does the agent's stated conclusion change?**

This repository's own recorded finding is that *behaviour changes only when a field CONTRADICTS
confidence, never when it merely adds data*. The overcount warning shipped yesterday is exactly such
a field, and it has never been tested on an agent.

## The task, identical for every agent

> In the repository at C:/Docker/aify-project-graph, how many callers does the symbol `has` have,
> and would it be safe to rename it? Give a number and a yes/no, with your evidence.

⭐ **Chosen because the graph is WRONG here in a measured way.** `graph_callers("has")` returns ~100
rows at `conf=0.90`, and they are collisions: `groups.has(rawId)` on a Map, `new Map().has()` inside
`buildIndex`. Exactly ONE node in the graph is labelled `has`. The honest answer is that the count is
inflated and a rename is not safe on that evidence.

## Arms

| Arm | n | Tools |
|---|---|---|
| **A — graph-armed** | 2 | the aify-project-graph MCP verbs available |
| **B — grep only** | 2 | no graph verbs |

⚠ Arm B is not a fairness control for productivity; it is here to establish **what the right answer
looks like** when someone reads the source instead of the index.

## What is measured, per agent

1. **The stated caller count.** A number, or an explicit refusal to give one.
2. **The rename verdict.** yes / no / refused.
3. **Did the agent SEE the warning** (arm A only): does its reasoning reference the overcount or
   "NOT a floor" language.
4. **Did it act on it**: is the final conclusion consistent with the warning, or does it state the
   inflated number as fact anyway.

## Decision rule, fixed now

| Observation | Verdict |
|---|---|
| Both arm-A agents report the inflated count as fact | ⛔ **The warning does not change behaviour.** It is decoration, and warning is not enough — filtering becomes the live question. |
| Both arm-A agents refuse or qualify the count | ✅ The warning reaches the conclusion. Weak evidence at n=2, reported as such. |
| Split (1 and 1) | Report the split and claim nothing. ⛔ A binary check reports the wrong conclusion when reality is neither of its options. |

**Abandon rule.** If an arm-A agent never calls `graph_callers` at all, this measures ADOPTION rather
than the warning, and the warning question is unanswered. Say that instead of grading the transcript
for something it cannot show.

## ⛔ Contamination guard

The preregistered adoption measurement counts NESTED subagent sidechains under a fixed cutoff, with
`--exclude-project=C--Docker-aify-project-graph` and `--exclude-instructed`. These agents are
comms-managed sessions working in that project directory and given an explicit task, so both
exclusions should apply.

**Should is not measured.** `n` is **5** before this run. It is re-read afterwards, and if it MOVED
this experiment contaminated the gated measurement and that gets reported, not buried.

## Claim ceiling

⛔ Four agents, one task, one repository. This can show that a warning is or is not reaching a
conclusion. It cannot produce a rate, and it says nothing about productivity.
⛔ Arm A agents are TOLD the tools exist, so nothing here speaks to organic adoption.

---

⭐ **THE RAW REPLIES ARE NOW IN THE REPOSITORY:** [`RAW-REPLIES-2026-09-07-overcount-ab.md`](RAW-REPLIES-2026-09-07-overcount-ab.md).
Every quotation below is a selection made by the person whose intervention was under test. The raw
file is not, and it is what a reviewer used to find the correction that follows.

## ⛔⛔ CORRECTION, 2026-09-07 — THE HEADING BELOW OVERSTATED WHAT THIS EXPERIMENT SHOWS

The result section was headed *"the warning REACHED the conclusion in both arm-A agents"* and closed
with *"⇒ ✅ the warning reaches the conclusion"*. **Both arms got the right answer.** Four of four.
The control arm reached the same structure with no graph, no warning and no tool.

⇒ **The warning cannot have been NECESSARY to reach a conclusion two agents reached without it.**
Net of the tool the arms tie, and the intervention's measured benefit is repairing a wrong number
*the graph itself introduced*. The grep arm had no wrong number to undo.

⭐ **THE COMPARISON I RAN WAS NOT THE COMPARISON I ARGUED ABOUT.** The control arm's result is in my
own table, three rows above the verdict. I graded within arm A because that was the preregistered
property, then reported the outcome as though it were about the tool. Nothing was hidden; I simply
never looked across the arms, and the fact that decides the claim was sitting in my own data.

### What survives, stated at the strength the evidence supports

- ✅ **The MECHANISM claim.** The word "overcount" appears in both graph-armed replies and in
  **neither prompt**. That is warning vocabulary the agents were not handed, so the warning very
  likely did reach their reasoning. This is better support than I originally rated it, and it is not
  mine — an outside reviewer found it while attacking the claim.
- ⛔ **The VALUE claim does not survive.** This experiment does not show the warning was worth
  having. It shows it can change what an agent says about a number the tool got wrong.
- ✅ The v0.8.1 CHANGELOG entry was checked against this and makes no claim about the warning
  changing a conclusion. Nothing in the release depends on the withdrawn half.

### ⛔ AND THE GRADED QUANTITY WAS THE WRONG NOUN

`has` at `collect_code_intel.js:131` is a function-local arrow, so **exactly one** function can call
it. `graph_callers` reports caller FUNCTIONS, not call sites — measured, not assumed: the edges table
carries a UNIQUE index on `(from_id, to_id, relation)` and `docs/known-limitations.md:8` states the
extraction is function-granular.

    TRUE ANSWER IN THE VERB'S OWN NOUN     1
    THE GROUND TRUTH I WROTE              10   (call sites)
    WHAT THE GRAPH REPORTED              252   (capped to 100, every one a collision)

⇒ `ab-graph-1` answered `CALLER_COUNT: 1` and was **the only one of four to answer in the noun the
verb computes.** I recorded the split as a confound — "the agents split on the noun" — without
noticing that one side of it was simply correct, and graded against 10 it read as the outlier.

⇒ The tool's real error on this task is **252 against 1**, not 100 against 10. *"Wrong by a factor of
a hundred"* stays in this document as an accurate quotation of an agent, and it has mixed-noun
arithmetic underneath it. It is not my number and is not used as one.

⇒ The repair is one line in the prompt, not in the code: ask for caller FUNCTIONS or call SITES and
say which. My own agents splitting on it is the cheapest possible proof the question was ambiguous,
and I wrote the question.

⚠ **The ground truth is a property of INDEXED SCOPE, not of the repository.** `git ls-files
reference/` returns 0 and `.gitignore:19` excludes that tree, which holds more user-defined `has`.
`git add reference/` changes the number silently.


## RESULT, 2026-09-07 — read the correction above this line first

All four agents replied. Every factual claim below was re-verified against source before being
accepted, because a reviewer's claim is a pointer to check, not a substitute for checking.

| agent | arm | CALLER_COUNT | RENAME_SAFE |
|---|---|---|---|
| `ab-graph-1` | A (graph) | **1** caller function / 10 call sites — "NOT the 100 the graph reported" | YES |
| `ab-graph-2` | A (graph) | **10** — "NOT the 100 the graph reported" | YES |
| `ab-grep-1` | B (source) | **10** | YES |
| `ab-grep-2` | B (source) | **10** | YES |

**Verified independently:** the definition is at `collect_code_intel.js:131`, and receiver-unqualified
`has(` occurs exactly **10** times on lines 133 (1), 135 (2), 136 (6), 137 (1). The quoted caveats are
real strings in `callers.js` and `lsp-evidence.js`.

### Against the preregistered rule ⇒ ✅ the warning reaches the conclusion — ⛔ AND THAT IS A MECHANISM CLAIM ONLY, SEE THE CORRECTION ABOVE

Both arm-A agents received `CONFIDENCE: 100 callers` and **neither reported it as fact.** Both quoted
the overcount caveat verbatim and both said, unprompted, that it is what redirected them:

> "the caveat text did its job here — it named `has` by name as an overcounting shape, which is what
> sent me to verify rather than report 100." — `ab-graph-1`
>
> "The verb's own caveat is what stopped that — the caveat did its job here." — `ab-graph-2`

⚠ **n = 2. This is weak evidence and is reported as weak.** It shows the warning CAN change a
conclusion; it is not a rate, and both agents were told the tools existed.

### ⛔ AND THE HEADLINE IS STILL WRONG — the finding that matters for the open decision

`ab-graph-1`, unprompted: "the headline number the verb prints is still 100 callers, and 100 is wrong
by a factor of 100." The caveat rescued the conclusion; it did not fix the number a hurried reader
takes. ⇒ **This is the evidence for the open question of whether collisions should be FILTERED rather
than warned about.** Warning demonstrably works on a careful agent. It leaves a false headline for an
incautious one.

### ⛔ MY OWN GROUND TRUTH WAS WRONG, and the agents corrected it

The preregistration above says the honest answer is a refusal. **It is not.** There IS a user-defined
`has` — a function-local `const has = (rel) => ...` inside `detectRepoLanguage`. I had checked
`communities.js` and `doc-links.js`, found no definition, and generalised from two files to the whole
repository. Four agents found it independently and I confirmed it in the source.

⇒ The experiment survives because the graded property was *does the stated conclusion change*, not
*is the answer a refusal*. But the ground truth I wrote into a preregistration was a hasty
generalisation, and it is corrected here rather than quietly left standing.

### ⭐⭐⭐ TWO AGENTS INDEPENDENTLY REPRODUCED THIS PROJECT'S OWN LESSON

Neither was asked to check their instruments. Both did, and both caught a FALSE ZERO:

- `ab-graph-2`: "My first positive control FAILED and I nearly did not notice. I grepped for
  `collectCodeIntel` … the export is `graphCollectCodeIntel`."
- `ab-grep-2`: a look-behind probe returned empty because ripgrep needs `--pcre2`, and the error was
  invisible because stderr was suppressed. "the false zero agreed with a plausible expectation and
  produced no collision to prompt a recheck."

That is **an instrument's silence is not evidence until you have watched it speak**, arrived at twice,
independently, by agents who had never read the ledger. The failure mode is not idiosyncratic to me.

### ⚠ CONFOUNDS, stated rather than buried

1. **The repository contains the answer.** `ab-grep-1` cited
   `PREREG-2026-09-06-does-the-trade-change-a-users-answer.md` — my own write-up of this exact symbol
   and this exact guard failure. Arm B's independence is therefore compromised for that agent. The
   arm-A results are not: both quoted LIVE tool output rather than the docs. ⇒ **A task whose answer
   is written down in the repository under test is a badly chosen task**, and I chose it.
2. **The question was ambiguous and the agents split on the noun.** `ab-graph-1` answered **1**
   (calling functions); the other three answered **10** (call sites). Both readings are correct and
   they agree on the substance. My question said "how many callers" without saying which. Another
   wrong-noun instance, this one authored by me in the prompt.
3. Arm B is not a productivity control and nothing here speaks to productivity.

### Side evidence: yesterday's fixes observed working on independent agents

Both arm-A agents quoted, verbatim and unprompted, `"absenceAuthority": false, "reason":
"collection_partial"` and the staleness disclosure naming the collection commit against HEAD. Those
are surfaces changed yesterday, seen doing their job by agents with no knowledge of that work.

### Contamination check ⇒ CLEAN

`n` was **5** before the spawn and **5** after, controls unchanged (positive 255, negative 0,
instructed-excluded 0). The gated adoption measurement was not disturbed.
