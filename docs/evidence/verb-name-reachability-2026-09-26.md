# Does any agent-facing text here name a verb that does not exist?

**Measured 2026-09-26. Answer: NO. Zero.** And the guard that would enforce it is **deliberately not
built** — reason below, so the non-start is a decision rather than an omission.

## Why it was checked

dashboard-manager found this in their own service and passed it over: the text they inject at the start
of an agent's turn told agents to call `dashboard_state_save`. **No such tool exists** — it is
`dashboard_state_update`. The code was correct, the text was delivered, and the thing it asked for was
impossible: a PROVEN feature whose entire output was an instruction nobody could follow. Worse, a test
they had written **froze the wrong name**, because a test naming a tool by hand is exactly as likely to be
wrong as the text it checks.

This repo has the same surface: `mcp/stdio/server-instructions.js` is injected prose that names verbs,
plus `AGENTS.md`, 68 `SKILL.md` files across four integrations, and the generated briefs.

## The probe, and its controls

Ground truth is derived, never listed: `TOOLS` from `mcp/stdio/tools/schema.js` (43 names). Agent-facing
text is scanned for `graph_*` / `code_intel_*` tokens and each is required to be in that set.

```js
const { TOOLS } = await import('./mcp/stdio/tools/schema.js');
const real = new Set(TOOLS.map((t) => t.name));
const named = [...new Set([...text.matchAll(/\b((?:graph|code_intel)_[a-z][a-z_]*[a-z])\b/g)]
  .map((m) => m[1]))].sort();
const absent = named.filter((n) => !real.has(n));
```

| control | result |
|---|---|
| POSITIVE — registry non-empty and contains a known verb | `43 names`, `graph_health` present |
| POSITIVE — a real verb is actually found in the scanned text | `graph_health` matched |
| NEGATIVE — a fabricated name is reported absent | `graph_zzq_not_a_verb` → absent |

## Result: 0 real defects, and both hits were false positives

76 files scanned. Two tokens flagged, **both explained by context and neither a defect**:

| flagged | where | what it actually is |
|---|---|---|
| `graph_export` | `AGENTS.md:207` | "**A future** `graph_export` verb could also unblock cross-tool consumers." Explicitly hypothetical, correctly worded, and naming it is the point |
| `code_intel_live` | `.aify-graph/brief.plan.md:19` | a **FILENAME** — `mcp/stdio/query/verbs/code_intel_live.js`. The regex matched a path stem, not a verb reference |

`server-instructions.js` — the closest analogue of dashboard-manager's injected text — named 21 verbs,
**all 21 real**.

## ⛔ Why the guard is NOT being built

**Every hit was a false positive.** A guard with a 100% false-alarm rate on this corpus costs more
attention than it saves, and a doubt costs a reader as much as a claim. Making it usable would need it to
skip filename contexts and permit explicitly-future mentions — i.e. an **exception allowlist**, which is
a list someone must remember to update, which is a defect with a delay on it.

⇒ So: the measurement is the deliverable. **0 unreachable verb names today**, with the controls that make
that zero mean something, and no guard. If a real instance ever appears, this note is where the probe and
its two known false-positive shapes already are, and the shape to fix first is the regex rather than the
prose.

## Part 2: reachability — the limit above, DISCHARGED rather than left as a note

The first version of this note said existence and reachability are separate questions and that only the
first was answered. Leaving that as prose would be the fourth undischarged hazard in this arc, so it was
measured. `docs/evidence/curated-name-parity.mjs`, output in `curated-name-parity-output.txt`.

**Prompted by dashboard-manager's second arm:** their bridge conformance test CALLS every advertised name
through a third-party MCP client and asserts none answers "no such tool" — and they found that a
comparison written first stayed green under a planted rename, because both sides read the same array.

**That arm is UNREACHABLE here, and only reading the code earns the right to say so:**

- `server.js:575` dispatches via `ACTIVE_TOOLS.find(t => t.name === name)`.
- `tools/list` is built from `selectListedTools(...)`, which is `TOOLS.filter(...)` in **every** branch —
  lean, code-intel and full. A filter of the same array, never a parallel list of names. All three read.
- all 43 registry entries carry `handler`, and `typeof handler === 'function'` for all 43.

⇒ A listed name always resolves to a callable handler, so "a listed tool answers no-such-tool" is
unreachable, and an arm for it would test a case nothing can produce.

## ⭐ But chasing it found the one place this build CAN fail silently

`selectListedTools` filters `TOOLS` against **hand-maintained Sets of NAME STRINGS**. A misspelled name in
one of those Sets is not an error: the filter drops it, the profile advertises fewer verbs than intended,
and **nothing says so.** AGENTS.md claims lean shows 6 — a typo would make it 5, quietly.

⇒ **The general class, which is the transferable part: a curated set of name strings filtered against a
registry fails SILENTLY on a typo.** It is a different shape from a wrong name in prose, which fails
loudly at the call site. This one fails as a verb quietly absent from a profile.

| curated set | names | absent from `TOOLS` |
|---|---|---|
| `LEAN_TOOL_NAMES` | 6 | **0** |
| `CODE_INTEL_TOOL_NAMES` | 11 | **0** |
| `MUTATING_TOOLS` | 14 | **0** |
| `HIDDEN_FULL_TOOL_NAMES` | 11 | **0** |

Lean's 6 matches AGENTS.md's stated 6. Controls: a known name present, a fabricated name absent, and — the
one that matters — **a set whose extraction found NOTHING is reported as "NOT a pass"**, because a regex
that matched nothing and four genuinely clean sets look identical.

⭐ **AND THE PROBE WAS WATCHED REPORTING A PLANTED BAD NAME, which the controls above do NOT establish.**
Those controls prove the *predicate* can answer absent; they say nothing about whether *this probe* surfaces
a bad curated name. So `'graph_zzq_planted_typo'` was inserted into `LEAN_TOOL_NAMES` in `server.js` and the
probe reported:

    ⛔ LEAN_TOOL_NAMES  names 7  absent-from-TOOLS 1  ["graph_zzq_planted_typo"]
    TOTAL curated names absent from TOOLS: 1

Then restored from a byte-for-byte backup (`git diff` empty) and re-run clean at 0. **A control on the
predicate is not a control on the instrument** — the distinction that cost four rounds elsewhere in this
arc.

⚠ **Portability was also a false claim in the first version of this probe**, which hardcoded
`C:/Docker/aify-project-graph`. "Rerunnable" was then true on one machine at one checkout. The root is now
derived from the script's own location and the probe was run from a different working directory as the
control.

⚠ **THE DEPENDENCY, named at the finding rather than in a plan.** All of Part 2 rests on LISTED being a
FILTER of `TOOLS`. If the listed set is ever built from a separate constant, the unreachability argument
collapses, dashboard-manager's arm (a) becomes worth building immediately, and this measurement expires.
That is the same shape as a cascade behind `foreign_keys = OFF`: a structural guarantee is only as good as
the structure, so the structure is what gets re-read.

⚠ Still not covered, and now the only open half: a verb can exist, be callable, and still be **unlistable**
— `hidden-tools.js` hides names from `tools/list`, and a host deferring MCP tools behind a search step
cannot reach an unlisted one. `remedy-reachability.test.js` already enforces the related rule mechanically
("a LISTED verb must not name an UNLISTED one"), and `server-instructions.js` carries that warning about
`graph_report`. So this half has a guard; it simply is not this probe's.
