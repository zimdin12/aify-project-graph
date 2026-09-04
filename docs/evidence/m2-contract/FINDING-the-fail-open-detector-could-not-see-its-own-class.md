# The fail-open detector could not see the defect its class is named after

R1(c) asked for a **sweep** of the fail-open class rather than another one-off fix, on this repo's own
rule that *one fix is not a sweep*. The sweep instrument already existed — `scripts/hazard-inventory.mjs`,
reporting 36 `fail-open-catch` candidates. So the first question was not *what does it find* but
**does it find the ones we already know about.** A candidate count says nothing about recall.

## The audit, and what it returned

`scripts/audit-hazard-detector-against-known-defects.mjs` recovers each known defect's source with
`git show <fix>^:<file>` — the free positive control this repo already records — and runs the same
detector the inventory runs, imported from the same module.

| | before | after |
|---|---|---|
| `FINDING-contract-failed-open` — `callers.js` @ `7cd2e74f^` | **0 hits** | pre=3 post=2 ✅ |
| `FINDING-contract-failed-open` — `impact.js` | **0 hits** | pre=3 post=2 ✅ |
| `FINDING-results-banner-failed-open` — `callers.js` @ `8e0eb4e2^` | **0 hits** | pre=2 post=1 ✅ |
| `FINDING-results-banner-failed-open` — `callees.js` | **0 hits** | pre=3 post=2 ✅ |
| gitignore-negation — `git.js` @ `1e1a07d0^` | 0 hits | 0 hits ❌ |

**Recall on the known population: 0 of 5 → 4 of 5.**

The cause was structural, not a tuning gap. `failOpenCatches` requires a catch body of **exactly one
return statement**, and the defect the whole class is named after is an *empty* catch:

```js
let line = '';
try { line = '\n' + await buildAbsenceTrustLine({ ... }); }
catch { /* defensive */ }
```

Zero statements, so the rule could never match it. An agent received a bare `NO CALLERS` with no
TRUST, no SCOPE and no NOT MODELLED — byte-identical to a build without the feature — and the scanner
built to find fail-open code reported nothing. Same shape as `memory/instrument-vs-motivating-case`,
where a hazard scanner missed the defect it was built from.

### What is kept honest about that table

⛔ **The gitignore row stays a MISS.** Moving it to EXCLUDED would be defensible — a wrong *filter* is
not a swallowed error, so this detector class genuinely cannot see it — but reclassifying a row
*after* watching it fail is how a score gets flattered. It is a named gap, left in the denominator.

⛔ **The audit refused to render a verdict on its first run.** Its positive control failed (no pre-fix
file flagged), so every "MISSED" would have been a fact about the harness rather than the detector.
Gating on that control is the only reason the second run's result is readable.

⛔ **Claim ceiling: this is recall on a known, fixed, tiny population.** It says nothing about unknown
defects, and 4 of 5 does not mean the class is closed.

## The new rule, and why it is not just "flag empty catches"

`emptyCatchKeepsDefault` flags a catch with **no statements** over a try that assigned to a variable
declared **outside** it. Measured across `mcp` + `scripts` *before* the rule was written:

```
try/catch statements                              607
  catch bodies that are EMPTY                     193   (31.8%)
  ... over an assignment to an OUTER variable      71   (11.7%)
```

The discriminator is the outer assignment, not the emptiness. Flagging emptiness alone would nearly
triple the candidate set and catch nothing extra — and a detector that flags everything gets muted,
which is worse than absent because it looks like coverage.

## What the sweep then found — ONE live instance, in the trust builder itself

Adjudicated from the 71, starting with the highest-stakes paths. Five candidates sit in
`lsp-evidence.js`, the module that *builds the trust statement*:

