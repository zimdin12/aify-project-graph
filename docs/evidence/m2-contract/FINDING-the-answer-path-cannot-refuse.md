# The answer path cannot refuse

`graph_health` denies absence authority on this repository. `graph_callers` answers anyway, for
symbols in the same repository, in the same pass. The two surfaces disagree, and the one an agent
calls when it asks "who calls X" is the permissive one.

Probe: `scripts/probe-coverage-floor-vs-answer.mjs` (preregistered before the run, at `11ad91ad`).
Run: `docs/evidence/m2-contract/coverage-floor-vs-answer.txt`.

> ⚠ The extension is not cosmetic. This was first written as `.log`, which `.gitignore:4`
> excludes, so the finding cited a file that was not in the repository. The evidence gate caught
> it: *"a commit citing this file as proof would point at nothing in the repo."* A pointer you
> cannot resolve is not a pointer.

## Where the question came from

I asked ef-manager which of six absence clauses to cut. They declined the question and replaced it,
quoted verbatim:

> "LSP SCOPE at 73/627 = 11.6% is not a caveat, it is a CANNOT-ANSWER wearing an answer's clothes.
> A refusal that shares a channel with a result gets read as a result."

That is a correctness claim, not a byte-budget one, so it outranks the cut. This repository has prior
form for the shape: a collection covering 0.6% of the repo silenced `graph_health`'s only code-intel
warning (`collection-coverage-defect`).

## Measured, on running code

Spine coverage on this repository: **73 of 627 eligible files = 11.6%** carry compiler-verified
evidence. `compilerVerifiedEdges: 1002`.

| Surface | Verdict | Field read |
|---|---|---|
| `graph_health` | **DENIES** absence authority | `capabilities.absenceAuthority: false`, `reason: "collection_partial"` |
| `graph_callers` | **ANSWERS** — 12 of 12 callerless symbols returned `NO CALLERS` | the rendered answer text |

Controls, all in the same pass:

- **AUTHORITY GRANT** — `graphCapabilities` returns `true` on complete inputs, so `false` here is a
  fact about this repository and not a property of the function. PASS.
- **COVERAGE CAUSE** — the denial is `collection_partial`, a coverage reason, not `not_indexed` or
  `legacy_unattested` wearing this defect's clothes. PASS.
- **ANSWER SHAPE** — a symbol that *has* callers (`#onData`) returns a caller list, not an absence,
  so the shape detector is not manufacturing the absences above. PASS.

## Established by construction, not by sampling

`graph_callers` has exactly four terminal shapes, enumerated over the whole file:

```
ERROR: symbol parameter is required     — a caller bug, not a graph state
noMatchMessage(...)                     — NO MATCH
NO CALLERS for "<symbol>" ...           — twice
<results>
```

None is conditional on coverage. The verb never reads `absenceAuthority`, `graphCapabilities`,
`coverageComplete` or `collection_partial` — a search for all four in `callers.js` returns zero,
and the **same search finds them in `health.js`**, so the zero is the verb's silence and not the
instrument's.

⇒ No input can make `graph_callers` refuse. The gate that would justify a refusal is computed, is
correct, is tested — and the answer path does not call it. That is the FOURTH recorded instance of
the pattern in `quality-of-the-unreachable`: hardening something without asking who consumes it.

⚠ And it adds an edge the earlier three did not have. The gate is not merely unconsumed — it sits
on `graph_health`, the verb an agent calls ONCE at session start, while the question it governs is
asked mid-task by `graph_callers`. For an agent moving fast, a gate on the reflective surface and
not the reflexive one is the same as no gate at all.

## What did not work

⛔ **Two of my own instrument failures, and the first one produced a false "all clear".**

`graphHealth` returns an **object**. My first version did `String(await graphHealth(...))` and
searched the result for `absenceAuthority` — that string is the 15 characters `[object Object]`. The
field was absent from a rendering that does not exist, the probe recorded `GRANTS`, and the verdict
printed **"the surfaces agree — ef-manager's point does not apply here."** The permissive answer, from
an instrument that could not see either surface. I never asked what the text I searched was the text
*of*, which is the same wrong-carrier error this repo has recorded repeatedly.

⛔ **The verdict rendered while one of its own controls was failing.** The header preregistered four
controls; `controlsOk` enforced three. `COVERAGE CAUSE` printed `FAIL` on that same run and the
conclusion printed anyway. A verdict that survives its own failed control is decoration. Both are
fixed: the gate now requires every preregistered control, and it refuses out loud.

⚠ **A preregistered control could not fire at all.** `REFUSAL DETECTABLE` assumed an unindexed
repository was reachable. It is not — `graph_callers` indexes on demand, and a fresh git repo with one
source file answers `NO MATCH ... INDEXED SCOPE: 1 file`, having built an index by the time it
replied. My premise was wrong, not the verb. The control was replaced in place, on the record, by the
reachability check above; the amendment is written into the preregistration header saying what
changed and why, because a preregistration edited to match its result is worthless otherwise.

## What this does NOT show

⛔ It does not show any agent was misled. Whether a caveat in the same channel is read or skipped is
the M5 A/B, and this probe cannot touch it.

⛔ It does not locate the floor. A disagreement makes "what is the coverage floor?" a live question;
it does not answer it. 11.6% is one observation of one repository at one instant, and the honest
reading is that the number is not the point — the missing branch is.

⛔ It does not condemn the caveat. `NO CALLERS` here *does* carry `LSP SCOPE`, `TRUST` and
`INDEXED SCOPE`. The disclosure exists. What does not exist is the refusal.

## Open, for ef-manager

The remedy is not obvious and I am not shipping one on my own judgement. `INSUFFICIENT COVERAGE` as a
distinct shape is one option; gating only the *strength* of the absence claim is another; a floor
expressed per-symbol rather than per-repository is a third, and is the direction
`evidence.exhaustive` already points. Their `nextAction` string already says as much: *"per symbol,
read evidence.exhaustive on code_intel_references rather than inferring from this summary."*
