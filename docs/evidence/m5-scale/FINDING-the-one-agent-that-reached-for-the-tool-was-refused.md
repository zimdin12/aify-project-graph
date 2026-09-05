# The one agent that reached for the tool was refused at the door

**Free measurement, existing data, zero marginal spend.** Proposed by ef-manager as the cheaper
alternative to re-running the A/B; it answers a question an A/B structurally cannot, because an A/B
conditions on use and use is the thing that is zero.

## The question

The 2026-08-25 A/B was void, but its most durable finding survived: **3 of 5 agents in the AUGMENTED
arm — explicitly told the graph tools were available — made ZERO graph calls.** Two causes were
proposed, with opposite remedies:

| cause | remedy |
|---|---|
| never considered it | a surfacing problem — fixable by routing and visibility work |
| reached for grep, grep worked | no felt need — **not** fixable by any index-quality work |

## What the transcripts actually show

**Neither.** Read at 2026-09-05, from the three zero-call transcripts:

| agent | tools used | what happened |
|---|---|---|
| `afef9dd3` | Bash×9, Grep×1 | never invoked ToolSearch |
| **`a7a1131c`** | Bash×6, Grep×1, **ToolSearch×1** | **asked for the tools by name and was refused** |
| `a089f88b` | Bash×6 | never invoked ToolSearch |

⛔ **THE THIRD CAUSE, AND NEITHER REVIEWER NOR I LISTED IT.** `a7a1131c` did everything correctly:

```
ToolSearch {"query":"select:code_intel_references,graph_callers,graph_whereis","max_results":5}
  -> "No matching deferred tools found"
```

Three real verbs, requested by exact name, through the documented door. The door said they do not
exist. Its very next action was `Bash` with a `grep`, and it never tried again.

⇒ **That is a REACHABILITY failure, not a surfacing failure and not an absence of felt need.** The
agent surfaced it, felt the need, reached — and could not get through. The remedy is different from
both proposed remedies, and it is the only one of the three that is a defect in our control.

## Why this matters more than the rate it came from

`0 / 973` organic adoption has been carried all week as a PLUMBING fact — "the channel that reaches
subagents never mentioned the tool". This is evidence for a second, compounding plumbing fact: **at
least one agent that DID get the message still could not load the tools.**

Those two have different fixes and the second one has never been worked on.

## ⛔ Claim ceiling

- **One transcript.** One agent, one moment, 2026-08-25. This does not establish a rate and is not
  offered as one.
- ~~**It does not explain the other two.**~~ **ANSWERED 2026-09-05, and the answer completes the
  split.** Read from ASSISTANT text only — the earlier grep matched the verb names in these
  transcripts and I nearly read that as consideration, but the PROMPT lists them and so does the
  deferred-tools reminder. Prompt text is what the agent was TOLD; assistant text is what it THOUGHT.
  With the streams separated (controls: assistant blocks found, prompt banner absent from the
  assistant stream and present in the user stream):

  | agent | mentioned the tool in its own words? | what the mention was |
  |---|---|---|
  | `afef9dd3` | once | describing a BUG in `graph_search`, not considering using it |
  | `a089f88b` | twice | both were FILE PATHS containing `aify-project-graph` |

  ⇒ **Neither ever considered it.** So the three split **1 reachability / 2 surfacing**.
- ~~**It is not established that this still happens.**~~ **IT DOES. REPRODUCED LIVE the same day**,
  in a session with the server connected and the tools available:

  | query | result |
  |---|---|
  | `select:code_intel_references,graph_callers,graph_whereis` | **"No matching deferred tools found"** |
  | `select:mcp__aify-project-graph__graph_callers` | loads |
  | keyword `graph` | loads |

  ⇒ The tools were never absent. `select:` matches the FULLY QUALIFIED name, and the instructions
  handed agents 22 unprefixed verb names and the working form zero times. The memory
  `graph-tools-are-deferred.md` is not contradicted — its probe used the keyword form, which works.
  Both are true, and the gap between them is exactly where the agent fell.

  Fixed in `cd8b8d8c`, at the line that caused it: TOOL SURFACE said *"if a tool-search returns
  nothing, do NOT retry"*, which is the instruction this agent obeyed.

## The instrument, and it failed once first

Controls reproduced a **month-old published table** exactly — 5 augmented arms, 3 with zero calls,
111 tool uses — which is the strongest available oracle because it was written before this
instrument existed and cannot have been fitted to it.

⛔ **AND THE FIRST RUN FAILED THAT CONTROL, WHICH IS THE ONLY REASON THIS IS TRUSTWORTHY.** It
reported **10** augmented arms where 5 exist. Cause: I classified an arm as augmented if its opening
prompt named the graph tools — and the BASELINE prompt names them too, in order to FORBID them
(*"HARD CONSTRAINT: you are FORBIDDEN from using any tool whose name begins with
`mcp__aify-project-graph__`"*).

⇒ A discriminator that cannot tell *told to use it* from *told not to* is not a discriminator. Without
the published table I would have reported causes for eight agents, five of which were forbidden from
calling.

## ⭐ The completed split, and the hypothesis that found NO support

| cause | agents | fixable by us? |
|---|---|---|
| **reachability** — asked by name, refused at the door | 1 | yes, and it is fixed (`cd8b8d8c`) |
| **surfacing** — never considered it after the prompt | 2 | yes, and it is the standing hypothesis |
| **no felt need** — reached for grep because grep was enough | **0** | no, and it would have ended the project |

⛔ **THE THIRD ROW IS THE RESULT.** "Agents do not use it because they do not need it" is the one
explanation under which no amount of index quality, honesty work or routing changes anything. Across
all three zero-call agents it has **no support**: one was blocked, two never thought about it, and
none of them weighed the tool against grep and chose grep.

⚠ **n = 3, one A/B, one machine, one moment.** This is the first evidence either way on a question
that had none, and it is not a rate. It does not license "the tool is wanted"; it licenses
*"non-use has not yet been shown to be a preference"*, which is a weaker and more useful claim.
