import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openExistingDb } from '../../storage/db.js';
import { loadManifest } from '../../freshness/manifest.js';
import { getUnresolvedCounts } from '../../freshness/unresolved-metrics.js';
import { featuresForFile, loadFunctionality } from '../../overlay/loader.js';
import { loadTasksArtifact, summarizeDirtySeams, summarizeOverlayQuality } from '../../overlay/quality.js';
import { selectBestRoot } from './path.js';
import { computeDecision } from './preflight.js';
import { computeCompileDbCoverage } from '../../code-intel/compile-db.js';
import { expandClassRollupTargets } from './target_rollup.js';
import { buildAmbiguousMatchMessage, resolveSymbol } from './symbol_lookup.js';
import { inspectReadFreshness, prefixReadWarnings } from './read_freshness.js';
import { getCodeIntelEvidenceForSymbol } from '../../code-intel/query.js';
import { buildTrustLine } from '../lsp-evidence.js';
import { noMatchMessage } from '../did-you-mean.js';

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

// SECONDARY qualifier (cohesion fix R2/C2). The HEADLINE trust line now comes
// from buildTrustLine (lsp-verified/lsp-partial/heuristic axis) so change_plan
// speaks the SAME trust vocabulary as the rest of the product. The edge-count
// axis below is kept as a graph-completeness qualifier on its own line.
function edgeCompletenessQualifier(dirtyCount) {
  if (dirtyCount > 100) return `GRAPH COMPLETENESS WEAK — ${dirtyCount} unresolved edges in graph`;
  if (dirtyCount > 0) return `GRAPH COMPLETENESS OK — ${dirtyCount} unresolved edges in graph`;
  return 'GRAPH COMPLETENESS STRONG — 0 unresolved edges';
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

function findSourceOccurrenceFiles(db, repoRoot, symbol, excludeFiles = []) {
  if (!symbol) return [];
  let candidateFiles = db.all(
    `SELECT DISTINCT file_path
     FROM nodes
     WHERE type = 'File' AND language != '' AND file_path != ''`
  )
    .map((row) => row.file_path)
    .filter((filePath) => !excludeFiles.includes(filePath));
  if (candidateFiles.length === 0) {
    try {
      candidateFiles = execFileSync(
        'git',
        ['-C', repoRoot, 'ls-files'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      )
        .split('\n')
        .map((line) => line.trim())
        .filter((filePath) => filePath && !filePath.startsWith('.aify-graph/') && !excludeFiles.includes(filePath));
    } catch {
      candidateFiles = [];
    }
  }
  if (candidateFiles.length === 0) return [];

  try {
    const out = execFileSync(
      'rg',
      ['-l', '-w', '--fixed-strings', symbol, '--', ...candidateFiles],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
    );
    return out.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch (err) {
    if (typeof err?.status === 'number' && err.status === 1) return [];
    return [];
  }
}

function upgradeDecisionForWeakTrustOccurrenceGap({ decision, callerCount, dirtyCount, sourceOccurrenceFiles }) {
  if (dirtyCount <= 100 || callerCount > 1 || sourceOccurrenceFiles.length <= 1) return decision;

  if (sourceOccurrenceFiles.length >= 10) {
    return {
      tier: 'CONFIRM',
      reason: `Graph shows ${callerCount} caller(s) but symbol text appears in ${sourceOccurrenceFiles.length} code files under weak trust — confirm scope with file reads.`,
    };
  }

  if (decision.tier === 'SAFE') {
    return {
      tier: 'REVIEW',
      reason: `Graph shows ${callerCount} caller(s) but symbol text appears in ${sourceOccurrenceFiles.length} code files under weak trust — verify caller scope in source before editing.`,
    };
  }

  return decision;
}

function buildSignalsCaveat({ dirtyCount, callerCount, sourceOccurrenceFiles }) {
  if (dirtyCount <= 100) return '';
  if (sourceOccurrenceFiles.length === 0) return '';
  if (callerCount > 0 && sourceOccurrenceFiles.length <= callerCount * 2) return '';
  return ' (raw indexed edges; weak trust may understate caller scope — see source-occurrence count)';
}

export function buildChangePlan(db, { symbol, top_k = 6, dirtyCount = 0 }) {
  return buildChangePlanWithContext(db, { symbol, top_k, dirtyCount });
}

export async function buildChangePlanWithContext(db, {
  symbol,
  top_k = 6,
  dirtyCount = 0,
  features = [],
  dirtyFiles = [],
  overlayQuality = null,
  sourceOccurrenceFiles = [],
  repoRoot = null,
}) {
  const typesClause = SEARCH_TYPES.map((type) => `'${type}'`).join(',');
  const candidates = resolveSymbol(db, symbol, typesClause);
  if (candidates.length === 0) {
    return noMatchMessage(db, symbol);
  }
  const ambiguity = buildAmbiguousMatchMessage(symbol, candidates);
  if (ambiguity) return ambiguity;

  const root = selectBestRoot(candidates);
  const rollup = expandClassRollupTargets(db, symbol);
  const targetIds = rollup.targetIds.length > 0 ? rollup.targetIds : [root.id];
  const { sql, params } = placeholders(targetIds, 'target');

  const incomingRows = db.all(
    `SELECT e.from_id, e.relation, e.confidence, e.provenance, n.label AS from_label, n.file_path AS from_file, n.start_line AS line
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
  const additionalOccurrenceFiles = sourceOccurrenceFiles.filter((file) => !targetFiles.includes(file));
  const callerCount = new Set(incomingRows.map((row) => row.from_id)).size;
  const signalsCaveat = buildSignalsCaveat({
    dirtyCount,
    callerCount,
    sourceOccurrenceFiles: additionalOccurrenceFiles,
  });

  // ⛔ TOTALS BEFORE THE CAP. Found by ef-manager's sweep for "an array is capped, then
  // the CAPPED array's length is emitted as a count" — the third instance of the class,
  // after symbol_lookup's candidate list and graph_packet's DEFINED IN.
  //
  // ⚠ SEVERITY, STATED ACCURATELY — my first write-up of this overstated it and the
  // correction is worth keeping. I claimed the cap "fed the RISK VERDICT". It does reach
  // computeDecision as `testCount`, but that function branches only on `testCount === 0`
  // vs `> 0` (preflight.js:173, :208), and slicing a non-empty array never yields an
  // empty one — so THE TIER COULD NEVER CHANGE. A test asserting the verdict moved was
  // vacuous, and passed with the defect reinstated.
  //
  // I then retreated to "it reaches the reason string" (preflight.js:209) and could not
  // reach that branch either. ⇒ The only DEMONSTRATED consequence is the SIGNALS line.
  //
  // The testCount change below stays anyway — handing a display cap to a decision function
  // is wrong independently of whether today's thresholds happen to be insensitive to it —
  // but it is defence in depth, not a defect with a shown consequence.
  //
  // The cap stays — it is a display budget and it is fine as one. What it must not do is
  // stand in for the population.
  const callerFilesAll = groupByFile(incomingRows, 'from_file', 'from_label', 'relation')
    .filter((entry) => !targetFiles.includes(entry.file));
  const dependencyFilesAll = groupByFile(outgoingRows, 'to_file', 'to_label', 'relation')
    .filter((entry) => entry.file && !targetFiles.includes(entry.file));
  const testFilesAll = groupByFile(testRows, 'test_file', 'test_label', 'confidence');
  const callerFiles = callerFilesAll.slice(0, top_k);
  const dependencyFiles = dependencyFilesAll.slice(0, top_k);
  const testFiles = testFilesAll.slice(0, top_k);
  const crossModule = new Set(callerFiles.map((entry) => fileDir(entry.file))).size > 1;
  // R2-2026-05-31 (BUG 2) — the caller set is "lsp-verified" only when at least
  // one incoming caller edge is clangd ground truth. A heuristic-only caller set
  // must not earn a SAFE-to-proceed verdict (cross-TU dispatch is undercounted).
  const callersHaveLspEvidence = incomingRows.some((row) => row.provenance === 'LSP_VERIFIED');
  let coverageComplete = true;
  let coverageReason = '';
  try {
    // Only a FOREIGN/UNITY DB downgrades a pre-collected lsp-verified caller set
    // (a DB absent at query time must not flip SAFE→REVIEW).
    const cov = computeCompileDbCoverage({ projectRoot: repoRoot });
    if (cov && cov.complete === false && (cov.foreignToolchain || cov.unityUnexpanded)) {
      coverageComplete = false; coverageReason = cov.reason || '';
    }
  } catch { /* defensive — treat as complete */ }
  const decision = upgradeDecisionForWeakTrustOccurrenceGap({
    decision: computeDecision({
      callerCount,
      testCount: testFilesAll.length, // the POPULATION, never the display cap
      dirtyCount,
      crossModule,
      confidence: root.confidence ?? 1.0,
      callersHaveLspEvidence,
      coverageComplete,
      coverageReason,
    }),
    callerCount,
    dirtyCount,
    sourceOccurrenceFiles: additionalOccurrenceFiles,
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

  // HEADLINE trust line — lsp-verified/lsp-partial/heuristic axis, the SAME
  // vocabulary the product doctrine + server-instructions + lean default train
  // the agent on. Derived from the provenance of the incoming (caller) edges so
  // an LSP_VERIFIED caller set reads as ground truth. Edge-count completeness is
  // demoted to a SECONDARY qualifier below.
  const incomingTrustEdges = incomingRows.map((row) => ({ provenance: row.provenance ?? 'EXTRACTED' }));
  let headlineTrust = '';
  try {
    headlineTrust = await buildTrustLine({ edges: incomingTrustEdges, db, repoRoot });
  } catch { /* defensive — never block the plan on trust-line failure */ }

  const lines = [];
  lines.push(`CHANGE_PLAN ${root.label} ${(root.type ?? 'unknown').toLowerCase()} ${root.file_path}:${root.start_line}`);
  if (rollup.rolledUp) lines.push(rollup.header);
  if (headlineTrust) lines.push(headlineTrust);
  lines.push(edgeCompletenessQualifier(dirtyCount));
  if (overlayQuality?.featureCount) {
    const taskLinkSummary = [
      `${overlayQuality.strongTaskLinks ?? 0} strong`,
      `${overlayQuality.mixedTaskLinks ?? 0} mixed`,
      `${overlayQuality.broadTaskLinks ?? 0} broad`,
    ].filter(Boolean).join(', ');
    lines.push(
      `MAP QUALITY tests ${overlayQuality.featuresWithTests}/${overlayQuality.featureCount} · docs ${overlayQuality.featuresWithDocs}/${overlayQuality.featureCount} · deps ${overlayQuality.featuresWithDependsOn}/${overlayQuality.featureCount} · related ${overlayQuality.featuresWithRelatedTo}/${overlayQuality.featureCount}${overlayQuality.tasksTotal > 0 ? ` · linked tasks ${overlayQuality.linkedTasks}/${overlayQuality.tasksTotal}` : ''}${taskLinkSummary ? ` · task links ${taskLinkSummary}` : ''}`,
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
  const shown = (all, cap) => (all.length > cap.length ? `${cap.length} of ${all.length}` : `${all.length}`);
  lines.push(`SIGNALS ${callerCount} caller(s), ${shown(dependencyFilesAll, dependencyFiles)} dependency file(s), ${shown(testFilesAll, testFiles)} test file(s)${additionalOccurrenceFiles.length > 0 ? `, ${additionalOccurrenceFiles.length} source-occurrence file(s)` : ''}${signalsCaveat}`);
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
  if (additionalOccurrenceFiles.length > 0) {
    lines.push('SOURCE OCCURRENCE FILES');
    additionalOccurrenceFiles.slice(0, top_k).forEach((file) => {
      lines.push(`- ${file}`);
    });
  }
  lines.push('AFFECTED FILES');
  affectedFiles.forEach((file) => lines.push(`- ${file}`));

  return lines.join('\n');
}

// Structured change-plan output (Plan #3). Returns an object with:
//   { affected: { items: [{ file, provenance, confidence }] },
//     code_intel_used: boolean }
// Code-intel-backed items appear first (provenance='CODE_INTEL'), then any
// tree-sitter / graph-edge derived files (provenance='EXTRACTED'). Tree-sitter
// occurrences are kept as fallback INFERRED-or-EXTRACTED provenance.
//
// Companion to graphChangePlan() (text formatter); both share the same
// underlying signals — this one is for programmatic consumers (Plan #4
// packet v2 + verify mode).
export async function changePlan({ repoRoot, symbol, top_k = 6 }) {
  if (!symbol) return { error: 'symbol parameter is required', code_intel_used: false, affected: { items: [] } };
  const graphDir = join(repoRoot, '.aify-graph');
  const dbPath = join(graphDir, 'graph.sqlite');

  let codeIntelUsed = false;
  const codeIntelItems = [];
  const seen = new Set();

  // Try code-intel first (compiler-backed). Cheap when present.
  try {
    const db = openExistingDb(dbPath);
    try {
      const evidence = getCodeIntelEvidenceForSymbol(db, { qname: String(symbol) });
      if (evidence.found) {
        codeIntelUsed = true;
        for (const r of evidence.references) {
          if (r.file && !seen.has(r.file)) {
            seen.add(r.file);
            codeIntelItems.push({
              file: r.file,
              provenance: 'CODE_INTEL',
              confidence: r.confidence || 'high',
            });
          }
        }
        for (const d of evidence.definitions) {
          if (d.file && !seen.has(d.file)) {
            seen.add(d.file);
            codeIntelItems.push({
              file: d.file,
              provenance: 'CODE_INTEL',
              confidence: d.confidence || 'high',
              role: 'definition',
            });
          }
        }
      }
    } finally { db.close(); }
  } catch { /* fall back, leave codeIntelItems empty */ }

  // Tree-sitter / graph-edge derived files (existing change_plan ranking
  // signal). We attach them as EXTRACTED provenance after the CODE_INTEL
  // items. Skipped if the graph DB isn't openable.
  const extractedItems = [];
  try {
    const db = openExistingDb(dbPath);
    try {
      const typesClause = SEARCH_TYPES.map((type) => `'${type}'`).join(',');
      const candidates = resolveSymbol(db, symbol, typesClause);
      if (candidates.length > 0) {
        const root = selectBestRoot(candidates);
        const rollup = expandClassRollupTargets(db, symbol);
        const targetIds = rollup.targetIds.length > 0 ? rollup.targetIds : [root.id];
        const { sql, params } = placeholders(targetIds, 'target');
        const incoming = db.all(
          `SELECT DISTINCT n.file_path AS from_file
           FROM edges e JOIN nodes n ON n.id = e.from_id
           WHERE e.to_id IN (${sql}) AND e.relation IN (${INCOMING_RELATIONS.map((t) => `'${t}'`).join(',')})`,
          params,
        );
        for (const row of incoming) {
          if (row.from_file && !seen.has(row.from_file)) {
            seen.add(row.from_file);
            extractedItems.push({ file: row.from_file, provenance: 'EXTRACTED', confidence: 'medium' });
          }
        }
      }
    } finally { db.close(); }
  } catch { /* ignore */ }

  const items = [...codeIntelItems, ...extractedItems].slice(0, Math.max(top_k, 6));
  return {
    symbol,
    code_intel_used: codeIntelUsed,
    affected: { items },
  };
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
  // ⛔ ONE GIT OBSERVATION PER READ, NOT TWO. inspectReadFreshness above already ran
  // `git status` and printed a warning about the result; this line ran it AGAIN, moments later,
  // and swallowed a failure into []. Two queries for one question is the shape of the field
  // report this whole area exists to answer — one verb said "592 dirty" and another "4 dirty"
  // for the same tree at the same commit, and the reader could not tell which was lying. Sharing
  // the observation makes disagreement unconstructible rather than merely unlikely.
  //
  // ⚠ NO `dirtyFilesKnown` HERE, AND THAT IS A DECISION RATHER THAN AN OMISSION. This verb renders
  // TEXT (see the lines.join below), so its reader always sees the prose warning the freshness
  // channel prints. A second machine-readable flag would have no consumer — and an unused flag
  // whose comment claims it does the work is how a defect hides behind its own documentation.
  const dirtyFiles = freshness.dirtyFiles;

  const db = openExistingDb(join(graphDir, 'graph.sqlite'));
  try {
    const sourceOccurrenceFiles = findSourceOccurrenceFiles(db, repoRoot, symbol, []);
    return prefixReadWarnings(
      await buildChangePlanWithContext(db, {
        symbol,
        top_k,
        dirtyCount,
        features: functionality.features ?? [],
        dirtyFiles,
        overlayQuality,
        sourceOccurrenceFiles,
        repoRoot,
      }),
      freshness.warnings,
    );
  } finally {
    db.close();
  }
}
