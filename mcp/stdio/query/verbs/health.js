// graph_health — single trustable answer to "is the graph usable right now?"
//
// Echoes PM feedback 2026-04-21: "To answer 'is the graph usable right now?'
// an agent has to call graph_index, read brief.plan.md, parse the TRUST line,
// cross-reference. All three can disagree." This verb aggregates those signals
// into one response so a session can check health in a single call.
//
// Synthesis-only. No new data — just a coherent view of what graph_status +
// the overlay validator + the brief's trust logic already expose.

import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { openExistingDb } from '../../storage/db.js';
import { loadManifest } from '../../freshness/manifest.js';
import { getDirtyFiles } from '../../freshness/git.js';
import { readArtifactIndexedAt } from '../../freshness/unresolved-categorization.js';
import { getHeadCommit } from '../../freshness/git.js';
import { getUnresolvedCounts } from '../../freshness/unresolved-metrics.js';
import { loadFunctionality, validateAnchors, hasOverlay } from '../../overlay/loader.js';
import { loadTasksArtifact, summarizeDirtySeams, summarizeOverlayQuality } from '../../overlay/quality.js';

// Single source of truth for trust-level thresholds. graph_health and the
// brief's trust() both consume this so they can't drift. Echoes bench
// 2026-04-21 showed them disagreeing (brief said "strong" while health said
// "weak (5421 unresolved)" on the same state) — fixed by centralizing.
export const UNRESOLVED_WEAK = 2000;
export const UNRESOLVED_OK = 500;
export function computeTrustLevel(unresolvedEdges) {
  if (unresolvedEdges > UNRESOLVED_WEAK) return 'weak';
  if (unresolvedEdges > UNRESOLVED_OK) return 'ok';
  return 'strong';
}

