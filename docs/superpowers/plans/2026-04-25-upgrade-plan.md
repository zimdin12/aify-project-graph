# aify-project-graph upgrade plan (post-2026-04-25 session)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan milestone-by-milestone. This is a co-designed plan between graph-tech-lead (Claude Code) and graph-senior-dev (Codex), locked at v2 on 2026-04-25.

## Goal

Flip Codex effective-tokens on the Echoes 3-task fixture from **+10.1%** to **clearly negative** while preserving the apg-only **−17.3%** Claude Code result from postfix4. Driving theory (echoes tester's eval): the regression is a steady token tax — full SKILL.md + verbose live-verb output + repeated overlay scans — that prompt-cache flattens on Codex but not on Claude. Cut the tax, cache stays warm, agent reads source faster.

## Non-goals

- Not redesigning the verb surface (lean-3 stays as the steady state; lean grows to 4 only for one measurement round)
- Not changing community detection / extraction / freshness model
- Not solving cross-runtime parity universally — Codex parity is the target, not always-wins
- **Not adding packet caching to disk** in this round (freshness/invalidation deferred — `.aify-graph/tasks/<id>.md` is backlog)

## Hard architectural rule

**`graph_packet` is a presentation/orchestration primitive, NOT a new graph engine.**

Composes existing trusted sources in priority order:

1. task / feature overlay (static JSON, fast)
2. brief / health / trust state (static JSON, fast)
3. optional narrow live enrichment (only if cheap, budgeted, explicit-skip-on-timeout)
4. fixed-schema markdown output

If `graph_packet` ever needs new SQL semantics, that's a signal to stop and rethink. We do not create a second truth surface that drifts from `graph_pull` / `graph_consequences` / brief logic.

## Hypothesis under test

**packet + compact Codex skill reduces startup context tax materially vs current Codex path.** Validation: re-bench Codex effective tokens on the same Echoes 3-task fixture (echoes tester's lane, when cycles allow) OR on apg with a Codex-shape simulation.

---

## M0.5 — latency reconnaissance

Small profile pass before M1. Design input only, no fixes yet.

- [ ] Add `scripts/verb-latency-profile.mjs` that times each lean verb 3× on apg (~2k nodes) and (if available) on a synthetic medium-scale fixture
- [ ] Identify dominant cost centers in `graph_pull` and `graph_consequences` (suspects: mention-detection per call, activity-layer git log, recursive transitive queries, repeated DB opens)
- [ ] Document findings in `docs/dogfood/latency-profile-2026-04-25.json`
- [ ] No broad fixes yet unless there's an obvious 1-line win

**Acceptance:** profile artifact exists, dominant cost center identified per verb, design input ready for M1.

**Estimated:** 60-90 min.

---

## M1 — `graph_packet` v1

The new presentation primitive.

### Surface

- New file `mcp/stdio/query/verbs/packet.js`
- Verb signature: `graph_packet(target, budget=800)`
- Input target: `task:<id>` OR `feature:<id>` only (resist scope creep — no symbol/file in v1)
- Output: stable compact markdown packet with fixed schema

### Implementation rule

Read overlay JSON + brief JSON directly. Do NOT call `graph_pull` / `graph_consequences` as primary mechanism. Optional narrow live enrichment third in priority, budgeted with explicit-skip-on-timeout.

### Output schema

```
TASK: <title>
STATUS: <status> (<link strength>)
FEATURES: <id>, <id>
SNAPSHOT: indexed=<sha> head=<sha> dirty=<n> trust=<ok|weak|missing>
READ FIRST:
- <file>:<line> — <why>
- <file>:<line> — <why>
CONTRACTS:
- <doc>
TESTS:
- <test path>
RISKS:
- <risk flag>
LIVE: enriched | skipped_under_budget | timeout | unavailable
```

`SNAPSHOT:` line is first-class (not buried in TRUST). `LIVE:` line makes partial packets explicit and honest.

### Budget semantics

`budget` = section-cap + token-estimate hybrid:

- fixed max items per section (predictable shape, prompt-cache-friendly)
- final token estimate trim if total exceeds budget (safety rail)
- NOT char count (unstable across file paths and docs)

### Lean-profile placement

For one measurement round, lean grows from 3 → 4 visible verbs:

- `graph_packet` (new)
- `graph_pull`
- `graph_consequences`
- `graph_change_plan`

`graph_change_plan` stays visible because it's a proven safety surface post-fix. After packet measurement we decide whether to demote one of the existing three.

### Acceptance

- [ ] Output reliably 500-900 tokens regardless of target shape
- [ ] **Packet must still be useful when `LIVE` is skipped or times out** — overlay-first value is the milestone, not live-enrichment polish
- [ ] Static-only path: < 2s on apg
- [ ] Static + live enrichment: < 5s on medium-scale graph (~7k nodes)
- [ ] Schema invariant test in `tests/unit/query/packet-schema.test.js`
- [ ] Round-trip test: packet result + source reads ≥ same actionable answer as full `graph_pull` + `consequences` chain
- [ ] Listed in lean profile (lean now 4 visible)
- [ ] Falls back to feature.tests[] when adjacent-tests empty (closes a M4a item by construction)
- [ ] Includes stale-warning at SNAPSHOT line if `indexed_commit != HEAD` (closes a M4a item by construction)

**Estimated:** 250-400 LOC + tests. 1 focused work session.

**Ships in same commit as M2.**

---

## M2 — compact Codex SKILL.md

Trim hard. Reduce steady instruction tax on Codex.

### Deliverable

- [ ] `integrations/codex/skill/SKILL.md` reduced from current ~6kb to ≤ 250 tokens
- [ ] Move long-form material to `integrations/codex/skill/references/SKILL-full.md` (reference, not auto-loaded)
- [ ] Operational only:
  - "use `graph_packet(target)` first"
  - "then `graph_pull` if precision needed"
  - "then read source"
  - "brief at `.aify-graph/brief.agent.md`"
  - "trust verdict gates verb worth"
- [ ] Skill+brief read at session start ≤ 1500 tokens (was ~7000)

### Conditional: brief.codex.md

Only add a separate `brief.codex.md` compact card if the SKILL trim alone leaves too much session-start tax. Measure first, then decide. Default = SKILL trim only.

**Estimated:** 1-2 hours, no code, doc surgery only.

**Ships same commit as M1** — packet + compact skill attack the same problem from two ends; bench attribution stays clean.

---

## M3 — latency surgery

After M1+M2 measured. Optimize the operations packet/lean flow depend on, informed by M0.5 profile.

### Deliverable

- [ ] Targeted fixes on M0.5-identified cost centers
- [ ] Lean visible verbs used in Codex workflow do not exceed 5s on the validation target under normal warm-cache conditions
- [ ] Codex `exec` no longer cancels live MCP calls in normal use
- [ ] Regression test that fails if any lean-visible verb exceeds 5s on apg

### Approach

Profile-driven. Likely targets (subject to M0.5 confirmation):

- Mention-detection per consequences call (cache per-commit?)
- Activity-layer git log subprocess (batch?)
- Recursive transitive queries (limit default depth?)
- Repeated `openExistingDb` opens within a single verb call

**Acceptance:** packet contract stays stable while optimizing beneath it. Packet's optional `LIVE:` enrichment can graduate from "sometimes skipped" to "usually enriched" without changing packet's external schema.

**Estimated:** 2-4 hours profiling + 1-2 sessions of targeted fixes.

---

## M4a — honesty / clarity bundle

Small, obvious wins. Directly support packet/brief trust.

- [ ] Brief `SNAPSHOT:` line in `brief.agent.md` (already in packet via SNAPSHOT field; this duplicates for brief-only fallback path)
- [ ] Dirty-files warning groups source/docs vs scratch/build counts
- [ ] `brief.agent.md` shows "showing N/M features" indicator when truncated
- [ ] `graph_consequences` falls back to feature.tests[] when adjacent-tests empty (already in packet via M1; this brings parity to consequences verb)
- [ ] `brief.plan.md` task lists default to open/in-progress with completed-count summary
- [ ] Skill ↔ lean-surface alignment on `graph_health`: either expose graph_health in lean profile OR change Codex skill text to recommend graph_status with the right shape

**Estimated:** 4-6 hours. Pipelined alongside M3 since most touch brief generator, not verb code.

---

## M4b — C++ brief quality debt (later, opportunistic)

Real but heavier than M4a. Only if time remains in the round.

- [ ] `brief.agent.md` PATHS pollution on C++/GLSL: filter out vendor includes (`vk_mem_alloc`) and type-name "calls" (`vec4 :0`)
- [ ] `brief.plan.md` feature `load:` metric reuses `graph_change_plan`'s caller-resolution path (currently undercount on C++ class anchors)

**Acceptance:** snapshot test against echoes brief output (when echoes tester re-runs) shows PATHS section free of vendor/type noise; feature load counts non-zero on features with known callers.

**Estimated:** 4-8 hours. Defer if M1-M4a + M3 already filled the round.

---

## Backlog (explicitly out of scope for this round)

- `graph_overlay_gaps()` / `graph_task_gaps()` helper verb — useful workflow primitive but doesn't help Codex token-tax goal directly; introduces new surface area + maintenance
- Packet caching to `.aify-graph/tasks/<id>.md` — interesting but introduces freshness/invalidation complexity right when we're trying to simplify
- Phased / streaming output for live verbs — re-evaluate after M3 if packet v1 still needs it
- `token_budget` parameter on `graph_pull` — narrower than packet's budget, may be redundant once packet is the primary path
- Confidence labels per output section (declared / task-linked / inferred / stale / dirty)

---

## Sequencing

```
M0.5 (profile) ──► M1 (packet) + M2 (codex card) [same commit] ──► measure Codex effective tokens
                                                              │
                                                              └──► M3 (latency, informed by M0.5 + M1 needs)
                                                                                │
                                                                                └──► measure again
                                                              │
M4a (honesty) ──► slots in alongside M3 (independent work)

M4b (C++ debt) ──► after M4a if time remains
```

## Validation gates

Same verified-fresh discipline from postfix4 (the lesson that prevented stale-snapshot benches from fooling us):

1. Force rebuild explicitly with absolute path
2. Assertion query confirms expected edges present (e.g. test-file IMPORTS count > 100)
3. THEN run bench

Re-bench fixture stays the same 8-task apg shape from `docs/dogfood/token-cost-bench-2026-04-25-postfix4.json`. Cross-runtime + scale validation deferred to a separate Codex/Echoes round when echoes tester has cycles.

## Plan-level acceptance criteria

- [ ] Codex effective tokens flips from +10.1% to ≤ 0% (parity or better) on Echoes 3-task fixture (or simulated equivalent)
- [ ] apg dogfood numbers stay at or above current postfix4 (6-2 wins, −17.3% tokens)
- [ ] Lean visible verbs used in Codex workflow do not exceed 5s on validation target under normal warm-cache conditions
- [ ] Codex `exec` no longer cancels live MCP calls in normal use
- [ ] Brief stale-warning prevents silent stale-map usage (closed by M1 packet SNAPSHOT and M4a brief SNAPSHOT)
- [ ] Compact Codex SKILL + packet measurably reduces startup context tax vs current Codex path

## Co-design log

- v0 — graph-tech-lead drafted Phase A/B/C/D bucket sketch
- v1 — graph-tech-lead drafted M1-M5 with acceptance criteria
- v2 — graph-senior-dev pushed back on:
  1. packet should not call graph_pull/consequences directly (orchestrator-only over JSON)
  2. add M0.5 latency reconnaissance before M1
  3. split M4 into honesty (M4a) vs C++ debt (M4b)
  4. cut M5 (overlay_gaps) to backlog
  5. tighten acceptance criteria (no absolute worst-case verb caps)
  6. NO packet caching this round
  7. brief.codex.md conditional on measurement
  8. lean = ADD packet (4 verbs for one round), do not replace change_plan yet
- v2 LOCKED — both agents aligned, plan committed.
