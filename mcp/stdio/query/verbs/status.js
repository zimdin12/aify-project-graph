import { join } from 'node:path';
import { loadManifest } from '../../freshness/manifest.js';
import { getHeadCommit, getDirtyFiles } from '../../freshness/git.js';

export async function graphStatus({ repoRoot }) {
  const graphDir = join(repoRoot, '.aify-graph');
  const { status: mStatus, manifest } = await loadManifest(graphDir);
  const commit = await getHeadCommit(repoRoot).catch(() => null);
  const dirtyFiles = await getDirtyFiles(repoRoot).catch(() => []);

  return {
    indexed: mStatus === 'ok' && manifest.commit !== null,
    nodes: manifest.nodes ?? 0,
    edges: manifest.edges ?? 0,
    indexedAt: manifest.indexedAt ?? null,
    commit: manifest.commit ?? null,
    currentHead: commit,
    dirtyFiles,
    unresolvedEdges: (manifest.dirtyEdges ?? []).length,
    dirtyEdgeCount: (manifest.dirtyEdges ?? []).length,
    schemaVersion: manifest.schemaVersion ?? 1,
    extractorVersion: manifest.extractorVersion ?? '0.0.0',
  };
}
