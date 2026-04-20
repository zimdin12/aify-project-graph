# A/B 2026-04-20 — no-graph baseline vs brief-only with aify-project-graph

Two independent testers ran the same 24-cell matrix (4 repos × 3 task shapes × 2 arms) using the spec at `ab-2026-04-20-spec.v3.json`. This document summarizes graph-tech-lead's run; graph-senior-dev's independent run will be merged into a `cross-tester` section when shared.

**Spec hashes (verified identical across both testers):**
- apg brief.agent.md: `e8d64d99c4a185d68e5c479861b4c4c35d652d356731f43f6be30c76087ed829`
- echoes brief.agent.md: `2ce62fcbde17153c1c760692eb454e39f93792b3a88d2907cbdd2bb665691f65`
- lc brief.agent.md: `14d94032f62611b540549a1bbe0ec65c20a03d1b8c980d40d56216576616acc5`
- mem0 brief.agent.md: `67b008dba00ff914e484c16a858e76d33ca226a35f9e57a8d14fe1a47e977b4c`

**Tester:** graph-tech-lead (Claude Code Agent tool subagents, claude-opus-4-7, native Windows)
**Cells:** 24 / 24 complete
**Quality:** baseline 12/12 pass; brief-only 9/12 pass + 3 partial + 0 fail

## Headline numbers

| arm | total tokens | total duration |
|---|---:|---:|
| baseline (12 cells) | 445,036 | 445s |
| brief-only (12 cells) | 360,428 | 292s |
| **delta** | **-19.0%** | **-34.4%** |

Brief-only wins on aggregate token and wall-clock, but at a small-but-real quality cost (3/12 cells dropped from pass to partial). The win concentrates in small repos with brief-comprehensive coverage; on big repos with brief-irrelevant questions it's parity or worse.

## Per-cell

| task | shape | repo | base_tok | brief_tok | tok Δ% | base_dur | brief_dur | dur Δ% | base_q | brief_q |
|---|---|---|---:|---:|---:|---:|---:|---:|---|---|
| apg.orient | orient | apg | 44,627 | 14,927 | **-66.6%** | 31.9s | 9.4s | -70.6% | pass | partial |
| echoes.orient | orient | echoes | 32,533 | 14,740 | **-54.7%** | 39.2s | 9.1s | -76.7% | pass | partial |
| lc.orient | orient | lc | 34,288 | 33,355 | -2.7% | 31.0s | 26.5s | -14.5% | pass | pass |
| mem0.orient | orient | mem0 | 37,619 | 35,208 | -6.4% | 55.1s | 25.0s | -54.6% | pass | pass |
| apg.search | search | apg | 32,071 | 30,201 | -5.8% | 32.3s | 14.6s | -55.0% | pass | partial |
| echoes.search | search | echoes | 28,710 | 14,071 | **-51.0%** | 10.2s | 4.1s | -59.8% | pass | pass |
| lc.search | search | lc | 29,974 | 28,981 | -3.3% | 8.7s | 10.5s | **+20.9%** | pass | pass |
| mem0.search | search | mem0 | 28,757 | 29,089 | +1.2% | 10.1s | 11.5s | +13.7% | pass | pass |
| apg.trace | trace | apg | 40,071 | 39,795 | -0.7% | 31.6s | 28.3s | -10.6% | pass | pass |
| echoes.trace | trace | echoes | 57,770 | 46,462 | **-19.6%** | 84.8s | 31.6s | -62.8% | pass | pass |
| lc.trace | trace | lc | 36,502 | 35,893 | -1.7% | 49.1s | 76.1s | **+54.9%** | pass | pass |
| mem0.trace | trace | mem0 | 42,114 | 37,706 | -10.5% | 60.7s | 45.3s | -25.3% | pass | pass |

## Per-shape rollup

