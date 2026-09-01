# FINDING — 20 of 24 absence-shaped verb files carry no evidence-scope statement

Preregistered at `PREREGISTRATION.md` before the census was built or run.

## Result

Registry control: **43** tools read from `mcp/stdio/tools/schema.js` (derived, not assumed).

| | count |
|---|---|
| verb source files scanned | 48 |
| with an absence-shaped path | 24 |
| reaching `buildAbsenceTrustLine` (EVIDENCE scope) | **4** |
| reaching only `noMatchMessage` (name help, NOT evidence scope) | 2 |
| reaching neither | 18 |

The four with an evidence-scope statement — `callers`, `callees`, `impact`, `neighbors` — are the
four call sites of `buildAbsenceTrustLine`, wired this session. **M2's stop condition is met for 4
of 24.**

Reaching neither: `code_intel_analyze`, `code_intel_live`, `consequences`, `explore`, `file`,
`health`, `lookup`, `module_tree`, `onboard`, `packet-live`, `packet`, `path`, `preflight`, `pull`,
`read_freshness`, `search`, `shader`, `trace`.

## The noun, kept separate

`HAS_SCOPE` in the raw census is **6**, and reporting that as M2 progress would conflate two
different producers. `buildAbsenceTrustLine` names the evidence boundary — the spine, its coverage,
the compile-DB state. `noMatchMessage` offers name suggestions when a symbol did not resolve. M2
asks "which TUs, which flags, was there a compile DB", so only the former answers it. `change_plan`
and `whereis` reach only the latter and are NOT counted as satisfying M2.

Also: these are verb SOURCE FILES (48), not registry tools (43) and not verbs. Some files are not
tools; some tools share a file. The ratio 20/24 is over absence-shaped files.

## What the census got wrong first, and how that surfaced

The first identity rule required `NO <CAPS> for`. `impact.js` emits
`NO IMPACT — no edges found for "${symbol}"` — an em-dash where the rule demanded `for` — so impact
was filed as having **no absence path while reaching two scope producers**. A self-contradictory
row.

The preregistered abandon rule did not catch it: it checked only that the census could see a scope
producer (via `callers`), so it controlled the scope half of the identity rule and left the absence
half uncontrolled.

The repair is structural rather than a wider regex: **a verb reaching an absence-scope producer has
an absence path by construction.** Rows where a producer is reached but the literal rule did not
fire are now printed as IDENTITY-RULE MISSES rather than silently absorbed — 2 remain
(`change_plan`, `whereis`), both real.

Effect of the correction: absence-shaped files 17 → 24, N/A 31 → 24. The first run under-counted
the population by 7.

## Claim ceiling, as registered

This reads SOURCE and reports REACHABILITY.

- It does **not** claim a reached producer emitted anything. `callers.js:93` records a scope note
  that threw on every call while its catch returned `''` — reached, inert, and the output looked
  unchanged.
- It does **not** claim anything about how often agents hit these paths.
- It does **not** claim the four scope statements are *sufficient*, only that they exist.

## Not yet done

M2's stop condition is "every absence-shaped answer carries a scope statement an agent can act on".
20 of 24 do not. ⚠ The plan also warns that recreating the warning wall the pilot agents skimmed
would undo M2's own purpose, so the remedy is not to paste the same paragraph into 20 more places —
the per-verb question is what scope each answer's reader is actually deciding against.

## ADDENDUM — reach: 2 of 16, not 4 of 24

"4 of 24" counts verb SOURCE FILES. The number that governs whether an agent ever benefits is
different, because the server lists a focused DEFAULT profile and long-tail verbs are not listed at
all. Both sets derived, neither hand-listed: `DEFAULT_TOOL_NAMES` from `mcp/stdio/server.js`,
verdicts from `census.json`.

| | |
|---|---|
| default-listed tools | **16** |
| default AND `NO_SCOPE` | 7 — `graph_packet`, `graph_pull`, `graph_consequences`, `graph_trace`, `graph_explore`, `graph_search`, `graph_health` |
| verbs reaching `buildAbsenceTrustLine` | `callees`, `callers`, `impact`, `neighbors` |
| **…of those, default-listed** | **`callers`, `impact` — 2** |

⛔ **HALF MY OWN COVERAGE IS UNREACHABLE BY DEFAULT.** `callees` and `neighbors` are not in the
focused profile, so an agent on the default surface never sees their scope statement. The honest
reach figure for M2 is **2 of 16 default-listed tools**, not 4 of 24 files.

This is the pattern already recorded as "quality of the unreachable": hardening something without
first asking who calls it. I wired four call sites because they were the four call sites, not
because they were the four an agent reaches.

⇒ Priority for the remaining work is the 7 default-listed gaps, and among those the
**action-authorising** ones first — `graph_consequences` answers "what breaks if I change this",
so an empty result there green-lights an edit. `graph_pull` / `graph_packet` are orientation,
`graph_search` is a locator, `graph_health` is a self-report.

⚠ `graph_whereis` shows as HAS_SCOPE in the raw census but reaches only `noMatchMessage`, which is
name help rather than evidence scope. It is not counted above.

## ADDENDUM 2 — re-measured after `structural_coverage` (and the census had drifted)

⛔ **THE CENSUS UNDER-REPORTED ITS OWN SUBJECT.** Its `SCOPE_PRODUCERS` list is hand-maintained.
`spineCoverage` was added to `graph_consequences` as the structured `structural_coverage` field, and
the census kept classifying that verb `NO_SCOPE` — the parallel-list defect, inside the tool built to
catch that class. Uncorrected it would have had me reporting 18 gaps when one was already closed.
A producer added without editing that line is invisible here; the list is now split so the FINDING
can separate the three questions the producers answer:

| producer | answers |
|---|---|
| `buildAbsenceTrustLine`, `spineCoverage` | EVIDENCE scope — what the answer was computed FROM |
| `unsearchedRelationNote` | RELATION scope — which relations were never consulted |
| `noMatchMessage` | NAME help — "did you mean", not a scope statement at all |

**Current, both sets derived:**

| | |
|---|---|
| absence-shaped verb files | 24 |
| with an EVIDENCE-scope statement | **5** — `callers`, `callees`, `impact`, `neighbors`, `consequences` |
| default-listed tools | 16 |
| **…with evidence scope AND default-listed** | **3** — `graph_callers`, `graph_impact`, `graph_consequences` |
| default-listed gaps remaining | 7 — `explore`, `health`, `packet`, `pull`, `search`, `trace`, `whereis` |

The reach figure moved 2 → 3 of 16, because `graph_consequences` is default-listed and is the one
verb among the gaps whose empty answer AUTHORISES AN ACTION ("what breaks if I change this").
`callees` and `neighbors` remain unlisted in the focused profile, so their scope statements are
still unreachable by default — coverage that exists and is not delivered.

**Not claimed:** that the seven remaining gaps all NEED an evidence-scope statement. `graph_health`
is a self-report about the graph, `search`/`whereis` are locators, `packet`/`pull` are orientation.
The plan warns that recreating the warning wall the pilot agents skimmed would undo M2's own
purpose, so the per-verb question is what decision each answer's reader is actually making — not
whether a clause can be attached.
