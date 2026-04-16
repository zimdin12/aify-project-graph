import { join } from 'node:path';
import { openDb } from '../../storage/db.js';
import { ensureFresh } from '../../freshness/orchestrator.js';
import { startDashboard } from '../../dashboard/server.js';

let activeDashboard = null;

export async function graphDashboard({ repoRoot, port }) {
  await ensureFresh({ repoRoot });

  // If already running, return existing URL
  if (activeDashboard) {
    return {
      url: activeDashboard.url,
      port: activeDashboard.port,
      status: 'already_running',
    };
  }

  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const result = await startDashboard({ db, port: port || 0 });

    activeDashboard = { ...result, db };

    return {
      url: result.url,
      port: result.port,
      status: 'running',
    };
  } catch (err) {
    db.close();
    throw err;
  }
}
