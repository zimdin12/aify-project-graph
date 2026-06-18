# Horizon A2 — plan (prep)

Working notes, pre-A1-verification. A2 is not started; these are the frozen decisions going in so we don't re-litigate after verification.

## What A2 ships (converged across audits)

1. **`functionality.yml` format freeze** (schema + loader, no mutation yet)
2. **File-backed overlay loader** — reads yaml into in-memory cache, NOT DB-backed
3. **Anchor validation** — detect broken symbol/file anchors at query time
4. **Two typed briefs**: `brief.onboard.md` + `brief.plan.md` (not 4 — dev: "start smaller")
5. **Similar-change retrieval** — one verb, uses git-log L3 data
6. **Maybe 1 precision cross-layer verb** (`graph_recent_activity`) — only if A1 bench shows live MCP earns routing on non-orient tasks

## Explicitly NOT in A2

- DB-backed overlay tables (defer until shape stabilizes)
- LLM-proposed yaml generation (Horizon B)
- ClickUp adapter (Horizon B, behind adapter protocol)
- Conversational yaml editing (Horizon A3)
- Drift detection / diff proposals (Horizon A3)
- Hot layer / ephemeral overlay (A3 or B)
- 4 typed briefs (start with 2, expand later based on usage)

## `functionality.yml` frozen schema (v0.1)

```yaml
version: 0.1
features:
  - id: auth                      # kebab-case, stable identity
    label: Authentication         # human-readable
    description: User login, session tokens, and credential validation.
    anchors:
      symbols:                    # preferred — survives file moves
        - verify_token
        - authenticate
        - User.__init__
      files:                      # path globs, fallback when symbol-anchoring weak
        - src/auth/*
        - src/users/session.py
      routes:                     # for web frameworks
        - POST /auth/login
        - GET /auth/session
      docs:                       # doc files/sections
        - docs/auth.md
    source: user                  # user | llm | clickup (Horizon B+)
    owner: null                   # optional, not required in A2
    tags: []                      # optional
```

Key decisions:
- **symbol-anchored by default** (file moves don't break), files as fallback only
- **source** field tracks provenance (gets used when conflicts arise in Horizon B)
- **no hierarchy** in v0.1 — features are flat. Nested features / feature-of-feature wait for B.
- **no weights** — every anchor is equal weight. Reranking later.

## Overlay loader module

- Location: `mcp/stdio/overlay/loader.js`
- Interface:
  - `loadFunctionality(repoRoot) → { features, diagnostics }`
  - `validateAnchors(features, db) → { valid, broken[] }`
  - `indexByFile(features) → Map<file_path, feature_id[]>` (for cross-layer joins)
- Reads `.aify-graph/functionality.yml` + `.aify-graph/functionality.yml.local` (gitignored overrides)
- Cached in-memory for the verb lifetime, invalidated on mtime change
- Zero DB writes

## Anchor validation

For each feature:
- **symbol anchors**: does `SELECT 1 FROM nodes WHERE label = ? AND type IN (func, method, class)` return >0?
- **file anchors**: does `SELECT 1 FROM nodes WHERE file_path GLOB ?` return >0?
- **route anchors**: does `SELECT 1 FROM nodes WHERE type='Route' AND label = ?` return >0?

Broken anchors surface in:
- `brief.json` → `diagnostics.broken_anchors[]`
- `brief.md` Trust section if any feature has >2 broken anchors
- A verb output header: `FEATURE auth: 2 broken anchors (missing: old_symbol, old_file.py)`

## Typed briefs (2, not 4)

- **`brief.onboard.md`** — entry points, subsystems, hubs, read-first, tests. Current brief.md base.
- **`brief.plan.md`** — features, recent activity by feature, risk areas, open PRs (from L3). Heavier on L2+L3 cross-referencing.

Rendering:
- Both emit from the same underlying data at index time
- Agent/user picks which to paste based on intent
- Cache-disciplined the same way brief.md is (content-hash-guarded writes)

## Similar-change retrieval (single verb)

- `graph_similar_changes({ symbol? | file? | feature? })` →
  - Finds past commits touching the same file/symbol (L3 git log)
  - Groups by commit, shows date/author/subject + files changed
  - Limit 5 by default
- Implementation: SQL join on overlay's file→feature map + git log walk
- No LLM, no inference — just retrieval

## Open question for post-A1-verification

**Should A2 include a precision cross-layer live verb?** Currently my bias is no — if A1 bench shows 0 MCP calls even on orient, we should NOT add MORE MCP verbs. Better bet: put cross-layer answers in `brief.plan.md` as ambient context.

Reconsider only if A1 shows meaningful MCP routing on non-orient tasks.

## Sequencing when A2 starts

1. Land `functionality.yml` schema + example at repo root (1 hr)
2. Land overlay loader + validation (half day)
3. Update brief generator to emit brief.onboard.md + brief.plan.md variants (2 hrs)
4. Ship `graph_similar_changes` verb (half day)
5. Test loop: generate yaml on self-repo, verify validation catches missing anchors, check briefs render

Estimate: 2-3 focused days if done sequentially; less with split work.

## Greenlight gate to A3

A2 ships → user tests → if:
- Users/agents actually read brief.plan.md and use similar-change verb,
- Anchor validation catches real drift in their repo,

…then A3 (conversational editing + drift proposals + anchor-suggestion-from-diff). Otherwise iterate A2 feedback first.