export async function graphHealth({ repoRoot }) {
  const graphDir = join(repoRoot, '.aify-graph');
  const dbPath = join(graphDir, 'graph.sqlite');
  const indexed = existsSync(dbPath);

  if (!indexed) {
    return {
      indexed: false,
      trust: 'missing',
      summary: 'No graph at .aify-graph/graph.sqlite. Run graph_index() or /graph-build-all.',
    };
  }

  const { manifest } = await loadManifest(graphDir);
  const manifestStatus = manifest?.status ?? 'ok';
  const head = await getHeadCommit(repoRoot).catch(() => null);
  const dirtyFiles = await getDirtyFiles(repoRoot).catch(() => []);
  const stale = Boolean(manifest?.commit && head && manifest.commit !== head);
  const { total: unresolvedEdges, trust: trustUnresolvedEdges } = getUnresolvedCounts(manifest);

  // Live counts agree with graph_status + graph_report
  let nodes = manifest?.nodes ?? 0;
  let edges = manifest?.edges ?? 0;
  try {
    const db = openExistingDb(dbPath);
    try {
      nodes = db.get('SELECT count(*) AS c FROM nodes').c;
      edges = db.get('SELECT count(*) AS c FROM edges').c;
    } finally {
      db.close();
    }
  } catch {
    // fall through with manifest values
  }

  // Overlay health
  const functionality = hasOverlay(repoRoot) ? loadFunctionality(repoRoot) : { features: [] };
  const tasksArtifact = loadTasksArtifact(repoRoot);
  const overlayQuality = summarizeOverlayQuality(functionality.features ?? [], tasksArtifact.tasks ?? []);
  const dirtySeams = summarizeDirtySeams(functionality.features ?? [], dirtyFiles);
  let overlay = { present: false, checked: 0, broken: 0, sample: [] };
  if (functionality.features.length > 0 || hasOverlay(repoRoot)) {
    try {
      const db = openExistingDb(dbPath);
      try {
        const { features } = functionality;
        const { valid, broken } = validateAnchors(features ?? [], db);
        overlay = {
          present: true,
          checked: valid.length + broken.length,
          broken: broken.length,
          sample: broken.slice(0, 3).map((b) => ({ id: b.feature.id, resolved: b.totalResolved, declared: b.totalDeclared })),
        };
      } finally {
        db.close();
      }
    } catch {
      overlay = { present: true, checked: 0, broken: 0, error: 'validator threw' };
    }
  }

  const trust = computeTrustLevel(trustUnresolvedEdges);

  // Brief-vs-live staleness check. Echoes 2026-04-22 bench saw
  // brief.plan.md say "TRUST weak: 5424 unresolved" while graph_health
  // said "trust=strong (500 unresolved)" at the same moment. Same
  // thresholds, different inputs — brief was cached with an older
  // manifest snapshot. Fix: compare brief's recorded graph_indexed_at
  // against the current manifest.indexedAt; warn when they diverge so
  // consumers know the brief needs regen.
  let briefStaleVsManifest = false;
  try {
    const briefJsonPath = join(graphDir, 'brief.json');
    if (existsSync(briefJsonPath)) {
      const briefJson = JSON.parse(readFileSync(briefJsonPath, 'utf8'));
      const briefIndexedAt = briefJson.graph_indexed_at;
      if (briefIndexedAt && manifest?.indexedAt && briefIndexedAt !== manifest.indexedAt) {
        briefStaleVsManifest = true;
      }
    }
  } catch {
    // brief.json missing or malformed — skip the check
  }
  const unresolvedCategorizationStaleVsManifest = (() => {
    const categorizationIndexedAt = readArtifactIndexedAt(join(graphDir, 'unresolved-categorization.json'));
    return Boolean(categorizationIndexedAt && manifest?.indexedAt && categorizationIndexedAt !== manifest.indexedAt);
  })();

  // Plain-prose summary — one line per axis — so agents don't need to
  // interpret several numeric fields. Each axis states a decision, not a
  // measurement.
  const verdicts = [];
  verdicts.push(`nodes=${nodes} edges=${edges}`);
  verdicts.push(
    trustUnresolvedEdges === unresolvedEdges
      ? `trust=${trust} (${unresolvedEdges} unresolved)`
      : `trust=${trust} (${trustUnresolvedEdges} trust-relevant unresolved, ${unresolvedEdges} total)`,
  );
  if (manifestStatus !== 'ok') verdicts.push(`rebuild-incomplete: status=${manifestStatus} (run graph_index(force=true))`);
  if (stale) verdicts.push(`stale: indexed ${manifest.commit.slice(0,7)}, HEAD ${head.slice(0,7)}`);
  else verdicts.push('fresh');
  if (overlay.present) {
    if (overlayQuality.featureCount === 0) {
      verdicts.push('overlay=empty');
    } else {
    const qualityBits = [
      `tests ${overlayQuality.featuresWithTests}/${overlayQuality.featureCount}`,
      `docs ${overlayQuality.featuresWithDocs}/${overlayQuality.featureCount}`,
      `deps ${overlayQuality.featuresWithDependsOn}/${overlayQuality.featureCount}`,
      `related ${overlayQuality.featuresWithRelatedTo}/${overlayQuality.featureCount}`,
    ];
    if (overlayQuality.tasksTotal > 0) {
      qualityBits.push(`tasks ${overlayQuality.linkedTasks}/${overlayQuality.tasksTotal}`);
    }
    verdicts.push(
      overlay.broken === 0
        ? `overlay=clean (${overlay.checked} features; ${qualityBits.join(', ')})`
        : `overlay=broken ${overlay.broken}/${overlay.checked} (${qualityBits.join(', ')})`,
    );
    }
  } else {
    verdicts.push('overlay=none');
  }
  if (dirtyFiles.length > 0) {
    if (dirtySeams.features.length > 0) {
      const preview = dirtySeams.features.slice(0, 3)
        .map((f) => `${f.id}(${f.file_count})`)
        .join(', ');
      const orphan = dirtySeams.orphanDirtyFiles > 0 ? `, orphan ${dirtySeams.orphanDirtyFiles}` : '';
      verdicts.push(`dirty-seams: ${preview}${orphan}`);
    } else {
      verdicts.push(`dirty=${dirtyFiles.length} files`);
    }
  }
  if (briefStaleVsManifest) {
    verdicts.push('brief-stale: regenerate with graph-brief.mjs');
  }
  if (unresolvedCategorizationStaleVsManifest) {
    verdicts.push('categorization-stale: regenerate via graph_index()');
  }

  return {
    indexed: true,
    trust,
    unresolvedEdges,
    trustUnresolvedEdges,
    nodes,
    edges,
    dirtyFiles,
    dirtySeams,
    commit: manifest?.commit ?? null,
    currentHead: head,
    stale,
    manifestStatus,
    briefStaleVsManifest,
    unresolvedCategorizationStaleVsManifest,
    overlay,
    overlayQuality,
    summary: verdicts.join(' · '),
  };
}
