# Pre-launch improvement analysis — 2026-04-20 A/B (graph-tech-lead single-tester)

This document mines the 24-cell bench result for **shippable improvements** before launch. Where the data is strong enough on a single tester, recommendations are concrete and ready to ticket. Where it needs cross-tester confirmation (graph-senior-dev's run pending), it's marked.

## Tier 1 — pre-launch ship blockers / strong-evidence P1s

These have direct evidence in the bench. Fixing them changes the bench result, not just polish.

### 1.1 SUBSYS picker is brittle (file-count-only)

**Defect:** `mcp/stdio/brief/generator.js` ranks subsystems by file count and shows top 4. echoes_of_the_fallen has `engine/voxel` (79f), `engine/rendering` (60f), `engine/rendering/shaders` (38f), `engine/core` (33f) in SUBSYS. `engine/ecs` (smaller dir) is dropped. Result: brief-only subagent **explicitly claimed "no distinct ECS subsystem surfaced"** when ECS is real and important. Quality dropped pass→partial.

**Cells affected in my data:** echoes.orient (1/12). Direction is structural — same defect would hit any small-but-architecturally-important subsystem in a code-heavy area (e.g. an `auth/` directory in a big monorepo dwarfed by `migrations/`).

**Fix:** rank SUBSYS by composite signal:
- file count (current)
- + outgoing edge count (more imports/calls = more wired-in)
- + presence of feature anchors (functionality.json maps a feature here)
- + presence of any hub (declared in HUBS section means people care)
- Bonus: if a directory has any of the above flags but loses on file count, surface it as a "minor subsystem" line so the agent knows it exists but isn't a top-level focus

**Expected impact:** echoes.orient brief-only would gain "ECS" mention → pass instead of partial.

### 1.2 HUBS biased toward fan-in misses public API surface

**Defect:** HUBS shows top 4 by graph fan-in. apg's `graphPull` (the canonical public verb implementation) has fan<9 because it's called only from the MCP dispatch table — but it IS the public API surface that subagents need to name. Brief-only subagent waffled on the function name and said "default export commonly pull" — wrong. Quality dropped pass→partial.

**Cells affected in my data:** apg.search (1/12). Direction generalizes — every tools/list-style API or route table will have public entries with low fan-in but high "should-be-named" weight.

**Fix:** add a `PUBLIC_API` (or `ENTRYPOINTS`) section to brief, populated from:
- Functions referenced in MCP `tools/list` arrays
- Functions referenced in route definitions (Laravel routes/, Express app.get, FastAPI @app.route, etc.)
- Functions exported from index.js / public modules
- Then continue to list HUBS by fan-in as today (separate signal, separate purpose)

**Expected impact:** apg.search brief-only would name `graphPull` → pass instead of partial.

### 1.3 Brief never names the language tooling (tree-sitter)

**Defect:** brief mentions "Graph ingest [walk,digest]" feature but never names tree-sitter explicitly. Brief-only subagent said "digests source files into nodes and edges" — conceptually correct but missed the must_include keyword. Quality dropped pass→partial.

**Cells affected in my data:** apg.orient (1/12). Direction generalizes — any orient question that asks "how is X done?" needs the underlying tool/library named, not just the abstract function.

**Fix lower-effort:** brief-generator should include a `TOOLING` line listing the major libraries/runtimes inferred from package.json / requirements.txt / Cargo.toml / go.mod. For apg this would emit `TOOLING: tree-sitter, better-sqlite3, vitest`. Cheap, deterministic, big quality lift.

**Expected impact:** apg.orient brief-only would mention tree-sitter → pass instead of partial. Generalizes to every orient task.

### 1.4 Brief overhead becomes pure latency cost when task is brief-irrelevant

**Defect:** when the brief content doesn't intersect the task, subagent reads the brief, reasons about it, then ignores it — paying tokens AND time for nothing. lc.trace was **+55% slower** with brief vs baseline (76s vs 49s). lc.search +21%, mem0.search +14%.

**Cells affected in my data:** 3/12 cells got measurably slower despite token parity.

**Fix harder:** there's no clean way to auto-detect "this task is brief-irrelevant" before reading the brief. Two pragmatic mitigations:
- **A** (cheap, doc-only): document in the README that brief is strongest on orient-shape and weakens on tasks asking about specific subsystems the brief doesn't cover. Set user expectation.
- **B** (system change): publish multiple briefs per repo — `brief.agent.md` (current generic), `brief.auth.md`, `brief.routing.md`, etc. — and let the agent pick the relevant brief per task. This is the "per-subsystem brief" idea. Bigger change but addresses big-repo fall-off too (Tier 1.5).
- **C** (UX): add a one-line "BRIEF_COVERAGE" hint in the brief itself — `BRIEF_COVERAGE: graph extraction, query verbs, dashboard. Likely UNHELPFUL for: deployment, testing infrastructure.` This lets the agent decide quickly whether to discard the brief and fall back to baseline behavior.

**Expected impact:** option A has zero risk and immediate signal. Recommend for launch. Option C is a 30-line change to generator.js. Option B is a bigger architectural change for v2.

### 1.5 Repo-size scaling — large repos get near-zero savings

**Defect:** brief value drops sharply with repo size. apg/echoes (small/medium) get -27 to -37%, lc/mem0 (large) get -2.5 to -6%. The brief is bounded at ~250-400 tokens regardless of repo size, so its information density per byte of source code falls off.

**Cells affected in my data:** lc (3/3) and mem0 (3/3) — 6/12 cells essentially.

**Fix:** see 1.4 option B (per-subsystem briefs). Until that ships, this is honest: brief is a 5x win on small repos and a parity-or-small-win on large repos. The README's "1.5-2.9× faster, 17-35% cheaper" claim is true *on the right repos and the right shape*. Suggest README clarification:

> Brief delivers 1.5-2.9× faster and 17-35% cheaper on **orient-shape tasks in repos under ~500 files**. Larger monorepos or shape-mismatched tasks see smaller wins (often parity).

## Tier 2 — Quality-of-life polish (lower priority)

These are real but smaller. Don't block launch.

### 2.1 RECENT line repeats commits that are repo-meta vs feature

apg's RECENT is dominated by docs/install commits because those are recent. Subagent doesn't get useful "what's actively being developed" signal. **Fix:** filter RECENT to commits that touched non-doc directories, or split into FEATURE-RECENT vs META-RECENT.

### 2.2 TRUST line is inscrutable to first-time readers

`TRUST weak: 17290 unresolved edges → prefer direct file reads for cross-file impact questions` — the agent reads this but doesn't know whether 17290 is "kinda bad" or "catastrophic." **Fix:** percentage-relative: `TRUST weak: 17290 unresolved (84% of edges) — many cross-module references not modeled. Direct file reads recommended for trace tasks.`

### 2.3 Brief artifacts have inconsistent line widths

Some lines wrap because of long file paths. Cosmetic. Could compact further with relative paths once repo root is known.

## Tier 3 — Bench-methodology improvements

Not product fixes. But if we're going to keep benching, these matter.

### 3.1 Validate prompt symbols/paths against repo state before running

3 of my 12 task prompts had factual errors that subagents caught mid-bench (graph_status doesn't hit SQLite, no /api/v2/end-user URL, Engine.h is in engine/ not game/). The bench survived because subagents were honest. But this should fail cleanly: pre-bench, validate each `must_include` symbol/path exists in the target repo via grep. If not, abort.

**Suggested addition to ab-runner.mjs:** a `--validate-prompts` flag that greps each task's `rubric.must_include` against the target repo and exits non-zero on first miss.

### 3.2 Multi-run variance per cell

Single run per cell. ±10-15% per-cell variance is plausible. For shipped claims we'd want 3-5 runs per cell with median + spread. dev's bench harness (ab-runner) already has `--repeats N` — for the next bench (post-launch claims), use it.

### 3.3 Capture per-cell tool-call breakdown

Right now I have `total_tokens` and `duration_ms` from the harness. The Agent tool also reports `tool_uses` count — I have it but didn't track it in the JSON. Add `tool_calls_count` to results schema next time so we can correlate token spend with tool-use breakdown.

## Concrete launch-blocker proposals

If shipping today on this evidence:

**Must:**
- Update README's headline numbers to scope them honestly (Tier 1.5 doc fix, 5 minutes)

**Should:**
- Implement Tier 1.3 (TOOLING line in brief, cheap, big lift) — single ~30-line change to `mcp/stdio/brief/generator.js`
- Implement Tier 1.4 option C (BRIEF_COVERAGE hint, ~30 lines)

**Nice:**
- Implement Tier 1.1 (composite SUBSYS rank) and Tier 1.2 (PUBLIC_API section) — bigger but high signal-to-effort

**Defer:**
- Tier 1.4 option B (per-subsystem briefs) — design work, post-launch v2

## Cross-tester confirmation status

graph-senior-dev's independent run is starting now (per his most recent message). All Tier 1 findings above are based on a single tester. They will become **stronger P1s** if dev's data shows the same pattern, and **scope-reduced or rephrased** if his diverges. Decision per dev: hold backlog ticket creation until merge.

If you want any of the proposed fixes implemented now (before dev's data lands and before launch), say which and I'll start.
