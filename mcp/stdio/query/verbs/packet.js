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
  // Always render the section header — even when empty — so agents can
  // distinguish "broken packet" from "no data of this kind." Empty
  // sections render as `LABEL: none`. Validation gate found that silent
  // omission was confusing agents who treated absence as a packet bug.
  if (capped.items.length === 0) return `${label}: none`;
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

// ----- LIVE enrichment (M3) -----
//
// Called only when the caller passes live=true. Adds a small targeted
// enrichment block computed from existing read verbs, with a strict
// time budget. If the budget is exceeded the block aborts and we mark
// LIVE: timeout in the output. Errors mark LIVE: unavailable. Both keep
// the rest of the packet usable.
//
// Per M0.5 profile (docs/dogfood/latency-profile-2026-04-25.json) the
// read verbs themselves are <150ms on graphs up to ~9k nodes, so the
// budget is set well above that to give callers headroom but still
// catch pathological cases (unfresh state, disk slowness).

const LIVE_BUDGET_MS = 2000;

async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __timeout: true }), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function enrichLive({ repoRoot, target, kind, value, opts }) {
  // Lazy import so static-only callers never pay the import cost.
  const { graphConsequences } = await import('./consequences.js');
  const t0 = Date.now();

  // graph_consequences accepts symbol OR file path; for feature/task targets
  // we synthesize a representative file path from anchors when possible.
  // If we can't, skip enrichment with an explicit reason.
  let consequenceTarget = target;
  if (kind === 'feature' || kind === 'task') {
    // No bare-symbol path available without going through overlay anchors;
    // use the original target string and let consequences resolve it (works
    // for tasks because consequences has task lookup; works for features
    // when bare id matches a feature).
    consequenceTarget = value;
  }

  let raw;
  try {
    raw = await withTimeout(
      graphConsequences({ repoRoot, target: consequenceTarget }),
      LIVE_BUDGET_MS,
    );
  } catch (err) {
    return { status: 'unavailable', detail: err?.message ?? 'live verb threw', elapsed_ms: Date.now() - t0 };
  }
  if (raw && raw.__timeout) {
    return { status: 'timeout', detail: `live enrichment exceeded ${LIVE_BUDGET_MS}ms`, elapsed_ms: Date.now() - t0 };
  }

  let parsed = null;
  try {
    if (typeof raw === 'object' && raw !== null) parsed = raw;
    else if (typeof raw === 'string') parsed = JSON.parse(raw);
  } catch {
    // graph_consequences returns plain markdown for NO MATCH and other
    // user-friendly messages — not a real error. Treat as "no enrichment
    // available for this target" rather than a verb failure.
    if (typeof raw === 'string' && /^NO MATCH|^ERROR|^GRAPH/i.test(raw.trim())) {
      return { status: 'unavailable', detail: 'no live data for this target', elapsed_ms: Date.now() - t0 };
    }
    return { status: 'unavailable', detail: 'live verb returned non-JSON', elapsed_ms: Date.now() - t0 };
  }
  // Defensive: parsed could be null/undefined or missing expected fields
  if (!parsed || typeof parsed !== 'object') {
    return { status: 'unavailable', detail: 'live verb returned no usable data', elapsed_ms: Date.now() - t0 };
  }

  // Pull only the enrichment fields packet doesn't already have from
  // overlay. Keeps the LIVE block small.
  const enriched = {
    status: 'enriched',
    elapsed_ms: Date.now() - t0,
    last_touched: (parsed.last_touched ?? []).slice(0, 3).map((c) => `${c.sha} ${c.date} ${c.subject ?? ''}`),
    co_consumer_files: (parsed.co_consumer_files ?? []).slice(0, opts.read_first ?? 3),
  };
  return enriched;
}

// ----- main -----

export async function graphPacket({ repoRoot, target, budget = DEFAULTS.budget_tokens, live = false }) {
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

  // Bare symbol/file fallback (M3 follow-up — addresses validation-gate
  // finding that PLAN/IMPACT tasks couldn't use packet because targets
  // were function names, not feature/task ids).
  // Strategy: ask graph_consequences to map the symbol to its containing
  // feature, then build the packet from that feature with a MATCHED VIA
  // line preserving the original target.
  let matchedViaSymbol = null;
  if (!resolvedFeature && !resolvedTask) {
    const { graphConsequences } = await import('./consequences.js');
    let mapped;
    try {
      const raw = await withTimeout(
        graphConsequences({ repoRoot, target: parsed.value }),
        LIVE_BUDGET_MS,
      );
      if (raw && !raw.__timeout) {
        // graphConsequences returns an object directly (not a JSON string),
        // unlike some other verbs. Handle both shapes defensively.
        if (typeof raw === 'object') mapped = raw;
        else if (typeof raw === 'string' && raw.trim().startsWith('{')) {
          mapped = JSON.parse(raw);
        }
      }
    } catch {/* fall through to error message */}

    const featureHit = mapped?.features_touching?.[0];
    if (featureHit) {
      resolvedFeature = findFeature(functionality, featureHit.id);
      kind = 'feature';
      matchedViaSymbol = parsed.value;
    }
  }

  if (!resolvedFeature && !resolvedTask) {
    return [
      `ERROR: target "${target}" not found as feature, task, or symbol mapping to a feature`,
      `HINT: list features in .aify-graph/functionality.json or tasks in .aify-graph/tasks.json`,
      `HINT: try the explicit form 'feature:<id>' or 'task:<id>'`,
      `HINT: bare function/file targets need to map to a known feature via graph_consequences first`,
      snapshot,
    ].join('\n');
  }

  let lines;
  if (resolvedFeature) {
    lines = buildFeaturePacket({ feature: resolvedFeature, brief, functionality, opts, snapshot });
  } else {
    lines = buildTaskPacket({ task: resolvedTask, functionality, brief, opts, snapshot });
  }
  if (matchedViaSymbol) {
    // Insert MATCHED VIA right after the FEATURE/TASK header so the agent
    // knows the packet is symbol-derived, not direct.
    lines.splice(1, 0, `MATCHED VIA: symbol "${matchedViaSymbol}" → feature ${resolvedFeature.id}`);
  }

  // LIVE: enrichment block. M3 landed: when live=true we run a budgeted
  // graph_consequences call and append the cheap-to-compute fields
  // (last_touched, co_consumer_files) that overlay JSON can't give us.
  // Strict 2s budget. Timeout / unavailable both still leave the rest
  // of the packet usable.
  if (live) {
    const enrich = await enrichLive({
      repoRoot,
      target,
      kind,
      value: resolvedFeature?.id ?? resolvedTask?.id ?? parsed.value,
      opts,
    });
    if (enrich.status === 'enriched') {
      lines.push(`LIVE: enriched (${enrich.elapsed_ms}ms)`);
      if (enrich.last_touched.length) {
        lines.push('LAST TOUCHED:');
        for (const c of enrich.last_touched) lines.push(`- ${c}`);
      }
      if (enrich.co_consumer_files.length) {
        lines.push('CO-CONSUMER FILES:');
        for (const f of enrich.co_consumer_files) {
          const path = typeof f === 'string' ? f : (f.file ?? JSON.stringify(f));
          lines.push(`- ${path}`);
        }
      }
    } else {
      lines.push(`LIVE: ${enrich.status} (${enrich.detail}; ${enrich.elapsed_ms}ms)`);
    }
  } else {
    lines.push('LIVE: skipped_under_budget (overlay-first; pass live=true to enrich)');
  }

  const text = renderLines(lines);
  return clampToBudget(text, opts.budget_tokens);
}
