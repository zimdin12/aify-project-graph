# The seven verbs — the carrier and population dev asked for

`graph-senior-dev`, reviewing `b396c0a`: *"seven-verb ruling stays open absent its exact
carrier."* Right to refuse. Here it is, measured rather than recalled.

## The question

Phase 3c cut the default `tools/list` from 17 verbs to 15 — a **listing** decision; everything
stays callable. `ef-manager` advised on the rest and then explicitly refused on seven:

> *"zero calls is evidence I was not doing the work they serve. Do NOT let me be the reason those
> get cut — a drop decision on my numbers alone would be the consumer-enumeration mistake again."*

## Carrier

- **Instrument:** `scripts/measure-verb-adoption.mjs`, counting `type === "tool_use"` blocks by
  name. Not a text grep: the bare string `graph_` returns ~5,170 on one session because the
  deferred-tool catalogue is echoed into the prompt. A tool NAME is not a tool CALL.
- **Population:** every Claude Code transcript on `win32:stevenz-l` — 2.8 GB, 22 top-level
  sessions + 1,049 subagent sidechains, 9 project directories.
- **Controls, same pass:** positive `Bash`/`Read`/`Grep` = 62,049; negative (fabricated verb
  name) = 0; 5 unparseable lines reported.
- **Data:** `docs/measurements/verb-adoption-2026-08-25.json`.

## The seven, measured

| verb | session calls | subagent calls | total |
|---|---|---|---|
| `code_intel_references` | 27 | 10 | **37** |
| `graph_consequences` | 36 | 0 | **36** |
| `graph_callers` | 6 | 6 | 12 |
| `graph_pull` | 10 | 0 | 10 |
| `code_intel_hierarchy` | 5 | 5 | 10 |
| `graph_trace` | 6 | 3 | 9 |
| `graph_explore` | 6 | 3 | 9 |

**All seven are called.** `ef-manager`'s zero was a fact about `ef-manager`, not about the
population — exactly as they warned.

## ⭐ And the attribution is the finding

| verb | echoes | sand_castle | aify-project-graph |
|---|---|---|---|
| `graph_consequences` | 31 | 5 | **0** |
| `code_intel_references` | 13 | 14 | **0** |

The two heaviest of the seven are called **entirely by other agents in the game repos, and not
once from this repo**. Ranked by total calls across the fleet, `code_intel_references` and
`graph_consequences` are **3rd and 4th of eighteen verbs**.

⇒ Cutting on one consumer's enumeration would have removed two of the most-used verbs we ship.
That is [[enumeration-vs-detection]] with a live example attached.

## For comparison, the verbs 3c did drop

`graph_dashboard` **1**, `graph_digest` **1**, `graph_explain_diff` **0**. The *least*-used of the
seven (`graph_trace`, `graph_explore`, 9 each) outranks every dropped verb by roughly an order of
magnitude.

⚠ One drop looks wrong on this data: **`graph_index` at 26 session calls** — more than
`graph_search` (14). It was dropped as "a thing a human runs, not an agent mid-task", which the
counts do not support. Flagged, not reversed; that is dev's call too.

## Recommendation

**Keep all seven in the default listing.** No cut is supported for any of them, and two would be
actively harmful.

## ⚠ What these numbers are NOT

- **A call is not a benefit.** `graph_health` leads the whole set at 78 and is maintenance. The
  decision verbs here are `code_intel_references` and `graph_callers`.
- **One machine, 22 sessions.** Not a rate for anything beyond `win32:stevenz-l`.
- **Usage is not value.** These counts justify *not cutting* — a listing decision, where the cost
  of a wrong cut is an agent that cannot reach a verb it needs. They do not establish that any
  verb earns its schema cost. `tools/list` is the always-paid surface and that question is
  separate and still open.
