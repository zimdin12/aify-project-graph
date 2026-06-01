# Agent Front Door + Adaptive Sizing — design spec

_Date: 2026-06-01 · Branch: `plan/next-gen-code-intel-bridge` · Author: graph-tech-lead_

## Goal

Make `aify-project-graph` **more useful and easier for AI coding agents** (Claude Code, Hermes) working on large C++ game projects (sand_castle, echoes, and future big projects). The bet is the **future-proof** one: as agents get more capable, the bottleneck is not bespoke features — it is whether an agent (a) reaches for the tool and routes to the right verb, (b) trusts/acts on the result without re-verifying, and (c) gets a response sized so it does not fall back to `Read`/`grep`.

This is a **sharpening pass over existing machinery** plus the one genuine gap: response budgets that do not scale with repo size.

## Non-goals (deferred, noted for the future)

- A/B eval harness (codegraph's `agent-eval`) — would *measure* the gains; valuable but deliberately deferred. We tune by judgment now.
- Embeddings / semantic vector search; persona-adapted tours; archetype auto-naming; knowledge-graph cross-linking.
- "Dashboard for agents" (agent-consumable view export).
- Any change to the graph extraction / trust model itself.

## Context: what already exists (do NOT rebuild)

- `mcp/stdio/server-instructions.js` — the MCP `initialize` playbook injected into the host system prompt once/session. Already has ORIENT FIRST, TOOL SELECTION BY INTENT, TRUST RULES, ANTI-PATTERNS, OUTPUT CONTRACTS.
- `graph_packet` (`mcp/stdio/query/verbs/packet.js`) — already the flagship one-shot "everything about X" verb, in `DEFAULT_TOOL_NAMES`, with `mode` (orient/plan/debug/review/audit/verify). **Budget is a STATIC `budget_tokens: 800`** clamped by `clampToBudget(text, budgetTokens, targetSection)` — this is the gap.
- Trust spine: `mcp/stdio/query/lsp-evidence.js` (`buildTrustLine`, `buildAbsenceTrustLine`) + the evidence/exhaustiveness contract already on `code_intel_references` / `code_intel_hierarchy` / `graph_callers`.
- Freshness: `mcp/stdio/query/verbs/read_freshness.js` (`inspectReadFreshness`) — staleness gating already exists.

## Components

### Component 1 — Adaptive response sizing (the net-new win)

**Problem.** A fixed budget regardless of repo size starves big repos: a god-file gets truncated and the agent re-`Read`s it — the exact fallback we want to kill. codegraph's single largest measured win was size-aware budgets with one load-bearing invariant: **the per-item cap must never decrease as the repo grows.**

**What already exists (discovered during planning).** `mcp/stdio/query/source-bundle.js` ALREADY implements adaptive, monotonic, repo-size tiers (`getSourceBundleBudget(nodeCount)` → `{perBlockLines, totalLines, maxBlocks}`, `assertMonotonicTiers()`), and `graph_explore` + `graph_trace` already use it. **So those verbs are done.** The isolated gap is **`graph_packet`**, which clamps to a STATIC `budget_tokens: 800` (in `graphPacket(...)` default + `clampToBudget`) and uses STATIC list caps (`packet-budget.js` `DEFAULT_CAPS`) regardless of repo size.

**Design.** A new sibling helper for TOKEN budgets (the source-bundle tiers are LINE budgets — different unit, different verb):

```
// mcp/stdio/query/response-budget.js
export function getPacketTokenBudget(nodeCount) {
  // returns { name, budgetTokens, caps: { evidence_records, affected_files, read_first, diagnostics, refs_per_symbol } }
}
export function assertMonotonicPacketTiers(tiers?) // throws on regression; called at load
```

Monotonic token tiers + scaled list caps (every axis non-decreasing as repos grow):

| tier | repo size (graph nodes) | budgetTokens | evidence_records | affected_files | read_first | diagnostics | refs_per_symbol |
|---|---|---|---|---|---|---|---|
| tiny | < 800 | 1500 | 12 | 12 | 10 | 10 | 8 |
| small | 800–4,000 | 2800 | 16 | 16 | 12 | 12 | 8 |
| medium | 4,000–15,000 | 4500 | 20 | 20 | 14 | 14 | 10 |
| large | 15,000–40,000 | 7000 | 26 | 26 | 18 | 16 | 12 |
| huge | > 40,000 | 10000 | 32 | 32 | 22 | 18 | 14 |

- `nodeCount` comes from `manifest.json` `nodes` (already read by `packet.js` as `manifest` — **zero extra cost, no db open**).
- **Override precedence:** explicit `budget` arg > `APG_PACKET_BUDGET` env > adaptive tier. The adaptive value becomes the **default** where the static `800` is today (change the param default from `800` to `null` so an explicit value is distinguishable).
- Wire-in: `graph_packet` only. The scaled `caps` replace `DEFAULT_CAPS` usage where packet ranks/caps its lists; `budgetTokens` feeds `clampToBudget`.
- The numbers are a **starting point, explicitly tunable** (constants atop the helper). Tuned generous for large games + large agent context windows.

**Already-adaptive (no work):** `graph_explore`, `graph_trace` (source-bundle tiers). **Deferred:** `graph_pull` controls token cost via layer selection + per-layer caps rather than one token clamp; adapting it is lower-value and out of scope for this pass.

**Invariant tests** (Component-1 acceptance): every cap axis (incl. `budgetTokens`) is non-decreasing across tiers; tier boundaries resolve to the expected tier (799→tiny, 800→small, 40001→huge); `assertMonotonicPacketTiers()` throws on a deliberately-regressed tier table.

### Component 2 — Front-door tightening (`server-instructions.js`)

Targeted edits only (it is already good; keep ≤ ~65 lines):

1. **`graph_packet` as the explicit first move.** Add to ORIENT FIRST / TOOL SELECTION: "Most 'understand X / how does Y work' questions resolve in ONE `graph_packet {target, mode}` call — prefer it over chaining `graph_search` + a node verb."
2. **KNOWN LIMITS block (honest).** A short section so agents do not burn calls on dead ends:
   - C++-first; JS/TS resolution is best-effort.
   - Dynamic dispatch the static graph does NOT synthesize: function-pointer / `std::function` / script (Lua) callbacks, DI/registry indirection — verify these by reading.
   - Cross-language beyond the C++↔GLSL shader bridge (`graph_shader`) is not resolved.
   - Absence claims are only trustworthy when the evidence banner says exhaustive (reinforces existing TRUST RULES).
3. Keep all existing TRUST RULES / ANTI-PATTERNS / OUTPUT CONTRACTS.

### Component 3 — Uniform trust + staleness envelope

Mostly verification + gap-fill, not new subsystems.

1. **Evidence envelope audit.** Confirm each absence-capable verb (`graph_callers`, `code_intel_references`, `code_intel_hierarchy`, `graph_impact`, `graph_consequences`) surfaces a consistent evidence shape — at minimum the existing `buildTrustLine` / `buildAbsenceTrustLine` line, and where the verb returns JSON, an `evidence { exhaustive, degraded, cause, readiness }` object. Fill any verb missing it.
2. **Staleness banner.** Where a response includes files that `inspectReadFreshness` reports as pending re-index / stale, prepend a single consistent line: `⚠ stale: <files> — Read these directly; the rest is fresh.` Reuse the existing freshness machinery; standardize the wording/placement so agents learn one pattern.

## Architecture / isolation

- New `response-budget.js` is a pure function module (no DB/IO) — trivially unit-testable in isolation; consumers import it.
- `server-instructions.js` stays a single exported string (no behavior change, content only).
- Component 3 reuses `lsp-evidence.js` + `read_freshness.js` — no new modules; small edits at verb boundaries.

## Testing

- `response-budget.js`: monotonicity + boundary unit tests (Component-1 acceptance above).
- `graph_packet` / `graph_explore` / `graph_pull`: a small repo and a synthetic large-node-count stub resolve to different budgets; explicit `budget` arg and env override still win.
- `server-instructions`: structural test asserts it names `graph_packet` as first move and contains a KNOWN LIMITS section.
- Absence-envelope: presence test per absence-capable verb.
- Full suite stays green (currently 1043 pass).

## Rollout

Additive and opt-out-safe: adaptive budgets only *raise* defaults (overridable); instructions are content-only; envelope changes are additive. No migration. Land on `plan/next-gen-code-intel-bridge`; commit, do not push unless asked.