| site | default kept on failure | verdict |
|---|---|---|
| `:223` `cpp` | `null` | **correct** — unknown stays unknown |
| `:558` `collection` | `null` | correct — falls back to a weaker generic line |
| `:607` `coverageIncomplete` | `false` | ⚠ **LATENT** — would fail open, but nothing reaches the catch (see below) |
| `:655` `stale` | `false` | ⛔ an unreadable HEAD reports the collection **current** |
| `:667` compile-DB probe | `false` | ⚠ deliberate — *"a probe failure must not fabricate staleness"* |

### The staleness one, reproduced and fixed

`stale === true` is what triggers the `FLOOR, not exhaustive` downgrade. The probe did not even have
to throw: `getHeadCommit(repoRoot).catch(() => null)` swallows the failure itself, and the guard read
`if (head && collection.indexedCommit && head !== collection.indexedCommit)`. With HEAD unreadable,
`stale` stayed `false`, no downgrade fired, and the collection earned:

```
TRUST: lsp-verified (clangd, index-ready, 1 caller, compile-db hash-A, collected 77d ago)
```

— the wording the server-instructions say licenses **"safe to delete"**, over a collection whose
currency nobody could establish. Reproduced live, not inferred.

⚠ **The asymmetry is the real finding, and it sits forty lines below in the same function.** The
*telemetry* unknown is handled fail-closed and argued in a comment: *"A missing measurement is not a
good measurement — treating absent telemetry as '0% unresolved' would grant the exhaustive banner on
exactly the collections we know least about."* That is this case word for word. The module already
held the rule and applied it to one unknown and not the other.

Fixed by making currency tri-state — `stale` / `current` / `unknown` — with the unknown branch placed
**beside** the telemetry branch, because keeping them adjacent is what stops one drifting back to a
silent default.

### The coverage one is LATENT, and I had it filed as live

I first recorded `:607` at the same ⛔ weight as the staleness defect and told a reviewer it was a
live instance I had chosen not to fix. **I had not checked that anything can throw into that catch.**

The obvious route is closed by code I had already read and not connected: `parseDb` in
`compile-db.js` swallows a malformed `compile_commands.json` to `null` internally, so a broken DB
never propagates. Probing `computeCoverage` directly with nine hostile inputs — nonexistent
`projectRoot`, null `projectRoot`, no arguments at all, a numeric `file`, null language, and the
typescript and python branches:

```
cases that THREW: 0 of 9
```

⇒ **`:607` is a LATENT fail-open, not a demonstrated one.** It would fail open the day something
throws into it, and nothing does today. It is not fixed, and "one fix is not a sweep" does not apply
to an instance that is not one.

⚠ **Claim ceiling on the correction itself:** nine probed inputs show I could not construct a throw,
**not** that none exists. That is a weaker and different statement than "unreachable".

⇒ **The protocol this earns, applied from here:** a candidate is written up at ⛔ weight only with a
*demonstrated route into the catch*. Without one it is filed as LATENT. One of the five candidates I
adjudicated was reproducible end to end and one was not, and nothing in the shape distinguished them
— only the attempt did.

⇒ **Live instances found by this sweep: ONE** (the staleness banner), not two.

## ⛔ And the first two mutants both survived, for two different reasons

**Mutant 1, on the detector.** Deleting the outer-name filter — the discriminator I had just argued
was the entire point — left all 21 tests green. The negative control read
`try { const x = g(); use(x); }`, which contains no assignment *expression* at all (`const x = g()`
is a declaration), so `assigned` was empty and the filter never ran on it. **The control asserted the
right outcome for the wrong reason.**

**Mutant 2, on the staleness fix — and this one nearly made me doubt a correct fix.** Neutralising
`currencyUnknown = true` left the test green. The cause was the *mutation*, not the fix: my new code
reads `else if (head !== collection.indexedCommit)`, so with the assignment removed and `head` null,
`null !== <sha>` fired and set `stale = true` — producing a *different* downgrade whose message
("HEAD has moved") was false. Printing the actual emitted line in both worlds is what separated them.

⇒ **A mutation that changes semantics is not the same as one that removes the fix.** The honest
mutant restores the pre-fix guard verbatim, and that one kills the test.
