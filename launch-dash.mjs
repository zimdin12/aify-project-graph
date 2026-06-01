import { openExistingDb } from './mcp/stdio/storage/db.js';
import { startDashboard } from './mcp/stdio/dashboard/server.js';
const db = openExistingDb('.aify-graph/graph.sqlite');
const { url } = await startDashboard({ db, port: 7700, repoRoot: process.cwd() });
console.log('DASHBOARD_UP', url);
