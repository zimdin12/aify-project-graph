# FINDING — the ts collection is not reproducible run-to-run, and one guard exclusion is named

Status: **warning-level**. The reproducibility observation is asserted; the mechanism is not.

## Preregistration (fixed before the numbers existed)

- **Population**: the first 12 `.js` files of `mcp/stdio/query/verbs`, sorted, from a single
  FROZEN corpus (`C:/Docker/aify-project-graph` at `6ca18a9`), read by the real
  `ts-langserver` provider. One corpus, shared by both arms, so only the CODE varies.
- **Arms**: `pre` = `702d09d` (validator wired in cpp-clangd only), `post` = `6ca18a9`
  (three-phase admission wired into lsp-collect). Separate git worktrees.
- **Identity rule**: a record is `kind|file|line|col|name`, sorted, hashed.
- **Claim ceiling**: with n=3 per arm this may report that variation EXISTS. It may not
  report a rate, a cause, or that any arm is deterministic.
- **Controls**: (1) each arm in its OWN process — an earlier A/B in this arc was void because
  both arms shared one process and one module load; (2) each arm prints the sha256 of the
  `lsp-collect.js` it actually imported, so "identical" cannot mean "the same build twice";
  (3) an arm producing zero records exits 3 and is excluded, never averaged in as agreement.

## Result

Carriers differed as required: pre `ca99d5e9002e0c29`, post `2a332de40773b39b`.

| arm | records across 3 runs | membership hashes |
|---|---|---|
| pre  | 7489, 7458, 7489 | `ee4254e1…`, `c5ac196c…`, `ee4254e1…` |
| post | 7488, 7488, 7488 | `87e6e0c4…` ×3 |

**The pre arm is not reproducible.** Identical code over an identical corpus produced two
distinct membership states. The swing is 31 records and is CONCENTRATED, not scattered:
`analytics_verbs.js` 18, `intelligence/analytics.js` 10, `read_freshness.js` 6,
`code_intel_analyze.js` 2; 32 of 36 are references.

**One guard exclusion is named**, from the post arm's own output — this does not depend on the
differential:

```json
{ "method": "textDocument/definition", "reason": "token_unverifiable",
  "uri": ".../mcp/stdio/query/verbs/consequences.js", "qname": "'in-progress'" }
```

`'in-progress'` is an OBJECT-LITERAL KEY (`consequences.js:48`,
`{ in_progress: 3, 'in-progress': 3, ... }`) that tsserver reports as a document symbol. It
fails `PLAIN_IDENTIFIER`, so it is classified UNAVAILABLE_UNVERIFIED — an honest "not checked",
never a mismatch accusation — and excluded fail-closed. The pre→post membership diff
independently shows a definition in that same file present in pre and absent in post.

## What is NOT claimed

- **NOT that post is deterministic.** Three runs showed no variation. That is absence of
  observed variation at n=3, not a property of the code, and no mechanism is known by which a
  read-caching refactor would change language-server timing.
- **NOT that the refactor removed nondeterminism.** Same reason.
- **NOT a cause for pre's instability.** `lsp-collect.js:427` retries once after 30ms when
  references come back empty, which would race an asynchronously-warming server. That is a
  CANDIDATE, untested here.
- **NOT a rate.** n=3 supports "variation exists", nothing quantitative.

## Instrument defects found while running this

- The identity rule was WRONG on first use: records carry `qname`/`range`, not `line`/`col`/`name`,
  so the dump read `definition|file|||` and the hash collapsed to a per-file multiset of kinds.
  The reproducibility result survives (per-file counts still differ) but individual symbols could
  not be named from it. The named exclusion above comes from the provider's own
  `unverifiedLocations`, not from the membership dump.
- Both arms first crashed identically with `ERR_MODULE_NOT_FOUND` (`better-sqlite3`) because a
  worktree has no `node_modules` — the exact shape that produced a false IDENTICAL earlier in
  this arc. Fixed by resolving the binary through the corpus, and by the refuse-empty guard.
- The runner reported `exit code 0` for two crashed arms, and later `exit code 1` for two
  successful ones: both times the status came from a trailing command, not from `node`.

## Correction to an earlier reading

A first pass showed pre 7489 / post 7488 and `unverifiedLocationsExcluded: 1`, and I reported the
guard as demonstrably non-inert on the strength of that exact match. With pre varying by 31
records between its own runs, a 1-record count delta cannot carry that claim, and it was
withdrawn. What replaced it is identity evidence — the excluded record is named, with its reason
and its source line — which the count coincidence was standing in for.
