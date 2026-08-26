# The standing F-list, verified rather than recalled

2026-08-26. The loop prompt driving this work has carried F2/F3/F6/F7/F8/F10 as "REMAINING" for the
whole session, while my own notes said they closed long ago. Neither is evidence. This is what
happened when each was checked.

| item | status | how |
|---|---|---|
| F2 — `positionGuessSkipped` unit | **closed** | the reader-facing hint states it: *"BOTH ARE COUNTS OF SYMBOLS, not files"* (`collect_code_intel.js:371`) |
| F3 — cpp `compile_db_missing` preflight | **closed** | present in `compile-db.js`, `runner.js`, `code_intel_analyze.js` and `init-project-mcp.mjs` — including project init, which was the ask |
| F6 — EXTRACTED vs AMBIGUOUS rendered | **UNTESTABLE HERE** — see below | executed |
| F7 — stale lock names no cause/expiry/remedy | **closed** | executed against a genuinely held lock |
| F8 — interrupted index silently degraded | **closed** | `index-incomplete` verdict in `health.js` and `graph-capabilities.mjs` |
| `graph_callers` ambiguous false-zero | **not a defect** | executed; see `2026-08-26-ambiguous-match-is-not-a-false-zero.md` |

## F7, executed

A bare lock directory is not enough — `proper-lockfile` ignores it, the call succeeds, and the probe
proves nothing. That first attempt was discarded. Holding the lock the way the library itself does
produces the real message:

> *"…The lock is 3 minute(s) old. It becomes reclaimable automatically after 60 minutes — about 57
> minute(s) from now. A lock this old is either a peer still indexing a large repository, or a
> previous run that was killed and never released it. If you are certain no index is running, remove
> …/.write.lock.lock and retry."*

Cause, expiry with a computed countdown, and the exact path. The "3 minutes old" is correct rather
than a bug: the retry budget is roughly three minutes of polite waiting, so the lock genuinely is
that age by the time the call gives up.

## F6 cannot be answered by this repository, and that is not the same as fixed

What IS established, by rendering the real verb: `LSP_VERIFIED` edges carry `[lsp✓]` and `EXTRACTED`
edges carry no tag, so the **verified** tier is distinguishable —

    EDGE timer→emit CALLS tests/fixtures/hostile-kill-arm.mjs:55 conf=0.95 [lsp✓]
    EDGE fakeSpawn→emit CALLS tests/unit/code-intel/analyze.test.js:26 conf=0.90

F6 is about the **other** pair. Answering it needs a target with exactly one definition (so edges
render rather than a disambiguation banner) carrying **both** EXTRACTED and AMBIGUOUS incoming calls.
On this graph — 8,456 EXTRACTED, 656 AMBIGUOUS, 2,379 LSP_VERIFIED — there are **zero** such targets.

⇒ The pair cannot be placed side by side here, so the rendering cannot be compared. **A zero from an
instrument that cannot exhibit the condition is a corpus limit, not a result.** The original
observation was made on `click`, which is deleted.

## Two probe failures worth keeping

⛔ **My first F6 probe was void, by a rule I already carry.** I selected the most-called names — which
are precisely the *ambiguous* ones — so every sample returned the disambiguation banner and never a
rendered edge. Worse, my check `/AMBIGUOUS/` matched **"AMBIGUOUS MATCH"**, which is symbol-name
ambiguity, not the provenance tier I was asking about. *Same word, two meanings* is written in my own
standing rules, and I walked into it anyway. The repair was to constrain to single-definition targets
and strip the banner before testing.

⛔ **My first F7 probe could not reproduce the condition.** A bare directory is not a lock the library
recognises, so "no error" said nothing about the error path. Always ask whether the setup actually
created the state under test before reading its silence.
