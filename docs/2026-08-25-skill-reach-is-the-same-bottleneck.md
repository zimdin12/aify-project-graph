# Skills have the SAME mid-task reach problem the verbs do

**This measurement falsifies the strategy I adopted earlier the same day.** After finding that
subagents invoked a graph verb in 7 of 1,049 transcripts, the corrected plan was: *"skills are the
lever for the population that is not reaching the verbs."* That plan assumed skills get reached.
They do not, in the same shape and at the same boundary.

Raw output: `docs/data/skill-invocation-attributed.json`
Instrument: `scripts/measure-skill-invocation.mjs`

## Method and controls, same pass

A `Skill` **tool_use block** is counted and its `skill` input read. Never a text grep — a skill name
in prose, or in the catalogue echoed into every prompt, is not an invocation.

| control | value | what a failure would have meant |
|---|---|---|
| any skill invoked, ours or not | **136** | zero ⇒ the parser never saw a `Skill` block, indistinguishable from "nobody uses skills" |
| fabricated skill name | **0** | non-zero ⇒ the matcher counts any string it sees |
| project dirs classed `self` | **1** | zero ⇒ an `elsewhere` figure from a walk that never saw us |
| project dirs classed `elsewhere` | **13** | zero ⇒ an adoption figure from a walk that only saw us |

**Population:** 22 top-level sessions + 1,059 nested subagent transcripts under
`~/.claude/projects`, i.e. every Claude Code transcript on this machine. **Supply side checked
first:** all 17 skills are present in `~/.claude/skills/`, so a zero here is genuine non-use and
not the unreachable-quality trap the doc layer sat in for weeks.

## Results

    17 skills shipped and installed
     9 invocations, total, ever
     5 distinct skills invoked
    12 skills NEVER invoked, by anyone, in the whole corpus
     0 invocations from 1,059 subagent transcripts
     0 invocations from this repo's own sessions

## ⭐ The attribution is what makes the 9 meaningful, and it surprised me

I added attribution expecting to discover that our own dogfooding inflated the count. **The
opposite:**

| origin | calls | transcripts |
|---|---|---|
| `self` (this repo) | **0** | 0 |
| `elsewhere` | **9** | 2 — both in `sand-castle` |

So every invocation is organic, from the one external project that also files our field reports.
That is real adoption, and it is also the entire supply of it.

⚠ **And we have never once invoked our own skills.** Nothing here validates them in practice; no
claim that they work in a real session rests on our own use, because there is none.

## The split, and what it is and is not

| invoked | never invoked |
|---|---|
| `aify-project-graph` (3) | `blast-radius`, `find-the-doc`, `graph-pull-context` |
| `graph-build-all` (2) | `graph-walk-bugs`, `safe-to-delete`, `graph-guide` |
| `graph-dashboard` (2) | `graph-anchor-drift`, `graph-feature-edit`, `graph-task-edit` |
| `graph-build-tasks` (1), `cpp-inner-loop` (1) | `graph-build-briefs`, `-functionality`, `-intelligence` |

Every skill that was invoked is one you reach for **deliberately, as the task** — set the thing up,
build the graph, open the dashboard. Every skill never invoked is one that would have to fire
**mid-task, while the agent is already doing something else** — "before you delete this, check the
blast radius", "find the doc for this".

⚠ **That reading is a HYPOTHESIS, not a result.** It is consistent with 5 versus 12 and with the
independent verb measurement, and n = 9 cannot establish a cause. What is *proven* is the count and
the population it was drawn from.

## ⇒ What this changes

The corrected strategy was to invest in skills because agents were not reaching the verbs. But the
skills sit at the same boundary: **entry-point reach works; mid-task reach does not.** Polishing
skill descriptions is quality work on the side of the boundary that is not the problem.

The open question is therefore not "are the skills good" — it is what makes an agent reach for
anything at all once it is already mid-task. Nothing measured so far answers that, and no further
skill polish will.

## What this does NOT establish

- **Why.** Non-use is measured; no cause is. The entry/mid-task split is the leading hypothesis.
- **That the 12 are bad.** A skill nobody triggered has not been evaluated at all.
- **Anything off this machine.** One corpus, one operator, one external project.
- **Cost.** Whether 12 unused skills carry a meaningful always-paid listing cost is unmeasured
  here; it is a separate question from whether they are reached.
