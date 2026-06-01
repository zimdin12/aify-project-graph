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

**Problem.** `graph_packet` (and the source-bundling verbs) clamp to a fixed token budget regardless of repo size. On a small repo that wastes nothing; on a big repo a god-file gets truncated and the agent re-`Read`s it — the exact fallback we want to kill. codegraph's single largest measured win was size-aware budgets with one load-bearing invariant: **the per-item cap must never decrease as the repo grows.**

**Design.** A new shared helper:

```
// mcp/stdio/query/response-budget.js
export function responseBudget(repoNodeCount) {
  // returns { totalTokens, perItemTokens, tier }
}
```

Monotonic tiers (per-item cap never decreases):

| tier | repo size (graph nodes) | totalTokens | perItemTokens |
|---|---|---|---|
| xs | < 800 | 1500 | 500 |
| s | 800–4,000 | 2800 | 700 |
| m | 4,000–15,000 | 4500 | 1000 |
| l | 15,000–40,000 | 7000 | 1400 |
| xl | > 40,000 | 10000 | 1800 |

- `repoNodeCount` comes from the existing graph stats (`SELECT count(*) FROM nodes`), already cheap and cached per request path.
- **Override precedence:** explicit `budget` arg > `APG_PACKET_BUDGET` / `APG_EXPLORE_BUDGET` / `APG_PULL_BUDGET` env > adaptive tier. The adaptive value becomes the **default** where a static constant is today.
- Wire-in points:
  - `graph_packet`: replace the static `budget_tokens: 800` default with `responseBudget(n).totalTokens`; pass `perItemTokens` into the per-section/per-file caps so a single god-file can use up to `perItemTokens`.
  - `graph_explore`: the multi-symbol source bundler uses `totalTokens` for the bundle and `perItemTokens` as the per-symbol/per-file cap.
  - `graph_pull`: same `totalTokens` default for its rendered budget.
- The numbers are a **starting point, explicitly tunable** (constants at the top of the helper). Tuned generous because the games will get large and agent context windows are big.

**Invariant tests** (Component-1 acceptance): `perItemTokens` is non-decreasing across tiers; `totalTokens >= perItemTokens` in every tier; tier boundaries resolve to the expected tier (799→xs, 800→s, 40001→xl).

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
