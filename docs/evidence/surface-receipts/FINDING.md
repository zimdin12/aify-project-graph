# M0a — surface receipts, from the carrier

Taken at repo HEAD `946bdee`, node `v22`, win32. Raw: `RECEIPTS.json`. Harness:
`scripts/surface-receipts.mjs`, `scripts/instructions-verb-audit.mjs`.

## Why this milestone existed

I published "agents reached 3 of 43 verbs" and treated 43 as the billed affordance. Review's
census showed 43 is the **callable registry** and the listed surface is already gated. The
arithmetic was fine; the noun was wrong. But that census was itself a **module read** — it
imported `tools/schema.js`. What a host bills and what an agent can pick come from a live
`tools/list` over stdio. Those are different instruments and the first cannot vouch for the
second, so M0a re-took every number from the protocol.

## What the carrier returned

Each row is a real spawned `node mcp/stdio/server.js --toolset=X`, a real `initialize`, a real
`tools/list`.

| profile | listed | tools/list bytes | instructions bytes | session-start total | schema share of tools/list |
|---|---|---|---|---|---|
| lean | 6 | 11,771 | 13,880 | 25,651 | 58.0% |
| **default** | **16** | **25,539** | **13,880** | **39,419** | **69.7%** |
| code-intel | 11 | 22,158 | 13,880 | 36,038 | 60.5% |
| full | 32 | 45,754 | 13,880 | 59,634 | 70.6% |

Registry, also from the carrier rather than the module: **43 registered, 0 absent, 0
inconclusive**. Every one of the 43 is reachable by `tools/call` under the `default` profile, so
"gating is listing only" is now proven at the protocol, not just asserted in a comment.

### Controls, all in the same pass

- **negative** — a fabricated name (`graph_this_verb_is_not_registered_m0a`) must come back
  `-32601 unknown tool`. **PASS** on every profile and on the registry sweep. A probe that cannot
  return ABSENT cannot return PRESENT, and every "registered" verdict here rests on this.
- **positive** — a name taken from the listing we had just received must come back registered.
  **PASS** on all four profiles. Without it the classifier could be answering `absent` for
  everything.
- **differential** — the four profiles must return four *distinct* listings, or `--toolset` is
  inert and this is one figure reported four times. **PASS**, 4 distinct.
- **non-destructive** — callability is probed by sending an argument the sensitive-path gate
  refuses. That clears the registry lookup and stops **before any handler runs**, so probing
  `graph_index` does not rebuild the graph. Both error codes are distinguished by code *and*
  message.

## The host-side receipt, which the harness cannot take

The harness measures **what our server emits**. Whether a host injects that verbatim is the
host's business and is not observable from inside our process. So this half is recorded by hand,
from what the host actually showed in this session:

> This Claude Code session received **16** `mcp__aify-project-graph__*` names, deferred behind a
> tool-search step. The set is **identical** to the `default` profile listing measured above —
> same 16 names, no additions, no substitutions.

Two independent carriers agree on the default surface. That also settles the reachability
question our own MCP instructions raise: the **8 verbs unlisted under every profile including
`full`** — `graph_lookup`, `graph_report`, `graph_overview`, `graph_hotspots`, `graph_cycles`,
`graph_module_tree`, `graph_preflight`, `graph_summary` — are registered and callable at the
protocol, and **not reachable in this runtime**, because a deferred index holds listed tools only.

## Two things the numbers changed

**1. Profile gating does not touch the larger half at lean.** `instructions` is 13,880 bytes on
*every* profile — it does not vary with the toolset. At `lean` it is **larger than the entire
tools/list** (13,880 vs 11,771). Any future "shrink the surface" work that only trims the listing
is working on the smaller half of the lean bill, and on 65% of the default one.

**2. "80% of it is schema" was too high.** Measured: 69.7% at default, 70.6% at full, 58.0% at
lean. The shape of the claim survives — input schemas are the majority of the listing everywhere —
but the figure I had been repeating is not the measured one and is corrected here.

## A hypothesis this produced, and its ceiling

`scripts/instructions-verb-audit.mjs` asked whether the always-paid instructions advertise verbs
that do not exist. **They do not: 0 advertised-but-absent, with both controls passing.** That
hypothesis is dead and is recorded as dead.

What it found instead: **22 of 43 registered verbs are never named in the instructions**, and four
of them are in the default listing — `graph_census`, `graph_dashboard`, `graph_trace`,
`graph_explore`, together 5,239 of the 25,539 tools/list bytes. So an agent is billed for four
verbs at session start that the routing text deciding which verb gets picked never mentions.

⚠ **This is a co-occurrence, not a cause.** It sits beside a field observation (agents reached
3–5 verbs, and the ones they reached are named in the instructions) whose n is small and whose
task set is narrow. It is a **candidate for M4 to test**, not a result, and nothing is narrowed on
it. The plan's own rule stands: two tasks cannot license retiring anything.

## What M0a does not show

- No tokenizer ran. Every figure is **bytes our server emitted**. There is no token count here,
  and dividing by four would attach a precise-looking number to a noun nothing measured.
- One host, one session, one platform. The host-side receipt is n=1 and says so.
- Nothing here measures whether a listed verb is *useful*, only what it costs and whether it can
  be reached.
