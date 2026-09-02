# Preregistration — can a NEW swallowing catch be added around a trust builder?

**Written:** 2026-09-02, before the gate was built.

## Why

Two cycles fixed **13 sites by hand** where a trust builder's failure was swallowed into an empty
catch, shipping either a bare absence or a bannerless result. That closes the instances. **Nothing
closes the class** — the 14th can be added tomorrow, and the suite would stay green, because the
symptom is the *silent absence* of text.

This project's own repeated lesson: a rule maintained by remembering is not a remedy. The two fixes
are currently held by comments at each call site, which is exactly the state the
remedy-reachability invariant was in before it was made mechanical.

## Question

Does any call to a trust builder sit inside a `try` whose `catch` makes no assignment?

## Population — derived

Every call to `buildTrustLine` or `buildAbsenceTrustLine` under `mcp/stdio/query/`. These two are the
whole silent-failure surface, established by census this cycle:

- `unsearchedRelationNote` is **not** wrapped in a try at either call site (`callers.js:98`,
  `callees.js:113`) — it throws loudly, which is fail-closed and acceptable.
- `constructCoverageClause` is called only inside `buildAbsenceTrustLine` (`lsp-evidence.js:435`), so
  its failure is already covered by the absence disclosure.

## Identity rule

For each builder call, look ahead up to 8 lines for a `catch`. If one is found, its block must
contain an assignment (`=`). A catch that is empty or comment-only is a **violation**.

⚠ This is a **proximity heuristic, not a parser**. It cannot see a catch further away, or one whose
assignment is on a later line outside the window. Stated here so the gate is not read as a proof.
A builder call with no catch at all is not a violation — that fails closed, loudly.

## Finding schema

One row per violation: `{ file, line, builder, catchLine }`.

## Controls, same pass

- **POSITIVE — the scan finds the known call sites.** If it parses zero builder calls, "no
  violations" is vacuous. It must find at least 10 (13 were fixed by hand).
- **POSITIVE — the scan sees catches at all**, i.e. at least one builder call has a catch in window.
- **NEGATIVE — an assigning catch is NOT flagged.** Otherwise the gate would fire on the fix itself.

## Claim ceiling

Covers catches around **these two named builders** within an 8-line window. It says nothing about
other swallowed safety output elsewhere in the codebase, and nothing about whether the disclosure text
is any good — only that *something* is assigned instead of silence.

## Abandon rule

If the scan cannot locate the known call sites, report it as unable to run and conclude nothing — do
not report a clean zero from a blind scan.

## Decided in advance

- **Zero violations** → the hand fixes hold; gate them so the class is closed.
- **Any violation** → a site the two cycles missed; fix it before gating, and record that hand-sweeping
  13 sites still left one behind.
