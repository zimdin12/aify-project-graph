# F11 — `graph_callers` returns no callers for half the symbols an agent would ask about

**Not called a defect.** Each individual refusal is defensible. The finding is the aggregate rate,
and the fact that it is not uniform.

## What was measured

For each pinned corpus arm, the **20 most-called symbols** (highest incoming `CALLS` edge count) were
passed to `graph_callers`, and the OUTCOME of each call classified — caller rows returned, or an
`AMBIGUOUS MATCH` prompt with no rows.

| arm | zero caller rows | share | incoming calls behind the block |
|---|---|---|---|
| click (Python) | 12 / 20 | **60%** | 936 |
| fmt (C++) | 10 / 20 | **50%** | 381 |
| fast-route (PHP) | 2 / 20 | 10% | 13 |
| p-queue (TypeScript) | 1 / 20 | 5% | 1 |

Blocked symbols include `invoke` (329 incoming), `__init__` (289), `echo` (123), `c_str` (103),
`size` (40), `begin` (38).

## ⭐ The control, because a rate without one proves nothing

Sampling only high-traffic symbols cannot show that importance matters — 50% could simply be the
base rate for every symbol. So the same measurement was run against the **lowest**-traffic symbols
(exactly one incoming call each):

    fmt     top-20  50% blocked   |   bottom-20  10% blocked
    click   top-20  60% blocked   |   bottom-20  10% blocked

⇒ **The block rate is 5–6× higher for the most-called symbols.** It is not a uniform base rate. The
refusal concentrates on precisely the symbols an agent is most likely to ask about.

The mechanism is unsurprising once stated: important, widely-used names (`__init__`, `size`, `get`,
`begin`, `invoke`) are exactly the names shared across many definitions, so importance and name
collision correlate.

## Why this is not filed as a defect

- **Each refusal is correct in isolation.** `__init__` genuinely resolves to many definitions.
  Returning callers of the wrong one would be worse than returning none.
- **The message is actionable.** It lists candidates with file:line, states the cap, and names two
  concrete next steps (qualify the symbol, or use `graph_whereis`, which caps differently).
- **⚠ But the aggregate is a real cost.** On the two largest arms, the majority of high-traffic
  symbols yield no caller rows on the first ask. An agent that asks one question and moves on gets
  nothing, and the tool's value is concentrated in exactly the answers it declines to give first.

⇒ This is a design tension between precision and answering, not an error. It belongs to review, the
same way the orphan population did.

## ⛔ What this measurement is NOT, and why that matters here

An earlier attempt to measure "how often a reader meets AMBIGUOUS" counted occurrences of the string
`AMBIGUOUS` in verb output. That was void: in verb output `AMBIGUOUS MATCH` means **the symbol name
resolves to several definitions**, which is unrelated to the edge provenance `AMBIGUOUS` (an edge
whose destination identity is unbound). Same word, two meanings, and the wrong one was counted.

This measurement classifies the **outcome of a call** — rows returned, or no rows — with mutually
exclusive categories that sum to the population. It is about symbol-name resolution only, and says
nothing about edge provenance.

## Not established

- **Whether qualifying the symbol succeeds.** The remedy is untested at scale; only that the first
  ask returns nothing.
- **Whether agents actually retry.** The cost depends entirely on that, and nothing here measures it.
- **Anything outside these four repositories** at their pinned commits.
