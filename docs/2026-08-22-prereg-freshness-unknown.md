# Preregistration — a freshness check that could not look must not report "clean"

**Status: PREREGISTERED, NOT YET IMPLEMENTED.** Written before any code change.

## Three defects, one shape, found by sweeping a fix I had already made

I repaired `safeDirtyCount` in `packet-input.js` earlier today: a failed git query returned `0`
rather than a typed unknown. **I did not sweep for the same shape in the other consumers of the same
query.** One fix is not a sweep — for the third time this session.

| site | on git failure | what is lost |
|---|---|---|
| `read_freshness.js:141` | `getDirtyFileEntries(...).catch(() => [])` | `trackedDirty.length === 0`, so the tracked-modification warning is **never emitted** |
| `read_freshness.js:140` | `getHeadCommit(...).catch(() => null)` — honest — then `stale = Boolean(manifest.commit && head && …)` | unknown HEAD silently becomes **not stale**; no staleness warning |
| `health.js:313` | `getDirtyFileEntries(...).catch(() => [])` | the DIAGNOSTIC verb reports **0 tracked, 0 untracked** |

⛔ **The comment above the first one states its own stakes:**

> *"This warning is the only thing standing between a user and a stale answer, so it keys on the one
> number that means drift."*

⇒ And a failed git query silences exactly that warning. The guard is disabled by the condition it
exists to report.

⚠ **The second is the sharper one.** `getHeadCommit` already returns `null` honestly — the typed
unknown exists and is correct. The CONSUMER discards it: `head &&` treats unknown as false, which
reads as "not stale". That is the same shape as `find.js` ignoring `overlay.error`: **an honest
producer whose consumer throws the honesty away buys nothing.**

⚠ And `orchestrator.js:207` calls the same helper with NO catch — it propagates. So three consumers,
two swallow, one does not. The inconsistency is not the defect but it is why the defect was easy to
write.

## Induction, verified BEFORE designing the controls

    getDirtyFileEntries(<non-repo dir>)  ->  THREW "Command failed: git status --porcelain"

So the `catch` genuinely fires and a control aimed at it can discriminate. (Checked because on
`safeDirtyCount` this question exposed that a neighbouring helper swallowed what that one propagated
— had it been wrapped the other way, the fix would have changed nothing and its control would still
have been green.)

## Preregistered controls

### C1 — a failed dirty query produces an UNKNOWN warning, not silence
- **Honest:** the reader is told the working-tree state could not be determined.
- **Hostile (today):** no warning at all, which reads as a clean tree.
- **Discriminates because:** warning-list membership differs.

### C2 — an unknown HEAD does not read as "not stale"
- **Honest:** staleness is UNKNOWN and says so.
- **Hostile (today):** `stale === false`, indistinguishable from a genuinely current graph.

### C3 — POSITIVE CONTROL: a healthy repo emits NO new warning
- ⛔ **The over-correction world, and the one that matters most here.** Every read verb prints these
  warnings. A change that emits an unknown-state caveat on ordinary runs would put permanent noise
  on every read in the product — correct and ruinous, and it would train readers to ignore the line
  that matters. This is the third time today the dangerous direction has been over-correction.
- **Discriminates because:** the healthy path's warning list must be **unchanged**, not merely small.

### C4 — a genuinely dirty tree still warns exactly as before
- Only the FAILURE path changes. A clean tree stays silent, a dirty tree keeps its existing wording.

### C5 — untracked files still do not trigger the tracked warning
- ⚠ The field report this guard was built from: 592 untracked / 0 tracked, one verb warned "592
  dirty" and another "4 dirty" for the same tree. Tracked-only is CORRECT and must survive this
  change untouched.

## Falsification, registered before the run

- a failed query still yields no warning → **the fix did not work**;
- a healthy repo gains a warning → **over-applied; permanent noise on every read**;
- an untracked-only tree warns about tracked modifications → **the field-report defect is back**;
- the induction does not throw → **the control never ran** and nothing here counts.

## Out of scope

- `orchestrator.js:207` is unchanged: it already propagates.
- The SNAPSHOT line's separate untracked-disclosure gap (two parties found it independently) is its
  own slice and is NOT bundled here.

