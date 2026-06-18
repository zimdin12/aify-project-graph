# Horizon B Blast Radius Preview Spec

Purpose: when a user starts a task or names a risky symbol, emit pre-emptive context before coding begins. This should reduce exploratory tokens and improve planning quality by front-loading the most relevant files, risk points, and historical analogs.

## Trigger Inputs

Two supported entrypoints:

1. Task-centric
- input: task id from `tasks.json` / normalized task source
- examples: `CU-123`, `AS-456`, `GH-789`

2. Symbol-centric
- input: symbol name already present in the code graph
- examples: `ensureFresh`, `CompanyDetailsController.companyDetails`

Task-centric should be the default when a task source exists.

## Output Shape

The preview should answer four questions, in this order:

1. What files are most likely in play?
2. What symbols/features are high-risk or high-fan-in?
3. What similar prior changes exist?
4. What should the agent read first before editing?

Suggested output object:

```json
{
  "subject": {
    "type": "task",
    "id": "CU-123",
    "label": "Tighten renderer output"
  },
  "files": [
    {"path": "mcp/stdio/query/renderer.js", "why": "feature anchor + recent similar change", "score": 0.92}
  ],
  "hubs": [
    {"label": "renderCompact", "file": "mcp/stdio/query/renderer.js", "risk": "high fan-in"}
  ],
  "similar_changes": [
    {"sha": "abc1234", "subject": "tighten compact path rendering", "files": ["mcp/stdio/query/renderer.js"]}
  ],
  "risks": [
    {"kind": "fan_in", "target": "renderPath", "detail": "used by 4 query verbs"}
  ],
  "read_first": [
    "mcp/stdio/query/renderer.js",
    "tests/integration/server-toolset.test.js"
  ]
}
```

## Delivery Mechanism

Default to **static delivery first**.

Primary surface:
- `brief.plan.md` section: `BLAST RADIUS`

Why:
- consistent with A1 finding that static artifact delivery beats live MCP on orient/plan-shaped tasks
- predictable token cost
- cache-friendly if generated deterministically

Secondary surface (optional later):
- one live precision verb only if the static preview proves high value and users need ad hoc refresh/filtering
- if added later, prefer `graph_plan_context(task=...)` over a proliferation of narrow verbs

For Horizon B, I would **not** default this to a live verb.

## Data Sources

### Task-centric path
Input task id joins to:
- normalized task snapshot (`tasks.json` / adapter output)
- optional functionality overlay anchors
- git/log-derived similar changes
- code-graph hubs and impact around anchored files/symbols

Scoring priority:
1. explicit feature/task anchors
2. recent similar file touches
3. graph fan-in / fan-out risk
4. test anchors near touched code

### Symbol-centric path
Input symbol joins to:
- `graph_impact`
- callers/path/change-plan data
- optional feature overlay
- similar historical changes touching that symbol’s file neighborhood

## Section Shape In `brief.plan.md`

Suggested markdown:

```md
## BLAST RADIUS
- Files: `mcp/stdio/query/renderer.js`, `tests/integration/server-toolset.test.js`, `mcp/stdio/server.js`
- High-risk symbols: `renderCompact` (high fan-in), `renderPath` (shared path renderer)
- Similar changes: `abc1234 tighten compact path rendering`, `def5678 trim verbose edge output`
- Read first: `mcp/stdio/query/renderer.js`, `tests/integration/server-toolset.test.js`
```

Rules:
- max 4 bullets
- files first, because that is the most actionable unit for agents
- one line for similar changes, not a history dump
- deterministic ordering by score

## Similar-Change Retrieval

This is a supporting component, not the primary output.

Definition of “similar” in Horizon B:
- touched the same file(s), or
- touched files anchored to the same feature, or
- touched the same top-risk symbol neighborhood

Avoid semantic embedding in Horizon B.
Use deterministic retrieval only:
- git history
- overlay anchors
- graph-locality

## Risk Types

Initial risk types should be simple and defensible:
- `fan_in` — symbol/file used widely
- `shared_path` — central path/renderer/orchestrator file
- `test_surface` — many tests or critical integration coverage nearby
- `hot_overlap` — current diff overlaps the same area (if hot layer exists)
- `feature_boundary` — task spans multiple anchored features

Do not add speculative risk classes until there is real usage.

## Validation Plan

### Deterministic tests
- given a seeded task snapshot and functionality overlay, preview returns expected top files
- given a symbol input, preview includes the same top file/symbols as current `change_plan`/`impact` logic
- similar changes are stable under repeated generation with the same git HEAD

### Quality checks
- on self repo, preview for a known renderer/output task surfaces renderer + server test files ahead of generic hubs
- on lc-api, preview for a request-handling task surfaces route/controller/middleware anchors rather than generic entity hubs

### User-facing acceptance
- preview should reduce “first 5 minutes” exploration for a task start
- if users still run 10 `rg` commands before acting, the preview is not specific enough

## Risks / Notes

- Task-to-code linkage quality is the limiting factor. If anchors are weak, blast-radius preview becomes generic noise quickly.
- Similar-change retrieval should help planning, not dominate the preview. It is supporting context.
- If this becomes a live verb later, we must watch carefully for the same routing failure we saw on orient tasks: static context may still outperform an interactive tool for most sessions.
