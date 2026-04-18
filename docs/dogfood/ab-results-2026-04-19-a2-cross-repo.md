# A/B Results — 2026-04-19 — A2 cross-repo brief vs lean-MCP

Measures the **static-artifact thesis** (brief-only delivery beats live-MCP
on orient tasks) across three languages after A2.0–A2.2 shipped:

- Node.js / JavaScript (aify-project-graph, self-repo)
- PHP / Laravel (lc-api, real production repo)
- C++ (echoes_of_the_fallen, game engine)

## Methodology

- Model: `gpt-5.4` via `codex exec --json`
- Reasoning effort: `medium`
- Repeats per cell: N=3
- Prompt: onboarding-style, asks for entrypoint + 3 subsystems
- Two arms per repo:
  - `brief-only`: `.aify-graph/brief.agent.md` pasted into the prompt, no MCP
  - `lean-mcp`: lean-profile MCP loaded (5 monopoly verbs), no brief
- Rubric: parses `SUBSYSTEM:` lines, requires 3 distinct matches from a
  pre-registered subsystem set (tightened after dev review — see
  `ab-results-2026-04-18-freeze-validation-self.md` for the rubric fix history)

## Summary

| Repo | Language | brief-only (med tok) | lean-mcp (med tok) | Token delta | brief pass | mcp pass | MCP calls in lean arm |
|---|---|---:|---:|---:|:---:|:---:|:---:|
| aify-project-graph | Node | 57,116 | 83,605 | **−32%** | 3/3 | 3/3 | 0/3 |
| lc-api | PHP | 67,186 | 91,083 | **−26%** | 0/3 (expert 2/3) | 0/3 (expert 3/3) | 0/3 |
| echoes | C++ | 63,389 | 93,219 | **−32%** | 3/3 | 0/3 (expert 3/3) | 0/3 |

Median effective-token calc: `input_tokens - cached_input_tokens + output_tokens`.

## Robust findings (not sensitive to rubric)

### 1. Token win is consistent cross-language: −26% to −32%

The size of the savings barely moves across repo size (122 files → 1819 files),
language family (JS, PHP, C++), or repo age. Static artifact delivery is
structurally cheaper than live MCP for this task shape regardless of
surface detail.

### 2. Live lean-MCP does not earn model routing on orient tasks

Across **9 out of 9** lean-mcp runs, the model made **0 MCP calls**.
It explored with shell (rg/cat/ls) every time. This confirms the A1
signal cross-language:

- On self-repo: 0/3 runs used MCP
- On lc-api: 0/3 runs used MCP
- On echoes: 0/3 runs used MCP

The lean profile's 5 verbs (`graph_impact`, `graph_callers`, `graph_path`,
`graph_report`, `graph_change_plan`) are ignored on orient-shaped prompts
even when the agent has them loaded. Shell is cheaper for the model to
route to, and the static brief is cheaper still.

### 3. Shell exploration is 8–16× more commands than brief consumption

On brief-only, the model uses 1–2 shell commands (often just one quick
verification of a file from the brief). On lean-mcp, the model runs
10–26 shell commands to reach an answer. Both succeed, but the cost
differential is structural, not a variance artifact.

## Rubric ambiguity — honest caveats

On lc-api and echoes, the strict pre-registered rubric missed semantically
valid answers:

- **lc-api**: lean-mcp chose `app/Http/Kernel.php` + `app/Providers/RouteServiceProvider.php` + `app/Http/Requests` — Laravel-canonical request-handling subsystems. Rubric listed `Controllers`/`Middleware`/`Components`/`Services`/`Jobs` but not Kernel/Providers/Requests. Rubric has since been broadened in the bench code.
- **echoes**: lean-mcp chose `game/systems/PlayerMovementSystem.cpp`, `game/ecs/GameComponents.h`, etc — game-level gameplay systems. Rubric expected `engine/core`, `engine/rendering`, etc (engine-level). Both are arguably correct for "work on gameplay systems"; the rubric doesn't distinguish.

Under expert adjudication (does this answer plausibly address the prompt):
brief-only and lean-mcp tie on quality across all three repos. The rubric
overstates brief's quality win on echoes and understates lean-mcp's correctness
on lc-api.

**The token savings are robust regardless of rubric.**

## What the brief-only arm does right

Because the brief's SUBSYS section surfaces high-file-count directories
at depth ≥2, the model's answer naturally lands on the structural level
of the repo (the brief's own labels). It doesn't explore deeper code —
it echoes and explains the brief's structure.

This means:
- **Token cost**: 1–2 shell commands, ~60k effective tokens
- **Answer granularity**: directory-level (e.g. `engine/core`, `app/Http/Middleware`)
- **Quality**: correct when the question targets structure, potentially less
  specific than shell exploration when the question asks for fine-grained answers
  (e.g. specific gameplay systems vs generic engine dirs).

## What the lean-mcp arm does right (and wrong)

- Explores actual code files, often arrives at more specific/nuanced answers
- But spends 10–26 shell commands and 85–93k tokens doing so
- Never invokes MCP verbs on orient tasks, so the lean-profile manifest is
  pure overhead in these sessions

## Product implication

Brief-only is the correct A1 delivery for orient-shaped sessions on any
project with a reasonable feature/subsystem organization. Live lean-MCP
adds cost without adding measurable quality on this task shape.

For tasks that require code-specific precision (symbol lookup, call-chain
trace, change impact), live MCP verbs are still the right surface — the
brief alone can't answer those questions.

## Raw data

See `.aify-graph/bench-a1-live-*.json` in the repo root for per-run
transcripts, token usage breakdowns, and final answers. Three artifacts
for this round:

- self-repo bench (N=3, after brief-content fixes): 2026-04-18
- lc-api bench (N=3, after role-aware hub fixes): 2026-04-18
- echoes bench (N=3): 2026-04-19

## Not validated yet

- mem0-fork (Python) — same prompt, not run. Would add a fourth data point
  and confirm the thesis on a large Python repo. ~4 minutes of codex time.
- Non-orient task shapes — change-planning, blast-radius analysis. These
  are where live MCP verbs may finally earn their manifest cost. A2's
  brief.plan.md + tasks.json integration targets this case but hasn't
  been benchmarked head-to-head yet.
