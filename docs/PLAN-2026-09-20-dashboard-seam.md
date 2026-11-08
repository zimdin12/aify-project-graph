# APG roadmap and dashboard seam

## Current planning draft, 2026-11-04, APG-r1

Planning only. No implementation, public edits, installs or commits are authorized by this draft.
Comms Tech Lead coordinates the shared dependency/approval index with Dashboard Manager. Final
APPROVE/REVISE waits for their named combined revision and each of the six component owners.
This local draft is not that approval and assigns no dates to other lanes.

### Goal and source precedence

APG supplies accurate, bounded code facts and language-server evidence through the dashboard.
The recorded target is one provider process per host, started and owned by aify-env on the first
request, shared across projects and agents, with no idle shutdown. The dashboard owns authored
features/tasks, their connections to code, and the agent-facing entry point. There is no new feature
export or APG skill distribution mechanism. Preserve the existing standalone/per-project paths
through migration; remove them only at the individually named gates below.

Source inspection baseline is APG 8dccb03ec3bacf1a7759b7b5e4a1608374e8e2d6. All 18 open issue
bodies and their 36 full comments were read, plus the complete closed discussions on #3/#9/#11/#18.
An issue reply saying "Applied" describes the proposal, not code delivered at that unchanged SHA.
The issue map below is the scope inventory, not the ready-to-build labels or the older sequence.

