---
name: graph-pull-context
description: Use when the user asks for everything connected to a file, feature, task, or symbol. Wraps `graph_pull` with intent-based layer selection and turns the JSON into a short cross-layer summary plus a read-next list.
---

# What else is attached to this?

You are about to change something. You know what it does. You do not know what is *attached* to
it — an open task in another lane, a contract that names it, a feature whose owner will notice.

That is the job. Not "call `graph_pull`".

Grep answers "where is this defined" already, and does it well. The thing grep cannot do is
join a file to a task, a contract and a feature in one look, because those live in the overlay
rather than in the code.

## Do it

Resolve the target first if the user was vague — `graph_whereis` for a name, `graph_search` for
a topic. An ambiguous target produces a confident answer about the wrong thing.

Then pull the layers the *situation* needs, not all of them:

| you are about to | pull |
|---|---|
| plan work | `code`, `functionality`, `tasks`, `activity` |
| debug a failure | `code`, `functionality`, `activity` |
| review or triage a change | add `docs` |

```text
graph_pull(node="src/thing.js", layers=["code","functionality","tasks"])
```

Prefer an explicit `feature:` or `task:` id over a path, and a path over a bare symbol. Each step
down that list is a resolution the tool has to guess at.

## Say what came back, and what did not

Report: what resolved · what each layer actually said · **what was empty** · the next one to
three files to read.

⛔ **An empty overlay layer is not evidence of absence.** `functionality` and `tasks` are
CURATED — they are as complete as whoever last maintained them. "No tasks" means no task was
recorded, which is a different claim from "nothing is in flight", and stating the second from the
first is the single most costly mistake available here.

⛔ **Check `truncated` before calling a list complete.** A capped list and a short list look
identical in the output.

⛔ **Never treat a feature or task match as true without opening one real file.** The overlay
points at code; it is not the code.

## When this is the wrong tool, say so and stop

- **You already have a precise question.** "What breaks if I change X" is `graph_consequences`.
  "Who calls X" is `code_intel_references`. Reaching for context first is slower and vaguer.
- **You do not yet know what you are asking.** That is `graph_packet` — orientation, one call.
- **You want an execution trace.** `graph_trace`.
- **The change is already clear.** Just make it. A context pull before a one-line fix is
  ceremony, and this skill is not worth its own latency there.

## The honest limit

Everything above the code layer is only as fresh as the last person who curated it. This skill is
worth using when the overlay is maintained and worth skipping when it is not — and `graph_health`
is how you find out which, before you rely on an empty list.