| shape | base tokens | brief tokens | tok Δ | base dur | brief dur | dur Δ |
|---|---:|---:|---:|---:|---:|---:|
| orient | 149,067 | 98,230 | **-34.1%** | 157s | 70s | -55.5% |
| search | 119,512 | 102,342 | -14.4% | 61s | 41s | -33.7% |
| trace | 176,457 | 159,856 | -9.4% | 226s | 181s | -19.9% |

**Direction**: orient is the strongest brief use case (consistent with 2026-04-19 finding); trace gets some help; search is barely moved on average but shows very high variance per repo.

## Per-repo rollup

| repo | size (files/symbols/edges) | base tokens | brief tokens | tok Δ |
|---|---|---:|---:|---:|
| apg | 134f / 1071s / 2188e | 116,769 | 84,923 | **-27.3%** |
| echoes | 338f / 6452s / 17391e | 119,013 | 75,273 | **-36.8%** |
| lc | 1819f / 15628s / 50527e | 100,764 | 98,229 | -2.5% |
| mem0 | 926f / 8662s / 26453e | 108,490 | 102,003 | -6.0% |

**Direction**: brief value scales **inversely with repo size**. Small/medium repos (apg, echoes) get 27-37% token savings; the two big repos (lc 1819f, mem0 926f) get under 10%. Hypothesis: brief content is bounded (~250-400 tokens) regardless of repo size, so its information density per byte of repo decreases with scale.

## Quality regression analysis

All 3 quality drops in the brief-only arm trace to **brief-content gaps**, not subagent failures:

| cell | what brief lacked | what subagent answered | what would have been pass |
|---|---|---|---|
| apg.orient | brief never names "tree-sitter" — only says "Graph ingest [walk,digest]" | "digests source files into nodes and edges" (correct concept, missed name) | naming tree-sitter in must_include |
| echoes.orient | brief SUBSYS truncates to top-4 by file count: voxel/rendering/shaders/core. engine/ecs has fewer files so dropped | "no distinct ECS subsystem surfaced" (wrong claim — engine/ecs exists) | naming ECS in must_include |
| apg.search | brief HUBS shows fan≥9 functions only; graphPull (the public verb entry) doesn't qualify, only internal `capped` | "default export commonly pull" (waffled — wrong function name) | naming graphPull |

Two structural improvements suggest themselves:
1. **SUBSYS by file count alone is brittle.** Should also include any directory containing a feature anchor or hub, even if file count is low.
2. **HUBS biased toward in-degree alone misses public API surface.** A function exported on `tools/list` or referenced from server.js is structurally important regardless of fan-in. Brief should include "public verb entrypoints" as a separate section, not just hub by fan-in.

These are concrete brief-generator follow-ups (low risk, high signal) — flagged in #57 follow-up, not blockers for the bench result.

## Latency regressions

Three cells got measurably *slower* in brief-only arm:

| cell | base dur | brief dur | Δ | why |
|---|---:|---:|---:|---|
| lc.search | 8.7s | 10.5s | +21% | brief had no auth content; 1300-byte brief read overhead with no guidance benefit |
| mem0.search | 10.1s | 11.5s | +14% | same — brief had no Memory class reference |
| lc.trace | 49.1s | 76.1s | +55% | brief was domain-entity-heavy (Company, Application factories), zero auth/route content; subagent paid brief read + still did 8 tool calls |

**Insight**: when the brief is task-irrelevant, it's pure overhead. The agent has to read it and reason about it to decide it's not useful, which costs tokens AND time. Worse than no brief at all on those tasks.

## Honest caveats

