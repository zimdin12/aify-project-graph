# The teaching half of the product is near-inert: 14 of 16 graph-using sessions invoked no skill

The purpose statement names two halves: the graph, **and "the skills that teach an agent when to
reach for which"**. Every measurement in this arc covers verbs. This measures the other half.

Carrier: `scripts/skill-reach.mjs` over `C:/Users/Administrator/.claude/projects`
(19 project dirs, 1,119 transcripts).

## Result — the conditional, not the marginal

| | |
|---|---|
| top-level sessions that used a graph verb | 16 |
| …that also invoked a graph-teaching skill | **2 (13%)** |
| …that used the graph with NO teaching skill | **14** |
| invoked a teaching skill but used no graph verb | **0** |
| neither | 17 |

Across the whole corpus: **143 Skill invocations, 30 distinct skills.** The graph-teaching skills
barely register — `aify-project-graph` 3 invocations, and `graph-guide` / `cpp-inner-loop` do not
appear at all. For contrast, `aify-comms` 24, `superpowers:brainstorming` 19,
`superpowers:systematic-debugging` 17, `superpowers:writing-plans` 17.

Subagents: **8 of 1,086** transcripts invoked any skill (0.7%) — the same shape as their MCP use.

Controls, same pass: **POSITIVE** Bash/Read/Edit = 121,480 calls (the parser sees tool calls);
**NEGATIVE** a fabricated skill name = 0 (the extractor is not over-broad).

## ⚠ The marginal figure was checked and DISCARDED before publishing

The first cut was "2 of 33 top-level transcripts invoked a graph-teaching skill". That denominator
spans 19 project dirs, most of which are not graph projects — a Minecraft-modding session has no
reason to invoke `graph-guide`. Reporting it would have been the fourth wrong-denominator claim in
this session. The conditional above (among sessions that ACTUALLY used the graph) is the one that
carries meaning.

## Claim ceiling

- **Counts INVOCATIONS, not usefulness.** Nothing here says a skill would have helped.
- **Cannot distinguish "not needed" from "would help but never read".** Agents used the graph in 14
  sessions without the teaching skill; whether those sessions used it *well* is unmeasured. That is
  precisely what M5 would test.
- **`0` skill-without-verb is not evidence of conversion.** With only 2 sessions invoking a skill at
  all, the cell is too small to support any rate.
- **n=16 graph-using sessions, one machine, one operator's fleet.** Not a general population.
- A skill never invoked is ambiguous between not installed, not surfaced, and not chosen. This
  reads transcripts, not skill availability.

## What it does NOT license

No change to the skills, and no removal. "Rarely invoked" is not "useless" — the same reasoning that
made "3 of 43 verbs" look like a case for narrowing, which measurement then refuted. What it does
establish is that the teaching half is **not currently doing the teaching** in 87% of the sessions
where the graph is used, so any claim that the skills are what make the graph usable is unsupported
by this corpus.
