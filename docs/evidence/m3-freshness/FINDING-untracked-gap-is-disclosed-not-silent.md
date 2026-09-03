# The untracked-file gap is DISCLOSED, and it is not caused by auto-sync

**Date:** 2026-09-03
**Supersedes the M3a correctness objection in** `FINDING-watcher-misses-new-files.md`
**Status: MEASURED.** Probe: `scripts/probe-untracked-disclosure.mjs`.
Run: `RUN-untracked-disclosure-probe.txt` (six arms, controls in the same pass, all PASS).

## What the earlier finding concluded, and why it needed re-measuring

FINDING-watcher-misses-new-files.md (2026-09-02) closed with:

> **default-on would silently miss every newly created file**, which is a correctness objection far
> stronger than any timing one.

Two words in that sentence are load-bearing, and **both are now false**. The finding was written the
day BEFORE the absence-disclosure work landed, so it described a real state of the world that has
since changed. It is not being corrected for sloppiness; it expired.

## 1. "silently" — refuted

An agent that asks about a symbol in a brand-new untracked file gets this, verbatim from the run:

```
NO MATCH for "brandNewFn". Try graph_search(query="brandNewFn") to find similar names.
NOT COVERED: src/newthing.js (untracked) — uncommitted, so not indexed. Commit or graph_index({force:true}) before treating this as absent.
```

The file is named, the reason is named, and a remedy is named.

| arm | what it rules out | result |
|---|---|---|
| C1 instrument — `graph_callers('baseFn')` finds a real caller | every absence below being vacuous | PASS |
| C2 discriminator — clean tree, absent symbol | the clause being decoration printed always | PASS (no clause) |
| T — the case, through `graph_callers`, `graph_callees`, `graph_impact` | one call site composing it by luck | PASS on all three |
| C3 remedy — `force:true`, then re-query | the disclosure recommending something untrue | PASS (`NO CALLERS`, not `NO MATCH`) |
| C4 case C — commit the file, then a plain incremental index | the indexer being at fault after a commit | PASS (arrives with no force) |

⚠ **C4 RUNS IN ITS OWN REPO, and that is required rather than tidy.** C3 above ran `force:true`,
which had already pulled the file in; asking that same repo whether a COMMIT would have indexed it
could only ever answer yes. A control that cannot fail is not a control.

⭐ **Three verbs, not one.** One verb passing would only show that one call site composes the clause.
The claim worth making is that the disclosure sits on the SHARED absence path, and that needs
independently-written call sites to agree. They do.

A second surface carries it too: `graph_health` names the same fact on a dirty-but-untracked tree
(`mcp/stdio/query/verbs/health.js:1886`), so the orientation path and the absence path agree.

## 2. "default-on would..." — a category error

The gap is a property of the **untracked deferral**, not of the watcher and not of `APG_AUTO_SYNC`.

Incremental indexing already runs with the flag OFF. The product installs four git hooks —
`post-commit`, `post-merge`, `post-checkout`, `post-rewrite` — and each runs
`scripts/reindex.mjs`, which calls `ensureFresh({ repoRoot })` at line 57 with `force` defaulting to
false. That is the same incremental path, on every commit, with `APG_AUTO_SYNC` playing no part.

⇒ **The untracked gap is identical with the flag on and with it off.** A blocker for flipping a flag
has to name a defect the flag introduces. This one names a defect that is fully present without it,
so it cannot carry the argument either way.

## What this does NOT establish

- **Case C is NARROWED, not closed.** C4 shows a committed new file arrives through a plain
  incremental index with no force. That is the DIRECT path, and the old finding's case C was observed
  **through the watcher**. So the indexer is exonerated and the remaining suspect is the watcher
  route alone — which is a smaller unknown than before, and still an unknown. ⛔ Do not read C4 as
  "case C is fixed": nothing in this run drove the watcher.
- **One platform, one language.** win32, node v22.20.0, a small JS fixture repo. Not reproduced on
  Linux or macOS, and not on a C++ repo.
- **Nothing about the other blockers.** Overlapping bursts (blocker 2) was never exercised; WSL
  `/mnt` and a large C++ repo are untouched.
- **Not an argument to flip anything.** Retiring a bad reason to hold M3a is not a reason to release
  it. The three real blockers are unmeasured, and the default stays where it is.

## Consequence for M3a

M3a stays **HELD** — on three open blockers instead of four, and none of them is correctness of the
untracked path. The value of writing this down is that the retired blocker was the STRONGEST-sounding
one, and a summary that leads with a correctness objection stops work in a way a timing objection
does not.
