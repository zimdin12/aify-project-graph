# Ingest / Freshness / Analysis Audit

Context:
- Audited `mcp/stdio/ingest/**`, `mcp/stdio/freshness/**`, and `mcp/stdio/analysis/**`
- Local `HEAD` is `d6b55fd`; `origin/main` resolves to the same commit in local refs
- Workspace had unrelated on-disk changes in `mcp/stdio/server.js` and `mcp/stdio/query/verbs/search.js`; audit scope below excludes those

## Executive Summary

The ingest/freshness stack is structurally sound, but there are three pre-live issues I would treat as blocking:

1. `ensureFresh()` is not crash-safe: it mutates the SQLite graph before it commits the new manifest, and most of the rebuild is not wrapped in one atomic transaction. A crash can leave the DB partially emptied or partially rebuilt while the manifest still claims the previous graph is valid.
2. The skip/unsupported-file paths can leave stale nodes behind. If a previously indexed file becomes unsupported or grows beyond the 1 MB cap, the old graph data remains in SQLite.
3. There are proven extractor config defects in Java, Ruby, and Rust that materially distort graph quality.

Everything else below is ordered by severity.

## Findings

### 1. Crash during `ensureFresh()` can leave the DB inconsistent while the manifest still looks valid
Severity: high

Evidence:
- [`mcp/stdio/freshness/orchestrator.js:41`](./mcp/stdio/freshness/orchestrator.js) decides whether to do a full rebuild
- [`mcp/stdio/freshness/orchestrator.js:46-47`](./mcp/stdio/freshness/orchestrator.js) deletes all edges/nodes immediately on full rebuild
- [`mcp/stdio/freshness/orchestrator.js:50-108`](./mcp/stdio/freshness/orchestrator.js) performs special-node rebuild, per-file extraction, ref resolution, communities, and mentions in multiple separate phases
- [`mcp/stdio/freshness/orchestrator.js:124`](./mcp/stdio/freshness/orchestrator.js) writes the manifest only at the very end

Why it matters:
- If the process dies after the DB has been deleted or partially rebuilt, but before `writeManifest()`, the old manifest remains on disk.
- On the next run, if `manifest.commit` still matches `HEAD`, `fullRebuild` becomes false and the code may treat the partial DB as a valid prior state.
- This is the main integrity risk in the stack.

Suggested fix:
- Treat index rebuild as an atomic state transition.
- Minimum fix: record an `indexing` / `incomplete` marker in the manifest before mutating the DB, then clear it only after success.
- Better fix: rebuild into a temp DB and swap files atomically after success.

### 2. Previously indexed files become stale if they later become unsupported or exceed the size cap
Severity: high

Evidence:
- [`mcp/stdio/freshness/orchestrator.js:78-80`](./mcp/stdio/freshness/orchestrator.js) skips unsupported extensions before deleting existing nodes
- [`mcp/stdio/freshness/orchestrator.js:85-89`](./mcp/stdio/freshness/orchestrator.js) skips files larger than 1 MB before deleting existing nodes
- [`mcp/stdio/freshness/orchestrator.js:91`](./mcp/stdio/freshness/orchestrator.js) only deletes nodes after those skip branches

Why it matters:
- If `foo.py` was indexed yesterday, then renamed to `foo.txt`, the old Python nodes stay in the graph forever.
- If a previously indexed large C/C++ file crosses the 1 MB cap, the old nodes stay in place and the graph silently lies.

Suggested fix:
- If a changed file was previously indexed, always delete old nodes/edges first, then decide whether to re-extract.
- Add a manifest warning list for skipped files so operators can see what was intentionally omitted.

### 3. `sweepFilesystem()` can abort the whole index on unreadable or non-UTF-8 files
Severity: high

Evidence:
- [`mcp/stdio/ingest/sweep.js:235-236`](./mcp/stdio/ingest/sweep.js) reads candidate files as UTF-8 with no `try/catch`

