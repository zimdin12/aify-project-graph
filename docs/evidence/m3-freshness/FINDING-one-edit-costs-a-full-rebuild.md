# One edit costs 85% of a full rebuild — and it is paid on every commit

**Date:** 2026-09-03
**Run + profile:** `RUN-incremental-scope-and-profile.txt`
**Probe:** `scripts/probe-incremental-scope.mjs`
**Status: PROVEN and LOCALISED.** Cause identified in the profile, not inferred.

## The measurement

On a clone of this repository (880 File nodes):

| | wall | files processed |
|---|---|---|
| full rebuild (`force: true`) | 67,965 ms | 880 |
| incremental, **1** appended function | **58,036 ms** | **4** (0.5%) |
| incremental, 229 appended functions | 56,998 ms | 4 (0.5%) |

⇒ **Incremental scoping WORKS — and buys almost nothing.** Touching 0.5% of the files costs 85% of
rebuilding all of them. The cost is essentially independent of how much changed.

⛔ **This is not a watcher problem.** `scripts/reindex.mjs` calls the same `ensureFresh` from the
installed `post-commit`, `post-merge`, `post-checkout` and `post-rewrite` hooks. **Every commit in
every install pays this**, whether or not `APG_AUTO_SYNC` is ever enabled.

## Where the time goes

A single incremental run, profiled in an isolated process with `node --cpu-prof` so the full rebuild
could not dominate: **55.3 s total, and two functions account for 82.5% of it.**

| self time | share | function |
|---|---|---|
| 38.29 s | **69.3%** | `findByQnameSuffix` — `mcp/stdio/ingest/resolver.js:400` |
| 7.27 s | **13.2%** | `globToRegExp` — `mcp/stdio/ingest/ignored-dirs.js:65` |

### 1. `findByQnameSuffix` scans every pending node, per lookup

```js
findByQnameSuffix(candidate) {
  const pending = pendingNodes.filter((node) => {          // linear, every call
    const qname = node.extra?.qname ?? '';
    return qname === candidate || qname.endsWith(`.${candidate}`);
  });
  ...
}
```

⭐ **Its own siblings show the intended shape.** `findByExactQname` reads `pendingByQname`, and
`findByLabel` reads `pendingByLabel` — both prebuilt Maps filled in `registerPending`. Only the
suffix finder was left as an O(candidates x pendingNodes) scan. The asymmetry is the tell: two of
three finders were indexed and this one was not.

### 2. `globToRegExp` recompiles a regex inside the matching loop

`pathMatchesPattern` calls `globToRegExp(normalizedPattern)` *inside* `.some()` over the path
segments, so a fresh `RegExp` is constructed for every segment, of every pattern, on every path
tested. It is a pure function of one string and nothing caches it.

## What this does NOT say

- **Not measured on another platform or language mix.** win32, node v22.20.0, a JS/TS-dominant repo.
- **Not a claim about the 2026-09-02 baselines.** Those recorded 36-42 ms for a single burst on the
  working repo. Both can be true — that measurement and this one differ in repo state and in what was
  already resolved — and reconciling them is not attempted here.
- **The full-rebuild hypothesis is refuted, not merely unsupported.** The preregistered discriminator
  was `processedFiles` against File-node count, and 4 of 880 settles it. The 53 s catch-up sync seen
  in `RUN-sustained-edit-cost.txt` is explained by this fixed cost, not by a rebuild.

## Why this matters for the product, not just for M3

The pitch is a graph that keeps itself current cheaply and incrementally. What is measured here is a
graph whose incremental path costs nearly as much as starting over — and it is spent on the commit
path, where nobody opted in. Every argument about auto-sync default-on has been conducted in terms of
burst timing while this sat underneath all of it.
