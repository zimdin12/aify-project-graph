import { join } from 'node:path';
import { openExistingDb } from '../../storage/db.js';
import { getDirtyFiles } from '../../freshness/git.js';
import { loadManifest } from '../../freshness/manifest.js';
import { getUnresolvedCounts } from '../../freshness/unresolved-metrics.js';
import { featuresForFile, loadFunctionality } from '../../overlay/loader.js';
import { loadTasksArtifact, summarizeDirtySeams, summarizeOverlayQuality } from '../../overlay/quality.js';
import { selectBestRoot } from './path.js';
import { computeDecision } from './preflight.js';
import { expandClassRollupTargets } from './target_rollup.js';
import { buildAmbiguousMatchMessage, resolveSymbol } from './symbol_lookup.js';
import { inspectReadFreshness, prefixReadWarnings } from './read_freshness.js';

const SEARCH_TYPES = ['Function', 'Method', 'Class', 'Interface', 'Type', 'Test', 'Route', 'Entrypoint'];
const INCOMING_RELATIONS = ['CALLS', 'REFERENCES', 'INVOKES', 'PASSES_THROUGH'];
const OUTGOING_RELATIONS = ['CALLS', 'USES_TYPE', 'REFERENCES', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS', 'INVOKES', 'PASSES_THROUGH'];

function placeholders(values, prefix) {
  return {
    sql: values.map((_, index) => `$${prefix}${index}`).join(','),
    params: Object.fromEntries(values.map((value, index) => [`${prefix}${index}`, value])),
  };
}

function fileDir(filePath) {
  if (!filePath || !filePath.includes('/')) return '';
  return filePath.slice(0, filePath.lastIndexOf('/'));
}

function trustLine(dirtyCount) {
  if (dirtyCount > 100) return `TRUST WEAK — ${dirtyCount} unresolved edges in graph`;
  if (dirtyCount > 0) return `TRUST OK — ${dirtyCount} unresolved edges in graph`;
  return 'TRUST STRONG — 0 unresolved edges';
}

function groupByFile(rows, fileKey, labelKey, relationKey) {
  const grouped = new Map();

  for (const row of rows) {
    const file = row[fileKey];
    if (!file) continue;
    const existing = grouped.get(file) ?? {
      file,
      count: 0,
      labels: new Set(),
      relations: new Set(),
      line: row.line ?? row.start_line ?? row.source_line ?? 0,
    };
    existing.count += 1;
    if (row[labelKey]) existing.labels.add(row[labelKey]);
    if (row[relationKey]) existing.relations.add(row[relationKey]);
    if (!existing.line || (row.line ?? row.start_line ?? row.source_line ?? 0) < existing.line) {
      existing.line = row.line ?? row.start_line ?? row.source_line ?? 0;
    }
    grouped.set(file, existing);
  }

  return [...grouped.values()].sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
}

function buildReadOrder({ root, targetFiles, callerFiles, dependencyFiles, testFiles, limit }) {
  const items = [];
  const seen = new Set();

  const push = (file, reason) => {
    if (!file || seen.has(file) || items.length >= limit) return;
    seen.add(file);
    items.push({ file, reason });
  };

  targetFiles.forEach((file, index) =>
    push(file, index === 0 ? 'target definition' : 'paired definition or implementation'));
  callerFiles.forEach((entry) =>
    push(entry.file, `top caller file (${entry.count} incoming edge${entry.count === 1 ? '' : 's'})`));
  dependencyFiles.forEach((entry) =>
    push(entry.file, `top dependency file (${entry.count} outgoing edge${entry.count === 1 ? '' : 's'})`));
  testFiles.forEach((entry) =>
    push(entry.file, `test anchor (${entry.count} covering edge${entry.count === 1 ? '' : 's'})`));

  return items;
}

export function buildChangePlan(db, { symbol, top_k = 6, dirtyCount = 0 }) {
  return buildChangePlanWithContext(db, { symbol, top_k, dirtyCount });
}

export function buildChangePlanWithContext(db, {
  symbol,
  top_k = 6,
  dirtyCount = 0,
  features = [],
  dirtyFiles = [],
  overlayQuality = null,
}) {
  const typesClause = SEARCH_TYPES.map((type) => `'${type}'`).join(',');
  const candidates = resolveSymbol(db, symbol, typesClause);
  if (candidates.length === 0) {
    return `NO MATCH for "${symbol}". Try graph_search(query="${symbol}") to find similar names.`;
  }
  const ambiguity = buildAmbiguousMatchMessage(symbol, candidates);
  if (ambiguity) return ambiguity;

  const root = selectBestRoot(candidates);
  const rollup = expandClassRollupTargets(db, symbol);
  const targetIds = rollup.targetIds.length > 0 ? rollup.targetIds : [root.id];
  const { sql, params } = placeholders(targetIds, 'target');

  const incomingRows = db.all(
    `SELECT e.from_id, e.relation, e.confidence, n.label AS from_label, n.file_path AS from_file, n.start_line AS line
     FROM edges e
     JOIN nodes n ON n.id = e.from_id
     WHERE e.to_id IN (${sql}) AND e.relation IN (${INCOMING_RELATIONS.map((type) => `'${type}'`).join(',')})
     ORDER BY e.confidence DESC`,
    params,
  );
  const outgoingRows = db.all(
    `SELECT e.to_id, e.relation, e.confidence, n.label AS to_label, n.file_path AS to_file, n.start_line AS line
     FROM edges e
     JOIN nodes n ON n.id = e.to_id
     WHERE e.from_id IN (${sql}) AND e.relation IN (${OUTGOING_RELATIONS.map((type) => `'${type}'`).join(',')})
     ORDER BY e.confidence DESC`,
    params,
  );
  const testRows = db.all(
    `SELECT n.label AS test_label, n.file_path AS test_file, n.start_line AS line, e.confidence
     FROM edges e
     JOIN nodes n ON n.id = e.from_id
     WHERE e.to_id IN (${sql}) AND e.relation = 'TESTS'
     ORDER BY e.confidence DESC`,
    params,
  );

  const targetFiles = [...new Set(
    candidates
      .filter((node) => targetIds.includes(node.id))
      .map((node) => node.file_path)
      .filter(Boolean),
  )].sort((a, b) => {
    if (a === root.file_path) return -1;
    if (b === root.file_path) return 1;
    return a.localeCompare(b);
  });

  const callerFiles = groupByFile(incomingRows, 'from_file', 'from_label', 'relation')
    .filter((entry) => !targetFiles.includes(entry.file))
    .slice(0, top_k);
  const dependencyFiles = groupByFile(outgoingRows, 'to_file', 'to_label', 'relation')
    .filter((entry) => entry.file && !targetFiles.includes(entry.file))
    .slice(0, top_k);
  const testFiles = groupByFile(testRows, 'test_file', 'test_label', 'confidence').slice(0, top_k);

  const callerCount = new Set(incomingRows.map((row) => row.from_id)).size;
  const crossModule = new Set(callerFiles.map((entry) => fileDir(entry.file))).size > 1;
  const decision = computeDecision({
    callerCount,
    testCount: testFiles.length,
    dirtyCount,
    crossModule,
    confidence: root.confidence ?? 1.0,
  });

  const readOrder = buildReadOrder({
    root,
    targetFiles,
    callerFiles,
    dependencyFiles,
    testFiles,
    limit: top_k,
  });
  const affectedFiles = [...new Set([
    ...targetFiles,
    ...callerFiles.map((entry) => entry.file),
    ...dependencyFiles.map((entry) => entry.file),
    ...testFiles.map((entry) => entry.file),
  ])].slice(0, Math.max(top_k, 6));
  const affectedFeatureIds = new Set(targetFiles.flatMap((file) => featuresForFile(features, file)));
  const dirtySeams = summarizeDirtySeams(features, dirtyFiles);
  const dirtyFeatureMatches = dirtySeams.features.filter((feature) => affectedFeatureIds.has(feature.id));
  const directDirtyFiles = targetFiles.filter((file) => dirtyFiles.includes(file));

  const lines = [];
  lines.push(`CHANGE_PLAN ${root.label} ${(root.type ?? 'unknown').toLowerCase()} ${root.file_path}:${root.start_line}`);
  if (rollup.rolledUp) lines.push(rollup.header);
  lines.push(trustLine(dirtyCount));
  if (overlayQuality?.featureCount) {
    lines.push(
      `MAP QUALITY tests ${overlayQuality.featuresWithTests}/${overlayQuality.featureCount} · docs ${overlayQuality.featuresWithDocs}/${overlayQuality.featureCount} · deps ${overlayQuality.featuresWithDependsOn}/${overlayQuality.featureCount} · related ${overlayQuality.featuresWithRelatedTo}/${overlayQuality.featureCount}${overlayQuality.tasksTotal > 0 ? ` · linked tasks ${overlayQuality.linkedTasks}/${overlayQuality.tasksTotal}` : ''}`,
    );
  }
  if (directDirtyFiles.length > 0 || dirtyFeatureMatches.length > 0) {
    const parts = [];
    if (directDirtyFiles.length > 0) parts.push(`target dirty: ${directDirtyFiles.join(', ')}`);
    if (dirtyFeatureMatches.length > 0) {
      parts.push(`feature seam: ${dirtyFeatureMatches.slice(0, 3).map((f) => `${f.id}(${f.file_count})`).join(', ')}`);
    }
    lines.push(`DIRTY SEAM — ${parts.join(' · ')}`);
  }
  lines.push(`RISK ${decision.tier} — ${decision.reason}`);
  lines.push(`SIGNALS ${callerCount} caller(s), ${dependencyFiles.length} dependency file(s), ${testFiles.length} test file(s)`);
  lines.push('READ ORDER');
  readOrder.forEach((step, index) => {
    lines.push(`${index + 1}. ${step.file} — ${step.reason}`);
  });
  if (callerFiles.length > 0) {
    lines.push('TOP CALLER FILES');
    callerFiles.slice(0, top_k).forEach((entry) => {
      lines.push(`- ${entry.file} — ${entry.count} incoming edge${entry.count === 1 ? '' : 's'}`);
    });
  }
  if (testFiles.length > 0) {
    lines.push('TEST ANCHORS');
    testFiles.slice(0, top_k).forEach((entry) => {
      lines.push(`- ${entry.file} — ${entry.count} covering edge${entry.count === 1 ? '' : 's'}`);
    });
  }
  lines.push('AFFECTED FILES');
  affectedFiles.forEach((file) => lines.push(`- ${file}`));

  return lines.join('\n');
}

export async function graphChangePlan({ repoRoot, symbol, top_k = 6 }) {
  if (!symbol) return 'ERROR: symbol parameter is required';
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_change_plan' });
  if (freshness.blocker) return freshness.blocker;
  const graphDir = join(repoRoot, '.aify-graph');
  const { manifest } = await loadManifest(graphDir);
  const { trust: dirtyCount } = getUnresolvedCounts(manifest);
  const functionality = loadFunctionality(repoRoot);
  const tasksArtifact = loadTasksArtifact(repoRoot);
  const overlayQuality = summarizeOverlayQuality(functionality.features ?? [], tasksArtifact.tasks ?? []);
  const dirtyFiles = await getDirtyFiles(repoRoot).catch(() => []);

  const db = openExistingDb(join(graphDir, 'graph.sqlite'));
  try {
    return prefixReadWarnings(
      buildChangePlanWithContext(db, {
        symbol,
        top_k,
        dirtyCount,
        features: functionality.features ?? [],
        dirtyFiles,
        overlayQuality,
      }),
      freshness.warnings,
    );
  } finally {
    db.close();
  }
}
