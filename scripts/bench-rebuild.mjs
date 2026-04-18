#!/usr/bin/env node
// Benchmarks a full rebuild: timing, peak RSS, node/edge counts by relation.
// Usage: node scripts/bench-rebuild.mjs <repoRoot>
// Exits 0 on success, 1 on failure. Prints a single JSON line to stdout.

import { rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureFresh } from '../mcp/stdio/freshness/orchestrator.js';
import { openDb } from '../mcp/stdio/storage/db.js';

const repoRoot = process.argv[2];
if (!repoRoot) {
  console.error('usage: node scripts/bench-rebuild.mjs <repoRoot>');
  process.exit(2);
}

const graphDir = join(repoRoot, '.aify-graph');

// User-curated overlay files that MUST survive a rebuild. Graph artifacts
// (graph.sqlite, manifest.json, brief.*) are derived and get recomputed;
// these are source-of-truth and can't be regenerated from the graph.
const PRESERVE = ['functionality.json', 'tasks.json'];

const preserved = {};
if (existsSync(graphDir)) {
  for (const name of PRESERVE) {
    const p = join(graphDir, name);
    if (existsSync(p)) {
      preserved[name] = await readFile(p);
    }
  }
  await rm(graphDir, { recursive: true, force: true });
}
if (Object.keys(preserved).length > 0) {
  await mkdir(graphDir, { recursive: true });
  for (const [name, content] of Object.entries(preserved)) {
    await writeFile(join(graphDir, name), content);
  }
}

let peakRssMb = 0;
const rssSampler = setInterval(() => {
  const rssMb = process.memoryUsage().rss / 1024 / 1024;
  if (rssMb > peakRssMb) peakRssMb = rssMb;
}, 250);

const t0 = Date.now();
let result;
let error = null;
try {
  result = await ensureFresh({ repoRoot, force: true });
} catch (err) {
  error = err;
}
const durationMs = Date.now() - t0;
clearInterval(rssSampler);

// Also sample final RSS
const finalRssMb = process.memoryUsage().rss / 1024 / 1024;
if (finalRssMb > peakRssMb) peakRssMb = finalRssMb;

// Collect edge breakdown by relation
let edgeByRelation = {};
let nodeByType = {};
try {
  const db = openDb(join(graphDir, 'graph.sqlite'));
  try {
    const relRows = db.all('SELECT relation, COUNT(*) AS n FROM edges GROUP BY relation ORDER BY n DESC');
    for (const row of relRows) edgeByRelation[row.relation] = row.n;
    const typeRows = db.all('SELECT type, COUNT(*) AS n FROM nodes GROUP BY type ORDER BY n DESC');
    for (const row of typeRows) nodeByType[row.type] = row.n;
  } finally {
    db.close();
  }
} catch {
  // DB unreadable (e.g., rebuild crashed) — leave counts empty
}

const report = {
  repoRoot,
  ok: !error && !!result,
  error: error ? String(error?.message ?? error) : null,
  durationMs,
  durationSec: Math.round(durationMs / 1000),
  peakRssMb: Math.round(peakRssMb),
  nodes: result?.nodes ?? 0,
  edges: result?.edges ?? 0,
  unresolvedEdges: result?.unresolvedEdges ?? 0,
  processedFiles: result?.processedFiles?.length ?? 0,
  nodeByType,
  edgeByRelation,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