Original records now read, rather than inferred from audit summaries:
- [ROLES](https://github.com/zimdin12/aify-comms/blob/8c2697eedad25622829d75f0dba00a592c925ad7/docs/audit-2026-11/ROLES.md), including its November 4 second set.
- [Owner guidance](https://github.com/zimdin12/aify-comms/blob/8c2697eedad25622829d75f0dba00a592c925ad7/docs/audit-2026-11/OWNER-GUIDANCE.md).
- [INTENT](https://github.com/zimdin12/aify-comms/blob/8c2697eedad25622829d75f0dba00a592c925ad7/docs/audit-2026-11/INTENT.md), a November 3 historical ledger. Its older export/no-standing-service and fleet-control interpretations do not override the newer ROLES amendments.
- [Shared tracker and decision table](https://github.com/zimdin12/aify-comms/issues/46), particularly D3, D8, D11 and D13. Defaults are identified as defaults, not recast as fresh operator testimony.
- Current bodies/discussions of dashboard #6/#16/#17/#21, env #12/#27/#30, setup #2/#3/#6 and wrapper #25 were read for the dependencies below. This is not a fresh source audit of those repositories.

### Phases and gates

Phases describe deliverables, not a fleet restart schedule. Independent safety work need not wait
for platform relocation. Retiring an interface is a separate gate from introducing its replacement.
Effort is ASSUMED APG-only focused engineering days, including implementation tests and review,
not elapsed dates or measurements. One day means six focused hours; external waiting is excluded.

| Phase | Deliverable and prerequisite | Measurable done-when | APG effort |
|---|---|---|---|
| P0 | Protect current users. Interim trust/clangd wording, foreign-link guard, HTTP hardening, unsupported PHP/Rust routing; prepare #10's test tiers. | The exact unsafe trust permissions are gone; stale/diverged/dangling foreign links refuse even with force without changing outside bytes; Host/option-shaped input refuses before effects, with healthy controls; unmapped PHP/Rust never starts clangd. Full suite remains the release gate. | 1.5-3 days |
| P1 | Deliver the provider package, contracts and explicit indexing, reusing existing handlers. Depends on P0's safety policy and #10's behavioral entry/testing foundation. | All seven calls below pass through the same versioned dispatch on both host and queue paths; no-index and strict snapshot-read tests prove no graph/cache creation; index failure exits nonzero; LSP children shut down within #20's total bound. CLI collection/import works without an agent MCP tool. | 5-9 days |
| P2 | Compose with dashboard and env. Depends on P1, the agreed host-provider contract, dashboard #17/#16/#21 and the applicable env #27 plugin-loader path. | Two sessions and two projects share one host provider without cross-project answers; bridge close leaves it alive; env stop ends its owned children. Local and HTTP lookups, resolve/stamp pre-write validation and browser subgraphs work. No-host/no-index/unsupported-version answers remain actionable. Dashboard #21 records actual real-session use, separately from tests. | 1-3 days of APG integration; other lanes not estimated |
| P3 | Improve the useful language facts. #7 and #15 precede PHP/Rust backend registration; #4 precedes #5's qualified controller integration. Can overlap P2. | Expected and forbidden PHP/Laravel/C++/Rust relations are asserted; existing TS/Python coverage survives; unchanged files migrate on extractor-version changes. Backend support requires a real cross-file reference on the supported transport, not a skip or supplied spike. | 6-12 days |
| P4 | Retire agent MCP and skills, not the provider's reusable handlers. Depends on P2's counterpart/use evidence, setup #2/#6, installed-owner inventory and the capability dispositions below. | One coordinated release removes registrations, instructions and skill shipping; selected runtime readbacks show no owned legacy registration/copy and preserve unrelated entries and foreign sources. The dashboard owns the safety guidance before APG's copy retires. No new APG skill rename or four-tree consolidation. | 1.5-3 days |
| P5 | Retire viewer and overlays at independent gates, not simply because P4 merged. | Viewer removal requires the operator's recorded use and acceptance of the dashboard code-layer view. Every affected project has an approved overlay import or explicit drop record before its reader/writer is removed. Retain the operator launcher and unmigrated project data until their gate passes. | 0.5-2 days after gates |
| P6 | Keep current decisions findable and history intact. Decision index can start now; search fencing waits for dashboard #6's shared selector behavior. | Current/approved/implemented states are separate; active-plan discovery and NO-RUN contracts survive; default search excludes history/evidence while explicit retrieval or a checkout pointer remains usable. No evidence is deleted merely for age. | 0.5-1 day |

Total APG effort envelope is 16-33 focused engineering days, not a delivery commitment. Re-estimate
P1 after the env/dashboard host contract is agreed and P3 after inspecting the actual language
workspaces. Optional PHP/Rust LSP qualification may follow P4 if the narrower real-use gate is met;
it must not be reported delivered or force a runtime installation to make a release green.

### Open issue map

All issue numbers in this table are in
[zimdin12/aify-project-graph](https://github.com/zimdin12/aify-project-graph/issues).
A phase suffix separates criteria of one issue without creating a second owner.

| Issue | Phase | Dependency and disposition | Done-when specific to this issue |
|---|---|---|---|
| #1 | P1 | Contract first, paired with #2 and #8; dashboard #17 recognizes a version before APG requires it. Keep brief schema deferred without a real reader. | Generated examples validate envelope, subgraph, resolve/stamp, lookup calls and no_index/enable against pinned schemas; unknown versions refuse. HEAD is the provider checkout HEAD captured for the run, not an enforced caller-requested commit. |
| #2 | P1 | Explicit CLI enable path before dashboard #17; #19 adds the optional C++ collection step. No replacement MCP-guard project. | Fresh repo, subdirectory, explicit target and linked-worktree tests select and disclose the intended top level; no nested graph or non-repo writes. Local exclude hygiene leaves tracked ignore bytes alone, including repo-local scratch/build exclusions. Build failure is nonzero; graph-backed reads create nothing; LSP-only calls remain usable without a graph. |
| #4 | P3 | Land with #15's PHP fixture, before #5's imported/FQCN route targets; preserve ID contracts with #19. | PHP and Python aliases reach emitted qnames; self/parent/static differ correctly; qualified unresolved magic/inherited calls stay unresolved; no namespace-fragment relations; persisted unchanged files re-extract. Keep trait-as-IMPLEMENTS default, separate from any trust-policy change. |
| #5 | P3 | #4 plus #15. Reuse Laravel plugin/fixtures; defaults cover Laravel 10 and 11+. | Six route forms and nested middleware/prefix/name/controller attribution pass; non-Laravel Cache/Log adds no Illuminate edges; composer enable/disable invalidates unchanged PHP facts; PHPUnit/Pest classification includes actual nodes. No whole-repo reparse on each incremental edit. |
| #6 | P0/P3 | Stop unknown-extension fallback now. Optional phpactor backend follows #7 and #13/#20; no container transport in this scope. | Unsupported/no-server paths do not spawn clangd or suggest a nonexistent collector. PATH/configured executable+argv works on the qualified transport with @live provenance and exhaustive:false. Container-only PHP degrades cleanly; absent-server tests are NOT_RUN, not support proof. |
| #7 | P3 | Shared capability registry before #6/#22 backend additions. No global identical extension union. | Named .mts/.hh/.c/.pyi cases agree where their capabilities require it across indexing, enumeration, inference and coverage; LSP-only is explicit, static/live identities differ deliberately, denominator covers collector admission, extractor version migrates existing graphs. |
| #8 | P1/P2/P4/P5 | Umbrella migration, not an indivisible ready item. Depends on #1/#2/#10/#13/#14/#19/#20, dashboard #16/#17/#21, env host ownership/plugin contract and setup #2/#6. | P1 seven-call provider; P2 composed evidence; P4 real PHP/C++/TS session calls recorded before removal; P5 separate viewer acceptance and per-project overlay records. Host process count does not grow with sessions; no idle shutdown. |
| #10 | P0/P1 | Test tiers and importable provider entry precede #8 provider integration. Do not refactor the retiring MCP executable merely to replace source-text tests. | Explicit argv/env/IO entry is importable; executable lifecycle tests remain. Ordered parallel-unit/serial-LSP projects never overlap and preserve budget safeguards. The ratchet derives and prints actual product-source assertions, excludes generated output, and catches a planted growth case. |
| #12 | P0/P5 | Harden now while viewer exists. Removal only at dashboard #16's A2 acceptance gate. | Request-level tests cover actual bound port, bad/missing Host on every route, no ACAO, no Git spawn for leading-dash base, distinct revision/repository failures and successful SPA/source/diff controls. Keep launch-dash usable after agent MCP removal until P5. |
| #13 | P1/P4 | Trusted-driver policy before provider clangd starts. Existing compile-analysis execution remains protected while reachable; retirement requires checking CLI/shared consumers too. | No wildcard/basename driver trust; trusted resolved locations and unsafe-argument controls; native/WSL and clang-cl INCLUDE checks. Do not assume deleting the MCP registry removes the analyzer CLI or makes an executable safe. No malicious compiler execution is required. |
| #14 | P1 | Shared provider admission for host and queue, using the chosen effective project/worktree root. | Guard and file consumer use the same canonical file; separate relative/absolute/symlink/Windows cases with permitted controls; credential paths refuse before consumer effects. Keep legitimate external SDK/header follow-up reads and explicit targeting from outside the repo. |
| #15 | P0/P3 | Correct unsupported claims early; extend existing language matrix with #4/#5/#22. | Expected and forbidden final relations are asserted with named construct populations and red controls. Both small-config claims corrected. TS/Python retained; Go/Java/Ruby labeled unmeasured with no new repair/fixture campaign. Fixture coverage is not real-world recall. |
| #16 | P0/P4/P5 | Interim safety/host-server wording now; provider-only docs track actual migration states. | Early absence permission is removed, clangd is not called bundled, and positive precision is distinguished from set completeness. Later install docs explain provider/index/setup and owned legacy cleanup. Plugin version validation is not built for artifacts P4 retires. Process wording says host-owned, not bridge-owned. |
| #17 | P6 | Use originals above; coordinate default-search fencing with dashboard #6 and comms #29. | Decision index separates current/approved/implemented. Under D8's default move only explicitly superseded material, preserving active root plans and exact-byte evidence. Use the shared selector fence, not a root .ignore that hides maintainers' tools; reconcile stale contrary issue wording in the combined plan. |
| #19 | P1/P4 | Neutral identity helpers now; CLI v0.2 collect/import and C++ enable instructions before deleting the legacy producer. | IDs remain byte-identical, null-range behavior explicit, end-to-end CLI fixture passes without graph_collect_code_intel. Historical v0.1 importer compatibility remains; external script callers are unknown, so publish migration steps rather than claim none exist. Keep the C++ collection loop separate. |
| #20 | P1/P2 | Shared owned-client lifecycle before host provider activation; env owns host process stopping. | Admission closes first; starting/live/collection clients and descendants actually exit, idempotently, under the issue's six-second test bound with a cooperative control. Preserve parent-poll coverage unless separately disproved on supported transports. Never kill other sessions' processes. |
| #21 | P0/P4 | Guard existing deploy/install paths now, no rename. Setup #2 moves trigger before any authorized pstack repair; #3 owns pin/reset policy. | Foreign dir/file links, dangling links and Windows junctions refuse before writes, even with force; outside bytes unchanged. Delete APG deployment only with P4's used replacement and cleanup ownership. No APG script resets third-party clones or deletes a foreign link. |
| #22 | P0/P3 | Unsupported .rs fix with #6; registry #7 and fixtures #15 before opt-in rust-analyzer. | Required/default trait methods, generic impls, IMPLEMENTS, qualified constructor/alias/module identities and duplicate-type negatives pass. Cross-file trait reference/readiness qualified on a real workspace; no C++ cause/advice leaks. Macro-token static limits remain disclosed. |

Closed issues are dispositions, not completed implementation:
- #3 is superseded: interim unsafe permissions belong to #16; durable trust/actions belong to #1.
- #9's MCP listing/refresh policy is superseded. P1 still has to prevent actual refresh/cache
  materialization in reused snapshot-read handlers; closing #9 does not prove that property.
- #11's consolidation/loader project is superseded by P4 retirement; #21's interim guard remains.
- #18 is withdrawn. Refactor only the seam needed for an assigned change, not all long functions.

### Contracts the combined revision must reconcile

1. **Host ownership and routing.** Env owns one process; the dashboard service owns the plugin and
   providerCheckout integration. APG owns provider dispatch, code facts, schemas and index commands.
   Agree the minimal env/dashboard request transport, request correlation, authorized host/root
   selection, per-project LSP/cache isolation, concurrent cancellation and owner-driven stop before
   activation. An NDJSON loop alone does not establish host sharing. Preserve current grants.
2. **Read discipline.** Graph-backed calls are attested snapshot reads with stale reasons and counts;
   guard against handler bootstrap/refresh and compile-DB materialization, not merely a missing DB.
   Live LSP calls have explicit operational effects and limits. Version their provenance and causes;
   neither those calls nor a zero text search certifies no dynamic/config/export/external callers.
3. **Installer prerequisite.** The earlier setup #6 versus env #12 chain-membership conflict is
   resolved in their updated proposals: neither places APG skills/MCP. Provider checkout integration
   belongs with the dashboard plugin, which moves under env #27. The actual approved-artifact/host
   start/connect contract and installed cleanup owner remain prerequisites, not implemented facts.
   Env #12's installed-skills record is not available merely because a plan names it.
4. **Transport parity.** Preserve resolve/stamp pre-write checks, browser subgraphs, unknown-version
   refusals and explicit no-provider/no-host causes on local and HTTP routes. Once a host provider
   exists, route queue work to it too; do not retain cold one-shot LSP starts as an unexamined HTTP
   default. Dashboard #17 owns bounded wait/cancellation; env #27/#30 and its moved plugin own dispatch.
5. **Existing capability disposition.** Before P4, record a completed, usable dashboard code lookup
   from a real session on each of PHP, C++ and TS, with project/transport/outcome identified through
   dashboard #21. Refused/no-host attempts alone do not meet the use gate; no paid trial is implied.
   The first API has find/callers/references/definitions/resolve/stamp/subgraph. That does not
   automatically replace transitive impact, virtual dispatch/hierarchy or compiler diagnostics. The named combined approval must identify each needed task's
   dashboard replacement or explicitly accept its loss. Do not recreate all 43 verbs speculatively
   or silently claim full parity. Viewer and project overlay losses have their stricter P5 gates.
6. **Guidance and source ownership.** Dashboard #17 and setup #2 move the full safe-to-delete process
   behind a code-reference pointer before APG skills disappear. Setup #6 reports owned leftovers;
   setup #3's reported reset-on-install policy does not authorize APG to reset a source. Preserve
   foreign/unmanaged content and follow the approved setup migration for the selected bytes.
7. **Stale prose to reconcile, not copy.** #8 still contains a per-bridge process alternative, #16
   describes bridge lifetime, #1 calls provider HEAD requested HEAD, env #30 calls the surviving queue
   UI-only, and wrapper #25/dashboard #17 retain cold-per-claim wording. Their later host-wide target
   and HTTP lookup scope take precedence in this draft. #17's root .ignore conflicts with dashboard
   #6's shared-selector rule. These are combined-plan corrections, not permission for public edits.

### Existing commitments, approval and operator gates

Keep atomic publication/read attestation, source identity, unknown-versus-empty, bounded populations,
per-edge provenance and no absence authority. Preserve derived reporter identity, per-script exit
semantics, dirty-tree refusal for sweeps, cursor/baseline integrity and the existing queue until the
replacement is verified. A request or event triggers work; any retained time backstop must name
its recovery obligation. New code must not rely on the November 3 ledger's superseded interpretations.

The September 8 plan's protected measurement boundaries remain: no paid A/B or usefulness trial,
no silent change to the frozen experiment, no embedding/runtime installation, no historical digest
rescue and no arbitrary health refactor. The NO-RUN in `docs/efficacy-eval-design.md` remains. Old
adoption/efficacy figures stay dated; ordinary real-session code use is not approval to start a trial.
The October sweep observations and last green suite are historical, not this draft's runtime proof.

Settled recorded target: provider-only, one host process/no idle timer, explicit graph enabling,
no feature export, no interim skill rename. Do not re-ask these as open architecture preferences.
Outstanding operator gates: A2's actual viewer acceptance, each project's overlay import/drop,
any runtime installation or paid trial, and live rollout/repair actions outside this planning scope.
D13 remains the recorded default for Laravel 10/11+, trait-as-IMPLEMENTS and opt-in rust-analyzer.

Before implementation the coordinator names the combined revision and collects explicit
APPROVE/REVISE from APG, dashboard, env, wrapper, comms and setup owners. Approval is revision-bound;
a materially changed interface/dependency returns to its affected owners. APG will not approve
an index that still makes the provider per session or removes an unmigrated project/installed path.
The only finished scope here is the local planning handoff. No product behavior has changed.

## Historical agreement, 2026-09-20

Retained below as the original record, not the current sequence. The November target above replaces
its future standalone/export/no-standing-provider direction; existing behavior remains until the
migration gates pass. Its viewer-use acceptance and evidence/measurement protections survive.

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
