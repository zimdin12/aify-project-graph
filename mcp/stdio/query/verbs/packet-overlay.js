// packet:overlay — reading fields off features/tasks and building their packet bodies.
//
// Extracted from packet.js in Phase 0 slice 1. MECHANICAL MOVE ONLY.
//
// AUTHORITY: given an already-resolved feature or task, produce its packet body. It does not
// resolve targets, does not decide budget, and does not seal — the facade owns all three.
//
// ⛔ NEVER IMPORT packet.js, and never export anything that renders a WHOLE packet: an exported
// whole-packet renderer is precisely the unsealed escape dev predicted would arrive "for
// testability", bypassing withSealScope/sealPacketOutput while focused tests stay green.
import { clampList, boundedList } from './packet-lists.js';
import { trustTier } from './packet-input.js';

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

function modeRisks(mode) {
  if (mode === 'debug') return ['debug mode — verify dirty source, repro path, and adjacent tests first'];
  if (mode === 'review') return ['review mode — do not approve from graph alone; verify diff, callers, and tests'];
  if (mode === 'audit') return ['audit mode — check contracts, test anchors, task linkage, and stale snapshot risk'];
  if (mode === 'plan') return ['plan mode — read contracts before editing and keep live graph calls surgical'];
  return [];
}

export function buildFeaturePacket({ feature, brief, functionality, opts, snapshot }) {
  const featureLabels = [feature.id];
  for (const dep of (feature.depends_on || []).slice(0, 3)) featureLabels.push(`dep:${dep}`);

  const readFirst = clampList(readFirstFromFeature(feature, brief?.features), opts.read_first);
  const contracts = clampList(contractsFromFeature(feature), opts.contracts);
  const tests = clampList(testsFromFeature(feature), opts.tests);
  const risks = clampList([...modeRisks(opts.mode), ...risksForFeature(feature, brief)], opts.risks);

  const lines = [
    `FEATURE: ${feature.label || feature.id}`,
    `MODE: ${opts.mode}`,
    `STATUS: overlay-defined (${feature.source || 'user'} source)`,
    `FEATURES: ${featureLabels.join(', ')}`,
    snapshot,
    boundedList('READ FIRST', readFirst, (x) => `${x.file} — ${x.why}`),
    boundedList('CONTRACTS', contracts, (x) => x),
    boundedList('TESTS', tests, (x) => x),
    boundedList('RISKS', risks, (x) => x),
  ];
  return lines;
}

export function buildTaskPacket({ task, functionality, brief, opts, snapshot }) {
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
  const risks = clampList([...modeRisks(opts.mode), ...risksForTask(task, brief)], opts.risks);

  const lines = [
    `TASK: ${task.title || task.id}`,
    `MODE: ${opts.mode}`,
    `STATUS: ${status}${linkStrength ? ` (${linkStrength})` : ''}`,
    `FEATURES: ${featureIds.length ? featureIds.join(', ') : '(unlinked)'}`,
    snapshot,
    boundedList('READ FIRST', readFirst, (x) => `${x.file} — ${x.why}`),
    boundedList('CONTRACTS', contracts, (x) => x),
    boundedList('TESTS', tests, (x) => x),
    boundedList('RISKS', risks, (x) => x),
  ];
  return lines;
}
