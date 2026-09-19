# apg's side of the aify-dashboard split

2026-09-20. Agreed with dashboard-manager over four rounds. The boundary proposal is
`docs/2026-09-19-dashboard-boundary-proposal.md` (3e9cc455); the joint ownership table is
DESIGN-APG-OWNERSHIP.md in aify-dashboard (d2f00f4), where every one of apg's 43 verbs appears
exactly once with an owner.

**The rule the split follows.** apg answers "what does this code do", which needs a parser, the graph
database or a language server on a checkout. aify-dashboard owns "what do we intend, and is it still
true", which outlives a checkout. Where they meet, the code fact stays here and the intent record moves,
joined by a symbolic anchor rather than by an id.

**Nothing here starts until the operator answers three questions** (with dashboard-manager, through
comms-tech-lead): whether the feature export is opt-in per project, when apg's visual dashboard retires,
and whether the 3D and multilayer views are accepted as lost.

## The work, with its conditions

1. **Read-only mode for the seam calls.** `stamp()` and `signals()` are already pure reads. `resolve()`
   and `subgraph()` are not: the usual path runs `ensureFresh`, which writes, and `MUTATING_TOOLS` has 14
   members including `graph_callers`, `graph_callees`, `graph_trace`, `graph_health` and every
   `code_intel_*` (they write a normalised compile DB and code-intel records). A host watcher calls these
   automatically, so they need a mode that answers from the graph as it stands and **returns the graph's
   indexed commit beside the answer**, so a reader says "as of commit X" instead of reading a stale graph
   silently. Refreshing stays the host plugin's job, on commit.
2. **Signals at a commit, with renames followed.** `mcp/stdio/overlay/confirmation.js` reads the working tree. The
   seam judges staleness on committed code, so it must read the anchored files at a commit
   (`git show <head>:<path>`) and follow git renames between the stamp's commit and head. The test-4
   replay did both, so the approach is known to work. The stamp records the commit it was taken at, and
   carries a `stampVersion`: if what apg hashes ever changes, links must be re-stamped rather than every
   link turning stale at once.
3. **The features CLI becomes export-aware.** `.aify-graph/functionality.json` becomes a read-only export written by
   the host plugin. `apg features confirm` must not fight the exporter; `apg features status` is already a
   pure read and stays. Where a project does not export, the hand-written file keeps working, so apg is
   usable alone.
4. **Delete the dead structural-digest writer.** `writeStructuralDigest` has no production caller (only
   its own module and three test files). The rest of the module is LIVE: `mcp/stdio/storage/publication-schema.js`
   creates the table on every publication, and the dashboard reads `listDigestCommits` and
   `deltaFromPrevious`. So the writer and its write-path tests go now; **the table, the read path,
   `mcp/stdio/storage/delta-between.js`, `/api/delta` and the Shape button retire with the visual dashboard, in one change.**
   `tests/unit/storage/commit-comparison-is-withdrawn.test.js` survives both steps as the record that the delta refuses on
   purpose. When the writer goes, the surviving read-path test asserts the table stays unwritten, so a
   writer cannot be added back quietly to a table the design calls inert.
5. **Retire `graph_lookup` and `graph_summary`,** superseded by `whereis` and `whereis(expand)`. They are
   registered in `mcp/stdio/tools/schema.js`, so they answer `tools/call` today: this is a surface change (schema
   entries, imports, two files, the hidden set), not a cleanup of dead code.
6. **Doc fixes apg owns, independent of the split.** `mcp/stdio/tools/schema.js`'s header says 42 declarations (43);
   `mcp/stdio/hidden-tools.js` says 14 full-only (16); `.claude-plugin/plugin.json` says 0.3.0 against package.json's 0.9.0;
   the Claude install doc and the marketplace entry claim Claude Code gets `full` when its manifest passes no
   toolset, so it gets the default 16 (which stays the right answer); `mcp/stdio/tools/schema.js`:315 says nothing reads
   diff-overlay.json, but `mcp/stdio/dashboard/server.js`:513 does.

## What moves out, so it is not planned twice

Truth for `.aify-graph/functionality.json` and tasks.json, their authoring skills
(`graph-build-functionality`, `graph-feature-edit`, `graph-anchor-drift`, `graph-build-tasks`,
`graph-task-edit`), and the overlay quality checks move to aify-dashboard. The git-hook reindex trigger
and code-intel scheduling move to aify-env, provided the hooks stay supported for repos with no aify-env
and the caller respects apg's write lock. The deletion-guard hook stays apg's code and apg's decision,
delivered through aify-wrapper; the SessionStart hint becomes a dashboard turn-start hook. **Neither hook
is wired anywhere today** (the user's Claude settings file has 9 hook entries across 6 events, none of them
apg's), so moving them and making them run is the same task.

## What is lost, recorded rather than pretended away

Per-file semantic summaries (nothing authors them; no input file exists in any local `.aify-graph`), the
guided tour and onboarding walk, repo-scale shape at a glance, the 3D and multilayer views, search by
meaning, feature descriptions in the session seed and briefs where a project does not export, and
in-session auto-refresh where neither aify-env nor the hooks run. The full table with recovery notes is in
the ownership document.
