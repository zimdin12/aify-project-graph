# M4, second half — the reached-verb distribution contradicts the "too large" hypothesis

M4 required measuring the hypothesis before acting on it. Measured, it is **not supported**.

Carrier: `scripts/measure-verb-adoption.mjs` over `C:/Users/Administrator/.claude/projects`
(19 project dirs, 1,119 transcripts).

## Result

| | |
|---|---|
| distinct verbs reached | **18** |
| default-listed tools | 16 |
| **reached AND default-listed** | **15 of 16** |
| listed but NEVER reached | **1** — `graph_census` |
| reached but NOT listed | 3 — `graph_status`, `graph_find`, `graph_digest` |

Invocation counts: `graph_health` 89, `graph_whereis` 42, `code_intel_references` 38,
`graph_packet` 37, `graph_consequences` 36, `graph_index` 26, `graph_callers` 26,
`graph_collect_code_intel` 20, `graph_search` 14, `graph_pull` 10, `graph_trace` 6,
`graph_explore` 6, `code_intel_hierarchy` 5, `graph_status` 2, `graph_impact` 2, `graph_find` 1,
`graph_digest` 1, `graph_dashboard` 1.

Controls, same pass: **POSITIVE** Bash/Read/Grep = 84,962 tool calls (the parser sees tool calls at
all); **NEGATIVE** a fabricated verb name = 0 (the matcher is not over-broad). 5 unparseable lines,
recorded.

## ⛔ "AGENTS REACHED 3 OF 43 VERBS" IS SUPERSEDED

That figure is the two-task pilot, and M4's own text says not to narrow on it. Across 1,119
transcripts, **15 of the 16 listed verbs are reached** — 94% of the surface an agent is actually
shown. Agents also invoke three verbs that are NOT listed, by name, which is evidence *against* the
idea that listing is what governs reach.

Two nouns were wrong in the original framing: the denominator (43 is the registry; 16 is what a
default session is shown) and the population (two tasks, versus 1,119 transcripts).

## Where the gap actually is — reach, not size

| | |
|---|---|
| top-level sessions | 31 |
| …with ≥1 graph call | 16 (**51.6%**) |
| subagent sidechain transcripts | 1,088 |
| …with ≥1 graph call | **9 (0.8%)** |

Half of sessions never call a graph verb, and delegated/subagent work essentially never does. That
is a presence problem at the moment of use, not a menu-length problem. Narrowing the listed set
would not move either number.

## Claim ceiling

- **This measures INVOCATION, not usefulness.** A reached verb is not a verb that helped. Nothing
  here says any call changed a decision.
- **The ≥6-task-shape requirement is NOT satisfied.** Transcripts are sessions; task SHAPE was never
  labelled. Inferring shape from session would be the wrong noun, so it is not inferred. M4's stop
  condition is therefore only partly met: the distribution is measured, the shape diversity is not.
- **n=31 top-level sessions** is a small denominator, on one machine, from one operator's fleet. It
  is not a general population.
- Subagent transcripts are nested runs, not sessions anyone chose to start; they are counted
  separately for that reason and must not be pooled with the 31.

## What this licenses

**Not narrowing.** The measured distribution argues against the premise that motivated it. If effort
goes anywhere from here, the evidence points at mid-task and subagent reach — 0.8% — rather than at
the size of the listed set.

## ⛔ CORRECTION — "0.8% of subagents" was the wrong denominator (same day)

M4's remaining action is *"either narrow the default toolset or improve routing"*. Narrowing was
refuted above. Before doing routing work, one question decides whether **routing** is even the right
noun: were the graph tools available to those subagents at all?

Discriminator: did the subagent call ANY `mcp__` tool? A transcript calling other MCP tools proves
the MCP surface was present and the graph was passed over. Measured over the same corpus:

| | |
|---|---|
| subagent transcripts | 1,086 |
| using **no MCP tool of any kind** | **1,069 (98.4%)** |
| using any MCP tool | 17 |
| …of those, using the graph | **9 (53%)** |

Other MCP servers subagents did use: `aify-comms` 20,656 calls, `chrome-devtools` 1,075,
`playwright` 22, `claude_ai_Hugging_Face` 20 — concentrated in those few transcripts.

Controls, same pass: **POSITIVE** Bash/Read/Grep = 112,794 calls (the parser sees tool calls);
**NEGATIVE** a fabricated tool name = 0 (the matcher is not over-broad).

⇒ **The graph is not being passed over.** Among subagents that use MCP at all, the graph is used by
roughly half. The binding constraint is that **subagent work almost never involves MCP tools** —
1,069 of 1,086 transcripts use none. Optimising graph salience for that population would be
improving a menu nobody opens.

⚠ **Claim ceiling.** This counts tool CALLS, not tool DEFINITIONS. "No MCP call" is **UNKNOWN
availability**, never proof the tools were absent — a subagent doing a file edit needs no MCP tool
whether or not one was offered. The 9-of-17 conditional rests on a denominator of **17**, which is
far too small to carry a rate; it is reported to show the ORIGINAL framing was wrong, not to replace
it with a confident number.

⚠ **What this does NOT say:** that subagent reach does not matter. It says the measured 0.8% was
graph-calls-per-ALL-subagents, and that figure conflates "the graph was skipped" with "no MCP tool
was relevant". Those demand different fixes and the data cannot yet separate them.
