// graph_packet — single-call agent prompt packet for a task or feature.
//
// Architectural rule (locked in 2026-04-25 upgrade plan v2):
// presentation/orchestration primitive only, NOT a new graph engine.
// Composes existing trusted sources in priority order:
//   1. task / feature overlay (static JSON, fast)
//   2. brief / health / trust state (static JSON, fast)
//   3. optional narrow live enrichment (only if cheap, budgeted,
//      explicit-skip-on-timeout)
// Output is a fixed-schema markdown string designed for prompt-cache
// stability. The packet must remain useful even when LIVE enrichment
// is skipped or times out — overlay-first value is the milestone.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Section caps come first; the final token-estimate clamp is a safety
// rail. Predictable shape → prompt-cache friendly.
const DEFAULTS = {
  features: 6,
  read_first: 8,
  contracts: 6,
  tests: 6,
  risks: 6,
  budget_tokens: 800,
};

const CHAR_PER_TOKEN_EST = 4; // rough; matches our existing brief-budget heuristic

function esTokens(s) { return Math.ceil((s || '').length / CHAR_PER_TOKEN_EST); }

function loadJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function readBrief(repoRoot) {
  const path = join(repoRoot, '.aify-graph', 'brief.json');
  return loadJsonSafe(path);
}

function readFunctionality(repoRoot) {
  const path = join(repoRoot, '.aify-graph', 'functionality.json');
  return loadJsonSafe(path);
}

function readTasks(repoRoot) {
  const path = join(repoRoot, '.aify-graph', 'tasks.json');
  return loadJsonSafe(path);
}

function readManifest(repoRoot) {
  const path = join(repoRoot, '.aify-graph', 'manifest.json');
  return loadJsonSafe(path);
}

