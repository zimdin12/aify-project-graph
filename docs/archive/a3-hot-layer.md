# A3 Hot Layer Spec

Purpose: represent the working set that is "hot right now" from the current branch and uncommitted diff, without polluting the committed project map. This is a transient overlay that helps planning and review sessions answer "what is actively changing?".

## Goals

- Surface uncommitted and branch-local work in a way agents can consume cheaply.
- Keep the committed map trustworthy by separating transient state from stable state.
- Default to static delivery first: the hot layer should mainly feed `brief.plan.md`, not expand the live MCP surface.
- Make expiry obvious and automatic so stale hot state does not silently persist.

## Inputs

The hot layer is sourced from Git, in this order:

1. `git diff --name-status --find-renames HEAD`
2. `git diff --unified=0 HEAD`
3. `git diff --cached --name-status --find-renames HEAD`
4. `git rev-parse --abbrev-ref HEAD`
5. Optional branch-local commit window:
   - `git log --oneline --decorate --no-merges <merge-base>..HEAD`

Interpretation:
- unstaged + staged file changes define the active file set
- hunk ranges from `git diff --unified=0` define changed line windows
- current branch name is part of the overlay identity
- optional branch-local commits provide short-term history distinct from uncommitted changes

## Data Model

Do **not** store hot state in the main code-graph tables.

Use a separate transient artifact plus in-memory overlay cache:
- `.aify-graph/hot-layer.json`
- regenerated on demand or when the git working tree hash changes
- not committed

Suggested JSON shape:

```json
{
  "version": 1,
  "branch": "feature/my-change",
  "head": "abc1234",
  "generated_at": "2026-04-19T10:00:00Z",
  "worktree_dirty": true,
  "files": [
    {
      "path": "mcp/stdio/query/renderer.js",
      "status": "M",
      "staged": true,
      "line_ranges": [[12, 48], [88, 101]],
      "anchors": {
        "symbols": ["renderCompact", "renderPath"],
        "features": ["query-output"],
        "tasks": []
      }
    }
  ],
  "branch_commits": [
    {
      "sha": "abc1234",
      "subject": "tighten compact path rendering"
    }
  ]
}
```

## Representation Strategy

Represent hot state as **tags/annotations**, not as new code-node types.

Reasoning:
- the underlying code node remains a `File`, `Function`, `Method`, etc.
- hot-ness is orthogonal state, not ontology
- separate tables/types would blur committed and transient identities

In-memory overlay model:
- `hotFiles: Map<filePath, HotFileState>`
- `hotSymbols: Map<symbolId, HotSymbolState>` (best-effort, derived from changed ranges intersecting indexed symbol spans)
- `hotFeatures: Map<featureId, score>` (derived from functionality anchors touching hot files/symbols)

Hot symbol tagging rule:
- if a changed line range overlaps a symbol span in the graph, tag that symbol as `hot`
- if overlap is ambiguous or file-only, keep the signal at file level and do not hallucinate symbol precision

## Ingest Flow

1. Resolve branch + HEAD.
2. Read staged and unstaged file deltas.
3. Parse zero-context diff hunks into changed line ranges.
4. Join file paths against indexed files in the graph.
5. Optionally project changed ranges onto symbol spans.
6. Optionally project hot files/symbols onto functionality anchors.
7. Write `.aify-graph/hot-layer.json` if content hash changed.
8. Expose the overlay to brief generation and future query surfaces.

## How It Surfaces In `brief.plan.md`

Add a dedicated `HOT` section. Do **not** fold it into `RECENT`, because recent history and active work are different signals.

Recommended section shape:

```md
## HOT
- `mcp/stdio/query/renderer.js` — modified locally, touches `renderCompact`, `renderPath`
- `tests/integration/server-toolset.test.js` — modified locally, validates lean profile behavior
- feature `query-output` — 2 hot files
```

Rules:
- max 5 bullets
- lead with files, then elevated feature/task summaries if available
- omit when the worktree is clean
- keep wording deterministic and compact for cache stability

Suggested companion trust line addition:
- `HOT worktree: 3 modified files on branch feature/query-output`

## Expiry Semantics

Hot state should expire aggressively.

Minimum rules:
- regenerate when branch changes
- regenerate when staged/unstaged diff hash changes
- if worktree becomes clean and branch-local commit window is empty, clear the hot layer

Recommended behavior:
- uncommitted hot file state disappears immediately after commit if the worktree is clean
- branch-local commit summaries remain until branch changes or HEAD merges to base (optional A3+ enhancement)

Do **not** keep hot state across branch switches.

## Query / UX Shape

Default delivery: static.
- `brief.plan.md` includes `HOT`
- `brief.json` includes `hot.files[]`, `hot.symbols[]`, `hot.features[]`

Live query support should be deferred unless a concrete need appears.

If a live query is added later, prefer:
- `graph_hot()` or `graph_plan_context()`

Avoid overloading existing verbs with transient overlay semantics in A3.

## Test Plan

### Unit
- parse `git diff --name-status` for M/A/D/R cases
- parse `git diff --unified=0` into exact line ranges
- branch switch invalidates previous overlay identity
- content-hash guard prevents unnecessary rewrites

### Integration
- modify one file in sample project, generate hot layer, assert file is listed as hot
- modify lines overlapping a known symbol, assert symbol gets tagged hot
- clean the worktree, regenerate, assert `HOT` section disappears
- rename a file, assert rename status is preserved and path mapping remains coherent

### Behavioral
- `brief.plan.md` for a dirty repo surfaces hot files before generic recent activity
- hot layer never causes committed brief sections to disappear or reorder nondeterministically
- if symbol projection fails, file-level hot signal still appears without false symbol precision

## Risks / Notes

- Diff-to-symbol projection will be approximate on large refactors and generated files; file-level signal must remain the trustworthy fallback.
- Renames need careful handling so the same hot item does not appear twice under old/new paths.
- This overlay is only useful if it remains clearly transient. If it starts behaving like durable history, we have mixed two different kinds of truth.
