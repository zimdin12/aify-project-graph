// A FULL REBUILD EMPTIES THE GRAPH BEFORE IT REFILLS IT, AND THAT WINDOW IS READABLE.
//
// Measured on an isolated 194-file subject settled at 8,306 edges: a raw reader polling during a
// forced rebuild saw [8306, 0, 30, 1594], with 12 of 195 samples reading ZERO. A first-party verb
// leaked a confident empty caller set in 2 of 3 runs — `graph_callers` rendered zero callers with no
// warning, because `inspectReadFreshness` had already read a clean manifest by the time the wipe
// landed. See docs/2026-08-26-the-graph-is-briefly-empty-and-a-verb-will-say-so.md.
//
// ⭐ THE MARKER LIVES IN THE DATABASE, NOT BESIDE IT. A manifest file is a second substrate, and
// checking it is what created the check-then-act race in the first place. Written inside the same
// transaction as the wipe, the marker cannot be observed out of step with the emptiness it warns
// about.
//
// ⛔ A CRASHED REBUILD MUST NOT BRICK EVERY READ FOREVER. The row carries when it was set and by
// which process, so the refusal can name a cause, an age, and a remedy rather than being a bare
// closed door — the same failure the stale-lock message was fixed for.

export const REBUILD_MARKER_TABLE = 'rebuild_state';

export function ensureRebuildMarkerTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${REBUILD_MARKER_TABLE} (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    started_at INTEGER NOT NULL,
    pid INTEGER
  )`);
}

// Returns null when no rebuild is in flight.
//
// ⚠ A MISSING TABLE IS REPORTED AS "NO REBUILD", AND THAT IS A DELIBERATE READING RATHER THAN A
// FAIL-OPEN. The table is created by the writer before any wipe, so its absence means no rebuild
// running this code has ever touched the database. It is not the case that we failed to find out.
export function readRebuildMarker(db) {
  try {
    const row = db.all(`SELECT started_at, pid FROM ${REBUILD_MARKER_TABLE} WHERE id = 1`)[0];
    return row ? { startedAt: row.started_at, pid: row.pid ?? null } : null;
  } catch {
    return null;
  }
}

// Caller is responsible for running this inside the SAME transaction as the wipe.
export function markRebuildStarted(db, { now, pid }) {
  ensureRebuildMarkerTable(db);
  db.run(`INSERT INTO ${REBUILD_MARKER_TABLE} (id, started_at, pid) VALUES (1, $started_at, $pid)
          ON CONFLICT(id) DO UPDATE SET started_at = $started_at, pid = $pid`,
  { started_at: now, pid: pid ?? null });
}

export function clearRebuildMarker(db) {
  try {
    db.run(`DELETE FROM ${REBUILD_MARKER_TABLE} WHERE id = 1`);
  } catch {
    // The table may not exist on a database that never rebuilt under this code. Nothing to clear.
  }
}

export function rebuildInProgressMessage({ startedAt, pid }, now) {
  const ageMs = Math.max(0, now - startedAt);
  const mins = Math.floor(ageMs / 60000);
  const age = mins >= 1 ? `${mins} minute(s)` : `${Math.floor(ageMs / 1000)} second(s)`;
  return [
    'GRAPH REBUILD IN PROGRESS — this read is refused rather than answered from a half-built graph.',
    `The rebuild started ${age} ago${pid == null ? '' : ` in process ${pid}`}.`,
    'A full rebuild empties the node and edge tables before refilling them, so a read taken now can',
    'report zero callers, zero results, or a partial count as though it were the answer.',
    'If a rebuild is genuinely running, wait for it to finish and retry.',
    'If nothing is running — the process was killed mid-rebuild — run graph_index(force=true) to',
    'rebuild and clear this marker.',
  ].join('\n');
}

export class GraphRebuildInProgressError extends Error {
  constructor(marker, now) {
    super(rebuildInProgressMessage(marker, now));
    this.name = 'GraphRebuildInProgressError';
    this.code = 'GRAPH_REBUILD_IN_PROGRESS';
    this.startedAt = marker.startedAt;
    this.pid = marker.pid;
  }
}
