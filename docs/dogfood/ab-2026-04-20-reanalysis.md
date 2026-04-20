# Full-project re-analysis — 2026-04-20

Fresh outside-in audit after the heads-down Phase 1 implementation run. Goal: flag anything wrong, brittle, stale, or launch-blocking that got missed during focused execution.

Methodology: I read actual state (git log, test output, file counts, doc cross-refs, brief generator code), not my own recollection. Findings cite file:line where specific.

## Launch-readiness verdict

**Launch-ready** with caveats. The core product works, fresh clones install cleanly, tests pass, docs are honest. Six items below are worth addressing before launch if time permits; three of those are real.

## What's solid

### Main branch is genuinely fresh-clone installable
- Confirmed via `rm -rf plugin-clone && git clone && npm install && npm test` → 144/144 green at time of re-analysis (later 152/152 after Phase 1 unit tests landed), zero flags, zero manual file copies. This was broken 8 hours ago and is now durable.
- `.npmrc` commits `legacy-peer-deps=true` — removes ERESOLVE on fresh installs (`package.json:26` + `.npmrc`).
- `change_plan.js` + `onboard.js` + `preflight.js` computeDecision export + `whereis.js` SEARCH_TYPES export all landed (`c39ee14`). Before this, origin/main was broken since `761595d`.

### Brief generator Phase 1 work is coherent
`mcp/stdio/brief/generator.js` is 1224 lines, up from ~890 before today. Additions:
- `extractTooling()` (lines 74-185) — manifest-parsing: package.json, requirements.txt, pyproject.toml (both Poetry + PEP-621), Cargo.toml, go.mod, composer.json
- `extractExports()` (lines 187-297) — 5-strategy universal detection (MCP / Laravel / Express / Python __init__ / graph fallback)
- `briefCoverage()` (lines 299-314) — single-line "what this brief covers"
- `primaryLangExt()` (lines 498-515) — dominant-language detection for READ dedup
- `readFirst()` overhauled (lines 517-605) — priority: docs → EXPORTS-backed → feature-anchored → graph fan-out, with language filtering
- `subsystems()` refactored (lines 404-460) — composite rank (file_count + edge_count/5), filters 0-file parents, excludes thirdparty/deps/external
- Renamed HUBS → INTERNAL_HUBS in agent + onboard briefs

All five helpers are deterministic, pull data from files/manifests/graph (no LLM), and integrate cleanly into `generateBrief()`.

### Doc truthfulness
Grepped for known stale claims across all `.md` files:
- `~/.claude/mcp.json` incorrect install path — **resolved** (now points at `claude mcp add` CLI). Only lingering reference is in the historical plan doc at `docs/superpowers/plans/2026-04-16-aify-project-graph-v1.md:3464` (plan artifacts are snapshots, not update targets — leave).
- `1.5-2.9× faster, 17-35% cheaper` universal claim — **resolved**. All 4 primary docs (README, 3× install, core skill) now carry runtime-scoped versions.
- HUBS → INTERNAL_HUBS terminology — **resolved** in docs people read; the one remaining "HUBS" mention is in `docs/dogfood/ab-results-2026-04-20-improvement-analysis.md:19` (historical analysis doc, leave).

### Cross-tester bench data exists and is coherent
Two independent testers, 2 × 24 cells, both testers' JSONs on disk, reconciled in `docs/dogfood/ab-results-2026-04-20-cross-tester.md`. 35% quality-grade disagreement is explained (model-specific + rubric-strictness drift), not random noise. One contaminated row (dev's `echoes.trace.brief-only`, flagged explicitly) excluded from aggregates.

## Real findings (worth addressing before launch)

### Finding 1 — Zero unit tests for the new Phase 1 brief features

**Severity**: medium (at re-analysis time). Test count was **still 144** after Phase 1 shipped ~400 lines of new code. (Follow-up: 8 new Phase 1 tests landed in commit 80f30f1; count is now 152.) The existing brief generator test suite (`tests/unit/brief/generator.test.js`, 7 tests) exercises `generateBrief()` end-to-end, which happens to cover the new code paths enough for green. But:
- `extractTooling()` parses 6 manifest formats. Zero targeted unit tests. A regex change would silently break without a dedicated test catching it.
- `extractExports()` has 5 strategies. Zero targeted unit tests.
- `primaryLangExt()` — no direct test.
- Composite SUBSYS rank logic — no test for "drops 0-file parents" or "excludes thirdparty".

**Grep evidence**: `grep -rE "TOOLING|EXPORTS|COVERS|INTERNAL_HUBS|extractTooling|extractExports" tests/` → zero matches.

**Recommendation**: add ~8 targeted unit tests. Not a launch blocker (code is green) but a regression risk. Post-launch P2 at worst; could batch with Phase 2 bench work.

### Finding 2 — Dev's WIP is a real feature branch (946 insertions, 16 files)

**Severity**: information, not blocker. `git diff --stat` on the local dev clone shows:
- `mcp/stdio/ingest/frameworks/laravel.js` +219 lines (Laravel plugin enhancement)
- `mcp/stdio/ingest/resolver.js` +226 lines (cross-file symbol resolution)
- 8 query verb tweaks (callers/callees/file/neighbors/path/search)
- +367 lines of new tests (ingest/resolver, laravel-plugin, query)

This is unshipped work that may address the lc-trace task quality gap (see the per-repo cross-tester analysis). It's not on main, so launch doesn't depend on it. But it represents real value sitting unreleased.

**Recommendation**: dev finalizes + commits when he's back from dashboard UX. Not a blocker but worth closing the loop post-launch.

### Finding 3 — `extractExports` MCP regex has a hard 20-entry cap