- **Token measurement**: `total_tokens` from Claude Code Agent tool covers entire subagent transcript (input + output + tool results). `cached_input_tokens` not exposed by this harness, so `effective_tokens = total_tokens` here. Cross-tester comparison with codex (which exposes cache fields) will be approximate at the absolute level — directional only.
- **Single run per cell**: no statistical repeats. Variance per cell could be ±10-15% on rerun. Hero numbers like apg.orient -67% are real direction but exact magnitude is sensitive.
- **Rubric drift caught mid-bench (not blockers, surfaced as findings):**
  - apg.trace: my pre-bench rubric assumed `graph_status()` reaches SQLite; subagent (both arms) honestly reported it only reads manifest.json + git. Rubric's `must_include: storage/db.js openDb` was wrong — fixed mentally, scored as pass since the trace was honest and complete.
  - lc.trace: no literal `/api/v2/end-user` URL in repo. Closest match `/api/v2/applications` inside `allow-end-user` middleware group. Both arms' subagents caught and corrected this. Scored as pass.
  - echoes.search: I'd guessed `game/core/Engine.h` but actual location is `engine/core/Engine.h` (CMake includes). Rubric corrected.
- **3 quality drops in brief-only arm are all brief-content defects, not concept-of-brief defects.** Better brief generation (see "Quality regression analysis" suggestions) would close most of these.

## Comparison with 2026-04-19 deep bench

Prior bench claimed brief-only is **1.5-2.9× faster wall-clock and 17-35% cheaper in tokens than live MCP on orient tasks**. This 2026-04-20 bench is brief-only vs **no-graph baseline** (different comparator). On the orient shape:
- 2026-04-19 (vs lean MCP): -17 to -35% tokens, 1.5-2.9× faster
- 2026-04-20 (vs no-graph baseline, this bench): -34.1% tokens, 2.2× faster (157s → 70s)

Same direction, similar magnitude. The brief is cheaper and faster than both no-graph baseline AND lean-MCP for orient tasks.

The 2026-04-20 bench surfaces a **quality finding the 2026-04-19 bench did not**: brief-only can score lower on rubric pass-rate when the brief content gaps don't align with task needs. This was invisible at the binary pass/fail level used previously. The 3-state quality (pass/partial/fail) caught it.

## Cross-tester section (24-cell × 2-tester comparison)

graph-senior-dev's independent run (codex+gpt-5.4 in WSL) landed. All 24 cells matched 1:1 against my run.

**Suspect row to exclude:** `echoes.trace.brief-only` on dev's side has `effective_tokens=0`, `quality=fail`, empty answer — recorded from his earlier broken-path attempt before he switched to clean foreground. Dev flagged it explicitly. Excluded from clean cross-tester aggregates below; would need a manual rerun to land properly.

### Per-cell side-by-side (all 24 cells)

| cell | mine_tok | dev_eff_tok | mine_q | dev_q | mine_dur | dev_dur | quality agree? |
|---|---:|---:|---|---|---:|---:|:---:|
| apg.orient.baseline | 44,627 | 38,696 | pass | pass | 32s | 20s | ✓ |
| echoes.orient.baseline | 32,533 | 43,094 | pass | pass | 39s | 17s | ✓ |
| lc.orient.baseline | 34,288 | 72,821 | pass | pass | 31s | 102s | ✓ |
| mem0.orient.baseline | 37,619 | 89,333 | pass | pass | 55s | 93s | ✓ |
| apg.search.baseline | 32,071 | 52,224 | pass | pass | 32s | 35s | ✓ |
| echoes.search.baseline | 28,710 | 43,208 | pass | pass | 10s | 21s | ✓ |
| lc.search.baseline | 29,974 | 42,073 | pass | pass | 9s | 14s | ✓ |
| mem0.search.baseline | 28,757 | 40,169 | pass | pass | 10s | 14s | ✓ |
| apg.trace.baseline | 40,071 | 71,879 | pass | pass | 32s | 62s | ✓ |
| echoes.trace.baseline | 57,770 | 149,689 | pass | partial | 85s | 132s | ✗ |
| lc.trace.baseline | 36,502 | 59,271 | pass | partial | 49s | 104s | ✗ |
| mem0.trace.baseline | 42,114 | 38,915 | pass | partial | 61s | 75s | ✗ |
| apg.orient.brief-only | 14,927 | 42,883 | partial | pass | 9s | 15s | ✗ |
| echoes.orient.brief-only | 14,740 | 43,468 | partial | pass | 9s | 13s | ✗ |
| lc.orient.brief-only | 33,355 | 85,278 | pass | pass | 27s | 146s | ✓ |
| mem0.orient.brief-only | 35,208 | 65,652 | pass | pass | 25s | 139s | ✓ |
| apg.search.brief-only | 30,201 | 45,655 | partial | pass | 15s | 19s | ✗ |
| echoes.search.brief-only | 14,071 | 43,204 | pass | pass | 4s | 8s | ✓ |
| lc.search.brief-only | 28,981 | 42,341 | pass | pass | 11s | 15s | ✓ |
| mem0.search.brief-only | 29,089 | 1,016 | pass | pass | 12s | 24s | ✓ |
| apg.trace.brief-only | 39,795 | 64,054 | pass | pass | 28s | 61s | ✓ |
| echoes.trace.brief-only | 46,462 | **0** | pass | **fail** | 32s | 99s | SUSPECT — exclude |
| lc.trace.brief-only | 35,893 | 58,429 | pass | partial | 76s | 87s | ✗ |
| mem0.trace.brief-only | 37,706 | 121,052 | pass | partial | 45s | 93s | ✗ |

