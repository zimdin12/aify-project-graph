# Adoption measured from transcripts, not memory — and it reverses the strategy

**2026-08-25.** Instrument: `scripts/measure-verb-adoption.mjs`. Data: `docs/measurements/verb-adoption-2026-08-25.json`.
Carrier: every Claude Code transcript on `win32:stevenz-l`, 2.8 GB, 22 top-level sessions + 1,049 subagent sidechains.

## Why this was measured at all

`the field fleet` was asked, from recall, whether any graph verb had changed what they did. They answered
**NONE**, then counted their own transcript and found **55 invocations**. Self-report was wrong by two
orders of magnitude, **in the direction that condemns the tool** — the direction nobody audits.

⛔ **The number in `docs/THE-GOAL.md` that has governed this project — the field fleet's "zero" — was
collected by that same method.** It is not refuted. Its *provenance* is now known to be inadmissible.

## Controls, run in the same pass as the measurement

| control | expectation | result |
|---|---|---|
| positive — `Bash`/`Read`/`Grep` invocations | must be non-zero, or the parser sees nothing | **62,049** ✅ |
| negative — a fabricated verb name | must be exactly zero, or the matcher matches prose | **0** ✅ |
| unparseable lines | reported, not hidden | 5 |

⚠ **The controls earned their keep on the second run.** A rewrite to separate the two populations
returned **zero sessions and zero calls across all 1,071 transcripts**. The recursion was broken. The
positive control came back 0 — impossible — which is the only reason it was caught. *A clean zero
would have read as "nobody uses it" and agreed with the prior.* A wrong zero that confirms what you
expected produces no collision, so nothing prompts you to check.

⛔ **And the trap `the field fleet` hit first**, preserved in the instrument: grepping the bare string
`graph_` returns ~5,170 on one session. That is the deferred-tool catalogue echoed into the prompt.
**A tool name is not a tool call.** Count `type === "tool_use"` blocks and read `name`.

## The result

**Two populations, never merged.** The noun on a number is what this repo has got wrong most often.

### Top-level sessions — the unit the published "64.6% never invoke" figure is about

```
sessions                22
with >=1 graph call      8      36.4%
with ZERO graph calls   14      63.6%
graph calls            318
```

### But that 36.4% is not comparable to the published figure, and the reason is the finding

Calls do not spread thinly. They are **absent wherever the server is not installed, and dense wherever
it is.** The graph MCP server is distributed per-repository via a local `.mcp.json`; it is *not* in the
Claude Code user-scope config on this machine.

| project | server installed | sessions with a call | calls |
|---|---|---|---|
| `echoes_of_the_fallen` | ✅ | 2 / 2 — 100% | 206 |
| `sand_castle` | ✅ | 3 / 4 — 75% | 87 |
| `aify-project-graph` | ✅ | 3 / 4 — 75% | 25 |
| `aify-comms` | ❌ | 0 / 5 | 0 |
| `aify-llamacpp-router` | ❌ | 0 / 2 | 0 |
| `aify-comfyui` | ❌ | 0 / 1 | 0 |
| `.minecraft` | ❌ | 0 / 1 | 0 |
| `projects` | ❌ | 0 / 1 | 0 |
| `Administrator` | ❌ | 0 / 2 | 0 |

**Conditional on the tool being reachable: 8 of 10 sessions invoked a graph verb — 80%.**
Where it is not reachable: 0 of 12, necessarily.

⇒ **The adoption failure is an INSTALL problem, not a discoverability or quality problem.** Three of
three configured projects show high use; six of six unconfigured show structural zero. The published
literature finding — that agents self-route away from query tools — **does not replicate here.** Where
agents can reach these verbs, they reach for them.

### Subagent sidechains — a different noun, and a real gap

```
transcripts            1049
with >=1 graph call       7      0.7%
graph calls              53
```

Subagents essentially never call the verbs, including inside repos where the server is installed and
the parent session uses it heavily. **This** is where tool descriptions and skills could plausibly move
a number. The parent-session population is already at 80% and has little headroom.

## What this reverses

The strategy recorded on 2026-08-24 was: *"stop building index quality, pull the adoption lever —
tool descriptions and skills are worth more measured points than index quality."* That rested on the
published 58% / 64.6% never-invoke figures, applied to a population they do not describe.

**It is wrong for the parent-session population and right for the subagent one.** The corrected
ranking:

1. **Install the server where the work is.** Six projects, structurally at zero, including `aify-comms`
   — a JS repo where the verbs would apply. This is configuration, and it is the largest single lever.
2. **Fix compile-DB coverage** (the `sand_castle` fluid-solver TUs). Adoption is already high there;
   what is broken is that the one verb they want — the absence claim — is void on the TUs they care
   about. High adoption of an answer that cannot be trusted is worse than low adoption.
3. **Then** skills/descriptions, aimed at subagents, where 0.7% has real headroom.

## Bounds, stated plainly

- **One machine, 22 sessions.** This is not a rate for anything beyond `win32:stevenz-l`.
- **Install and task class are confounded.** The configured repos are also the C++/JS symbol-heavy
  ones; `.minecraft` is Java, where `javap` genuinely serves better. The correlation is perfect but
  the causal direction is not established by this data.
- **A call is not a benefit.** 318 invocations prove the verbs were reached, not that any changed a
  decision. `the field fleet` measured 55 calls they could not feel, and separately reports that the
  `code_intel_references` arc they do remember ended in a **retracted conclusion** — an empty caller
  set from a TU that never compiled is byte-identical to a TU with no callers.
- **`graph_health` at 78 is the top verb**, and health/index/collect are maintenance, not decision
  inputs. The decision verbs are `code_intel_references` (27) and `graph_callers` (6).
- **Which config served any particular call is unobserved.** The `.mcp.json` files exist; that they
  are what loaded during those calls is an inference, flagged as such at `the field fleet`'s insistence.