**Severity**: low. `mcp/stdio/brief/generator.js:202` caps MCP server tool detection at 20 verbs:
```
if (out.length) return out.slice(0, 20);
```
apg has 19 verbs. One more and we silently drop. Other MCP servers with more tools (e.g. if someone forks and adds) would hit this.

**Recommendation**: uncap for MCP mode (the whole point is every verb is public API), OR document the limit. 5-minute fix.

### Finding 4 — `EXPORTS` for non-MCP codebases capped at 8

**Severity**: low. Same function slices to 8 for Laravel/Python/Express/fallback paths. A Laravel app with 50 routes shows only 8 in brief. lc-api currently extracts just 1 route (the `apiResource` match) because my regex only catches `Route::<method>('uri', Handler::class)` pattern — not the nested `Route::group(...)` form Laravel uses heavily.

**Recommendation**: improve Laravel route parser to walk nested `Route::group(...)` + `Route::middleware(...)`. This is exactly what dev's P1-post-launch Laravel contributor ticket is for. Acceptable to defer.

### Finding 5 — Dashboard untested and untouched for ~2 weeks

**Severity**: medium (functional-correctness-by-inspection, not by test). Dashboard (`mcp/stdio/dashboard/server.js` + `index.html`, 763 total lines) last touched at commit `50fb7c6` (2026-04-18). No tests for dashboard rendering. I've verified it renders structurally but haven't opened it in-browser this session.

**Recommendation**: manual smoke test before launch (run `graph_dashboard()`, open URL, verify all 4 layers render, filter panel works, clicking nodes doesn't throw). ~5 min. Dev's 4 dashboard UX items address interaction enhancement, not rendering correctness.

### Finding 6 — Legacy `graph-build-all` skill references pre-Phase-1 brief structure

**Severity**: low. `integrations/claude-code/skills/graph-build-briefs/SKILL.md:37` still says:
```
Typical size: `brief.agent.md` 200-400 tokens; `brief.plan.md` 300-600 tokens
```
Post-Phase 1, brief.agent.md is ~400-500 tokens (I added TOOLING + COVERS + EXPORTS + updated SUBSYS format). Still within the stated range, but the ceiling is tighter now.

**Recommendation**: bump range to `250-500 tokens` in that skill's expected-output line. 30-second fix.

## False alarms (things I checked, nothing wrong)

- **Test count** 144 is stable across all 7 of today's commits. Green throughout.
- **Stale bench claims** — all 4 primary docs updated. Only stale references live in historical plan/analysis artifacts that are frozen by convention.
- **HUBS terminology** — rename propagated correctly through renderers + data structures. Data field `hubsArr` still uses old name in code but only in internal dataflow, not user-visible output.
- **Install path pinning** — all 3 install docs consistent. `~/.claude/plugins/aify-project-graph` (Claude), `~/.codex/plugins/aify-project-graph` (Codex), `${XDG_CONFIG_HOME:-~/.config}/opencode/plugins/aify-project-graph` (OpenCode). No drift.
- **MCP verb count in docs** — scoped honestly. Full toolset = 19; lean = 3.
- **Brief regeneration** — 4 bench repo briefs regenerated with new format after Phase 1; hashes noted in cross-tester doc.

## Pre-launch checklist (honest)

Must-do before launch:
- [x] Main is fresh-clone installable
- [x] `npm install` works without flags
- [x] `npm test` 144/144 at re-analysis time; 152/152 after Phase 1 unit tests landed (commit 80f30f1)
- [x] Docs honest (no universal claims beyond what data supports)
- [x] Cross-tester bench landed + reconciled
- [x] Quality parity achieved (3 previously-partial cells verified pass)

Should-do (30 min combined if we want):
- [ ] 8 targeted unit tests for Phase 1 brief features (Finding 1)
- [ ] Manual dashboard smoke test (Finding 5)
- [ ] Brief size range bump in graph-build-briefs skill (Finding 6)
- [ ] Uncap EXPORTS for MCP mode (Finding 3)

Nice-to-have (deferred to post-launch, already in backlog):
- [ ] Phase 2 overlay bench
- [ ] PATHS section
- [ ] Laravel framework plugin (captures Finding 4)
- [ ] Dashboard UX (3D / selected-node dim / role-aware panel / trust cues)

## Recommended post-launch priority queue

Using evidence from today's work (ordered by impact × cost):

1. **Dev's WIP merge** — 946 lines of committed-in-local work including Laravel plugin + resolver improvements. Highest latent value, just needs dev review cycle.
2. **Laravel EXPORTS contributor** (P1 from backlog) — lc-api brief is the weakest of the 4 benched repos; framework-specific contributor closes the gap. Finding 4 in this doc shows the current generic regex only catches 1/N routes on lc-api.
3. **Phase 2 overlay bench** (P1 from backlog) — measures whether brief provides **quality gains** vs just parity. Early signal from my 4 partial cells: pre-delete-impact = parity, feature-drilldown = clear win. Worth proving.
4. **Unit tests for Phase 1 brief features** (Finding 1) — regression safety net.
5. **PATHS section** (P2 from backlog) — trace tasks barely benefit from brief currently.
6. **Dashboard UX** (4 items) — polish, orthogonal to core.

## Bottom line

Launch is defensible. The 6 findings above are honest engineering residue from a heads-down implementation sprint, not showstoppers. Two are 5-minute fixes (Finding 3, Finding 6). One is a smoke test (Finding 5). Three are post-launch work (Findings 1, 2, 4).

If user wants launch polish before shipping: do Findings 3, 5, 6 now (~15 min total). If user wants to ship now and iterate: everything important is already on main.
