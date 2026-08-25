# Census — every reader of `degraded` / `operationallyDegraded`

**Step 2 of the migration `graph-senior-dev` ruled on 2026-08-25.** He approved deleting both
booleans as a *target* and **refused immediate silent deletion**, requiring a versioned
fail-closed migration. Step 2 is this census, and it gates every later step.

His reason for refusing the quick removal, which is the one that matters:

> *"After deletion, `undefined` is falsy and `if (!evidence.degraded)` becomes true — the
> dangerous direction."*

That is the falsy-preservation trap this repo has already been bitten by: *"null is falsy so no
consumer changes"* is true for consumers that SKIP on falsy and exactly backwards for the one that
CLAIMS on falsy.

## Method and controls, same pass

- **Positive control:** `degraded` appears 100 times across `mcp/` — the term is live, so a zero
  in any category below is a finding rather than a broken search.
- **Negative control:** a fabricated `operationallyDegradedZZZ` returns 0 — the matcher is not
  matching everything.
- Writes (`degraded:`) are excluded from the reader counts; a producer is not a consumer.

## ⭐ Result: ZERO dangerous falsy reads of the contract field

The pattern dev warned about — `if (!evidence.degraded)` — **does not exist anywhere.**

⚠ One near-miss, checked and cleared. `providers/cpp-clangd.js:593` contains
`if (!degraded) refsCleanNotFoundSymbols += 1;`, which looks exactly like the hazard and feeds a
count whose own note reads *"Only `clean` counts as an observed absence."* It is a **local
variable** in the collection loop, not the evidence field. Deleting the contract field does not
touch it. Reported here because it is the first thing the next person will find and misread, as I
did for about a minute.

## Readers by surface

| surface | references | notes |
|---|---|---|
| `mcp/stdio/query` | 2 | one write, one read — the sticky-telemetry branch |
| `mcp/stdio/code-intel` | 0 | — |
| `tests` | 8 | assertions pinning `degraded === true` |
| `integrations` | 8 | skill text describing the field to agents |
| `scripts` | 0 | — |
| `docs` | 3 | prose |

**The only production reader is one branch:**

```js
// code_intel_live.js:896
if (evidence.degraded && evidence.cause && !STANDING_CAUSES.has(evidence.cause)) { … }
```

It is the sticky-degraded tracker, and it already **requires `cause`** alongside the boolean.

⛔ **RETRACTED 2026-08-25 — I CLAIMED THIS WAS A NO-OP AND IT IS NOT.** The original text here said
dev's step 5 was *"smaller than it sounds: the branch can drop the `degraded &&` term and read
`cause` alone without altering its behaviour, because `cause` is non-null exactly when `degraded`
is true."* I read that off the code. I did not exercise it.

**MEASURED** (`scripts/check-evidence-invariant.mjs`, 1,134 reachable combinations, both outcomes
observed as controls — 798 degraded-true, 336 degraded-false):

    violations: 336 of 1,134 (29.6%)
    every one the same shape:  degraded: false  ·  cause: 'unknown'

That state is deliberate — `ready: false, degraded: false, cause: 'unknown'`, *"usable result;
readiness signal missing"*. The answer is usable, nothing is degraded, `exhaustive` is withheld,
and the reason is named.

⇒ **Dropping the `degraded &&` term would make the sticky-degraded tracker fire on results that
are NOT degraded.** Step 5 is therefore **larger** than I told dev, not smaller, and the
equivalence is a precondition that must be re-established — not assumed — before any step treats
the two fields as interchangeable. The checker is kept as an instrument for exactly that.

## `operationallyDegraded` HAS crossed a release boundary

Dev's step 7 says remove it outright if it has not shipped, otherwise deprecate it in the same
window. Verified with `merge-base`: it entered at `b396c0a`, which **is** contained in `v0.7.0`
and therefore in `v0.7.1`. So it has shipped twice and takes the deprecation path, not deletion.

⚠ A tag existing is not the same as a consumer depending on it, and nothing here establishes that
anyone consumes v0.7.x. But "has crossed a release boundary" is the condition dev stated, and it
is met.

## What this census does NOT establish

- **External consumers.** Nothing in this repo can tell whether an installed integration outside
  it reads `evidence.degraded`. The 8 `integrations` hits are our own skill text, which we ship;
  a third-party reader would be invisible here.
- **That deletion is safe.** It establishes that the *specific hazard dev named* is absent from
  this codebase. Steps 1 and 3–8 are untouched.
- **Persisted records.** `schema_version: '0.2'` records carry a `cause` column; whether any
  stored payload embeds `degraded` is not audited here.

## Next steps, in dev's order

1. bump an explicit evidence-contract version — ✅ `e0fbddd`, `contractVersion: 1`
2. census — ✅ this document
3. absence authority to `exhaustive === true` only — already true in practice; needs asserting
4. diagnosis/rendering to `cause` — one branch, above
5. sticky telemetry to named cause — ⛔ **LARGER than I first claimed.** `cause` is NOT a drop-in
   for `degraded && cause`; see the retraction above. Needs a real classification, not a term
   deletion.
6. `degraded` retained as deprecated output — ✅ `e0fbddd`, `DEPRECATED_EVIDENCE_FIELDS`
7. `operationallyDegraded` deprecated (it shipped) — ✅ `e0fbddd`
8. delete both in the versioned contract, **with an old-reader hostile test proving an unknown
   schema REFUSES rather than reading a missing boolean as healthy** — test written in advance at
   `tests/unit/query/evidence-contract-version.test.js`; the deletion itself is not started and is
   blocked on step 5.