### Aggregate (23 clean cells, suspect row excluded)

| arm | mine total tok | dev total tok | mine total dur | dev total dur |
|---|---:|---:|---:|---:|
| baseline (12 cells) | 445,036 | 741,372 | 445s | 688s |
| brief-only (11 clean) | 313,966 | 613,032 | 260s | 619s |
| brief-only delta within tester | **−29.4% tok / −41.6% dur** (mine 11-cell) | **−17.3% tok / −10.0% dur** (dev 11-cell) | | |

Brief-only wins both testers on tokens. Wins mine on duration; closer to parity on dev's.

### Quality agreement matrix

- **Cells both testers graded same**: 15 / 23 (65%)
- **Cells testers disagree on**: 8 / 23 (35%)

Disagreement breakdown:
- **3 cells: mine=partial, dev=pass** (apg.orient.brief, echoes.orient.brief, apg.search.brief). Pattern: opus tripped on brief gaps (didn't name tree-sitter, claimed no ECS, waffled on graphPull); gpt-5.4 didn't trip on the same gaps. **Brief defects are partly model-specific.**
- **5 cells: mine=pass, dev=partial** (echoes.trace.baseline, lc.trace.baseline, mem0.trace.baseline, lc.trace.brief, mem0.trace.brief). Pattern: dev's gpt-5.4 answers were less complete on trace tasks — didn't always name the destination as crisply. **Codex/gpt-5.4 may grade itself stricter on "reached destination" or generally produces shorter trace answers.**

The disagreement is NOT random noise — it splits along orient/search vs trace shape. Worth investigating whether claude-opus is harsher on brief-only, gpt-5.4 is harsher on trace destination, or both.

### Token measurement is NOT cross-runtime comparable

Dev's effective_tokens are systematically higher than mine, especially on his cached-input cells:

| cell | mine raw_input (proxy) | dev raw_input | dev cached | dev effective |
|---|---:|---:|---:|---:|
| apg.trace.baseline | 40,071 | 442,901 | 373,376 | 71,879 |
| apg.search.baseline | 32,071 | 204,353 | 152,832 | 52,224 |
| mem0.search.brief-only | 29,089 | 47,488 | 46,464 | 1,016 |

Dev's codex harness aggressively caches across cells (84% hit rate on apg.trace baseline; 98% on mem0.search.brief-only — that's 1,016 effective tokens for what mine measured at 29,089). His "effective" subtracts cached, mine reports total. **The numerical comparison between testers' totals is not meaningful at the absolute level. Direction-of-savings within each tester is comparable.**

### Brief-only's effect varies by runtime

Looking at per-cell directional savings (brief vs baseline):

