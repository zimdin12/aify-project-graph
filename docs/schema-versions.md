# Schema Versions

This page explains the `schemaVersion` reported by `graph_status()`.

## Scope

`schemaVersion` refers to the SQLite graph schema in `.aify-graph/graph.sqlite` and the freshness manifest that tracks it. It does **not** version-lock the user-owned overlay files:

- `.aify-graph/functionality.json`
- `.aify-graph/tasks.json`

Those overlays are file-backed and normalized permissively at load time. New optional fields are tolerated; missing optional fields are filled with defaults.

## Current version

- **Current schemaVersion:** `3`

## History

### v1

Introduced the initial SQLite-backed graph storage.

What it included:
- `nodes` and `edges` tables
- base indexes on node label / file path / type
- base indexes on edge source / target / relation
- manifest-backed freshness with `schemaVersion`

Representative commit:
- `976bcf0` — `feat(storage): SQLite schema — nodes + edges tables with indexes`

### v2

No long-lived v2 schema shipped on `main`.

What happened:
- the storage layer evolved between early hardening passes, but the durable on-branch schema history visible in `schema.js` jumps from `v1` to `v3`
- if you only interact with released `main` builds, treat `v2` as an internal stepping stone rather than a migration target

### v3

Expanded lookup quality and edge integrity.

What it introduced:
- `idx_nodes_qname` on `json_extract(extra, '$.qname')`
- unique edge index `idx_edges_unique`
- `idx_edges_source_file`

Representative commit:
- `c231f24` — `perf(resolver): replace in-memory indexes with SQLite-backed lookup`

Later additive extension on top of v3:
- `c6c865a` — added `External` to the node-type set for unresolved-call materialization

## Migration behavior

### Graph DB / manifest

When the persisted graph schema is older than the runtime expects:
- the freshness/orchestrator layer detects the mismatch
- the graph is rebuilt into the current schema
- no manual migration command is required

Practical expectation:
- if `schemaVersion` changes, the safe response is usually `graph_index(force=true)` or letting the next rebuild happen naturally

### `functionality.json`

No standalone migration step today.

Current behavior:
- the loader accepts older shapes and normalizes missing optional fields to defaults
- fields such as `depends_on` / `related_to` are optional; if absent, they load as empty arrays
- stale anchors or references to missing features show up as validation/trust issues rather than hard parse failures

Practical expectation:
- older files usually continue to load
- after a repo upgrade, regenerate briefs and review trust warnings

### `tasks.json`

No standalone migration step today.

Current behavior:
- tasks are treated as a file-backed overlay
- missing optional metadata is tolerated
- attribution gaps show up in briefs/pull output rather than forcing a migration

Practical expectation:
- old task snapshots are usually still readable
- rebuilding briefs after updating tasks is enough for normal use

## Operator guidance

- If `graph_status()` shows an unexpected `schemaVersion`, compare it to this page first.
- If graph output looks stale or inconsistent after an upgrade, run `graph_index(force=true)`.
- If overlay-driven features behave oddly after an upgrade, regenerate briefs and check overlay trust / anchor validation before rewriting the overlay by hand.
