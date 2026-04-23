import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { startDashboard } from '../../dashboard/server.js';
import { inspectReadFreshness } from './read_freshness.js';

// Keyed by repoRoot so calling graph_dashboard from different repos in the
// same process doesn't silently return the URL of the first repo's server
// (the previous single-slot state caused exactly that — dev audit 11b90fb).
const activeDashboards = new Map();

export async function graphDashboard({ repoRoot, port }) {
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_dashboard' });
  if (freshness.blocker) return freshness.blocker;

  const existing = activeDashboards.get(repoRoot);
  if (existing) {
    return {
      url: existing.url,
      port: existing.port,
      status: 'already_running',
    };
  }

  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const result = await startDashboard({ db, port: port || 0 });

    activeDashboards.set(repoRoot, { ...result, db });

    return {
      url: result.url,
      port: result.port,
      status: 'running',
      warnings: freshness.warnings,
    };
  } catch (err) {
    db.close();
    throw err;
  }
}
