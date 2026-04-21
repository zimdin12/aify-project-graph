// Sidecar for the FULL unresolved-edges list across incremental runs.
//
// Problem this solves: manifest.dirtyEdges was capped at 500 to keep the
// JSON small, but the orchestrator also fed manifest.dirtyEdges back into
// the next incremental run's refs list — so any unresolved edges past 500
// were silently dropped each invocation. On repos with large unresolved
// backlogs (dynamic dispatch, external packages) this caused state loss
// across runs and made incremental drift from force rebuilds.
//
// Shape (dev-approved): keep manifest.dirtyEdges as the first-500 sample
// for cheap breakdown queries (status/health use it for shape stats) and
// write the full list to `.aify-graph/dirty-edges.full.json` sidecar.
// The orchestrator reads the sidecar (full) when carrying refs forward
// into the next run, falling back to the manifest sample if the sidecar
// is missing (older graphs).

import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const SIDECAR_FILE = 'dirty-edges.full.json';

export async function readDirtyEdgesSidecar(graphDir) {
  const path = join(graphDir, SIDECAR_FILE);
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.dirtyEdges) ? parsed.dirtyEdges : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return null; // signals "fall back to manifest"
    return []; // corrupt — treat as empty, manifest sample still provides something
  }
}

export async function writeDirtyEdgesSidecar(graphDir, dirtyEdges) {
  await mkdir(graphDir, { recursive: true });
  const path = join(graphDir, SIDECAR_FILE);

  // Empty list → remove the sidecar so a healthy graph doesn't leave a
  // stale file lying around. Don't error if already absent.
  if (!Array.isArray(dirtyEdges) || dirtyEdges.length === 0) {
    try { await unlink(path); } catch {}
    return;
  }

  const tempPath = `${path}.${randomUUID()}.tmp`;
  const payload = JSON.stringify({
    count: dirtyEdges.length,
    writtenAt: new Date().toISOString(),
    dirtyEdges,
  });
  await writeFile(tempPath, payload, 'utf8');
  await rename(tempPath, path);
}
