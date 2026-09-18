# Would a commit-time staleness warning have caught real stale notes? A retrospective test

Pre-registered 2026-09-18, before any detector output exists. Steven approved running it ("yes carry on").
Read-only: a separate clone of aify-comms pinned at 7678acf3, origin removed. No model, no paid runs.

## Why

Steven's design idea: layers of notes, decisions and features connected to code, with staleness markers
so that a code change says "this note may no longer be true". The 2026-09-14 check found a real case:
a KNOWN_ISSUES entry described `terminalChildEnv` as the live launch path ten days after commit 779099d7
removed its last production caller, and a live bug sat behind it. Before building anything, test
whether a simple rule would have flagged the stale notes we know about, and how much noise it makes.

## Population

The repo's own definition of "docs an agent must trust", derived exactly as
`service/tests/test_docs_name_symbols_not_line_numbers.py::gated_docs()` does:
CLAUDE.md, every .md linked from its "Primary entry points" section, and every file under
`.claude/skills`. At 7678acf3 that is 31 files (`raw/population.txt`). Dated plans and audits outside
this set are historical records and are not expected to stay current.

**A note** is a markdown section: the text under one heading, up to the next heading of any level.
**An anchor** is a backticked token in a note that is either a repo file path, or an identifier
(`[A-Za-z_][A-Za-z0-9_]{3,}`) that has a definition in this repo's source.

## The rules (fixed here)

For every anchor, take the commit that last wrote the anchor's line (`git blame`), call it W, and
compare W with HEAD (7678acf3):

- **S1 path gone:** the path existed at W and does not exist at HEAD.
- **S2 symbol gone:** the identifier had a definition in this repo's source at W and has none at HEAD.
  The "defined at W" condition is what separates this from the repo's own earlier check, which found
  15 false alarms in 16 because it included names that were never this repo's (kernel, hermes).
- **S3 symbol orphaned:** the identifier is defined at both W and HEAD, and it had at least one
  reference outside its defining file(s), outside tests, fixtures and markdown at W, and has none
  at HEAD.
- **S4 file orphaned:** the path exists at both W and HEAD, and was referenced by basename from at
  least one non-test, non-markdown source file other than itself at W, and by none at HEAD.

"Definition" is a regex over JS and Python source (function, class, const/let/var, def, methods,
module-level assignment). "Reference" is a whole-word `git grep`. Neither is a resolver. Both limits
are stated here, not discovered later.

## Known stale notes (recall set), chosen before the run

- **K1** KNOWN_ISSUES.md, "Managed spawns inherit whatever launched the bridge": names
  `terminalChildEnv`, orphaned by 779099d7. Expected: S3.
- **K2** DECISIONS.md, the `--resident`/`--managed` wrapper decision: calls `terminal-env.js` the env
  builder. Expected: S4.
- **K3** README.md, the same claim about `terminal-env.js`. Expected: S4.

Three cases I already knew, picked by me. That is weak recall evidence; it only shows whether the rule
can see the case that motivated it. Precision is the stronger measure.

## Grading

Every flag, or a random sample of 30 (fixed seed 20260918) if there are more than 30, is graded by
reading the note today. **TRUE** means the note, read at HEAD, states or implies something false or
misleading because of the change the flag names. **FALSE** means it is still accurate, for example a
historical entry that says "was removed", or a name that moved but the note did not rely on it.
**UNCLEAR** is counted against precision. Self-graded, and labelled so.

## Decision rule

Build a commit-time staleness warning into APG only if all three hold:

1. It flags K1 and at least one of K2 or K3.
2. Precision on graded flags is at least 50%.
3. Notes flagged are at most 25% of notes that have anchors; more than that becomes wallpaper.

If 1 fails, the rule cannot see the case that motivated it: do not build it. If 2 or 3 fails, it is
too noisy: report, and do not build. A pass licenses the thin version only (notes as nodes, anchors,
a confirmed-at date, a warning at commit time), not a general layer engine.

**Also reported, not deciding:** the commit each flag's change landed in, which gives pings per commit
if this ran at commit time.

## Amendment A, 2026-09-18, before any output on the population

Instrument controls on K1 (`raw/controls-registered.txt`) show the registered S3/S4 cannot fire on the
motivating case. Whole-word grep counts COMMENTS as references: at HEAD `terminalChildEnv` is still
"referenced" by comments in `mcp/stdio/runtimes.js` and `scripts/hermes-mcp-config.mjs`, and
`terminal-env` by comments and docstrings in seven files. The definition regex passed its controls
(finds `terminalChildEnv`, `managed_launch_env`, the method `normalizeSessionHandle`; finds nothing for a
made-up name).

The registered rules still run unchanged, and their result is reported and decided as registered.

Added, before seeing any population output: **S3a / S4a**, the same rules with references counted only in
code. JS `//` and `/* */` comments, Python `#` comments and triple-quoted strings, and shell `#` comments
are stripped before the whole-word test. String literals in JS stay, because imports are strings.

Honesty about this variant: K1-K3 passing under S3a/S4a is NOT evidence, because the amendment was made
knowing they fail without it. For the amended variant only precision (criterion 2) and volume
(criterion 3) are evidence. Its build/no-build reading uses criteria 2 and 3, with criterion 1 reported
but discounted.
