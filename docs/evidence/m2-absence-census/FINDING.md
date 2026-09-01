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