---

# AMENDMENT — written before implementation, after enumerating the population mechanically

⛔ **My three-site table above was produced by eye and was wrong.** Enumerating every call site of
the freshness git helpers gives **21 sites across 12 files**, and one of them is worse than anything
in the original table.

## ⛔⛔ THE ONE I WOULD HAVE SHIPPED PAST

    search.js:309   if (freshnessState && !freshnessState.stale) ruledOut.push('the index is fresh');

This runs inside the NO-RESULTS explanation and prints **"Ruled out: the index is fresh."** It does
not merely stay silent on an unknown — it **affirmatively exonerates the index** for an absence,
using a `stale=false` that came from a git query that never ran. An unknown promoted to an
exculpatory claim, in the exact verb where a reader is deciding whether "not found" means "not
there". Same class as [[absence-claim-defect-class]].

⛔ **AND IT BREAKS MY INTENDED DESIGN.** I was about to make `stale` a tri-state `true|false|null`
and reason that "`null` is falsy, so every existing `if (stale)` consumer keeps its behaviour and I
cannot over-correct." That reasoning is correct for three consumers and **exactly backwards for this
one**: `!null` is `true`, so falsy-preservation *preserves the defect* at the only site that turns
the value into a positive claim. A design justified by "nothing else changes" is only as good as the
consumer audit behind it, and mine was one grep short.

⇒ `search.js` must test `=== false`. Registered here because I want the record to show the design
was wrong before the tests were, not after.

## The population, classified by what the swallowed value BECOMES

⚠ Severity is decided at the BOUNDARY — by what a value is *named and claimed*, not at the `catch`
where it originates.

**IN SCOPE — the value becomes a trust verdict shown to a reader:**

| site | swallowed | becomes |
|---|---|---|
| `read_freshness.js:141` | dirty → `[]` | the tracked-dirty warning is never emitted |
| `read_freshness.js:140,143` | head → `null` | `stale=false`; no staleness warning |
| `read_freshness.js:37` | — | `staleNotFoundCaveat` returns `''`; a not-found loses its caveat |
| `health.js:313` | dirty → `[]` | the DIAGNOSTIC verb prints "0 tracked, 0 untracked" |
| `health.js:306,317,246` | head → `null` | `stale=false`; the "graph is behind HEAD" recommendation is withdrawn |
| `search.js:309` | — | **"Ruled out: the index is fresh"** — an affirmative claim |
| `status.js:14,15` | both | `dirtyFiles: []` and `currentHead: null` reported as the state |

**DELIBERATELY OUT OF SCOPE — advisory enrichment, named so a clean commit cannot imply coverage:**

- `change_plan.js:475`, `consequences.js:268`, `pull.js:1328` — dirty **seams**. An empty seam list
  is a weaker claim than a trust verdict, but it is still a claim. **Own slice, not fixed here.**
- `explain_diff.js:240` — `changedFiles` fallback.
- `cpp-clangd.js:148`, `lsp-collect.js:140`, `lsp-evidence.js:229`, `server.js:694,720` — these
  already return `null` honestly and **store** it rather than claiming from it.
- `orchestrator.js:207`, `brief/generator.js:485` — no catch; they propagate. Correct already.
- `packet-input.js:154` — fixed earlier today; it is what started this sweep.

## Design

A `WorktreeState` class owns the concept: *the working tree as observed, or the explicit fact that
it could not be observed.* One place runs both git queries and records which one failed, so the
disclosure wording is derived rather than re-typed at seven call sites.

- `stale` becomes `true | false | null`.
- `disclosures()` returns **`[]`** when everything was observable — the over-correction guard, and
  the control that matters most, since these lines print on every read in the product.

## Additional falsification

- `search.js` still prints "Ruled out: the index is fresh" under an unknown HEAD → **the worst
  instance survived**, and the slice failed regardless of what else went green.

---

# RESULT — measured, with both arms run

## Induction, proven before the controls were designed

    getDirtyFileEntries(<non-repo>)  THREW   "Command failed: git status --porcelain"
    getHeadCommit(<non-repo>)        THREW   "Command failed: git rev-parse HEAD"
    getDirtyFileEntries(<this repo>) OK      1 entry
    getHeadCommit(<this repo>)       OK      a8c3f158d50b
    probe exit 0

