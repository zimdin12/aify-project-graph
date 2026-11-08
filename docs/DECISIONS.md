# Decisions

Which recorded decisions still apply. The dated notes in `docs/` are the evidence journal; this page says
which of their decisions stand. Read the cited note for the reasoning.

Columns:

- **Status.** CURRENT (stands), SUPERSEDED (replaced; the row names by what), OPEN (waiting on a decision or a
  run), PARKED (stopped on purpose, not rejected).
- **Approved.** Whether the work was approved, and by whom. A current decision can be unapproved work.
- **Implemented.** What HEAD does, checked when this page was written (2026-11-08, at `2a2bd795`). "Not checked"
  means I did not look.

A note whose decisions are all superseded moves to `docs/archive/`. aify-dashboard's search leaves
`docs/archive/` and `docs/evidence/` out by default (`FENCED_UNDER_DOCS`, aify-dashboard#6); open such a note
by its path.

Each source is `path:line` followed by words found on that line, so a moved note or a shifted line is visible.
`tests/unit/docs/decisions-index-cites-real-lines.test.js` checks every one.

## Product direction

| Date | Decision | Status | Approved | Implemented | Source |
|---|---|---|---|---|---|
| 2026-11-04 | apg is a provider for aify-dashboard only: no agent MCP tools, no per-session server, no apg agent skills. One provider process per host, started by aify-env, no idle timer. A project with no graph gets the steps to enable one. Nothing is removed until the dashboard counterpart exists and is used. | CURRENT | Yes, owner decision 2026-11-04 | No. Agent MCP tools and skills still ship; the migration is #8. | [aify-comms ROLES.md:55 at 8c2697ee](https://github.com/zimdin12/aify-comms/blob/8c2697eedad25622829d75f0dba00a592c925ad7/docs/audit-2026-11/ROLES.md#L55); `docs/PLAN-2026-09-20-dashboard-seam.md:138` "Settled recorded target: provider-only" |
| 2026-11-04 | Delivery in phases P0-P6. Retiring an interface is a separate gate from introducing its replacement. | CURRENT | No. A planning draft awaiting the combined owner approval. | Partly. P0 and P3 issues are being closed (#7, #12, #15, #16, #21). | `docs/PLAN-2026-09-20-dashboard-seam.md:34` "Retiring an interface is a separate gate"; `docs/PLAN-2026-09-20-dashboard-seam.md:5` "Planning only" |
| 2026-11-04 | P4: retire the agent MCP server and skills, keeping the provider's reusable handlers. | CURRENT | Target yes (owner); the gate has not passed. | No | `docs/PLAN-2026-09-20-dashboard-seam.md:44` "Retire agent MCP and skills" |
| 2026-11-04 | P5: retire the viewer and the overlays at their own gates. Standalone and per-project paths stay until then. | CURRENT | Target yes; the viewer and each project's overlay need their own acceptance. | No. Viewer and overlays exist. | `docs/PLAN-2026-09-20-dashboard-seam.md:45` "Retire viewer and overlays at independent gates"; `docs/PLAN-2026-09-20-dashboard-seam.md:16` "Preserve the existing standalone/per-project paths" |
| 2026-11-04 | Recorded defaults: Laravel 10/11+, trait-as-IMPLEMENTS, rust-analyzer opt-in. | CURRENT | Recorded defaults, not fresh owner testimony | Trait-as-IMPLEMENTS yes; rust-analyzer no | `docs/PLAN-2026-09-20-dashboard-seam.md:142` "D13 remains the recorded default" |
| 2026-11-04 | Issues #3, #9 and #11 are superseded; #18 is withdrawn. | CURRENT | n/a | n/a | `docs/PLAN-2026-09-20-dashboard-seam.md:81` "#3 is superseded"; `docs/PLAN-2026-09-20-dashboard-seam.md:85` "#18 is withdrawn" |
| 2026-09-20 | Dashboard split: overlays and their skills move to aify-dashboard, the features file becomes a read-only export. | SUPERSEDED by the 2026-11-04 provider-only decision (no feature export; overlays retire at P5 gates) | Agreed with dashboard-manager, 2026-09-20 | No | `docs/PLAN-2026-09-20-dashboard-seam.md:185` "becomes a read-only export"; `docs/PLAN-2026-09-20-dashboard-seam.md:150` "Historical agreement, 2026-09-20" |
| 2026-09-20 | Retire `graph_lookup` and `graph_summary` (superseded by `whereis`). A surface change, not dead-code cleanup. | SUPERSEDED by P4, which retires the whole agent MCP surface | Agreed 2026-09-20 | No. Both are still registered in `mcp/stdio/tools/schema.js`. | `docs/PLAN-2026-09-20-dashboard-seam.md:197` "Retire `graph_lookup` and `graph_summary`" |
| 2026-09-20 | Delete the dead structural-digest writer. | SUPERSEDED as a standalone step; the 2026-11-04 plan does not schedule it | Agreed 2026-09-20 | No. `writeStructuralDigest` is still defined. | `docs/PLAN-2026-09-20-dashboard-seam.md:189` "Delete the dead structural-digest writer" |
| 2026-09-20 | The deletion-guard hook stays apg's, delivered through aify-wrapper. | CURRENT until P4 | Agreed 2026-09-20 | No. "Neither hook is wired anywhere today." | `docs/PLAN-2026-09-20-dashboard-seam.md:213` "Neither hook" |
| 2026-09-19 | apg runs as a library and CLI only, no standing service; read-only feature export; retire the viewer. | SUPERSEDED by the 2026-11-04 provider-only decision | No. A proposal. | n/a | `docs/archive/2026-09-19-dashboard-boundary-proposal.md:5` "A proposal only" |

## Languages

| Date | Decision | Status | Approved | Implemented | Source |
|---|---|---|---|---|---|
| 2026-08-30 | F4, a PHP language-server backend, is gated on a PHP runtime on the host, not on a licence. phpactor is MIT and needs no bundling. | CURRENT | Installing a runtime is Steven's call. #6 plans phpactor on PATH that degrades cleanly when absent. | No PHP backend in `mcp/stdio/code-intel/backends.js` | `docs/2026-08-30-f4-php-is-gated-on-a-runtime-not-a-licence.md:1` "gated on a runtime, not on a licence" |
| 2026-08-26 | F4 does not earn a backend: blocked on a licence. | SUPERSEDED 2026-08-30 by the row above | n/a | n/a | `docs/archive/2026-08-26-f4-php-spike.md:9` "Q1 fails on licensing" |
| 2026-08-10 | No PHP extractor work before step 3 of the one-plan. | SUPERSEDED by P3 of the 2026-11-04 plan, which schedules the PHP work | n/a | PHP fixtures and fixes landed under #4 and #15 | `docs/2026-08-10-one-plan.md:915` "No PHP extractor work before step 3" |
| 2026-08-10 | The 105.3% PHP figure is not a quality rate. | CURRENT | n/a | n/a | `docs/2026-08-10-one-plan.md:832` "RETIRED" |

## Plans and their order

| Date | Decision | Status | Approved | Implemented | Source |
|---|---|---|---|---|---|
| 2026-09-08 | Retire dead paths, verify reach, exercise real tasks, refactor the seams they expose, then consider a funded series. | Ordering SUPERSEDED by the 2026-11-04 draft for delivery; its measurement gates stay in force | Owner-directed | Not checked | `docs/PLAN-2026-09-08-simplify-and-reach.md:3` "Supersedes the ORDERING"; `docs/PLAN-2026-09-08-simplify-and-reach.md:6` "measurement gates remain in force" |
| 2026-09-06 | Two tags, then build the delta. | SUPERSEDED 2026-09-08 | n/a | n/a | `docs/archive/PLAN-2026-09-06-two-tags.md:3` "SUPERSEDED 2026-09-08" |
| 2026-09-03 | Order: suite green, fail-open, then the rest. | SUPERSEDED by the 2026-09-06 and 2026-09-08 plans | n/a | n/a | `docs/ROADMAP-2026-09-03.md:5` "Supersedes the ordering" |
| 2026-09-03 | Drop M3b. | CURRENT | Decided 2026-09-03 | n/a | `docs/PLAN-agent-knowledge-system.md:525` "DROP" |
| 2026-09-02 | M4: do not narrow the tool surface. | CURRENT until P4 retires the surface | n/a | n/a | `docs/PLAN-agent-knowledge-system.md:566` "DO NOT NARROW" |
| 2026-09-03 | The M5 A/B is 12 runs, Steven's budget. The plan's earlier figure on the same day was 24, cut from 72. | CURRENT (12) | Steven | Not run (see the next row) | `docs/ROADMAP-2026-09-03.md:292` "12 runs = 6 paired cells (Steven's budget)"; `docs/PLAN-agent-knowledge-system.md:630` "72 → 24" |
| 2026-09-08 | The efficacy A/B does not run yet: the protocol is a scaffold, not an executable run. | OPEN (held) | n/a | Not run | `docs/efficacy-eval-design.md:3` "NO-RUN" |
| 2026-09-08 | Files over 400 lines of code may only shrink; 1,000 is a hard ceiling. | CURRENT | n/a | Yes, `tests/unit/source-files-do-not-grow.test.js` | `docs/PLAN-2026-09-08-simplify-and-reach.md:365` "A door now holds the line" |
| 2026-09-08 | Freeze embedding expansion until a real discovery task needs it. | CURRENT | n/a | n/a | `docs/PLAN-2026-09-08-simplify-and-reach.md:67` "FREEZE" |
| 2026-09-08 | T3's heading-rank precision signal was measured and not built. | CURRENT | n/a | n/a | `docs/PLAN-2026-09-08-simplify-and-reach.md:319` "NOT BUILT" |
| 2026-09-08 | Retire `APG_AUTO_SYNC` and `startAutoSync`. | CURRENT | n/a | Yes. Only a comment names it (`mcp/stdio/sync/watcher.js`). | `docs/PLAN-agent-knowledge-system.md:62` "RETIRED 2026-09-08" |

## Verbs, evidence and indexing

| Date | Decision | Status | Approved | Implemented | Source |
|---|---|---|---|---|---|
| 2026-08-25 | Delete `degraded` and `operationallyDegraded`, through a versioned fail-closed migration, never silently. | CURRENT as a target; the deletion step is BLOCKED | Approved as a target | No. Contract 1 still carries both; contract 2 drops them. | `docs/2026-08-25-evidence-contract-census.md:3` "approved"; `docs/2026-08-25-step-7.5-negotiated-contract.md:3` "BLOCKED" |
| 2026-08-25 | The seven contested verbs and `graph_index` stay listed. | CURRENT until P4 | Approved | Not checked | `docs/2026-08-25-seven-verbs-carrier-and-population.md:67` "APPROVED to remain listed" |
| 2026-08-30 | Default `graph_search` widens to documents when code finds nothing; explicit `kind:"code"` stays narrow. | CURRENT for the premise; the first implementation was replaced | Upheld by the reviewer | Not checked | `docs/2026-08-30-the-founding-question-failed-on-the-default-path.md:111` "reversal of a deliberate prior decision"; `docs/2026-08-30-review-response-round-1.md:8` "do not revert the discovery premise"; `docs/2026-08-30-review-response-round-1.md:9` "the implementation did not" |
| 2026-08-29 | A full rebuild runs as one transaction. | CURRENT | n/a | Yes, `mcp/stdio/storage/rebuild-transaction.js` | `docs/2026-08-19-roadmap.md:581` "CLOSED 2026-08-29" |
| 2026-08-22 | A stale MCP process refuses rather than warns. | CURRENT | n/a | Not checked | `docs/2026-08-19-roadmap.md:565` "REFUSES" |
| 2026-08-22 | Hook rule A is dead; rule B is viable and fires only on LSP_VERIFIED edges. | CURRENT | n/a | Not wired (see the deletion-guard row) | `docs/2026-08-22-hook-fire-rate.md:15` "DEAD"; `docs/2026-08-19-roadmap.md:380` "LSP_VERIFIED" |
| 2026-08-19 | No LLM-inferred decision or governance edges. | CURRENT | n/a | n/a | `docs/2026-08-19-roadmap.md:15` "explicitly NOT wanted" |
| 2026-08-19 | Legacy doc-to-symbol `mentions` are deleted and rederived. | CURRENT | Ruled by the reviewer | Not checked | `docs/2026-08-19-roadmap.md:116` "DELETE and rederive" |
| 2026-08-19 | Variable extraction (R2). | PARKED, not rejected | n/a | No | `docs/2026-08-19-variable-extraction-parked.md:3` "PARKED" |
| 2026-08-18 | The ">10 files, Grep beats whereis" guidance is retired. | CURRENT | n/a | n/a | `docs/whereis-threshold-retirement.md:3` "retired" |
| 2026-08-12 | Split `server.js` and `generator.js` into two files each. | CURRENT, done | n/a | Yes | `docs/2026-08-12-refactor-proposal.md:3` "EXECUTED" |
| 2026-08-25 | Adoption is an install problem. The follow-up plan, "skills are the lever", was falsified the same day. | CURRENT for the finding; the skills plan is SUPERSEDED | n/a | n/a | `docs/2026-08-25-adoption-is-an-install-problem.md:1` "reverses the strategy"; `docs/2026-08-25-skill-reach-is-the-same-bottleneck.md:3` "falsifies the strategy" |
| 2026-08-25 | Step 7.5's negotiated contract stays in the code; no further investment. | CURRENT | n/a | Yes (dormant) | `docs/2026-08-25-step-7.5-was-premature.md:70` "DORMANT" |
| 2026-08-11 | The Sand Castle gate is lifted, with no read-only restriction. | CURRENT | Steven, 2026-08-11 | n/a | `docs/2026-08-10-one-plan.md:1248` "GATE LIFTED" |
| 2026-08-10 | Ideas rejected with reasons, so they are not proposed again. | CURRENT | n/a | n/a | `docs/2026-08-10-one-plan.md:1224` "Deaths, with reasons" |

## Waiting on a decision

| Date | Question | Status | Source |
|---|---|---|---|
| 2026-08-20 | Boundary nodes: keep them, typed as External? Collections accumulate: leave as is? | OPEN | `docs/2026-08-20-open-decisions.md:9` "Boundary"; `docs/2026-08-20-open-decisions.md:59` "Collections" |
| 2026-08-21 | Rigour for the remaining mutation arms (recommend option B). | OPEN | `docs/2026-08-21-status-and-one-new-decision.md:75` "THE NEW DECISION" |
| 2026-07-26 | The `APG_AUTO_REINDEX` default. | OPEN, Steven's call | `docs/v0.3-hardening-plan.md:162` "APG_AUTO_REINDEX" |
| 2026-09-26 | Whether to build resolved-ref evidence at all. | See its record: a record of decisions, not an approved plan | `docs/superpowers/plans/2026-09-26-resolved-ref-evidence.md:3` "NOT AN APPROVED PLAN" |

## Findings withdrawn or reverted

These are corrections to claims, not product decisions. Act on the correction, not on the original note.

| Date | What was withdrawn | Source |
|---|---|---|
| 2026-08-22 | The collection-coverage "recurrence" defect, withdrawn in full; the verified-layer figures are un-retracted. | `docs/2026-08-22-collection-coverage-recurrence.md:1` "WITHDRAWN IN FULL" |
| 2026-08-26 | The external-creation guard fix, reverted after it deleted real edges. Its successor is the one-door note. | `docs/2026-08-26-a-gate-on-creation-is-not-a-gate-on-the-edge.md:5` "REVERTED"; `docs/2026-08-26-one-door-for-external-edges.md:3` "successor" |
| 2026-08-26 | F6, withdrawn twice; closed by F12. | `docs/2026-08-26-f6-withdrawn-twice.md:8` "Withdrawn"; `docs/2026-08-26-graph-quality-arc-closed.md:24` "Closed by F12" |
| 2026-08-26 | F5 orphan nodes: not a defect. | `docs/2026-08-26-graph-quality-arc-closed.md:23` "Not a defect" |
| 2026-08-26 | An ambiguous match is not a false zero. | `docs/2026-08-26-ambiguous-match-is-not-a-false-zero.md:1` "disclosure, not a false zero" |
| 2026-08-26 | F10's reversed fallback: deleted, not corrected. | `docs/2026-08-26-f10-fixed-and-proven.md:36` "DELETED" |
| 2026-08-25 | The defect-A disclosure mechanism, abandoned before building. | `docs/2026-08-25-prereg-defect-a-index-population.md:99` "ABANDONED" |
| 2026-08-21 | `doc_link:inline-basename` deleted (precision 0.7083). | `docs/2026-08-21-phase1-gate-status.md:25` "DELETED" |
| 2026-08-22 | `doc_ref:shaped` deleted (precision 0.9311). | `docs/2026-08-19-roadmap.md:181` "DELETED" |

## How this page was built

An inventory of every `docs/*.md` searched for decision words ("decided", "superseded", "retired",
"Steven's call" and the like), reading the plans and roadmaps in full and the other notes' first lines plus
matching passages. A decision written without such words can be missing; the likeliest places are
`docs/THE-GOAL.md`, `docs/2026-08-10-state-of-the-service.md` and `docs/M1a-A-site-identity-design.md`.
`docs/evidence/` and the notes that were already in `docs/archive/` were not read.

When a decision changes, edit its row here and add a pointer line under the title of the note it corrects.
