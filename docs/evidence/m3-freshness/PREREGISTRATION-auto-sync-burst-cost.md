# PREREGISTRATION — should APG_AUTO_SYNC default ON? Written before any timing exists.

M3a asks one question: *"measure whether APG_AUTO_SYNC should default on"*. Today it is opt-in
(`mcp/stdio/sync/auto-sync.js`: `env[AUTO_SYNC_ENV_VAR] !== '1'` → `status:'disabled'`), debounced at
750ms, calling `ensureFresh({repoRoot})` on each burst.

## The reasoning this replaces

A comment in `ingest/fingerprint.js` records *"91% of reindexes on this repo already take 15s or
more"*, which reads as a decisive argument against default-on. It is not usable as-is: it is a
document, not a measurement of current code, and it does not distinguish EDIT KINDS.
`ensureFresh` has a TTL fast path with a commit guard, and P1-6 cosmetic-skip resolves a body-only
edit without re-extraction — so cost splits by what was edited, which is the thing to measure.

## Population

This repository, this machine, single bursts. 695 files carrying symbols, 3,012
`Function`/`Method`/`Class` nodes, 838 fingerprinted files.

## Identity rule — what counts as each burst kind

Each burst is ONE edit to ONE tracked source file, reverted before the next:

| kind | edit |
|---|---|
| **A cosmetic** | insert a `//` comment line |
| **B body-only** | change a string literal inside a function body, no call added or removed |
| **C signature** | add a parameter to a function declaration |
| **D added call** | insert a call to an existing in-file function inside a body |
| **E noop** | no edit at all |
| **F forced** | no edit, `force: true` |

## Metric

Wall-clock milliseconds of `ensureFresh({ repoRoot })`, plus whatever the returned object states
about which path ran. **Three repeats per kind, INTERLEAVED** (A,B,C,D,E,F,A,B,…) rather than
grouped — a grouped run on this machine has already produced a false pre/post verdict in this arc,
because load drifts over minutes and grouping aliases that drift onto the variable under test.

Reported as median per kind. A warm-up call runs first and is recorded separately, never folded in.

## Preregistered decision rule — fixed before the numbers exist

- **Recommend DEFAULT ON** iff `median(A) < 2000ms` AND `median(B) < 2000ms` AND
  `median(C) < 15000ms` AND `median(D) < 15000ms`.
  Rationale for the thresholds, stated now so they cannot be moved later: an agent's own tool calls
  run ~1–5s, so a background sync under ~2s for the common (cosmetic/body) case does not compete
  with them; structural edits are rarer and may cost more.
- **Recommend KEEP OPT-IN** otherwise.
- Any other outcome is reported as-is, not rounded toward a recommendation.

## Controls, required in the same pass

- **ORDERING CONTROL:** `median(E) <= median(A)` and `median(F) >= median(C)`. A noop must be the
  cheapest thing measured and a forced rebuild the dearest. If that ordering does not hold, the
  instrument is not measuring re-index work and every number is void.
- **POSITIVE CONTROL ON THE CHEAP PATH:** `median(F) / median(E)` must be > 2. If a forced rebuild
  is indistinguishable from a noop, the timer is not resolving the work at all.
- **MUTATION CONTROL:** each edit is verified APPLIED by re-reading the file before timing. An
  unapplied edit would silently measure kind E four times and report it as A–D.

## Abandon rule

If either control fails after one honest attempt, the result is reported as **UNMEASURED** with the
reason, and the default stays opt-in on the grounds that nothing was established. Loosening a
threshold or dropping a control to reach a recommendation is the failure this file exists to make
visible.

## Claim ceiling

One repo, one machine, one burst at a time, JavaScript. It says nothing about a large C++ repo,
nothing about sustained editing where bursts overlap a running sync, and nothing about the
watcher's own idle cost — only what one burst costs once the watcher has fired.

⛔ Safety: the tree is COMMITTED before any edit, every edit is reverted immediately, and the run
ends with a `git status --porcelain` check. `git checkout --` has eaten uncommitted work here.
