import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { inspectReadFreshness, prefixReadWarnings } from './read_freshness.js';
import { loadIntelligenceOverlays } from '../../intelligence/overlays.js';
import { computeOverview, computeHotspots } from '../../intelligence/analytics.js';

// graph_tour — an ORDERED "explore this codebase in N steps" sequence, beyond
// the flat graph_onboard. Composes existing signals (entrypoints + the
// archetype-named region map + hotspots + cross-archetype flows) into a guided
// walk an agent can follow top-to-bottom, then drill with graph_packet. Borrowed
// from understand-anything's tour-generator, structure-first (no LLM); richer
// when the intelligence overlay is present. Pure over an open db (buildTour);
// graphTour is the freshness-gated wrapper.

const CONTAINER = new Set(['File', 'Module', 'Directory', 'Document', 'Config', 'External', 'Repository']);

function regionRank(c) {
  const interTotal = (c.edges_to || []).reduce((s, e) => s + (e.count || 0), 0);
  return c.node_count * (1 + interTotal);
}

export function buildTour(db, { steps = 8, focus = null, architecture = null, json = false } = {}) {
  const total = db.get('SELECT COUNT(*) AS c FROM nodes').c;
  if (!total) return 'TOUR — the graph is empty. Run graph_index first (no nodes indexed).';

  const focusLc = focus ? String(focus).toLowerCase() : null;

  // Entry points — where execution starts.
  const entrypoints = db.all(
    `SELECT label, type, file_path, start_line FROM nodes
     WHERE type IN ('Entrypoint', 'Route') ORDER BY type, label LIMIT 6`,
  );

  // Region map (archetype-named clusters), code-only, ranked by size×connectivity.
  let regions = computeOverview(db, { topSymbols: 5, architecture })
    .filter((c) => !c.cluster.startsWith('__'))
    .filter((c) => (c.top_symbols || []).length > 0);
  if (focusLc) {
    regions = regions.filter((c) => {
      const a = c.archetype || {};
      return String(a.id || '').toLowerCase() === focusLc
        || String(a.name || '').toLowerCase().includes(focusLc)
        || String(c.label || '').toLowerCase().includes(focusLc);
    });
  }
  regions.sort((a, b) => regionRank(b) - regionRank(a));

  // Assemble ordered steps, capped to `steps`.
  const stepsOut = [];
  if (entrypoints.length) {
    const ep = entrypoints[0];
    stepsOut.push({
      title: 'Entry points',
      why: 'where execution starts — trace outward from here',
      symbols: entrypoints.slice(0, 4).map((e) => `${e.label} @ ${e.file_path}:${e.start_line ?? '?'}`),
      refs: entrypoints.slice(0, 4).map((e) => e.label),
      verb: ep ? `graph_trace ${ep.label} <target>` : 'graph_callers <symbol>',
    });
  }
  for (const r of regions) {
    if (stepsOut.length >= steps) break;
    const topSym = r.top_symbols[0]?.label;
    stepsOut.push({
      title: r.label,
      why: `${r.node_count} symbol${r.node_count === 1 ? '' : 's'}${r.archetype && r.archetype.confidence !== 'low' ? ` (${r.archetype.name})` : ''} — a major subsystem`,
      symbols: r.top_symbols.slice(0, 4).map((s) => `${s.label}${s.degree ? ` ·${s.degree} deg` : ''}`),
      refs: r.top_symbols.slice(0, 4).map((s) => s.label),
      verb: topSym ? `graph_packet ${topSym}` : 'graph_packet <symbol>',
    });
  }
  // Optional closing hotspots step (skipped under focus to keep it on-topic).
  if (!focusLc && stepsOut.length < steps) {
    const hot = computeHotspots(db, { limit: 5 }).filter((h) => !CONTAINER.has(h.type));
    if (hot.length) {
      stepsOut.push({
        title: 'Hotspots',
        why: 'the highest-degree symbols you will touch most — review before refactoring',
        symbols: hot.slice(0, 5).map((h) => `${h.label} ·${h.degree} deg @ ${h.file_path || '?'}`),
        refs: hot.slice(0, 5).map((h) => h.label),
        verb: `graph_impact ${hot[0].label}`,
      });
    }
  }
  const capped = stepsOut.slice(0, steps);

  // Structured form for the dashboard Guided Tour panel (each step's `refs` are
  // bare symbol labels the UI turns into click-to-focus pills).
  if (json) return capped;

  const lines = [];
  lines.push(`TOUR — ${focus ? `focus: ${focus}; ` : ''}${capped.length} step${capped.length === 1 ? '' : 's'}`);
  lines.push('Treat this as an orientation map: read top-to-bottom, then drill with graph_packet.');
  lines.push('');
  capped.forEach((s, i) => {
    lines.push(`${i + 1}. **${s.title}** — ${s.why}`);
    for (const sym of s.symbols) lines.push(`   • ${sym}`);
    lines.push(`   → ${s.verb}`);
  });
  return lines.join('\n');
}

export async function graphTour({ repoRoot, steps = 8, focus = null }) {
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_tour' });
  if (freshness.blocker) return freshness.blocker;
  const graphDir = join(repoRoot, '.aify-graph');
  let architecture = null;
  try {
    const intel = loadIntelligenceOverlays({ repoRoot });
    architecture = intel.architecture || null;
  } catch { /* overlay optional */ }
  const db = openExistingDb(join(graphDir, 'graph.sqlite'));
  try {
    return prefixReadWarnings(buildTour(db, { steps, focus, architecture }), freshness.warnings);
  } finally {
    db.close();
  }
}
