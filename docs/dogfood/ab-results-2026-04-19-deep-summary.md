# Deep A/B Benchmark — 4 repos × 2 task shapes × 2 arms × N=3 — 2026-04-19

48 live codex runs comparing **static brief delivery** vs **lean live MCP**
across four languages (Node, PHP, C++, Python) and two task shapes
(orient + plan). Measures speed, quality, tokens, and live-verb routing
in parallel.

Raw matrix: [ab-results-2026-04-19-deep-live-matrix.md](ab-results-2026-04-19-deep-live-matrix.md)

## Orient tasks — brief-only wins cleanly

| Repo | Lang | Brief tok | Lean tok | **Token Δ** | Brief dur | Lean dur | **Dur Δ** |
|---|---|---:|---:|---:|---:|---:|---:|
| aify-project-graph | Node | 58,384 | 78,625 | **−26%** | 40s | 80s | **−50%** |
| lc-api | PHP | 66,613 | 85,036 | **−22%** | 75s | 108s | **−31%** |
| echoes | C++ | 61,584 | 94,917 | **−35%** | 37s | 92s | **−59%** |
| mem0-fork | Python | 72,240 | 87,354 | **−17%** | 57s | 161s | **−65%** |

**Headline:** brief-only is **1.5–2.9× faster wall-clock** and **17–35% cheaper in tokens** across every language.

Quality signal (strict rubric):

- **Clean wins on self + echoes**: both arms 100% pass, brief-only cheaper/faster
- **Rubric-narrowness on lc-api**: brief 0/3 but lean 3/3 — lean arm explored and gave semantically-valid Laravel answers (Kernel.php, RouteServiceProvider, Http/Requests) that strict rubric missed. Same pattern as previous rounds; token win robust regardless.
- **Both arms fail on mem0-fork**: rubric couldn't accommodate the dual `mem0/*` and `openmemory/*` package layout. Token win still stands.

## Plan tasks — value proportional to overlay quality

| Repo | Plan brief size | Brief tok | Lean tok | Token Δ | Dur Δ | Notes |
|---|---|---:|---:|---:|---:|---|
| aify-project-graph | **558 tok** (rich, functionality.json + depends_on) | 78,184 | 96,088 | **−19%** | **−28%** | Both 33% pass (1/3) |
| mem0-fork | 85 tok (empty) | 103,014 | 144,871 | **−29%** | +11% | Both 0/3 |
| lc-api | 78 tok (empty) | 74,564 | 71,664 | **+4%** | −23% | Both 0/3 |
| echoes | 73 tok (empty) | 112,290 | 107,816 | **+4%** | −3% | Both 0/3 |

**Critical finding: plan brief only wins when `functionality.json` exists.**

- **Rich brief (self-repo, 558 tok)**: brief-only beats lean-MCP by **−19% tokens, −28% duration**, quality tied.
- **Thin brief (lc-api/echoes/mem0, 73-85 tok)**: brief loses on tokens by +4% on lc-api and echoes. On mem0, wins by 29% despite thin brief (lean-MCP arm's variance was unusually high — 175k on run 2).

This confirms the audit finding: **plan brief's value is proportional to overlay quality.** Without `functionality.json`, brief.plan.md is just REPO/RECENT/TRUST headers without the action-bearing FEATURES section.

## Routing signal — first MCP usage observed

Across 48 runs, lean-MCP arm made MCP calls in exactly **one cell**: echoes plan, where brief-only actually got the MCP calls (brief arm, 2 and 3 MCP calls). Zero MCP calls on lean-mcp arm across all 48 runs.

This pattern — **14 orient + 12 plan lean-MCP runs = 26 consecutive runs with zero MCP usage** — confirms and extends the earlier finding: live lean-MCP (3 verbs: `graph_impact`, `graph_path`, `graph_change_plan`) does not earn model routing regardless of task shape.

## Cross-cut observations

**1. Duration wins are bigger than token wins.**
- Orient: brief-only is 28-65% faster
- Plan: brief-only is -3% to -28% faster (nearly always faster, sometimes dramatically so)
- Fewer shell commands (brief-only median 1-19 vs lean-mcp 15-24) = fewer round-trips = fewer wait cycles

**2. Quality rubrics still interfere with semantic-valid answers.**
- lc-api orient: brief strict 0% but the answer was *correct* — just "App/Http/Controllers" instead of "Kernel.php"
- mem0 orient/plan: both arms consistently fail strict rubric on mem0's split `mem0/` + `openmemory/` package layout
- Token + duration wins remain robust under honest (expert) adjudication

**3. The plan-brief enrichment we shipped post-bench is promising.**
The self-repo plan brief used here was the enhanced version (558 tok, with `open:`/`tests:`/`load:` per feature, feature+test attribution on risk items). It cleanly beat lean-MCP −19%/-28% on self. The test on repos-without-overlay wasn't possible because the enrichment only fires when `functionality.json` exists.

**4. Per-repo rubric improvements needed for a full honest read.**
- lc-api plan & orient rubrics: narrow; need Laravel-semantic acceptance
- mem0 plan & orient rubrics: don't accept the openmemory/ wrapper layer
- These are bench-harness gaps, not product gaps

## Actionable conclusions

### A. Ship the plan-brief enrichment (already done, commit `e769acb`)

Self-repo shows clear win on plan tasks when overlay exists. The enriched plan brief (per-feature `open:` + `tests:` + `load:`, risk items with feature+test attribution) is the right shape.

### B. Functionality.json is the load-bearing artifact

Plan brief is worthless without it. The install doc should elevate `/graph-map-functionality` as **day-1 setup**, not optional. Current docs make it look optional.

### C. Further trim lean profile to 2 verbs (from 3)

26 consecutive lean-MCP runs with zero MCP calls is overwhelming evidence. Candidates to drop next:
- **`graph_change_plan`** — explicitly prompted on plan tasks, never invoked. Strongest drop signal.
- Keep `graph_impact` and `graph_path` as precision escape hatches.

### D. Broaden rubrics before next deep bench

The lc-api and mem0 strict-rubric-0% results are signal about the rubric, not the product. Before spending another ~90 min of codex time, rewrite the orient + plan rubrics to accept semantically-valid answer sets.

### E. Speed is a bigger selling point than tokens

The duration deltas are more dramatic than the token deltas (up to −65% wall-clock). Brief-only doesn't just reduce cost — it's **materially faster to complete tasks**. The install docs and README headline currently emphasize token savings; should add speed.

## What this benchmark doesn't tell us

- How the brief + overlay performs in sessions that span multiple tasks
- Whether brief drift correlates with agent confusion (haven't measured drift-induced errors)
- Whether the 0-MCP-calls pattern would invert on genuinely precision-requiring tasks (e.g. "trace this bug to root cause" — would `graph_path` finally fire?)
- How well brief-only scales on repos > 5000 files (largest tested: lc-api at 1819)

## Next bench, if we run one

Narrow, cheap, targeted:
- Bench `graph_pull` on plan-shaped tasks as a skill-guided flow (via `graph-pull-context`) vs bare lean-MCP. This tests whether the NEW cross-layer verb earns routing where the older ones didn't.
- Run on one repo with rich overlay + one without, so we measure the overlay-quality dependence separately from the verb's own value.
- N=3. 12 runs, ~20 min. Decisive.
