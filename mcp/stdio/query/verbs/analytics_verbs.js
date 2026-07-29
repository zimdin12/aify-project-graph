// Analytics verbs (P2a / P2-9) — agent-facing surface for the dashboard's
// computed analysis, ending the "dashboard is an island" problem.
//
//   graph_overview  → community/layer/dir cluster map
//   graph_hotspots  → god nodes (top-N by in+out degree)
//   graph_cycles    → file-level import/include cycles, tightest first
//   graph_digest    → token-budgeted project digest (the headline verb)
//
// All four are thin wrappers over the SHARED intelligence/analytics.js module
// — the SAME functions the dashboard endpoints call (P2b). Verbs return a
// compact human-readable text body with the structured data attached under
// `data`, and carry the standard freshness/trust banner via read_freshness.

import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { loadIntelligenceOverlays } from '../../intelligence/overlays.js';
import {
  computeOverview,
  computeHotspots,
  hotspotBoundCaveat,
  UPPER_BOUND_FOOTNOTE,
  computeCycles,
  computeDigest,
  computeProvenanceMix,
} from '../../intelligence/analytics.js';
import { inspectReadFreshness, prefixReadWarnings } from './read_freshness.js';

function dbPathFor(repoRoot) {
  return join(repoRoot, '.aify-graph', 'graph.sqlite');
}

// Load the architecture overlay (for layer-based clustering / digest LAYERS
// line) if present. Returns null when absent — clustering then falls back to
// community_id → top-dir, exactly as analytics.js documents.
function loadArchitecture(repoRoot) {
  try {
    const intel = loadIntelligenceOverlays({ repoRoot });
    return intel.architecture || null;
  } catch {
    return null;
  }
}

// ── graph_overview ──────────────────────────────────────────────────────────
export async function graphOverview({ repoRoot, top_k = 12 }) {
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_overview' });
  if (freshness.blocker) return freshness.blocker;
  const db = openExistingDb(dbPathFor(repoRoot));
  try {
    const architecture = loadArchitecture(repoRoot);
    const clusters = computeOverview(db, { topSymbols: 5, architecture });
    const shown = clusters.slice(0, top_k);

    const lines = [`OVERVIEW ${clusters.length} cluster(s)` + (clusters.length > top_k ? ` (showing top ${top_k} by size)` : '')];
    for (const c of shown) {
      const top = c.top_symbols.map((s) => `${s.label}(${(s.type || '').toLowerCase()})`).join(', ');
      lines.push(`CLUSTER ${c.label} — ${c.node_count} node(s)${top ? ` — top: ${top}` : ''}`);
      const edgesTo = c.edges_to.slice(0, 4);
      if (edgesTo.length) {
        const labelByKey = new Map(clusters.map((x) => [x.cluster, x.label]));
        const edgeStr = edgesTo.map((e) => `${labelByKey.get(e.cluster) || e.cluster}(${e.count})`).join(', ');
        lines.push(`  → ${edgeStr}`);
      }
    }
    // M1 — wrap the WHOLE hybrid body (text + appended JSON) through the
    // staleness wrapper in ONE call so the snapshot warnings cannot be escaped
    // by the appended JSON block, matching every other verb's output contract.
    const text = lines.join('\n') + '\n\n' + JSON.stringify({ clusters: shown }, null, 2);
    return prefixReadWarnings(text, freshness.warnings);
  } finally {
    db.close();
  }
}

// ── graph_hotspots ──────────────────────────────────────────────────────────
export async function graphHotspots({ repoRoot, limit = 15 }) {
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_hotspots' });
  if (freshness.blocker) return freshness.blocker;
  const db = openExistingDb(dbPathFor(repoRoot));
  try {
    const hotspots = computeHotspots(db, { limit });
    const lines = [`HOTSPOTS ${hotspots.length} god node(s), by in+out degree`];
    for (const h of hotspots) {
      lines.push(`- ${h.label} ${(h.type || '').toLowerCase()} ${h.file_path} (deg ${h.degree}; ${h.fan_in} in / ${h.fan_out} out)${hotspotBoundCaveat(h)}`);
    }
    if (hotspots.some((h) => h.degree_is_upper_bound)) lines.push(UPPER_BOUND_FOOTNOTE);
    if (hotspots.length === 0) lines.push('(no ranked symbols — graph may be container-only)');
    // M1 — wrap text + appended JSON in ONE staleness-wrapper call (see graph_overview).
    const text = lines.join('\n') + '\n\n' + JSON.stringify({ hotspots }, null, 2);
    return prefixReadWarnings(text, freshness.warnings);
  } finally {
    db.close();
  }
}

// ── graph_cycles ────────────────────────────────────────────────────────────
export async function graphCycles({ repoRoot, max_len = 5, top_k = 20 }) {
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_cycles' });
  if (freshness.blocker) return freshness.blocker;
  const db = openExistingDb(dbPathFor(repoRoot));
  try {
    const { cycles, capped, scanned } = computeCycles(db, { maxLen: max_len, topN: top_k });
    const lines = [];
    if (cycles.length === 0) {
      lines.push(`CYCLES none found — import/include graph is acyclic at file level (${scanned} file node(s) scanned, maxLen=${max_len}).`);
    } else {
      lines.push(`CYCLES ${cycles.length} file-level import cycle(s), tightest first${capped ? ' — SEARCH CAPPED (raise top_k for more)' : ''}`);
      for (const c of cycles) {
        lines.push(`- (${c.length}) ${c.join(' → ')} → ${c[0]}`);
      }
    }
    // M1 — wrap text + appended JSON in ONE staleness-wrapper call (see graph_overview).
    const text = lines.join('\n') + '\n\n' + JSON.stringify({ cycles, capped, scanned }, null, 2);
    return prefixReadWarnings(text, freshness.warnings);
  } finally {
    db.close();
  }
}

// ── graph_digest ────────────────────────────────────────────────────────────
export async function graphDigest({ repoRoot, budget = 6000 }) {
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_digest' });
  if (freshness.blocker) return freshness.blocker;
  const db = openExistingDb(dbPathFor(repoRoot));
  try {
    const architecture = loadArchitecture(repoRoot);
    const text = computeDigest(db, { budget, architecture });
    return prefixReadWarnings(text, freshness.warnings);
  } finally {
    db.close();
  }
}

// Exported for the (P2b) dashboard /api/digest endpoint + tests.
export { computeProvenanceMix };