function safeGitHead(repoRoot) {
  try {
    return execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

function safeDirtyCount(repoRoot) {
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter((l) => l.trim()).length;
  } catch { return 0; }
}

function trustTier(unresolvedEdges) {
  if (unresolvedEdges == null) return 'missing';
  if (unresolvedEdges < 200) return 'strong';
  if (unresolvedEdges < 800) return 'ok';
  return 'weak';
}

// Parse `feature:<id>` / `feature/<id>` / `task:<id>` / `task/<id>` shapes.
// Bare ids are auto-detected against the loaded overlay/tasks.
function parseTarget(target) {
  if (typeof target !== 'string' || !target) return { kind: 'unknown', value: target };
  const m = target.match(/^(feature|task)[:/](.+)$/i);
  if (m) return { kind: m[1].toLowerCase(), value: m[2].trim() };
  return { kind: null, value: target };
}

function findFeature(functionality, value) {
  const features = functionality?.features ?? [];
  return features.find((f) => f.id === value)
    || features.find((f) => (f.label || '').toLowerCase() === value.toLowerCase());
}

function findTask(tasksArtifact, value) {
  const tasks = tasksArtifact?.tasks ?? [];
  return tasks.find((t) => t.id === value);
}

// ----- enrichment helpers (overlay-first) -----

function readFirstFromFeature(feature, briefFeatures) {
  // Prefer the brief's enriched feature data (already has top callers /
  // primary-file shape). Fall back to feature.anchors.files.
  const enriched = (briefFeatures?.valid ?? []).find((v) => v.feature?.id === feature.id);
  if (enriched) {
    const items = [];
    const primary = enriched.resolved?.files?.[0];
    const sym = enriched.resolved?.symbols?.[0];
    if (primary) items.push({ file: primary, why: sym ? `defines ${sym}` : 'feature primary file' });
    for (const f of (enriched.resolved?.files || []).slice(1)) {
      items.push({ file: f, why: 'feature anchor file' });
    }
    return items;
  }
  return (feature.anchors?.files || []).map((f) => ({ file: f, why: 'feature anchor (glob)' }));
}

function readFirstFromTask(task, functionality) {
  const items = [];
  // task.files_hint takes priority — agent-curated
  for (const f of (task.files_hint || [])) {
    items.push({ file: f, why: 'task files_hint' });
  }
  // then anchored files of each linked feature
  for (const fid of (task.features || task.related_features || [])) {
    const feature = functionality?.features?.find((x) => x.id === fid);
    if (!feature) continue;
    for (const f of (feature.anchors?.files || []).slice(0, 3)) {
      items.push({ file: f, why: `feature ${fid} anchor` });
    }
  }
  return items;
}

function contractsFromFeature(feature) {
  const out = [];
  for (const c of (feature.contracts || [])) out.push(c);
  for (const d of (feature.anchors?.docs || [])) {
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

function testsFromFeature(feature) {
  return (feature.tests || []).slice();
}

function risksForFeature(feature, brief) {
  const risks = [];
  // No explicit tests anchored
  if (!(feature.tests || []).length && !(feature.anchors?.tests || []).length) {
    risks.push('no curated test anchor — verify coverage');
  }
  // Broad anchor count (high-fan-in feature is harder to audit)
  const fileCount = (feature.anchors?.files || []).length;
  if (fileCount >= 5) risks.push(`broad file anchor (${fileCount} globs) — change blast radius wide`);
  // Trust gate
  const trust = trustTier(brief?.repo?.unresolved_edges ?? brief?.unresolved ?? null);
  if (trust === 'weak') risks.push('graph trust=weak — verify in source before acting');
  return risks;
}

function risksForTask(task, brief) {
  const risks = [];
  if (!(task.features || task.related_features || []).length) {
    risks.push('task has no feature link — coverage unknown');
  }
  if ((task.status || '').toLowerCase().includes('block')) {
    risks.push(`task status reads blocked: ${task.status}`);
  }
  const trust = trustTier(brief?.repo?.unresolved_edges ?? brief?.unresolved ?? null);
  if (trust === 'weak') risks.push('graph trust=weak — verify in source before acting');
  return risks;
}

function snapshotLine(brief, manifest, repoRoot) {
  const indexed = manifest?.commit ?? brief?.graph_commit ?? '?';
  const head = safeGitHead(repoRoot) ?? '?';
  const dirty = safeDirtyCount(repoRoot);
  const unresolved = manifest?.dirtyEdgeCount ?? manifest?.dirtyEdges?.length ?? null;
  const trust = trustTier(unresolved);
  const stale = indexed !== '?' && head !== '?' && indexed !== head ? ' STALE' : '';
  return `SNAPSHOT: indexed=${shortSha(indexed)} head=${shortSha(head)} dirty=${dirty} trust=${trust}${stale}`;
}

function shortSha(s) {
  if (typeof s !== 'string') return '?';
  return s === '?' ? '?' : s.slice(0, 7);
}

// ----- packet renderer -----

function renderLines(out) {
  return out.filter(Boolean).join('\n');
}

function clampList(items, cap) {
  if (!items || items.length === 0) return { items: [], total: 0, truncated: false };
  return {
    items: items.slice(0, cap),
    total: items.length,
    truncated: items.length > cap,
  };
}

function renderListSection(label, capped, formatter) {
  if (capped.items.length === 0) return null;
  const head = `${label}:`;
  const rows = capped.items.map((x) => `- ${formatter(x)}`);
  if (capped.truncated) rows.push(`- (${capped.total - capped.items.length} more — narrow target)`);
  return [head, ...rows].join('\n');
}

function buildFeaturePacket({ feature, brief, functionality, opts, snapshot }) {
  const featureLabels = [feature.id];
  for (const dep of (feature.depends_on || []).slice(0, 3)) featureLabels.push(`dep:${dep}`);

  const readFirst = clampList(readFirstFromFeature(feature, brief?.features), opts.read_first);
  const contracts = clampList(contractsFromFeature(feature), opts.contracts);
  const tests = clampList(testsFromFeature(feature), opts.tests);
  const risks = clampList(risksForFeature(feature, brief), opts.risks);

  const lines = [
    `FEATURE: ${feature.label || feature.id}`,
    `STATUS: overlay-defined (${feature.source || 'user'} source)`,
    `FEATURES: ${featureLabels.join(', ')}`,
    snapshot,
    renderListSection('READ FIRST', readFirst, (x) => `${x.file} — ${x.why}`),
    renderListSection('CONTRACTS', contracts, (x) => x),
    renderListSection('TESTS', tests, (x) => x),
    renderListSection('RISKS', risks, (x) => x),
  ];
  return lines;
}

function buildTaskPacket({ task, functionality, brief, opts, snapshot }) {
  const featureIds = task.features || task.related_features || [];
  const status = task.status || 'unknown';
  const linkStrength = featureIds.length === 0
    ? 'unlinked'
    : (task.link_strength || (featureIds.length > 1 ? 'strong' : 'mixed'));

  const readFirst = clampList(readFirstFromTask(task, functionality), opts.read_first);
  // contracts: union of contracts from all linked features
  const contractsSet = new Set();
  for (const fid of featureIds) {
    const f = functionality?.features?.find((x) => x.id === fid);
    if (!f) continue;
    for (const c of contractsFromFeature(f)) contractsSet.add(c);
  }
  const contracts = clampList([...contractsSet], opts.contracts);
  // tests: union from features
  const testsSet = new Set();
  for (const fid of featureIds) {
    const f = functionality?.features?.find((x) => x.id === fid);
    if (!f) continue;
    for (const t of testsFromFeature(f)) testsSet.add(t);
  }
  const tests = clampList([...testsSet], opts.tests);
  const risks = clampList(risksForTask(task, brief), opts.risks);

  const lines = [
    `TASK: ${task.title || task.id}`,
    `STATUS: ${status}${linkStrength ? ` (${linkStrength})` : ''}`,
    `FEATURES: ${featureIds.length ? featureIds.join(', ') : '(unlinked)'}`,
    snapshot,
    renderListSection('READ FIRST', readFirst, (x) => `${x.file} — ${x.why}`),
    renderListSection('CONTRACTS', contracts, (x) => x),
    renderListSection('TESTS', tests, (x) => x),
    renderListSection('RISKS', risks, (x) => x),
  ];
  return lines;
}

function clampToBudget(text, budgetTokens) {
  // Final safety rail: if assembled output exceeds budget, drop optional
  // tail sections in priority order until under budget.
  const lines = text.split('\n');
  const sectionStarts = ['RISKS:', 'TESTS:', 'CONTRACTS:'];
  while (esTokens(lines.join('\n')) > budgetTokens) {
    let dropped = false;
    for (const head of sectionStarts) {
      const idx = lines.findIndex((l) => l.startsWith(head));
      if (idx === -1) continue;
      // Drop section: from head until next blank/non-list line
      let end = idx + 1;
      while (end < lines.length && (lines[end].startsWith('-') || lines[end] === '')) end += 1;
      lines.splice(idx, end - idx);
      lines.push(`(${head.slice(0, -1)} dropped — over budget)`);
      dropped = true;
      break;
    }
    if (!dropped) break; // can't shrink further
  }
  return lines.join('\n');
}

// ----- main -----

export function graphPacket({ repoRoot, target, budget = DEFAULTS.budget_tokens, live = false }) {
  if (!target) return 'ERROR: target parameter is required (task:<id>, feature:<id>, or bare id)';
  if (!repoRoot) return 'ERROR: repoRoot parameter is required';

  const opts = { ...DEFAULTS, budget_tokens: budget };

  // Per architectural rule: read overlay + brief + manifest JSON directly.
  // No ensureFresh() call. No SQLite open. No verb dispatch. Static-first.
  const functionality = readFunctionality(repoRoot);
  const tasksArtifact = readTasks(repoRoot);
  const brief = readBrief(repoRoot);
  const manifest = readManifest(repoRoot);
  const snapshot = snapshotLine(brief, manifest, repoRoot);

  const parsed = parseTarget(target);

  // Resolve target
  let kind = parsed.kind;
  let resolvedFeature = null;
  let resolvedTask = null;
  if (kind === 'feature' || (!kind && functionality)) {
    resolvedFeature = findFeature(functionality, parsed.value);
    if (resolvedFeature) kind = 'feature';
  }
  if (!resolvedFeature && (kind === 'task' || !kind) && tasksArtifact) {
    resolvedTask = findTask(tasksArtifact, parsed.value);
    if (resolvedTask) kind = 'task';
  }

  if (!resolvedFeature && !resolvedTask) {
    return [
      `ERROR: target "${target}" not found as feature or task in overlay/tasks`,
      `HINT: list features in .aify-graph/functionality.json or tasks in .aify-graph/tasks.json`,
      `HINT: try the explicit form 'feature:<id>' or 'task:<id>'`,
      snapshot,
    ].join('\n');
  }

  let lines;
  if (resolvedFeature) {
    lines = buildFeaturePacket({ feature: resolvedFeature, brief, functionality, opts, snapshot });
  } else {
    lines = buildTaskPacket({ task: resolvedTask, functionality, brief, opts, snapshot });
  }

  // LIVE: status — overlay-first means "skipped under budget" by default.
  // Live enrichment is opt-in (live=true). When opted in, it would compose
  // a snapshot-accepting read of relations; not in v1 scope (deferred to
  // M3 latency-pass when readOnly:true verb path lands). For now mark
  // explicitly so the packet stays honest.
  lines.push(live
    ? 'LIVE: skipped_under_budget (live enrichment opt-in path lands in M3 alongside readOnly verb mode)'
    : 'LIVE: skipped_under_budget (overlay-first; pass live=true to enrich)');

  const text = renderLines(lines);
  return clampToBudget(text, opts.budget_tokens);
}
