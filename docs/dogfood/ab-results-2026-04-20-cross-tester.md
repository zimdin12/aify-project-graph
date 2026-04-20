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

## Cross-tester section (pending)

graph-senior-dev (codex on WSL, gpt-5.4) is running the same 24 cells independently. When his results JSON arrives, this section will be filled in with:
- Side-by-side per-cell token counts
- Quality agreement matrix (do both testers grade pass/partial/fail the same?)
- Where deltas are consistent across runtimes vs runtime-specific
- Final merged take

## Bottom line (this tester only — pending dev cross-check)

- Brief-only arm wins **-19% tokens, -34% duration** in aggregate vs no-graph baseline.
- Win concentrates on **orient (-34%) > search (-14%) > trace (-9%)** by shape.
- Win concentrates on **small/medium repos (-27 to -37%)** vs **large repos (-2 to -6%)**.
- Quality cost is **3/12 cells partial vs 12/12 pass baseline**, all from brief-content gaps.
- 3/12 cells got measurably slower with brief (irrelevant brief = overhead).
- Net: brief-only is a real win for orient-shaped work on indexed-comprehensively repos. It's not a universal win and shouldn't be sold as one. Brief-generator improvements (SUBSYS not just by file count; HUBS not just by fan-in) would close most of the quality cost.