Why it matters:
- A single unreadable doc/config file or a non-UTF-8 `.txt` / `.md` / `.json` / `.yaml` file will throw and fail the whole sweep.
- Unlike code extraction, there is no size cap or binary guard here.

Suggested fix:
- Wrap candidate reads in per-file `try/catch`.
- Add a binary/non-text guard and a size cap for sweep files too.
- Report skipped special files in the manifest or return payload.

### 4. Java imports are currently not emitted at all
Severity: high

Evidence:
- [`mcp/stdio/ingest/languages/java.js:17`](./mcp/stdio/ingest/languages/java.js) uses `field: 'path'` for `import_declaration`
- Tree-sitter Java exposes the import target as nested `scoped_identifier`, not a `path` field; `childForFieldName('path')` is undefined in practice

Why it matters:
- Java graphs will under-report cross-file structure badly.
- This is a proven config bug, not a hypothesis.

Suggested fix:
- Switch Java import extraction to `descendantTypes: ['scoped_identifier', 'identifier']` or an explicit extractor similar to the TS/JS import logic.

### 5. Ruby import extraction is flat-out wrong: it treats normal calls as imports
Severity: high

Evidence:
- [`mcp/stdio/ingest/languages/ruby.js:17`](./mcp/stdio/ingest/languages/ruby.js) sets `imports` to `{ nodeTypes: ['call'], descendantTypes: ['identifier'] }`
- In Ruby AST, ordinary calls like `foo(bar)` are `call` nodes too

Why it matters:
- Every normal Ruby call is a candidate `IMPORTS` ref.
- That pollutes dependency edges and makes resolver output misleading.

Suggested fix:
- Restrict Ruby imports to `require`, `require_relative`, and similar load primitives only.
- This likely needs a tiny custom rule/extractor, not a broad `call` match.

### 6. Rust `impl_item` declarations are silently dropped
Severity: high

Evidence:
- [`mcp/stdio/ingest/languages/rust.js:14`](./mcp/stdio/ingest/languages/rust.js) includes `impl_item` in the symbol rule with `field: 'name'`
- Rust `impl_item` exposes `type_identifier` children, not a `name` field, so extraction returns no symbol label
- I verified `extractFile()` on `impl Runner for Foo {}` produces no node for the impl block

Why it matters:
- Rust trait implementations disappear from the graph.
- This directly harms inheritance/type structure and method ownership reasoning.

Suggested fix:
- Split `impl_item` into its own rule or custom extractor path using descendant `type_identifier` nodes.

### 7. `ensureFresh()` is not a true no-op on clean trees
Severity: medium

Evidence:
- [`mcp/stdio/freshness/orchestrator.js:50`](./mcp/stdio/freshness/orchestrator.js) always clears special nodes
- [`mcp/stdio/freshness/orchestrator.js:52-66`](./mcp/stdio/freshness/orchestrator.js) always re-sweeps filesystem and framework plugins
- [`mcp/stdio/freshness/orchestrator.js:106-108`](./mcp/stdio/freshness/orchestrator.js) always reruns communities and mentions

Why it matters:
- Even when no source files changed, every query still pays for special-node rebuild plus two whole-graph analysis passes.
- This is likely the dominant reason clean-tree refreshes cost more than expected.

Suggested fix:
- Add a real fast-path: if there are no dirty files, no manifest dirt, no HEAD change, and schema/extractor versions match, return immediately.
- Rerun communities/mentions only when their inputs changed.

### 8. `resolveRefs()` rebuilds a full in-memory index of every node on every call
Severity: medium

Evidence:
- [`mcp/stdio/ingest/resolver.js:13-42`](./mcp/stdio/ingest/resolver.js) loads and indexes all nodes
- [`mcp/stdio/freshness/orchestrator.js:100`](./mcp/stdio/freshness/orchestrator.js) calls it on every refresh pass

