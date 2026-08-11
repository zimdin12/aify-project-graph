# `ask_graph` — the evaluation, written BEFORE the verb

Steven's idea, and his correction is what makes it testable: `ask_graph` is **added
functionality**, not routing. So the claim is not "agents will reach for it" (which needs
§1's blocked counterfactual) but:

> **Can it answer a question no single verb answers, and that chaining verbs by hand
> answers worse?**

That stands or falls on answer quality, and answer quality can be measured now.

★ **Written first on purpose.** Every adoption number this project has produced was
contaminated by deciding what counted after seeing the result. The question set and the
scoring rule are fixed here, before the verb exists, so the result can come out negative.

---

## The design constraint Steven named

> *"ask_graph should have good initial prompt ofc. but we have to accept it, llm based
> stuff is like that."*

Taken as written, and it settles a real design question: **do not build determinism
machinery around the subagent.** No retry-until-stable, no consensus voting, no pinning
the answer. The prompt carries the quality; variance is accepted. What must NOT vary is
whether a claim is **supported** — that is a property of the evidence, not of the phrasing,
and it is the one thing the harness checks.

---

## What the answer must carry

A synthesis verb is where confident wrongness lives — it is the whole class §2 exists to
kill, given a fluent voice. Three requirements, and they are testable:

1. **Every load-bearing claim names the verb or file that produced it.** A claim with no
   source is a claim the subagent made up.
2. **"I could not establish X" is a first-class output.** A synthesis that never fails to
   establish anything is a synthesis that is guessing.
3. **It must not launder a caveat.** If `graph_consequences` returned `exhaustive: false`
   or the coverage was a FLOOR, the answer says so. Distilling away a doubt clause is
   strictly worse than the payload it replaced — the caller loses the doubt AND the data.

⇒ Requirement 3 is the one I expect to fail first, and it is why the harness scores
caveat survival separately from correctness.

---

## The question set

Chosen so that **no single verb answers them**. Each needs at least two of
{code graph, overlay, tasks, docs, file contents} plus judgement about which matter.

A question only belongs here if a competent agent would need to chain verbs AND read
files. Anything a single verb answers is a control, not a test.

| # | question | why no single verb answers it |
|---|---|---|
| Q1 | "What breaks if I change the voxel material ID to 16 bits?" | Steven's own example. Needs call graph + shader/GLSL mirrors + open tasks + the actual field declarations. |
| Q2 | "Is this symbol safe to delete?" | Needs the transitive recompile surface, whether the closure is TERMINATED or a FLOOR, test coverage, and whether "no callers" is a clean absence or a DEGRADED lookup. The last distinction is invisible to any single verb. |
| Q3 | "Why does this test fail only on Windows?" | Needs file contents, git history, and the platform-skip surface. Mostly NOT a graph question — included deliberately, see below. |
| Q4 | "Which of these three refactors touches the most untested code?" | Needs impact per candidate crossed with test coverage, then a comparison the graph does not model at all. |
| Q5 | "What does this repo actually do?" (cold, no context) | The orientation question. `graph_packet` targets it — so this is the one where manual chaining should WIN or tie, and if `ask_graph` beats it that is evidence the packet is underperforming. |

★ **Q3 and Q5 are adversarial by construction.** Q3 is largely not a graph question and Q5
already has a dedicated verb. A question set where the new tool wins everything is a
question set chosen to make it win. If `ask_graph` cannot lose, the eval is decoration.

---

## Scoring — the D1′ dependence method, reused

Same instrument as §1, on a population that needs no consent.

1. **Enumerate before attributing.** List the load-bearing claims in each answer FIRST,
   before looking at which arm produced it. This is not fussiness: it already caught me
   publishing a false claim in my own tool's favour (C9), on exactly the claim I most
   wanted the tool to own.
2. For each claim, ask the counterfactual: **could the other arm have produced it?**
3. Score three things separately, never as one number:
   - **claims supported** — of the load-bearing claims, how many trace to real evidence
   - **claims UNIQUE to the arm** — the actual capability question
   - **caveats survived** — did a doubt clause present in the underlying verb output
     reach the caller, or get distilled away

### The arms

- **A — `ask_graph`**: the question, one call.
- **B — manual chaining**: a competent agent, same question, same repo, full verb surface,
  no `ask_graph`. This is the honest baseline and it is a strong one.

⚠ **Not a token comparison.** Total tokens go UP — the subagent pays full price plus its
own reasoning. Caller context goes down. That is a known accepted cost, recorded here so
it cannot later be reported as a discovery or sold as a context fix.

### What counts as a NEGATIVE result

Stated in advance so it cannot be renegotiated afterwards:

- `ask_graph` produces **no claims arm B could not**, on 4 of 5 questions → it is not a
  capability, it is a wrapper. Do not ship it as one.
- **Caveat survival is worse than arm B** on any question → ship blocked regardless of
  claim counts. A confident distillation is the defect class this project exists to fix,
  and shipping one from the tool that fixes it would be the worst possible outcome.
- Claims supported < arm B → the subagent is inventing. Same block.

---

## Status

Question set and scoring fixed 2026-08-12, before the verb exists. Harness next, then the
verb, then run both arms and publish whatever comes out.
