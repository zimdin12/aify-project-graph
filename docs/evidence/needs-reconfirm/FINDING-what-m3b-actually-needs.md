# M3b's blocker, made precise: there is exactly ONE fingerprint authority, by design

**Date:** 2026-09-02
**Cost:** zero agent budget. Measured by reading the schema, the writer and the live artifacts.
**Status of M3b before this:** "ANSWERED, NOT BUILT — dispositioned: scope to structural, or drop."

## Why this was worth doing

The plan records that review rejected anchor-scoped hashing because *"a hash comparison needs TWO
authorities, and reindexing after an edit refreshes the only stored fingerprint — erasing the drift
M3b exists to retain."* That is the real blocker, but it sat inside a bullet as an assertion. A
disposition of "scope it or drop it" is not a decision anyone can make without knowing **what the one
unblocking change costs.**

## What is actually stored

| artifact | shape | written when |
|---|---|---|
| `structural_fingerprints` (SQLite) | `file_path TEXT PRIMARY KEY, fingerprint TEXT` | rebuild commit |
| `.aify-graph/structural-fp.json` | `{count, writtenAt, fingerprints}` — 739 entries on this repo | **the same commit** |
| overlay claims (`functionality.json`, `tasks.json`) | — | **ABSENT on this repo** |

## ⛔ The on-disk snapshot is NOT a second authority — and it looks exactly like one

`structural-fp.json` has a `writtenAt` timestamp and lives outside the database, so it reads like a
baseline that survives reindexing. It is not. `orchestrator.js:705-725` states the invariant
outright:

> "So all three are now transaction-local and merge only after COMMIT succeeds. The durable state and
> the database can no longer disagree, **because the same event promotes both.**"

That lockstep is deliberate, and it was built to fix a real defect (a rollback leaving the JSON
asserting fingerprints for files with no rows). **Using it as M3b's baseline would fight an invariant
the codebase maintains on purpose** — and would reintroduce exactly the disagreement it was written
to prevent.

This is the trap in this milestone: an artifact with a timestamp, in a separate store, that is still
one authority.

## So the minimal unblocking change is

A fingerprint **captured at claim time and stored with the claim**, written by a *different event*
than the reindex. Then the comparison has two authorities: claim-time snapshot versus live
fingerprint, and reindexing refreshes only the live side. Nothing existing can stand in for it:

- the DB table and the JSON both move with the rebuild;
- the overlay carries no fingerprint, no hash and no capture point (`grep` over `mcp/stdio/overlay/`:
  zero matches for fingerprint / baseline / capturedAt).

That is a format addition to the overlay plus a writer, a reader and a comparison surface.

## ⚠ And the scope fact that should govern the decision

**This repository has no overlay claims at all** — `functionality.json` and `tasks.json` are absent
from `.aify-graph/`. M3b detects claims that went out of date; with zero claims it is **inert here**
by construction. It earns its place only on repositories that actually use the curated overlay, and
how many of those exist, and how often their claims go stale, is **unmeasured**.

Before building it, that is the number to get. Building a drift detector for a population of zero is
the "correct but wrong" failure — proven code for something that never happens.

## Ceiling

Read from the schema, the writer and the artifacts on **this** repo today. It does not measure how
many claims exist elsewhere, how often they go stale, or whether an agent would act differently if
told. It establishes what M3b needs and what nothing existing can supply, not whether M3b is worth
building.