Why it matters:
- Complexity is proportional to total graph size, not just changed files.
- At current repo sizes this is probably acceptable, but it scales poorly and compounds with the “no-op is not really no-op” issue.

Suggested fix:
- Cache indexes across a single run, or move more of the lookup burden into targeted SQL.
- At minimum, avoid calling resolver when `refs.length === 0`.

### 9. Resolver heuristics are still too coarse for correctness-critical use
Severity: medium

Evidence:
- [`mcp/stdio/ingest/resolver.js:62-79`](./mcp/stdio/ingest/resolver.js) only prefers same-file or same-directory unique matches
- [`mcp/stdio/ingest/resolver.js:113-126`](./mcp/stdio/ingest/resolver.js) otherwise falls back to label matching with only a common-name denylist

Why it matters:
- Duplicate labels outside the common-name list can still resolve incorrectly.
- The resolver is not import-aware, receiver-aware, package-aware, or class-aware beyond qname suffix coincidence.

Suggested fix:
- Use import context, parent class, and file/module namespaces as first-class ranking signals.
- Keep the common-name denylist as a guardrail, not the main correctness mechanism.

### 10. `detectMentions()` resolves duplicate symbol names arbitrarily
Severity: medium

Evidence:
- [`mcp/stdio/analysis/mentions.js:21-27`](./mcp/stdio/analysis/mentions.js) stores only the first `label -> id` mapping

Why it matters:
- If multiple symbols share the same label, document mentions always link to whichever node was seen first.
- That creates deterministic but wrong `MENTIONS` edges.

Suggested fix:
- Either store all matching IDs and avoid ambiguous matches, or rank by proximity/path/module.

### 11. `detectMentions()` overcounts inserted edges
Severity: low

Evidence:
- [`mcp/stdio/analysis/mentions.js:39-45`](./mcp/stdio/analysis/mentions.js) increments `added` even though the insert uses `INSERT OR IGNORE`

Why it matters:
- The returned `added` count is not trustworthy once duplicates exist.

Suggested fix:
- Inspect the insert result and only increment on actual row insertion.

### 12. `detectMentions()` is fully sequential and unbatched
Severity: low

Evidence:
- [`mcp/stdio/analysis/mentions.js:31-46`](./mcp/stdio/analysis/mentions.js) reads docs one by one and inserts edges one by one, outside a transaction

Why it matters:
- Probably fine at current scale, but it is avoidable overhead on larger repos.

Suggested fix:
- Batch inserts in a transaction.

### 13. Community detection uses an avoidable N+1 update path
Severity: low

Evidence:
- [`mcp/stdio/analysis/communities.js:47-61`](./mcp/stdio/analysis/communities.js) prepares `update` but never uses it
- [`mcp/stdio/analysis/communities.js:53`](./mcp/stdio/analysis/communities.js) does `SELECT extra FROM nodes WHERE id = ?` inside the update loop
- [`mcp/stdio/analysis/communities.js:55-57`](./mcp/stdio/analysis/communities.js) parses and rewrites full JSON per node

Why it matters:
- This is unnecessary per-node overhead in a hot post-index analysis step.

Suggested fix:
- Use `json_set(extra, '$.community_id', ?)` directly in a single prepared statement.

### 14. `communityResult` is computed and then ignored
Severity: low

Evidence:
- [`mcp/stdio/freshness/orchestrator.js:107`](./mcp/stdio/freshness/orchestrator.js) assigns `communityResult`
- It is never used afterwards

Why it matters:
- Code smell and a hint that expected reporting/validation is missing.

Suggested fix:
- Remove the variable or expose the result.

### 15. `getDirtyFiles()` is not robust to rename/copy porcelain output
Severity: low

Evidence:
- [`mcp/stdio/freshness/git.js:18-22`](./mcp/stdio/freshness/git.js) parses `git status --porcelain` by slicing from character 3 onward

Why it matters:
- Rename entries like `R  old -> new` become `old -> new`, which is not a real path.
- That can feed garbage into refresh logic.

