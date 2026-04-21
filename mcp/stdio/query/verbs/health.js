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
import { existsSync } from 'node:fs';
import { openDb } from '../../storage/db.js';
import { loadManifest } from '../../freshness/manifest.js';
import { getHeadCommit } from '../../freshness/git.js';
import { loadFunctionality, validateAnchors, hasOverlay } from '../../overlay/loader.js';

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
  const head = await getHeadCommit(repoRoot).catch(() => null);
  const stale = Boolean(manifest?.commit && head && manifest.commit !== head);
  const unresolvedEdges = manifest?.dirtyEdgeCount ?? (manifest?.dirtyEdges?.length ?? 0);

  // Live counts agree with graph_status + graph_report
  let nodes = manifest?.nodes ?? 0;
  let edges = manifest?.edges ?? 0;
  try {
    const db = openDb(dbPath);
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
  let overlay = { present: false, checked: 0, broken: 0, sample: [] };
  if (hasOverlay(repoRoot)) {
    try {
      const db = openDb(dbPath);
      try {
        const { features } = loadFunctionality(repoRoot);
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

  const trust = computeTrustLevel(unresolvedEdges);

  // Plain-prose summary — one line per axis — so agents don't need to
  // interpret several numeric fields. Each axis states a decision, not a
  // measurement.
  const verdicts = [];
  verdicts.push(`nodes=${nodes} edges=${edges}`);
  verdicts.push(`trust=${trust} (${unresolvedEdges} unresolved)`);
  if (stale) verdicts.push(`stale: indexed ${manifest.commit.slice(0,7)}, HEAD ${head.slice(0,7)}`);
  else verdicts.push('fresh');
  if (overlay.present) {
    verdicts.push(overlay.broken === 0
      ? `overlay=clean (${overlay.checked} features)`
      : `overlay=broken ${overlay.broken}/${overlay.checked}`);
  } else {
    verdicts.push('overlay=none');
  }

  return {
    indexed: true,
    trust,
    unresolvedEdges,
    nodes,
    edges,
    commit: manifest?.commit ?? null,
    currentHead: head,
    stale,
    overlay,
    summary: verdicts.join(' · '),
  };
}