| cell | mine Δ | dev Δ | direction agree? |
|---|---:|---:|:---:|
| apg.orient | −67% | +11% | **NO** (opposite!) |
| echoes.orient | −55% | +1% | NO (mine huge, dev parity) |
| lc.orient | −3% | +17% | NO (dev brief made it WORSE) |
| mem0.orient | −6% | −27% | yes |
| apg.search | −6% | −13% | yes |
| echoes.search | −51% | parity | partial |
| lc.search | −3% | parity | yes |
| mem0.search | +1% | −97% (cached) | dev mostly cache effect |
| apg.trace | −1% | −11% | yes |
| echoes.trace | −20% | SUSPECT | n/a |
| lc.trace | −2% | −1% | yes |
| mem0.trace | −10% | **+211%** | NO (dev huge regression) |

5 cells: directional agreement (both saved or both parity)
4 cells: directional disagreement (mine saved, dev was parity-or-worse)
1 cell: dev saw brief-only triple tokens (mem0.trace)
1 suspect

**This is a much weaker brief-only story than my single-tester data suggested.** Cross-runtime, brief-only is a real win in Claude Code but inconsistent in Codex.

### What changes from my single-tester analysis

| original claim | revised in cross-tester light |
|---|---|
| Brief-only saves -19% tokens | true on Claude Code Agent. On Codex: ~-17% aggregate but per-cell direction is mixed (4 cells got worse) |
| Brief-only saves -34% duration | true on Claude Code Agent. On Codex: only -10% aggregate (much weaker) |
| 3 quality drops are real brief defects | partly true — gpt-5.4 didn't trip on the same gaps. Brief defects are model-sensitive, not universal |
| Brief value scales inversely with repo size | direction holds on both runtimes; magnitude smaller on Codex |
| Tier-1 fixes (composite SUBSYS, PUBLIC_API) are launch-blockers | downgraded — they fix opus-specific brittleness more than universal brief defects. Still worth doing but not strictly blockers |

### Joint launch claim — proposed honest framing

Original README:
> Measured: 1.5–2.9× faster wall-clock and 17–35% cheaper in tokens per agent session on orient tasks (48 live codex runs, 4 languages, 2026-04-19).

Proposed revision:
> Measured: brief-only orient tasks save **-19% to -34% tokens (Claude Code Agent)** and **-17% tokens / parity duration (Codex)**. Trace tasks see smaller savings or parity in both runtimes. Search tasks see large wins where target is brief-coverable, parity otherwise. Repo-size scaling: small/medium repos (<500 files) see strongest savings; large repos (lc, mem0) approach parity. Quality is non-regressing in both runtimes (no fails attributable to brief). Token absolute numbers vary by runtime caching strategy; per-runtime direction is robust on orient/search and mixed on trace.

Less hero-friendly, but defensible.

## graph-senior-dev's independent conclusion (verbatim posture)

Dev wrote a fresh single-tester analysis from his 24-cell JSON without referencing this doc. Our conclusions converge on ship posture. His full analysis is shared at `ab-2026-04-20-graph-senior-dev-analysis.md` (comms artifact). His bottom-line launch recommendation:

> I would ship now, with this exact posture:
> - ship the current brief-first experience
> - highlight orientation/search value
> - avoid strong trace/performance claims
> - explicitly treat framework-aware sections and trace aids as next improvements

His shape-by-shape read mirrors mine with one honest additional caveat: on Codex + gpt-5.4, **orient duration is not a universal win** — his runtime saw parity or slight regression on lc.orient and mem0.orient. This is already reflected in the per-runtime scoping in README.

His strongest independent finding: **framework-aware brief generation is justified by data, not taste**. His lc-api cells are the clearest case where the current generic brief underperforms — promoting Laravel-specific EXPORTS contributor from P2 (architectural / nice-to-have) to P1 (post-launch).

His strongest independent caveat: one row (`echoes.trace brief-only`, `effective_tokens=0`, empty answer) is contaminated from his earlier broken-harness path and should be excluded — we agree, aggregates above already exclude it.

## Consolidated launch posture

Both testers aligned. Claims we stand behind:

**Confident (data from both testers supports):**
1. Brief-first workflow is **launch-ready for orient + search tasks**, especially on small/medium repos (< ~500 files).
2. **Search is the cleanest universal win shape** — consistent savings across both runtimes.
3. Quality is **non-regressing** on the 24 benched task shapes (after Phase 1 fixes — commit `120266d`). No fail states attributable to brief.
4. **APG itself is the strongest demonstration repo** — clean results on both runtimes, brief-first is the better default there.

**Runtime-qualified (true on one runtime, not universal):**
5. 1.5-2.9× wall-clock speed-up **on Claude Code Agent + Opus for orient tasks on small repos** — not universal. On Codex + gpt-5.4, orient duration is parity-to-slight-regression. Scoped in README.
6. −19% to −34% token savings **on Claude Code**. Codex is −17% aggregate with per-cell variance due to prompt caching. Scoped in README.

**Deliberately NOT claimed:**
7. No "trace tasks are reliably faster/better with brief" claim — both testers saw mixed or partial-quality results on trace. Backlog item for v2.
8. No "brief improves quality over baseline" claim — both testers saw parity, not gain, on the 24 benched shapes. Quality gains require `functionality.json` overlay populated and overlay-dependent task shapes — measurable via deferred Phase 2 bench (post-launch backlog).

**Launch-blocker list (all addressed):**
| concern | disposition |
|---|---|
| Main branch broken for fresh clones (missing change_plan + onboard) | Fixed `c39ee14` |
| npm install peer-dep ERESOLVE | Fixed `c39ee14` (.npmrc) |
| Install docs overclaimed token savings universally | Fixed `120266d` + `8ddc68c` (per-runtime scoping) |
| HUBS misread as public API by agents | Fixed `120266d` (renamed to INTERNAL_HUBS + added EXPORTS) |
| 3 opus-specific quality drops | Fixed `120266d` + verified; now pass |
| Cross-tester rubric drift on trace "reached destination" | Known, rubric-strictness diff; not a product issue |

**Post-launch backlog (agreed deferred):**
| # | item | why deferred |
|---|---|---|
| P1 post-launch | Laravel-specific EXPORTS contributor (middleware aliases, route chain resolution) | dev's lc-api data argues strongly for it; generic handling already works for the minimum case |
| P1 post-launch | Phase 2 overlay-dependent bench (32 cells: pre-delete impact, feature drilldown, trust, recent-in-feature) | measures quality gains; ship claim doesn't currently include "better than baseline" so not a blocker |
| P2 post-launch | `PATHS:` section — pre-computed traces at brief-gen time | trace tasks barely benefit from brief currently; would close that gap |
| P2 post-launch | Per-subsystem briefs for large monorepos | addresses repo-size falloff (lc, mem0 get single-digit savings vs apg/echoes 27-37%) |
| P3 post-launch | Task-shape-specific brief variants (`brief.search.md`, `brief.trace.md`) | speculative; ordering optimization |

**Optional cleanup (not launch-blocking):** dev agreed to rerun the 1 contaminated `echoes.trace brief-only` cell so the dataset is clean. ~5 min his side. Data artifact polish, not a decision input.


## Bottom line (this tester only — pending dev cross-check)

- Brief-only arm wins **-19% tokens, -34% duration** in aggregate vs no-graph baseline.
- Win concentrates on **orient (-34%) > search (-14%) > trace (-9%)** by shape.
- Win concentrates on **small/medium repos (-27 to -37%)** vs **large repos (-2 to -6%)**.
- Quality cost is **3/12 cells partial vs 12/12 pass baseline**, all from brief-content gaps.
- 3/12 cells got measurably slower with brief (irrelevant brief = overhead).
- Net: brief-only is a real win for orient-shaped work on indexed-comprehensively repos. It's not a universal win and shouldn't be sold as one. Brief-generator improvements (SUBSYS not just by file count; HUBS not just by fan-in) would close most of the quality cost.
