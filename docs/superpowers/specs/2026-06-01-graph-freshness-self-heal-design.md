# Graph Freshness Self-Heal + Discoverability — design spec

_Date: 2026-06-01 · Branch: `plan/next-gen-code-intel-bridge` · Author: graph-tech-lead_

## Goal

Fix the #1 agent-value problem found in a real A/B field test (sc-manager, Sand Castle, 3 converging datapoints): **a stale graph is worse than no graph** for managed workers, because they get the read verbs but cannot refresh. The graph was many commits behind HEAD → false-empty results for just-landed symbols (e.g. `graph_search` for new `UnifiedFluid*` symbols → 0 hits) and drifted line numbers, turning the tool into an extra verify-against-source step instead of replacing one.

## Root cause (verified in code)

- A **central staleness gate already exists** at the MCP dispatch layer (`mcp/stdio/server.js` ~1061-1098): every verb except `graph_status`/`graph_index` already prepends a `graph stale: indexed <x>, HEAD <y>. Run graph_index() to refresh` warning. So the *signal* is there.
- The freshness *engine* (`ensureFresh` in `mcp/stdio/freshness/orchestrator.js`) is robust + incremental (detects HEAD movement via `manifest.commit !== HEAD` → diffs changed files; cosmetic/structural tiers; partial-resume). `graph_index` is a thin wrapper over it.
- **The gaps:**
  1. `graph_index` is NOT in `DEFAULT_TOOL_NAMES` — it is callable-by-name but not listed, so a managed worker reading "run graph_index" has no surfaced action.
  2. There is **no auto-heal** — the gate WARNS but never reindexes, so a worker that cannot/does not reindex keeps getting stale data.

This maps onto the field report's 3 fixes:
1. Expose `graph_index` (or auto-reindex) to managed workers → **Components A + B**.
2. Auto-reindex so it is never stale → **Components A + C**.
3. Build the feature/task overlay → **out of scope**: per-repo DATA (the team runs `/graph-build-functionality`); the tool already emits an "OVERLAY NOT BUILT" hint. Not tool code.

## Non-goals

- Per-verb freshness wiring (the central gate already covers all verbs).
- Rebuilding `ensureFresh` / the staleness detection (already correct).
- Building the sand_castle overlay (team data action).

## Components

### Component A — Opt-in auto-reindex at the central gate (`server.js`)

Today the dispatch computes staleness AFTER the handler runs (only to build the warning). Add a BEFORE-handler self-heal:

- After `repoRoot` is resolved and BEFORE `tool.handler(normalized)`, when the verb is not `graph_index`/`graph_status` AND `process.env.APG_AUTO_REINDEX` is truthy:
  - cheaply check stale: `manifest.commit && head && manifest.commit !== head` (reuse the same git+manifest reads already imported below).
  - if stale → `await ensureFresh({ repoRoot })` inside `try/catch`. On success the handler reads fresh data; on failure, swallow and fall through (the post-handler warning still fires).
- Warn-by-default behavior is UNCHANGED when `APG_AUTO_REINDEX` is unset/false.
- Truthy parsing: `1`, `true`, `yes`, `on` (case-insensitive) → on; everything else → off.
- A module-level helper keeps it testable: `export function autoReindexEnabled(env)` in a small `mcp/stdio/freshness/auto-reindex.js`.

### Component B — Discoverability + sharper warning

- **Add `graph_index` to `DEFAULT_TOOL_NAMES`** (`server.js`) so workers can act on the warning. (It stays a normal verb; this only lists it.)
- **Enrich the existing staleness warning** with the commit count and the self-heal hint. Reuse `commitsBehindHead(repoRoot, manifest.commit, head)` from `read_freshness.js`:
  `graph stale: indexed <x>, HEAD <y> (N commits behind). Run graph_index() to refresh, or set APG_AUTO_REINDEX=1 for auto-refresh — line numbers may drift.`
  (N omitted gracefully when the count can't be computed.)
- **`server-instructions.js` FRESHNESS rule** (new short block):
  `FRESHNESS: If a response says "graph stale", run graph_index first (or set APG_AUTO_REINDEX=1). A stale "not found" is NOT proof a symbol is gone — re-run after indexing.`

### Component C — Optional git post-commit hook installer

A small standalone script `scripts/install-graph-hook.mjs` that, run from a target repo, writes an executable `.git/hooks/post-commit` which fires an incremental reindex (best-effort, non-blocking: backgrounds a `node <server-or-index-entry>`-style reindex, never fails the commit). For teams that want the graph always fresh without per-read latency. Isolated + opt-in; documented in the status doc. Idempotent: detects an existing aify hook block and replaces only that block (never clobbers an unrelated post-commit hook).

## Architecture / isolation

- `auto-reindex.js`: pure `autoReindexEnabled(env)` predicate — unit-testable, no IO.
- `server.js`: ~12 lines added in the existing dispatch block (one before-handler self-heal + enriched warning). No new dispatch path.
- `scripts/install-graph-hook.mjs`: standalone, no runtime coupling to the server.
- Reuses `ensureFresh`, `commitsBehindHead`, `getHeadCommit`, `loadManifest` — no new freshness logic.

## Testing

- `autoReindexEnabled`: truthy/falsey matrix (`'1'/'true'/'on'/'yes'` → true; `undefined/'0'/'false'/''` → false).
- Central gate auto-heal (integration): a temp git repo whose graph is indexed at an older commit, then HEAD advances with a new symbol; with `APG_AUTO_REINDEX=1`, a read verb returns the new symbol (manifest advanced); with it unset, the read still warns + does not reindex.
- `graph_index` present in the default listing (extend the existing `tests/integration/server-toolset.test.js`).
- `server-instructions` contains the FRESHNESS rule (structural test).
- Hook installer: on a temp git repo, writes an executable `.git/hooks/post-commit` containing the aify block; re-running replaces (not duplicates) the block; preserves a pre-existing unrelated hook body.
- Full suite stays green (currently 1058).

## Rollout

Additive + opt-out-safe: auto-reindex is OFF by default (no behavior change unless `APG_AUTO_REINDEX` is set); listing `graph_index` only adds a tool to `tools/list`; the warning is content-only; the hook is a manual install. Land on `plan/next-gen-code-intel-bridge`; commit, do not push unless asked.
