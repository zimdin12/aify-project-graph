# The seven verbs — the carrier and population the reviewer asked for

`the reviewer`, reviewing `b396c0a`: *"seven-verb ruling stays open absent its exact
carrier."* Right to refuse. Here it is, measured rather than recalled.

## The question

Phase 3c cut the default `tools/list` from 17 verbs to 15 — a **listing** decision; everything
stays callable. `the field test` advised on the rest and then explicitly refused on seven:

> *"zero calls is evidence I was not doing the work they serve. Do NOT let me be the reason those
> get cut — a drop decision on my numbers alone would be the consumer-enumeration mistake again."*

## Carrier

- **Instrument:** `scripts/measure-verb-adoption.mjs`, counting `type === "tool_use"` blocks by
  name. Not a text grep: the bare string `graph_` returns ~5,170 on one session because the
  deferred-tool catalogue is echoed into the prompt. A tool NAME is not a tool CALL.
- **Population:** every Claude Code transcript on `win32:stevenz-l` — 2.8 GB, 22 top-level
  sessions + 1,049 subagent sidechains, 9 project directories.
- **Controls, same pass:** positive `Bash`/`Read`/`Grep` = 62,762; negative (fabricated verb
  name) = 0; **5 unparseable lines, now localized.**
- ⭐ **The skipped lines are identified, not just counted.** A count is not whole-byte coverage: a
  recovered line can only ADD usage, so a per-project **zero** cannot be defended from a count
  alone — and "APG 0" is load-bearing below. Localized: 2 in `aify-comms`, 2 in `sand_castle`, 1 in
  `.minecraft`, and **0 in the aify-project-graph population**. The APG zero therefore stands, and
  the two in `sand_castle` could only strengthen the game-repo attribution if recovered.
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

**All seven are called.** `the field test`'s zero was a fact about `the field test`, not about the
population — exactly as they warned.

## ⭐ And the attribution is the finding

| verb | echoes | sand_castle | aify-project-graph |
|---|---|---|---|
| `graph_consequences` | 31 | 5 | **0** |
| `code_intel_references` | 13 | 14 | **0** |

⚠ **NARROWED — the instrument does not support the wider claim.** `perProject.topVerbs` covers
**top-level sessions only**; nested sidechains are pooled into one global tally that does **not**
retain project attribution. So:

- `graph_consequences` — 36 calls, **0 nested**, so the game-repo attribution holds for all 36.
- `code_intel_references` — **27 top-level** calls were all in the two game repos; the **10 nested
  calls are unattributed by this carrier**. "All 37 from the game repos" is NOT supported.

Ranked by total calls, they are **4th and 5th of eighteen verbs** — 3rd and 4th only *after
excluding `graph_health`*, which is maintenance. The original text wrote "across the fleet" beside
an exclusion it never stated.

⇒ Cutting on one consumer's enumeration would have removed two of the most-used verbs we ship.
That is [[enumeration-vs-detection]] with a live example attached.

**Ruling (`the reviewer`, 2026-08-25): all seven APPROVED to remain listed; `graph_index`
APPROVED to remain listed.** His reasoning for the keep is the asymmetry, not the counts: a
deferred host may be unable to call an unlisted verb *at all*, so cutting a demonstrated consumer
route has asymmetric harm. It establishes that zero-use reasoning is false for this population —
not that any verb earns its schema cost.

## For comparison, the verbs 3c did drop

`graph_dashboard` **1**, `graph_digest` **1**, `graph_explain_diff` **0**. The *least*-used of the
seven (`graph_trace`, `graph_explore`, 9 each) outranks every dropped verb by roughly an order of
magnitude.

⛔ **CORRECTION — I NAMED A DROP THAT NEVER HAPPENED.** This document originally said
`graph_index` "was dropped" and called it a decision of mine that looked wrong. It is **in
`DEFAULT_TOOL_NAMES`** (`mcp/stdio/server.js:152-202`) and always has been, and lines 204-239
record an explicit REFUSAL to drop it:

> *"BOTH of those verbs are in this set BECAUSE OF RECORDED HARM WHEN THEY WERE ABSENT, and a
> usage count does not address absence-harm evidence… graph_index 2026-06-01 Sand Castle A/B — a
> stale graph is WORSE than none for managed workers who got the read verbs but not this one.
> They could not act on the 'run graph_index' staleness warning because it was not in their
> surface."*

I read Phase 3c's **proposal** list in the roadmap and reported it as the shipped state, without
opening the file. Then I claimed authorship of it. `the reviewer` caught it against source.

⇒ What the 26 calls actually do: they **independently refute the proposed drop**. The implemented
keep is unchanged, and its original basis — absence harm — is the stronger of the two reasons.

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
