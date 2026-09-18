# Test 4: does a "changed since confirmed" ping on a feature map catch features that went stale?

Pre-registered 2026-09-18, before any test-4 output. Steven: "go with recommendation" (attach the map to
graph nodes rather than grep prose).

## Why this test and not a fourth grep detector

Tests 1-3 extracted anchors from free prose, and failed on two things: the detector could not tell which
notes were history, and it could resolve only 340 of 2,956 backticked names. APG already has a structured,
agent-edited layer with explicit anchors: `functionality.json` (features anchored to symbols and files,
validated against the graph). No repo on this machine has one (search positive-controlled on the test
fixture). What it lacks is what Steven described: a confirmed-at point and a ping when anchored code changes
after it.

A ping here states a fact ("anchored symbol X changed since this feature was confirmed"), not a guess that
the feature is wrong. So the question is not precision. It is **recall** (do the features that really went
wrong get pinged) and **noise** (how often a feature must be re-confirmed).

## Setup

- **Repo:** the aify-comms clone at 7678acf3 (read-only, origin removed), about 280 commits a week.
- **W:** the last commit at or before HEAD's commit time minus 28 days. Four weekly slices W -> W+7d ->
  W+14d -> W+21d -> HEAD, each boundary the last commit at or before that time.
- **The map:** a blind agent writes `functionality.json` from a plain copy of the tree at W (`git archive`,
  no `.git`, so it cannot see the future). 15 to 25 features. Each has `id`, `label`, a `description` of at
  most 80 words that makes concrete claims about behaviour, at least one `anchors.symbols` entry and at
  least one `anchors.files` entry.
- **The graph:** APG's own indexer (`scripts/reindex.mjs`) on a worktree at each boundary.
- **Anchor identity:** a symbol anchor is its name inside the anchored files, resolved in the graph at W.
  At a later boundary it is the node with the same name in the same file, or in the file git reports it
  renamed to. Name-and-file, not name alone.

## Pings, computed per feature and per slice

- **F (file):** an anchored file's content differs between the two boundaries, or the file is gone.
- **S (symbol):** an anchored symbol is gone, or the text of its line range (from the graph at each
  boundary) differs.

Reported two ways: weekly (each slice against its own start, as if the feature were re-confirmed after
each ping) and cumulative (W against HEAD).

## Truth

An independent blind grader gets a plain copy of HEAD (no `.git`) and the map, and grades **every** feature:
is the description, as written at W, still accurate at HEAD? STALE (a claim in it is now false or
misleading) / ACCURATE / UNCLEAR. It never sees the pings or these rules.

## Decision

- **Minimum sample:** recall is read only if at least 5 features are graded STALE. Fewer, and the result on
  recall is "no result", whatever the ratio. (Test 3 lacked this rule.)
- **Build symbol-level confirmed-at pings** if cumulative S recall (STALE and S-pinged / STALE) is at least
  80% **and** the mean weekly S ping rate is at most 30% of features.
- **Else, file-level** if the same two bars hold for F.
- **Else, do not build.** Report.
- Reported, not deciding: specificity (ACCURATE and not pinged / ACCURATE), UNCLEAR counted separately.

## Limits recorded before the run

- One repo, one map author, one grader.
- 280 commits a week is a stress case for noise; a quieter repo pings less.
- A map written from code alone may describe features more coarsely than a maintainer would.
- The ping fires on text change, so a comment edit pings. That is counted as noise, not excluded.
