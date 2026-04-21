#!/usr/bin/env node
// scripts/diagnose-convergence.mjs
//
// Diagnoses the incremental-vs-force convergence bug flagged by echoes
// manager (500→5424 on reindex) and graph-senior-dev (696→2097 on apg).
//
// Strategy: snapshot the current graph, run incremental ensureFresh,
// capture (edge count, dirtyEdge count, edge sample), restore snapshot,
// run force ensureFresh, capture same, then diff the two sets.
//
// No code changes to the ingest path — this is read-only instrumentation
// against whatever state the repo's .aify-graph is currently in.
//
// Usage:
//   node scripts/diagnose-convergence.mjs <repoRoot>
//
// Output: docs/dogfood/p0-convergence-diagnosis-<timestamp>.md + raw JSON
// next to it for programmatic consumption.

import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureFresh } from '../mcp/stdio/freshness/orchestrator.js';
import { openDb } from '../mcp/stdio/storage/db.js';

const [, , repoArg] = process.argv;
if (!repoArg) {
  console.error('usage: diagnose-convergence.mjs <repoRoot>');
  process.exit(2);
}
const repoRoot = resolve(repoArg);
const graphDir = join(repoRoot, '.aify-graph');
if (!existsSync(graphDir)) {
  console.error(`no .aify-graph at ${graphDir}. Run graph_index() first.`);
  process.exit(3);
}

function snapshot(label) {
  const dbPath = join(graphDir, 'graph.sqlite');
  const manifestPath = join(graphDir, 'manifest.json');
  if (!existsSync(dbPath)) return { label, edges: 0, nodes: 0, unresolved: 0, edgeKeys: new Set() };
  const db = openDb(dbPath);
  try {
    const nodes = db.get('SELECT count(*) AS c FROM nodes').c;
    const edges = db.get('SELECT count(*) AS c FROM edges').c;
    const edgeRows = db.all(`SELECT e.relation, e.source_file, e.source_line,
                                    f.label AS from_label, t.label AS to_label,
                                    t.type AS to_type, t.file_path AS to_file
                             FROM edges e
                             JOIN nodes f ON f.id = e.from_id
                             JOIN nodes t ON t.id = e.to_id`);
    const edgeKeys = new Set(edgeRows.map((r) =>
      `${r.relation}|${r.source_file}:${r.source_line}|${r.from_label}→${r.to_label}(${r.to_type}@${r.to_file ?? '-'})`
    ));
    let manifest = null;
    if (existsSync(manifestPath)) {
      try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { /* ignore */ }
    }
    const unresolved = manifest?.dirtyEdgeCount ?? (manifest?.dirtyEdges?.length ?? 0);
    const unresolvedSample = (manifest?.dirtyEdges ?? []).slice(0, 30).map((r) => ({
      relation: r.relation, source_file: r.source_file, target: r.target, extractor: r.extractor,
    }));
    return { label, nodes, edges, unresolved, edgeKeys, unresolvedSample };
  } finally {
    db.close();
  }
}

function backupGraphDir(label) {
  const backup = join(tmpdir(), `apg-convergence-${label}-${Date.now()}`);
  mkdirSync(backup, { recursive: true });
  cpSync(graphDir, backup, { recursive: true });
  return backup;
}

function restoreGraphDir(backup) {
  rmSync(graphDir, { recursive: true, force: true });
  cpSync(backup, graphDir, { recursive: true });
}

const baseline = snapshot('baseline');
console.log(`baseline: ${baseline.nodes} nodes, ${baseline.edges} edges, ${baseline.unresolved} unresolved`);

const backup = backupGraphDir('baseline');

// Pass 1: incremental ensureFresh (no force)
console.log('pass 1: ensureFresh({ force: false })...');
await ensureFresh({ repoRoot, force: false });
const incremental = snapshot('incremental');
console.log(`incremental: ${incremental.nodes} nodes, ${incremental.edges} edges, ${incremental.unresolved} unresolved`);

// Restore for fair force comparison
restoreGraphDir(backup);

// Pass 2: force rebuild
console.log('pass 2: ensureFresh({ force: true })...');
await ensureFresh({ repoRoot, force: true });
const force = snapshot('force');
console.log(`force: ${force.nodes} nodes, ${force.edges} edges, ${force.unresolved} unresolved`);

