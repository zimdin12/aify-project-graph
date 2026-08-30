import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadManifest } from '../../freshness/manifest.js';
import { WorktreeState } from '../../freshness/worktree-state.js';
import { getUnresolvedCounts } from '../../freshness/unresolved-metrics.js';
import { openExistingDb } from '../../storage/db.js';
import { ATTESTATION, classifyAttestation, readGraphPublication } from '../../storage/publication-schema.js';
import { hasOverlay, loadFunctionality } from '../../overlay/loader.js';
import { loadTasksArtifact, summarizeDirtySeams, summarizeOverlayQuality } from '../../overlay/quality.js';

export async function graphStatus({ repoRoot }) {
  const graphDir = join(repoRoot, '.aify-graph');
  const { status: mStatus, manifest } = await loadManifest(graphDir);
  const { total: unresolvedEdges, trust: trustUnresolvedEdges } = getUnresolvedCounts(manifest);
  // graph_status REPORTS these two values as the state of the tree, so a failed git query used
  // to be published as currentHead:null alongside dirtyFiles:[] — an honest null next to a
  // dishonest empty list, which together read as "a repo with no HEAD and nothing modified"
  // rather than "we could not look".
  const worktree = await WorktreeState.observe(repoRoot);
  const commit = worktree.head;
  const dirtyFiles = worktree.allDirty ?? [];
  const functionality = hasOverlay(repoRoot) ? loadFunctionality(repoRoot) : { features: [] };
  const tasksArtifact = loadTasksArtifact(repoRoot);
  const overlayQuality = summarizeOverlayQuality(functionality.features ?? [], tasksArtifact.tasks ?? []);
  const dirtySeams = summarizeDirtySeams(functionality.features ?? [], dirtyFiles);

  // Live DB counts — graph_report uses these, so status agrees with report
  // when the DB is fresher than the manifest (e.g. after an ensureFresh pass
  // that hasn't rewritten the manifest yet).
  let liveNodes = null;
  let liveEdges = null;
  // ⛔ THE DEFAULT IS THE REFUSING VALUE. If the database cannot be opened below, this verb has
  // seen only one side and must say so rather than inherit the manifest's word for it.
  let generationState = ATTESTATION.LEGACY_UNATTESTED;
  let dbCounts = null;
  const dbPath = join(graphDir, 'graph.sqlite');
  if (existsSync(dbPath)) {
    try {
      const db = openExistingDb(dbPath);
      try {
        liveNodes = db.get('SELECT count(*) AS c FROM nodes').c;
        liveEdges = db.get('SELECT count(*) AS c FROM edges').c;
        // ⭐ THIS VERB CAN ACTUALLY COMPARE, so it must. The comment above already concedes that
        // the DB can be fresher than the manifest; until now that was reported as a nicety about
        // node counts, while the unresolved counts beside it were taken from the manifest with
        // nothing saying which graph they described.
        //
        // ⛔ AND A MANIFEST CANNOT ATTEST ITSELF. Reviewer's caution, and it is the whole point: a
        // manifest naming its own generation is one side of a two-sided comparison. Only a reader
        // holding BOTH substrates can tell attested from torn, which is why this happens here,
        // inside the handle, and not wherever the counts are formatted.
        const publication = readGraphPublication(db);
        generationState = classifyAttestation({
          dbGeneration: publication === null ? null : publication.generation,
          manifestGeneration: manifest?.generation ?? null,
        });
        dbCounts = publication?.counts ?? null;
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
    manifestStatus: manifest.status ?? 'ok',
    commit: manifest.commit ?? null,
    currentHead: commit,
    dirtyFiles,
    // Present ONLY on the failure path, so a healthy graph_status is unchanged byte for byte.
    // Without it, dirtyFiles:[] is indistinguishable from a measured clean tree.
    ...(worktree.disclosures().length > 0
      ? { worktreeObservationFailed: worktree.disclosures() }
      : {}),
    unresolvedEdges,
    trustUnresolvedEdges,
    dirtyEdgeCount: unresolvedEdges,
    // ⚠ WHICH GRAPH THOSE COUNTS DESCRIBE, beside the counts themselves. On a legacy or torn graph
    // this verb used to print an unresolved count with nothing qualifying it, and a reader has no
    // other way to tell a measurement from a number copied out of a file that may not match.
    generationState,
    // The transactionally-committed aggregates, when the publishing run recorded them. null means
    // the graph predates them — NOT zero, which would be a measurement nobody took.
    dbUnresolvedCount: dbCounts?.unresolved ?? null,
    dbTrustUnresolvedCount: dbCounts?.trustUnresolved ?? null,
    unresolvedBy: summarizeUnresolved(
      manifest.dirtyEdges ?? [],
      unresolvedEdges,
    ),
    overlayQuality,
    dirtySeams,
    schemaVersion: manifest.schemaVersion ?? 1,
    extractorVersion: manifest.extractorVersion ?? '0.0.0',
  };
}

// Coarse cause breakdown for unresolved refs. Echoes PM wants to know WHY
// 45% of their edges are unresolved without speculative labels. We report
// what the graph actually knows: relation type and source language. No
// "template instantiation" / "dynamic dispatch" claims.
//
// The input `dirtyEdges` is the manifest sample (capped at 500 rows);
// `totalCount` is the authoritative count from dirtyEdgeCount (backed by
// the sidecar on disk). We expose both so percentages from byRelation
// sum to `sample_size`, while `total` tells the caller the true scale.
function summarizeUnresolved(dirtyEdges, totalCount) {
  if (!dirtyEdges || dirtyEdges.length === 0) {
    return { total: totalCount ?? 0, sample_size: 0, byRelation: {}, byLanguage: {} };
  }
  const byRelation = {};
  const byLanguage = {};
  for (const ref of dirtyEdges) {
    const rel = ref.relation || 'UNKNOWN';
    const lang = ref.extractor || 'unknown';
    byRelation[rel] = (byRelation[rel] ?? 0) + 1;
    byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;
  }
  const sampled = totalCount > dirtyEdges.length;
  return {
    total: totalCount ?? dirtyEdges.length,
    sample_size: dirtyEdges.length,
    byRelation,
    byLanguage,
    note: sampled
      ? `byRelation/byLanguage counts sampled from ${dirtyEdges.length} of ${totalCount} unresolved refs — shape representative, scale = total`
      : undefined,
  };
}
