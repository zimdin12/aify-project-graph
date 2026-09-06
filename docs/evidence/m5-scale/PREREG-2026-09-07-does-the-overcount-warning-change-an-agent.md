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
