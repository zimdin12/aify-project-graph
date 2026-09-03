# The graph does not reach the layer where the work happens

Measured 2026-09-03 from every Claude Code transcript on this machine — 3.5 GB, 19 project
directories — with `scripts/measure-verb-adoption.mjs`, which already existed and which I found by
grepping before writing a new one.

| Layer | Transcripts | With ≥1 graph call | Rate |
|---|---|---|---|
| **Top-level sessions** — someone chose to start these | 36 | 16 | **44%** |
| **Subagent sidechains** — spawned BY those sessions | **1,116** | **9** | **0.8%** |

Per project: 11 of 19 have ever called a graph verb. **Within those 11, 16 of 22 sessions made a
call — 73%.** In the 8 that never have, 14 sessions made zero calls.

## The number that matters is the ratio between the rows

There are **31× more subagent transcripts than top-level sessions.** That is where the work volume
is, and the graph is essentially absent from it.

⇒ Everything this arc improved — identity, the absence contract, the disclosure surface, tonight's
headline scope — lands on the 36-session row. It reaches roughly **1%** of the transcripts where an
agent is actually reading code.

## Sampled: are the tools even there?

60 subagent transcripts, with the controls in the same pass:

```
POSITIVE CONTROL — contain a Bash tool_use:       51 / 60
POSITIVE CONTROL — contain a Read/Grep tool_use:  54 / 60
contain any aify-project-graph tool name at all:   1 / 60
```

The controls establish that these transcripts DO record tool activity, so the graph's absence is a
fact about the graph and not about the instrument. These agents are working hard — with grep and
file reads — and the graph is not in the room.

⚠ **What I cannot separate:** "the tools were not offered" from "the tools were offered, never
called, and never echoed into the transcript". Both produce the same bytes. What is established is
the outcome — the graph does not reach this layer — not the mechanism.

## ⛔ This corrects something I told Steven earlier today

I reported that the adoption bottleneck "points at **trust**", on the strength of one outside team
writing `grep is the instrument` into its agent docs. That inference was too fast. The measured
dominant factor at the layer that carries 31× the volume is **presence**, not trust. Both can be
true — a top-level agent may distrust it while a subagent never sees it — but the one I can measure
is presence, and I named the other one first because it was the one I had a quote for.

⚠ And note the direction: at the top level, adoption is **44% overall and 73% where the tool is
used at all.** That is *better* than the published 58–64% non-invocation figure I had been quoting
against our own product. I imported someone else's number about a population I could have measured.

## What it says about the A/B

The paired A/B measures answer quality for an agent that calls the verb. Measured adoption in that
layer is already 44–73%, so the A/B is asking a real question about a real population — but it is
the smaller population by a factor of 31, and no A/B result changes the 0.8% row.

⇒ **Spending the runs before this is fixed buys precision in the layer that already adopts, while
the layer that carries the work cannot call the tool at all.**

## Claim ceiling

⛔ These are Steven's own agents and this team's projects, not strangers — a biased sample. It is a
biased sample of **his actual use**, which is the population that matters here, and it beats a
published figure from a different product.

⛔ 60 of 1,116 subagent transcripts were sampled for availability. The 9/1,116 invocation count is a
full census; the 1/60 availability figure is a sample.

⛔ It measures Claude Code on one machine. Nothing here speaks to Hermes, to Codex, or to the PHP
work repos where this tool is also used.

## Verbs actually called, all layers (n=362 + 55)

`graph_health` 89 · `graph_whereis` 42 · `code_intel_references` 38 · `graph_packet` 37 ·
`graph_consequences` 36 · `graph_index` 26 · `graph_callers` 26 · `graph_collect_code_intel` 20 ·
`graph_search` 14 · `graph_pull` 10 · the rest ≤6.

⚠ `graph_health` leads by 2×. The most-called verb is the one that asks *"can I trust what I am
about to be told"* — which is worth remembering when deciding what to build next.

---

# Follow-up, same day: it is not availability, and the fix is one file

Four probes, live, against running agents rather than transcripts.

## 1. Are the tools reachable from a subagent at all?

A `general-purpose` subagent, asked to census its own toolset:

```
graph tools in loaded toolset : NO
ToolSearch present            : YES
ToolSearch("graph") returns   : graph_callers, graph_census, graph_consequences,
                                graph_dashboard, graph_health
actual toolset                : Agent, Artifact, Bash, Edit, Glob, Grep,
                                ToolSearch, PowerShell, Read, Skill, Write
```

⇒ **Reachable, but deferred.** Not in the loaded set; a subagent that reads its tool list concludes
correctly that it has grep and not a graph.

## 2. So is deferred-ness the barrier? No.

The availability discriminator (`scripts/m4-subagent-availability.mjs`, which already existed and
frames exactly this question) over 1,115 subagent transcripts:

```
with a GRAPH call            9
with ANOTHER mcp__ call      8      <- MCP surface WAS present, graph passed over
with NO mcp__ call at all 1,098      <- availability UNKNOWN, not proven absent
other MCP servers used   : aify-comms 21,663 · chrome-devtools 1,075 · playwright 22
```

⛔ **21,663 calls to another deferred MCP server.** Deferred MCP plainly reaches subagents and gets
used heavily. Those agents had a reason to reach for comms and none to reach for the graph.

⇒ This CORRECTS the section above. I wrote that the dominant factor was *presence*. It is not
presence and it is not permission — **nothing at the subagent layer says this tool exists.**

## 3. Where does an instruction have to live to reach them?

Probed directly, answered from context before any tool call:

```
project instruction text (AGENTS.md / CLAUDE.md) in a subagent's context : NO
  verbatim: "no project instruction text in context"
auto-memory MEMORY.md in a subagent's context                            : YES
```

⛔ **`AGENTS.md` and `CLAUDE.md` do not reach subagents.** The obvious place to put this instruction
would have changed nothing, and the change would have looked done.

## 4. Does the fix work end to end?

Wrote the routing knowledge to the channel that reaches — the auto-memory — then probed a FRESH
subagent WITHOUT quoting the instruction to it, so the test measures the channel and not the prompt:

```
1. context routing : the deferred-tools statement reached it
2. load mechanism  : ToolSearch loaded the schema, no error
3. execution       : graph_health returned a 24-field response
```

⭐ **Instruction-level reach works, verified end to end on a running agent.**

## ⛔ And a correction I made in the same hour

An earlier probe had `graph_callers` refuse with "STALE SERVER PROCESS — refusing to answer rather
than answering from code that is no longer on disk", and I reported that the server "has been
refusing every call for ~6 hours". **That was an overclaim from one verb.** `graph_health` answered
normally under the identical staleness and reported it as a `_warnings` field inside the response.

⚠ The verb-dependence looks deliberate rather than broken: health is the diagnostic verb, so it must
answer *especially* when stale, or a reader cannot find out why anything else refused. Recorded as
observed; not filed as a defect.

⚠ Separately and genuinely worth acting on: **15 `aify-project-graph` server processes** are alive on
this machine, the oldest from 2026-08-31. The one serving this repo loaded `90e4ab4e` and the
checkout is 6 hours past it.

## What this changes

The roadmap's R4 asked which of four causes we had — discoverability, trust, latency, genuine
non-need. Measured: **discoverability**, and specifically at the subagent layer, where 31× the
transcripts live. The fix is a paragraph in a file, not index quality.

⚠ Unverified, and stated as such: whether a Hermes `delegate_task` child inherits MCP tools. The
server IS configured globally in `~/.hermes/config.yaml`, but the OpenAI pool is at 0% and no Hermes
agent is reachable to test it. Do not assume it mirrors Claude Code.
