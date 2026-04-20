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
    unresolvedBy: summarizeUnresolved(manifest.dirtyEdges ?? []),
    schemaVersion: manifest.schemaVersion ?? 1,
    extractorVersion: manifest.extractorVersion ?? '0.0.0',
  };
}

// Coarse cause breakdown for unresolved refs. Echoes PM wants to know WHY
// 45% of their edges are unresolved without speculative labels. We report
// what the graph actually knows: relation type and source language. No
// "template instantiation" / "dynamic dispatch" claims. The sampled array
// is capped at 500 by the manifest writer, so percentages derived from it
// are representative but not exact for huge repos — we label them "sampled"
// when the full count exceeds the sample.
function summarizeUnresolved(dirtyEdges) {
  if (!dirtyEdges || dirtyEdges.length === 0) {
    return { total: 0, byRelation: {}, byLanguage: {} };
  }
  const byRelation = {};
  const byLanguage = {};
  for (const ref of dirtyEdges) {
    const rel = ref.relation || 'UNKNOWN';
    const lang = ref.extractor || 'unknown';
    byRelation[rel] = (byRelation[rel] ?? 0) + 1;
    byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;
  }
  return {
    total: dirtyEdges.length,
    byRelation,
    byLanguage,
    note: dirtyEdges.length >= 500
      ? 'sampled from the first 500 unresolved refs — shape representative, counts approximate'
      : undefined,
  };
}
