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
- **It does not explain the other two.** They never invoked ToolSearch at all, so this refusal says
  nothing about why. The surfacing hypothesis remains live for them.
- ⚠ **IT IS NOT ESTABLISHED THAT THIS STILL HAPPENS.** The memory
  `graph-tools-are-deferred.md` records the opposite — that ToolSearch loads the verbs, probe-
  verified — and it was written later. Either the situation changed, or the probe and this agent
  differed in a way that matters. **That question is the highest-value next measurement, and it is
  cheap.** Until it is answered this is history, not a live defect.

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