// Diff
const inOnlyIncremental = [...incremental.edgeKeys].filter((k) => !force.edgeKeys.has(k));
const inOnlyForce = [...force.edgeKeys].filter((k) => !incremental.edgeKeys.has(k));
const inBoth = [...incremental.edgeKeys].filter((k) => force.edgeKeys.has(k));

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const reportPath = join(process.cwd(), 'docs', 'dogfood', `p0-convergence-diagnosis-${timestamp}.md`);
mkdirSync(join(process.cwd(), 'docs', 'dogfood'), { recursive: true });

const report = `# P0 convergence diagnosis — ${timestamp}

Repo: \`${repoRoot}\`

## Counts

| State | Nodes | Edges | Unresolved (manifest.dirtyEdgeCount) |
|---|---|---|---|
| Baseline | ${baseline.nodes} | ${baseline.edges} | ${baseline.unresolved} |
| After incremental | ${incremental.nodes} | ${incremental.edges} | ${incremental.unresolved} |
| After force | ${force.nodes} | ${force.edges} | ${force.unresolved} |

**Incremental → Force delta on unresolved:** ${incremental.unresolved} → ${force.unresolved} (${force.unresolved - incremental.unresolved >= 0 ? '+' : ''}${force.unresolved - incremental.unresolved})

## Edge set divergence

| Set | Count |
|---|---|
| In both | ${inBoth.length} |
| Incremental only (force dropped these) | ${inOnlyIncremental.length} |
| Force only (incremental missed these) | ${inOnlyForce.length} |

### Sample: edges incremental has but force dropped (first 20)

${inOnlyIncremental.slice(0, 20).map((k) => '- `' + k + '`').join('\n') || '_(none)_'}

### Sample: edges force has but incremental missed (first 20)

${inOnlyForce.slice(0, 20).map((k) => '- `' + k + '`').join('\n') || '_(none)_'}

## Unresolved sample — incremental

${incremental.unresolvedSample.slice(0, 10).map((r) => `- ${r.relation} "${r.target}" [${r.extractor}] at ${r.source_file}`).join('\n') || '_(none)_'}

## Unresolved sample — force

${force.unresolvedSample.slice(0, 10).map((r) => `- ${r.relation} "${r.target}" [${r.extractor}] at ${r.source_file}`).join('\n') || '_(none)_'}

## Interpretation hints

- If **incremental-only edges** are non-empty → incremental is carrying forward edges that force rebuild no longer produces (stale pointers surviving rename/delete)
- If **force-only edges** are non-empty → incremental misses resolutions the fresh rebuild finds (the earlier hypothesis)
- If **both deltas are non-empty** → bidirectional drift; neither state is canonical
- If **counts diverge but edge-key sets don't** → the difference is entirely in external/unresolved materialization, check External nodes

Diff each sample manually before proposing a fix. The bug class (forward drift vs backward drift) determines whether the right fix is "re-examine all edges on incremental" or "warm-start force from incremental state."
`;

writeFileSync(reportPath, report);

const jsonPath = reportPath.replace(/\.md$/, '.json');
writeFileSync(jsonPath, JSON.stringify({
  repoRoot, timestamp,
  baseline: { nodes: baseline.nodes, edges: baseline.edges, unresolved: baseline.unresolved },
  incremental: { nodes: incremental.nodes, edges: incremental.edges, unresolved: incremental.unresolved, unresolvedSample: incremental.unresolvedSample },
  force: { nodes: force.nodes, edges: force.edges, unresolved: force.unresolved, unresolvedSample: force.unresolvedSample },
  edgeDivergence: {
    bothCount: inBoth.length,
    incrementalOnlyCount: inOnlyIncremental.length,
    forceOnlyCount: inOnlyForce.length,
    incrementalOnlySample: inOnlyIncremental.slice(0, 50),
    forceOnlySample: inOnlyForce.slice(0, 50),
  },
}, null, 2));

console.log('');
console.log(`wrote ${reportPath}`);
console.log(`wrote ${jsonPath}`);
console.log('');
console.log(`summary: incremental_unresolved=${incremental.unresolved} force_unresolved=${force.unresolved} delta=${force.unresolved - incremental.unresolved}`);
console.log(`edge divergence: incremental_only=${inOnlyIncremental.length} force_only=${inOnlyForce.length}`);
