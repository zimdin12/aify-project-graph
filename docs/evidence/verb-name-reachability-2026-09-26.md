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

⚠ **What this does NOT cover.** It checks that a named verb EXISTS, never that it is REACHABLE. A verb
can exist and still be unlistable — `mcp/stdio/hidden-tools.js` hides names from `tools/list`, and a host
that defers MCP tools behind a search step cannot reach an unlisted one. `server-instructions.js` already
carries that warning about `graph_report` specifically, which is a stronger failure than a wrong name and
is not what this probe measures. **Existence and reachability are separate questions and this answers only
the first.**
