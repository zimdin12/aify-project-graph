# "Never named in the routing text" is not "unrouted" — 3 of the 4 route themselves

**Date:** 2026-09-02
**Measured from:** the live protocol — a real `initialize` (instructions) and a real `tools/list`,
not a module read.
**Cost:** zero agent budget.

## The measurement replicates

The plan's open M4 candidate says four default-listed verbs are never named in the routing text,
worth 5,239 of 25,539 bytes. Re-measured today: **4 verbs, 5,239 of 25,512 bytes (20.5%)**. Still
true; not stale.

Never named in the instructions: `graph_census`, `graph_dashboard`, `graph_trace`, `graph_explore`.

Controls in the same pass: instructions and listing non-empty; the matcher finds `graph_health`
(which the text does name); it rejects an invented name; and a boundary check confirms `graph_call`
does not match `graph_callers`.

## ⛔ But the number does not mean what I was about to say it meant

I was one step from reporting "four verbs an agent gets no guidance on". That is a **slide from a
textual claim to a semantic one** — the instructions are not the only routing surface. Each verb
carries its own description in `tools/list`, and three of these four route themselves explicitly:

| verb | description length | routes itself? |
|---|---|---|
| `graph_trace` | 817 | **yes** — *"PRIMARY for 'show me the whole call path from A to B'"* |
| `graph_explore` | 649 | **yes** — *"PRIMARY for 'show me the source of these N symbols'"* |
| `graph_census` | 954 | **yes** — *"THE DISTRIBUTION BEHIND THE TOTALS graph_health REPORTS"* |
| `graph_dashboard` | **56** | **no** |

So the actionable population is **one verb, not four**. Anyone acting on the plan's line as written
would have scoped the work 4× too wide.

## The one real candidate

`graph_dashboard` — *"Open the interactive graph browser. Returns {url, port}."* It says what it does
and never when to reach for it, and it is the only listed verb with no routing on either surface.

It also fails the purpose test on its face: the product's stated users are **AI agents**, and this
verb opens an **interactive browser UI for a human**. A URL and a port are not an affordance an agent
can act on. "Every feature must earn its place" applies squarely.

## Why I am NOT acting on it

⛔ **M4's status is HYPOTHESIS REFUTED — do NOT narrow the surface.** Unlisting a verb is exactly the
narrowing that milestone forbids on insufficient data, and my evidence here is a **description read,
not usage data**. Whether an agent ever reaches `graph_dashboard`, and whether some host surfaces the
URL usefully, are unmeasured.

Recorded as an evidenced candidate for whoever runs M4's ≥6-task-shape measurement, with the argument
and its limits stated, rather than acted on unilaterally.

## Ceiling

This measures **which names appear in which text**, on the default profile, today. It does not show
an agent reads a description, routes by it, or would behave differently if the text changed. Nothing
here is usage data.
