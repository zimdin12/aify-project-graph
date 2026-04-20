import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadManifest } from '../../freshness/manifest.js';
import { getHeadCommit, getDirtyFiles } from '../../freshness/git.js';
import { openDb } from '../../storage/db.js';

export async function graphStatus({ repoRoot }) {
  const graphDir = join(repoRoot, '.aify-graph');
  const { status: mStatus, manifest } = await loadManifest(graphDir);
  const commit = await getHeadCommit(repoRoot).catch(() => null);
  const dirtyFiles = await getDirtyFiles(repoRoot).catch(() => []);

  // Live DB counts — graph_report uses these, so status agrees with report
  // when the DB is fresher than the manifest (e.g. after an ensureFresh pass
  // that hasn't rewritten the manifest yet).
  let liveNodes = null;
  let liveEdges = null;
  const dbPath = join(graphDir, 'graph.sqlite');
  if (existsSync(dbPath)) {
    try {
      const db = openDb(dbPath);
      try {
        liveNodes = db.get('SELECT count(*) AS c FROM nodes').c;
        liveEdges = db.get('SELECT count(*) AS c FROM edges').c;
      } finally {
        db.close();
      }
    } catch {
      // fall through — use manifest numbers
    }
  }

  return {
    indexed: mStatus === 'ok' && manifest.commit !== null,
    nodes: liveNodes ?? manifest.nodes ?? 0,
    edges: liveEdges ?? manifest.edges ?? 0,
    indexedAt: manifest.indexedAt ?? null,
    commit: manifest.commit ?? null,
    currentHead: commit,
    dirtyFiles,
    unresolvedEdges: manifest.dirtyEdgeCount ?? (manifest.dirtyEdges ?? []).length,
    dirtyEdgeCount: manifest.dirtyEdgeCount ?? (manifest.dirtyEdges ?? []).length,
    schemaVersion: manifest.schemaVersion ?? 1,
    extractorVersion: manifest.extractorVersion ?? '0.0.0',
  };
}