⚠ The probe's FIRST run exited 1 without executing a single assertion — a relative import resolved
against the script's directory instead of the cwd. **The negative control is what exposed it.** Had
the probe only asserted "throws", `ERR_MODULE_NOT_FOUND` would have read as a proven induction.

## Arm 1 — the controls against PRE-FIX source (`a8c3f15`, disposable worktree)

    5 failed | 0 passed

Each failed on the assertion naming the defect, and — the check that matters —
**the positive control inside each test PASSED first**:

| test | pre-fix failure |
|---|---|
| C6 laundering | `expected 'NO RESULTS…' not to match /the index is fresh/` |
| C6 disclosure | `expected 'NO RESULTS…' to match /could not read HEAD/` |
| C1/C2 channel | `unknown is null — not the false it used to be: expected false to be null` |
| caveat tri-state | `must not be silent: expected '' to match /could NOT be determined/` |
| graph_status | `no longer PRESENTED as a measurement: expected false to be true` |

⇒ The healthy-arm assertions passing under pre-fix source is what proves the red is the **defect**
and not a broken fixture.

## Arm 2 — the OVER-CORRECTION, because a guard nobody watched fail is a rumour

C3 passed in both arms above, so it was **unproven**. `disclosures()` was mutated to emit
unconditionally — the plausible wrong version of this fix — with a site count (`SITES_FOUND=1`,
exact-equals) and a before/after hash proving the mutation was not inert.

    5 failed | 9 passed

C3 caught it, along with four siblings. ⭐ **And the C6 laundering tests stayed GREEN** — over-
disclosing does not reintroduce the false claim. Each arm fails a *different* set, so the controls
discriminate in both directions rather than merely detecting "something is broken".

## Gates

| gate | result |
|---|---|
| `refactor-guard --verify` | **61/61 corpus entries identical**, routes 6/6, exit 0 |
| `authority-ledger --check` | ALL FILES COMPLETE: true (examined 6), exit 0 |
| `npx vitest run` | **338/338 files, 2682 passed, 4 skipped, exit 0** |

⛔ **The first baseline I took was worthless and I nearly used it.** I ran `--baseline` *after*
editing, so `--verify` would have compared the new tree against itself and passed vacuously. The
baseline above was retaken from the pre-fix tree, which makes 61/61 a real over-correction check:
the fix added **zero** drift to the healthy routes.

⚠ **Carrier:** 2682 tests on this checkout, Windows 11, node v22.20.0, vitest 3.2.4. That figure is
about this machine, not about the repo on anyone else's.

## Two instrument failures caught in flight, both of which reported success

1. A `python -c "…"` with backticks let the shell run `currentHead:` and `dirtyFiles:` as
   **commands**; the writer printed `OK` and `node --check` passed. Only `git diff` showed two
   comments with their content eaten. ⇒ Grade an edit by the diff, never by the writer's exit code.
2. `git stash push` / `pop` round-tripped `search.js` through the repo's `eol=lf` normalisation, so
   the restore hash did not match. Content was intact (the diff is exactly the 7-line insertion) and
   the committed bytes are identical either way — but **the hash net is the only reason I know
   that** rather than assuming it.

## Also caught: the repo's own meta-guard refused my tests

`negative-assertions-are-controlled` failed the first full run: *bare `not.toMatch` count is 156,
baseline 154.* I had written two bare negative assertions — absence asserted by a matcher never
proven able to fire, which is this slice's own defect one level up. Both now go through
`expectAbsentWithLiveMatcher`, which proves the matcher fires on a forbidden canary and rejects an
allowed one before asserting absence.

## What is NOT fixed, restated so this commit cannot imply coverage

`change_plan.js:475`, `consequences.js:268`, `pull.js:1328`, `explain_diff.js:240` still swallow a
failed dirty query into `[]` for **dirty-seam enrichment**. Lower severity — an empty seam list is a
weaker claim than a trust verdict — but it is still a claim, and it is **not fixed here**.