Suggested fix:
- Use `git status --porcelain=v1 -z` and parse it correctly, or handle rename syntax explicitly.

### 16. Git helpers hard-fail outside a valid Git repo
Severity: low

Evidence:
- [`mcp/stdio/freshness/git.js:11-34`](./mcp/stdio/freshness/git.js) uses `execFileSync('git', ...)` directly with no fallback or classification

Why it matters:
- A non-git project or transient Git failure aborts freshness entirely.

Suggested fix:
- Either document “git repo required” as a hard invariant, or degrade cleanly with a clearer error surface.

### 17. `sweepFilesystem()` silently ignores symlinks
Severity: low

Evidence:
- [`mcp/stdio/ingest/sweep.js:219-233`](./mcp/stdio/ingest/sweep.js) only handles `isDirectory()` and then falls through to file handling
- [`mcp/stdio/freshness/orchestrator.js:211-220`](./mcp/stdio/freshness/orchestrator.js) `listRepoFiles()` also only follows plain files/directories

Why it matters:
- Symlinked source trees or docs are skipped with no warning.

Suggested fix:
- Decide whether symlinks are unsupported or should be followed; either way, surface that choice explicitly.

### 18. Special-file sweep has no size guard, while code extraction does
Severity: low

Evidence:
- [`mcp/stdio/ingest/sweep.js:235-236`](./mcp/stdio/ingest/sweep.js) reads all candidate files
- [`mcp/stdio/freshness/orchestrator.js:85-89`](./mcp/stdio/freshness/orchestrator.js) only size-caps language files

Why it matters:
- Large markdown, JSON, or YAML files can still blow up memory or latency on the sweep path.

Suggested fix:
- Apply a similar size policy to sweep candidates.

### 19. `isEntrypoint()` is intentionally broad, but still noisy
Severity: low

Evidence:
- [`mcp/stdio/ingest/sweep.js:103-110`](./mcp/stdio/ingest/sweep.js) classifies every `index.*` and `main.*` file as an entrypoint

Why it matters:
- That includes files like `index.css` / `index.html`, which are usually orientation noise rather than execution entrypoints.

Suggested fix:
- Restrict by language or executable/runtime relevance.

### 20. Small code quality nits
Severity: low

Evidence:
- [`mcp/stdio/ingest/sweep.js:2`](./mcp/stdio/ingest/sweep.js) imports `relative` but never uses it
- [`mcp/stdio/ingest/resolver.js:58-60`](./mcp/stdio/ingest/resolver.js) `uniqueOrNull()` is dead code
- [`mcp/stdio/analysis/communities.js:47`](./mcp/stdio/analysis/communities.js) `update` is dead code

Why it matters:
- Not dangerous, but worth cleaning up while touching the surrounding code.

## What Looks Good

- Manifest writes are atomic via temp-file + rename: [`mcp/stdio/freshness/manifest.js:45-57`](./mcp/stdio/freshness/manifest.js)
- Lock release is correctly handled on normal completion via `finally`: [`mcp/stdio/freshness/lock.js:15-19`](./mcp/stdio/freshness/lock.js)
- The 1 MB cap does prevent the known large-file crash for code extraction, even though the stale-node behavior around it still needs fixing: [`mcp/stdio/freshness/orchestrator.js:85-89`](./mcp/stdio/freshness/orchestrator.js)
- The generic extractor shape is extensible; most of the remaining quality work is rule accuracy and lifecycle correctness, not a foundational rewrite

## Recommended Fix Order

1. Crash consistency in `ensureFresh()` / DB-manifest coupling
2. Stale-node bug for unsupported and >1 MB files
3. `sweepFilesystem()` unreadable/binary-file hard-fail
4. Proven config bugs: Java imports, Ruby imports, Rust impls
5. Real no-op fast path on clean trees
6. Resolver quality improvements
7. Mentions/community cleanup and performance polish
