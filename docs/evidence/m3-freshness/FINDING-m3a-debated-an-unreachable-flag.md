# M3a has been arguing about the default of a flag nothing reads

**Date:** 2026-09-03
**Status: MEASURED, with a positive control.** No fix applied — this is filed, not acted on.

## What M3a says it is about

> **M3a:** measure whether `APG_AUTO_SYNC` should default on.

Four blockers accumulated under that question — idle cost, overlapping bursts, WSL `/mnt`, a large
C++ repo — and a full day of work today went into two of them.

## What is actually wired

Exhaustive search for `APG_AUTO_SYNC` and for imports of `sync/auto-sync.js`, excluding
`node_modules` and evidence files:

| reference | kind |
|---|---|
| `mcp/stdio/sync/auto-sync.js` | its own definition |
| `tests/unit/sync/auto-sync.test.js` | its own tests |
| `scripts/probe-max-wait.mjs`, `scripts/probe-sustained-edit-cost.mjs` | probes I wrote today |
| `docs/PLAN-agent-knowledge-system.md` | the plan describing it |

**No production caller. The MCP server never invokes `startAutoSync`, and nothing starts a watcher at
boot.**

⭐ **POSITIVE CONTROL, same pass.** The same search finds `startWatcher`'s real consumer immediately:
`mcp/stdio/query/verbs/watch.js:132`, behind the `graph_watch` verb, registered at
`mcp/stdio/tools/schema.js:88`. So the instrument can find a live consumer when one exists, and its
silence on `startAutoSync` is a result rather than a broken query.

## The reachability ladder, measured

| mechanism | reachable? | notes |
|---|---|---|
| git hooks -> `scripts/reindex.mjs` -> `ensureFresh` | **yes, automatically** | `post-commit`, `post-merge`, `post-checkout`, `post-rewrite`. This is what actually keeps a graph current today. |
| `graph_watch` verb -> `startWatcher` | **callable, NOT listed** | absent from `DEFAULT_TOOL_NAMES`; `tools/call` does not filter, so an agent reaches it only by knowing the name |
| `startAutoSync` / `APG_AUTO_SYNC` | **no** | no production consumer |

⇒ **The question "should `APG_AUTO_SYNC` default on" is malformed.** There is no default to flip,
because nothing consults the flag. Every blocker filed under it was gating a decision that could not
have had an effect.

## What this does and does not invalidate

**It does NOT invalidate today's measurements.** The probes drove `startAutoSync` -> `startWatcher` ->
the real `ensureFresh`, which is the same watcher `graph_watch` uses. The numbers — starvation,
duty cycle, staleness, the 86% incremental speedup — are about real mechanisms and stand.

**It DOES invalidate the framing.** Every one of those findings is written as an argument for or
against flipping `APG_AUTO_SYNC`, and that is a decision with no effect attached. The real questions
underneath are different ones:

1. Should `graph_watch` be in the default listed set? It is the only agent-reachable freshness
   control and an agent has to know its name to use it. ⚠ M4 measured that listing is not what
   governs reach (agents invoke 3 unlisted verbs by name), so this is a question, not a conclusion.
2. Is the git-hook path enough on its own? It is the only automatic mechanism, and it fires on
   commit — so an agent editing without committing is working against a stale graph, disclosed but
   stale, no matter what any watcher default says.
3. Should `startAutoSync` be wired, or deleted? It is a tested module with no caller.

## ⛔ This is the same defect class I have a standing rule about

The rule is: **check reachability with no arguments BEFORE any quality push.** I spent the day
measuring the cost, the correctness and the staleness characteristics of a module, and asked who
called it only at the end. The cost work was real and the numbers are good; the decision they were
gathered to inform did not exist.

⚠ **Filed, not fixed.** Deleting a tested module or re-listing a verb are both changes with their own
blast radius, and neither is authorised by having noticed this. The plan is corrected so it stops
directing work at the unreachable path; the three questions above are what a reviewer should weigh in
on.
