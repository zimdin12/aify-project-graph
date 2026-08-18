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
import { computeTrustLevel } from './health.js';
import { getTrackedDirtyFilesSync } from '../../freshness/git.js';
import { getUnresolvedCounts } from '../../freshness/unresolved-metrics.js';
import { assessOverlayBuild, overlayNotBuiltHint } from '../../overlay/quality.js';
import { getPacketTokenBudget } from '../response-budget.js';
import { openExistingDb } from '../../storage/db.js';
import { resolveSymbolWithTotal, languageCensusExact } from './symbol_lookup.js';
// The governed-list machinery lives in its own module so routes in THIS file cannot reach
// the admission primitive. See packet-lists.js for why that had to stop being a choice.
import {
  clampList, boundedList, boundedListAll, candidateList, symbolList,
  exactly, atLeast, unknownPopulation, renderCandidateDisclosures,
  withSealScope, sealPacketOutput, renderPacketLines, clampOccurrences,
} from './packet-lists.js';

// Re-exported: these were part of packet.js's surface before the extraction and existing
// importers (tests, and the seal's own fixtures) still name them here.
export {
  renderCandidateDisclosures, extractListBlocks, sealPacketOutput, withSealScope, SEAL_CAVEAT,
  candidateList, symbolList, boundedList, boundedListAll, renderPacketLines,
  exactly, atLeast, unknownPopulation, _disclosureRenderCount,
} from './packet-lists.js';

// Definitions grouped by language, over ALL nodes rather than the displayed slice.
// Falls back to the file extension when the language column is empty, so a repo indexed
// before languages were recorded still gets a breakdown instead of a blank one.
function countByLanguage(nodes) {
  const counts = new Map();
  for (const n of nodes) {
    const ext = (n.file_path || '').split('.').pop();
    const key = n.language || (ext && ext !== n.file_path ? ext : 'unknown');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Largest group first: the dominant mirror set is the one a reader must act on.
  return [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([lang, count]) => ({ lang, count }));
}

// ★ SYMBOL→FEATURE DOES NOT NEED THE FULL CONSEQUENCES TRAVERSAL.
//
// Measured (ef-manager, echoes, 2026-08-10): ALL THREE bare symbols tried —
// SimCoordinator, WorldBuffer, GpuMaterial — blew the 2000ms budget. Not an edge
// case: graph_packet's bare-symbol path was non-functional on a 12k-node C++ repo,
// which is the repo class this verb exists to serve.
//
//   graphConsequences round-trip:  601ms @ 3,958 nodes · 4316ms @ 12,126 nodes
//
// The fix is not a bigger budget — that moves the cliff and leaves the reader
// unable to tell which side they are on. It is to stop asking an expensive
// question. graphConsequences computes callers, importers, documents_mentioning,
// tasks, tests, git history, risk flags and a receipt. To answer "which feature
// owns this symbol" none of that is needed: resolve the label, then check which
// feature anchors it. Two cheap steps against data already in hand.
//
// The full traversal is still one NEXT line away for a reader who wants it.
function resolveFeatureForSymbolCheap(repoRoot, functionality, symbol) {
  if (!symbol || !functionality?.features?.length) return null;
  let db;
  try {
    db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    // ⛔ `nodes` is capped at 50 by the retrieval query; `resolvedTotal` is the COUNT.
    // Reporting nodes.length as the total was the same cap-as-total defect this whole
    // change exists to remove, one level upstream — caught by graph-senior-dev-hermes.
    const { rows: nodes, total: resolvedTotal } = resolveSymbolWithTotal(db, symbol);
    // ⇒ UNCAPPED census where the exact-label predicate applies; null (=> SAMPLED) otherwise.
    // An exact total must never lend its authority to a composition built from the page.
    const exactCensus = languageCensusExact(db, symbol);
    const censusIsExact = Boolean(exactCensus);
    const census = exactCensus ?? countByLanguage(nodes);
    if (!nodes.length) return null;

    const matchedSymbols = new Set(nodes.map((n) => n.label).filter(Boolean));
    const matchedFiles = new Set(nodes.map((n) => n.file_path).filter(Boolean));

    // Same anchor semantics as consequences, deliberately — a different rule here
    // would make the cheap path and the full path disagree about the same repo.
    for (const f of functionality.features) {
      const symbolHit = (f.anchors?.symbols ?? []).some((s) => matchedSymbols.has(s));
      const fileHit = (f.anchors?.files ?? []).some((pattern) => (
        pattern.endsWith('/*')
          ? [...matchedFiles].some((p) => p.startsWith(pattern.slice(0, -1)))
          : matchedFiles.has(pattern)
      ));
      if (symbolHit || fileHit) {
        return {
          feature: f,
          // ★ locationsTotal is NOT decoration. The slice below is a display cap, and
          // without the true count the renderer printed the CAP as the total —
          // "UNRANKED (3 matches)" for a symbol with nine definitions. Same class as
          // the symbol_lookup candidate defect: a limit reported as a finding.
          locationsTotal: resolvedTotal,
          // ★★ BY LANGUAGE, because for a mirrored type the COUNT IS THE FINDING.
          // ef-manager, echoes: `GpuMaterial` is 16 definitions — 1 C++ header and 15 GLSL
          // shaders on a shared std430 stride, where every copy must agree or
          // materialPalette[id] addresses the wrong entry for every material above 0. A
          // fixed cap treats N definitions as a list to SAMPLE; here N is a property of
          // the symbol and the property is the hazard.
          locationsByLanguage: census, locationsCensusExact: censusIsExact,
          locations: nodes.slice(0, 3).map((n) => ({
            file: n.file_path, line: n.start_line, type: n.type,
          })),
        };
      }
    }
    return { feature: null, locationsTotal: resolvedTotal, locationsByLanguage: census, locationsCensusExact: censusIsExact, locations: nodes.slice(0, 3).map((n) => ({
      file: n.file_path, line: n.start_line, type: n.type,
    })) };
  } catch {
    return null; // fall through to the budgeted path; never make orientation fail
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

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
const PACKET_MODES = new Set(['orient', 'plan', 'debug', 'review', 'audit', 'verify']);

const MODE_OVERRIDES = {
  orient: {},
  plan: { read_first: 10, contracts: 8, tests: 8, risks: 8 },
  debug: { read_first: 10, tests: 10, risks: 8 },
  review: { read_first: 8, contracts: 8, tests: 10, risks: 10 },
  audit: { read_first: 10, contracts: 10, tests: 10, risks: 12 },
  verify: { read_first: 8, contracts: 4, tests: 8, risks: 8 },
};

function esTokens(s) { return Math.ceil((s || '').length / CHAR_PER_TOKEN_EST); }

// Budget precedence: explicit arg > APG_PACKET_BUDGET env > repo-size tier.
// Returns { budgetTokens, caps } where caps scales the list/section limits with
// repo size (monotonic — never shrinks as the repo grows). A fixed budget
// starves big repos: a god-file gets truncated and the agent re-Reads it.
export function resolvePacketBudget({ explicit, env, nodeCount }) {
  const tier = getPacketTokenBudget(nodeCount);
  // Accept only positive finite numbers; trim env so a stray ' ' (which
  // Number() coerces to 0) doesn't silently gut every packet.
  const asPositive = (v) => {
    if (v == null) return null;
    const s = String(v).trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const budgetTokens = asPositive(explicit) ?? asPositive(env) ?? tier.budgetTokens;
  return { budgetTokens, caps: tier.caps };
}

function normalizeMode(mode) {
  const value = typeof mode === 'string' ? mode.trim().toLowerCase() : 'orient';
  return PACKET_MODES.has(value) ? value : 'orient';
}

function optionsForMode(mode, budgetTokens) {
  return {
    ...DEFAULTS,
    ...(MODE_OVERRIDES[mode] ?? {}),
    budget_tokens: budgetTokens,
    mode,
  };
}

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
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
  } catch { return null; }
}

// SNAPSHOT `dirty=` is a TRUST number: it tells the agent whether the indexed
// source can still be believed. It therefore counts tracked modifications only,
// via the same shared helper the read-verb warning uses.
//
// This used to shell out to `git status --porcelain` and count every line —
// untracked files and ignored-dir noise included. Field report: `dirty=592` on a
// tree with zero tracked modifications, while the read-verb warning (correctly)
// said nothing. The agent had two contradictory dirty counts for one tree and no
// way to tell which was load-bearing, so the honest banner lost credibility to
// the wrong one.
function safeDirtyCount(repoRoot) {
  try {
    return getTrackedDirtyFilesSync(repoRoot).length;
  } catch { return 0; }
}

function trustTier(unresolvedEdges) {
  // Reuse the shared computeTrustLevel from health.js so packet's SNAPSHOT
  // line never disagrees with graph_health on the same snapshot
  // (validation-gate bug 2). Returns 'missing' when count is unknown.
  if (unresolvedEdges == null) return 'missing';
  return computeTrustLevel(unresolvedEdges);
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

function modeRisks(mode) {
  if (mode === 'debug') return ['debug mode — verify dirty source, repro path, and adjacent tests first'];
  if (mode === 'review') return ['review mode — do not approve from graph alone; verify diff, callers, and tests'];
  if (mode === 'audit') return ['audit mode — check contracts, test anchors, task linkage, and stale snapshot risk'];
  if (mode === 'plan') return ['plan mode — read contracts before editing and keep live graph calls surgical'];
  return [];
}

function snapshotLine(brief, manifest, repoRoot) {
  const indexed = manifest?.commit ?? brief?.graph_commit ?? '?';
  const head = safeGitHead(repoRoot) ?? '?';
  const dirty = safeDirtyCount(repoRoot);
  // Use the SAME getUnresolvedCounts() health.js uses, which prefers
  // trust-relevant count (manifest.trustDirtyEdgeCount) over the raw
  // total. Without this, packet's SNAPSHOT trust line disagreed with
  // graph_health on the same snapshot (final-bench bug 1).
  const { trust: trustCount } = getUnresolvedCounts(manifest ?? {});
  const trust = manifest ? trustTier(trustCount) : 'missing';
  const stale = indexed !== '?' && head !== '?' && indexed !== head ? ' STALE' : '';
  return `SNAPSHOT: indexed=${shortSha(indexed)} head=${shortSha(head)} dirty=${dirty} trust=${trust}${stale}`;
}

function shortSha(s) {
  if (typeof s !== 'string') return '?';
  return s === '?' ? '?' : s.slice(0, 7);
}

// ----- packet renderer -----




function buildFeaturePacket({ feature, brief, functionality, opts, snapshot }) {
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

// Find the [start, end) line range of a section whose header is `head`
// (e.g. "TESTS:"). The body is the run of `- ` list items (and blank lines)
// following the header. Returns null when the section isn't present.
function findSectionRange(lines, head) {
  const idx = lines.findIndex((l) => l.startsWith(head));
  if (idx === -1) return null;
  let end = idx + 1;
  while (end < lines.length && (lines[end].startsWith('- ') || lines[end] === '')) end += 1;
  return { idx, end };
}

// Tier-1 skeletonize: collapse list items in a section that share a leading
// directory prefix into one summary line, e.g.
//   - src/auth/login.js — anchor
//   - src/auth/logout.js — anchor
//   - src/auth/session.js — anchor
// becomes:
//   - 3 items under src/auth/* (+ first shown) ...
// We keep the first item verbatim (so the agent still has a concrete read) and
// summarize the rest sharing that directory. Returns true when it collapsed
// anything.
function skeletonizeSection(lines, range) {
  const body = lines.slice(range.idx + 1, range.end).filter((l) => l.startsWith('- '));
  if (body.length <= 2) return false;
  // Extract a path-ish token (first whitespace/em-dash-delimited field) per row.
  const dirOf = (line) => {
    const text = line.slice(2).trim();
    const pathTok = text.split(/\s+—\s+|\s+/)[0] ?? '';
    const slash = pathTok.lastIndexOf('/');
    return slash > 0 ? pathTok.slice(0, slash) : null;
  };
  const groups = new Map();
  for (const line of body) {
    const dir = dirOf(line);
    const key = dir ?? `__nodir__:${line}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }
  // Only worth collapsing if at least one dir-group has >= 2 members.
  const collapsible = [...groups.entries()].some(([k, v]) => !k.startsWith('__nodir__:') && v.length >= 2);
  if (!collapsible) return false;

  const newBody = [];
  for (const [key, members] of groups) {
    if (key.startsWith('__nodir__:') || members.length < 2) {
      newBody.push(...members);
      continue;
    }
    // Keep the first member concrete; summarize the rest.
    newBody.push(members[0]);
    newBody.push(`- ${members.length - 1} more under ${key}/* (collapsed — over budget)`);
  }
  lines.splice(range.idx + 1, range.end - (range.idx + 1), ...newBody);
  return true;
}

// Tier-2 collapse: replace a section's body with a single header+count line
// instead of deleting the section, preserving the signal that data exists.
function collapseSectionToCount(lines, head) {
  const range = findSectionRange(lines, head);
  if (!range) return false;
  const count = lines.slice(range.idx + 1, range.end).filter((l) => l.startsWith('- ')).length;
  if (count === 0) return false;
  lines.splice(range.idx, range.end - range.idx, `${head} ${count} omitted (over budget)`);
  return true;
}

export function clampToBudget(text, budgetTokens, targetSection = null) {
  // Skeletonize-before-drop (codegraph #564/#569): size to the answer, not the
  // cap. Three tiers, applied in escalating order, NEVER touching the section
  // that contains the packet target:
  //   Tier-1 — collapse list items sharing a directory prefix into a summary.
  //   Tier-2 — keep header + omitted-count instead of deleting the body.
  //   Tier-3 — drop the section entirely (last rail only).
  const lines = text.split('\n');
  // Priority order: trim the least-load-bearing sections first.
  //
  // ⛔ CLAMPABLE SECTIONS MUST BE BOUNDED KINDS ONLY, AND THAT IS NOW ENFORCED RATHER THAN
  // ASSUMED. skeletonizeSection REWRITES a section's rows into directory summaries. Do that
  // to a CANDIDATES block and its population line — "showing 3 of 9" — would go on describing
  // a row set that no longer exists: a false population claim manufactured by the budget
  // clamp, after the seal had already validated the packet. Nothing prevented it except this
  // array happening not to list a candidate head.
  //
  // ⚠ The clamp runs AFTER serialization by design (validating before it is what retired the
  // false-accusation class), so the seal cannot catch a clamp-introduced lie.
  //
  // ⇒ EVERY ENTRY BELOW MUST BE A BOUNDED KIND — one that makes no population claim. Enforced
  // by tests/unit/query/packet-seal.test.js, which reads this array and checks each head
  // against BOUNDED_KINDS. That test is the guard; I first wrote a runtime .filter() here too
  // and removed it, because mutation showed deleting the filter alone changes nothing
  // observable — it only ever mattered in combination with adding a candidate head, which the
  // test already catches. A safeguard that cannot be falsified on its own is decoration.
  const sectionHeads = ['RISKS:', 'TESTS:', 'CONTRACTS:', 'READ FIRST:'];
  const isTarget = (head) => targetSection && head.startsWith(targetSection);

  if (esTokens(lines.join('\n')) <= budgetTokens) return lines.join('\n');

  // Tier-1: skeletonize every non-target section once.
  for (const head of sectionHeads) {
    if (isTarget(head)) continue;
    const range = findSectionRange(lines, head);
    if (range) skeletonizeSection(lines, range);
    if (esTokens(lines.join('\n')) <= budgetTokens) return lines.join('\n');
  }

  // Tier-2: collapse non-target sections to header+count.
  for (const head of sectionHeads) {
    if (isTarget(head)) continue;
    collapseSectionToCount(lines, head);
    if (esTokens(lines.join('\n')) <= budgetTokens) return lines.join('\n');
  }

  // Tier-3 (last rail): drop non-target sections entirely.
  for (const head of sectionHeads) {
    if (isTarget(head)) continue;
    const range = findSectionRange(lines, head);
    if (!range) continue;
    lines.splice(range.idx, range.end - range.idx, `(${head.slice(0, -1)} dropped — over budget)`);
    if (esTokens(lines.join('\n')) <= budgetTokens) return lines.join('\n');
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

// ⛔ A SAMPLE LENGTH IS NOT A POPULATION, AND ABSENCE IS NOT ZERO-DIFFERENCE.
//
// Both consumers below used to read `matched?.symbols_total ?? symHits.length`. That `??`
// conflates two states that must never render alike:
//   1. a producer that MEASURED the population and found total === sample.length;
//   2. a producer that omitted it, or does not know.
// While `symbols_total` was (wrongly) deleted from graphConsequences, this fallback silently
// substituted the sample for the population and printed "UNRANKED (3 matches)" on a repo with
// NINE definitions. The tests did not merely miss the deletion — the fallback absorbed it and
// manufactured a confident wrong number in its place.
//
// graph-senior-dev-hermes's ruling, which this implements: fail closed. `symHits.length` is a
// display count, not a population authority. A total is usable ONLY when producer-attested and
// internally consistent; anything else is `unknown`, and a boolean cannot mint a count.
//
// ★ ONE resolver, used by BOTH call sites deliberately. Two parallel fallbacks are how one
// path gets repaired while the other stays fail-open — which is exactly what happened here
// once already: I fixed the no-feature branch and the feature branch kept the bug for a day.
// ★★ ONE RENDERER FOR CANDIDATE/DEFINITION LISTS, CONSUMED BY EVERY BRANCH.
//
// ef-manager, after the third per-branch fix: "I would stop patching branches. Three fixes to
// three branches of one verb, and comparing the two survivors immediately surfaced a fourth
// divergence." They were right, and the fourth was real — both branches printed the
// CROSS-LANGUAGE DUPLICATE finding, only ONE carried the FLOOR caveat, on the same verb, same
// symbol, same repo content. A disclosure added where someone was burned, not to its sibling.
//
// ⇒ The structural version closes the CLASS instead of the instances: population, omitted
// count, duplicate finding, floor caveat and next-verb are assembled in one place, so a new
// branch cannot be born missing them. That makes the next "third route" impossible rather than
// findable.
//
// ⚠ The floor caveat's MECHANISM is gated on the languages actually present — also their
// correction. The CONDITION (a cross-language duplicate) is language-generic; naming
// `R"(...)"` is C++/GLSL-specific and would be noise on a Python/TypeScript duplicate. The
// general claim is what always holds; the example appears only where it applies.
// ⛔ THE ROUTE INVENTORY COULD NOT SEE A FIFTH ROUTE, AND graph-senior-dev-hermes PROVED IT
// BY WRITING ONE. They inserted a branch inside graphPacket returning a bare
// `CANDIDATES:\n- src/hidden.cpp:1` — a real reader-facing list that never touches the
// renderer — and packet-route-inventory.test.js still passed 2/2.
//
// ★ The reason is structural, not a bug in the regex: that test groups header emissions by
// TOP-LEVEL FUNCTION and passes the function if `renderCandidateDisclosures(` appears
// anywhere inside it. graphPacket is 396 lines and already contains a renderer call, so
// every new branch added to it inherits credit it did not earn. My claim — "NO route shows
// a symbol list without reaching renderCandidateDisclosures()" — was true of functions and
// false of routes, which is precisely the distinction the fourth route taught me.
//
// ⇒ A source inventory cannot fix this: attributing a header to the code path that reaches
// it is dataflow, not pattern matching. So the guarantee moves to RUNTIME, at the one
// boundary every route must pass through. This counter is the instrument: the seal compares
// it either side of a call, so a route that emits a list without consulting the renderer is
// caught by the fact that it never ran, no matter which branch produced it.
// ⛔ THE FIRST VERSION OF THIS COUNTER WAS MODULE-GLOBAL, AND I DEFENDED IT WITH AN
// ASSUMPTION I HAD NOT CHECKED: "not worth AsyncLocalStorage until a parallel caller
// exists." A parallel caller already existed — the shipped server. mcp/stdio/server.js does
// `rl.on('line', async (line) => ...)` with no queue, mutex or in-flight tracking anywhere,
// and readline does not await an async listener before emitting the next line. Two
// pipelined tool calls interleave by construction.
//
// ★ Deterministic repro of the hole, no async needed: call A (a disclosure-less route)
// snapshots the count, call B renders, call A seals — A sees the count advanced and passes.
// I ran exactly that and the seal let `CANDIDATES:\n- src/hidden.cpp:1` through untouched.
// The "it can only ever produce a FALSE PASS" defence was true and worthless: a false pass
// is the entire defect this seal exists to prevent.
//
// ⇒ Each graphPacket invocation gets its own scope, so a renderer call made by one packet
// cannot satisfy another. The global counter is kept for observability only and is no
// longer what the seal reads.






export function resolvePopulation(total, sampleLength) {
  // `>= sampleLength` because a total smaller than the sample we are holding is not a total,
  // it is a contradiction — and a contradicting field must not be trusted merely for existing.
  if (Number.isInteger(total) && total >= sampleLength) return { attested: true, total };
  return { attested: false, total: null };
}

// FIX 3: build a compact pointer packet for a bare symbol that the graph knows
// but which maps to no feature/task. Returns a markdown string, or null when
// the symbol is genuinely unknown to the graph (caller then emits the hard
// "not found" error — the honest outcome for a typo).
//
// `consequences` is whatever graph_consequences returned for the symbol: a rich
// object (has matched.symbols / features_touching), or a human-readable string
// (AMBIGUOUS MATCH / NO MATCH). We extract file/candidate locations from either
// shape and steer the agent to the verbs that DO give symbol context.
// Cheap existence check: is there ANY code-intel collection to query? Recommending a
// compiler-backed verb on a repo that has never collected sends the reader to an empty answer.
function hasCodeIntelCollection(repoRoot) {
  try {
    const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      return Boolean(db.get('SELECT 1 AS x FROM code_intel_collections LIMIT 1')?.x);
    } finally { db.close(); }
  } catch { return false; }
}

function buildSymbolPointerPacket({ symbol, consequences, snapshot, codeIntelAvailable = false }) {
  const lines = [];
  // ⛔ THE LAST LINE USED TO BE UNCONDITIONAL, AND IT WAS WRONG TWICE OVER ON A JS REPO.
  // ef-manager, in the field: on a file-path target it emitted
  //   NEXT: code_intel_hierarchy(symbol="mcp/stdio/query/verbs/packet.js", kind="callers")
  //         — clangd call/override tree
  // A C++ verb recommended for JavaScript, AND a file path in a parameter named `symbol`.
  // It was also offered when graph_health had just reported no code-intel collection exists, so
  // the verb had nothing to answer with.
  //
  // ★ Advice that is not conditioned on whether it applies is the same defect as a disclosure
  // that does not state its basis: it costs the reader a call to find out it was never for them.
  const looksLikePath = /[\\/]/.test(symbol) || /\.[a-z0-9]{1,4}$/i.test(symbol);
  const readNext = [
    `NEXT: graph_pull(node="${symbol}") — cross-layer context for this symbol`,
    `NEXT: graph_consequences(target="${symbol}") — "what breaks if I touch it"`,
    `NEXT: graph_explore(symbols=["${symbol}"]) — verbatim source`,
    // Offered only when the target is symbol-shaped AND a collection exists to query.
    ...(looksLikePath || !codeIntelAvailable
      ? []
      : [`NEXT: code_intel_hierarchy(symbol="${symbol}", kind="callers") — compiler-backed call/override tree`]),
  ];

  if (consequences && typeof consequences === 'object') {
    const symHits = consequences.matched?.symbols ?? [];
    const fileHits = consequences.matched?.files ?? [];
    if (symHits.length === 0 && fileHits.length === 0) return null;
    lines.push(`SYMBOL: ${symbol}`);
    lines.push('STATUS: known to graph; not mapped to a feature (symbol-context packet)');
    lines.push(snapshot);
    // ★ THIS LIST IS TRUNCATED AND UNRANKED — SAY BOTH.
    //
    // Field report (ef-manager, echoes_of_the_fallen, 2026-08-09). `GpuMaterial`
    // has 16 hits: ONE authoritative C++ declaration and 15 GLSL mirrors. This
    // slice showed five shader copies and dropped the C++ declaration entirely,
    // while graph_whereis ranked the C++ one first. An agent trusting this list
    // would have gone and edited a shader copy.
    //
    // The cause is that `slice(0, 6)` is arrival order, not relevance — and the
    // packet never said so, which is what made a wrong first entry read as the
    // answer. Ranking properly belongs in graph_whereis, which already does it;
    // duplicating a heuristic here would give two rankings that can disagree.
    // So the packet states what it is: an unranked sample, with a pointer to the
    // verb that ranks. Silence about truncation is the defect, not the truncation.
    const SHOWN = 6;
    // ⚠ NOT pre-sliced any more. `clampList(locItems, SHOWN)` received a list ALREADY cut to
    // SHOWN, so `truncated` was structurally always false and its "(N more)" branch could never
    // fire — a safeguard that cannot execute, the same dead-instrument shape as an assertion
    // that cannot fail. Found by enumerating every symbol-list emitter in this file rather than
    // recalling them, after a FOURTH route turned up that I had never listed.
    const locItems = symHits.map((s) => ({
      file: s.file, why: `${s.type || 'symbol'}${s.line ? ` @ line ${s.line}` : ''}`,
    }));
    const definedRows = clampList(locItems, SHOWN);
    // ★★ REPORT THE TRUE TOTAL, NOT THE CAP.
    //
    // `symHits` is `matched.symbols`, which upstream is `pickPrimarySymbol(...)` sliced to
    // THREE. So `symHits.length > SHOWN` (6) was unreachable dead code, and the else
    // branch rendered "(3 matches)" on a repo with nine definitions — the cap reported as
    // the total, with no disclosure that anything had been dropped.
    //
    // That is the same defect ef-manager found in symbol_lookup's candidate list, one
    // layer up: a capped list whose consumer could not tell it had been capped. The old
    // test here asserted the template's spelling and could never have seen the number in
    // it was wrong.
    const pop = resolvePopulation(consequences.matched?.symbols_total, symHits.length);
    // ⛔ DEFINED IN USED TO BE A "BOUNDED" LIST — a kind that by definition states no
    // population — while the population was disclosed on SEPARATE LINES pushed after it.
    // graph-senior-dev, reading the output with no knowledge of the design, could not tell
    // whether one row meant one definition, a sample, or a floor. I had flagged the same seam
    // from the design side. Two independent routes to the same conclusion.
    //
    // ⇒ It is a symbol list now: the population is IN THE HEADER, derived from `pop`, and the
    // ranking caveat rides inside the same occurrence instead of beside it. Adjacency was the
    // defect — a reader does not owe the packet the assumption that a nearby line refers to
    // the list above it.
    const rankingNote = pop.attested && pop.total > 1
      ? [`  ⚠ UNRANKED — order is arrival, not relevance. graph_whereis(symbol="${symbol}") `
        + 'lists them; NEITHER verb ranks — do not treat the first entry as the definition.']
      : [];
    lines.push(symbolList(
      'DEFINED IN',
      definedRows.items.map((x) => `- ${x.file} — ${x.why}`),
      {
        symbol,
        population: pop.attested ? exactly(pop.total) : unknownPopulation(),
        languages: (consequences.matched?.symbols_by_language ?? []).map((b) => b.lang),
        notes: rankingNote,
      },
    ));
    // ⛔ THE FOURTH ROUTE, AND MY "ONE RENDERER FOR EVERY BRANCH" CLAIM WAS FALSE.
    //
    // This object-form branch consumed `matched.symbols` and the total but never
    // `matched.symbols_by_language`, and never called renderCandidateDisclosures(). dev's probe —
    // an unanchored symbol with 1 C++ and 15 GLSL definitions — got the population warning and
    // NO cross-language duplicate finding and NO floor caveat. The shared renderer closed the
    // divergence between the branches I had already looked at; it could not close a branch I had
    // never enumerated, and I asserted coverage over "every branch" without listing them.
    //
    // ⇒ Route identity, not just branch parity: this route now consumes the same renderer.
    lines.push(...renderCandidateDisclosures({
      shown: symHits.length,
      total: pop.attested ? pop.total : NaN,
      symbol,
      languages: (consequences.matched?.symbols_by_language ?? []).map((b) => b.lang),
      exact: consequences.matched?.symbols_census_exact !== false,
    }));
    if (fileHits.length) {
      // ALSO IN was bounded too, for the same reason and with the same consequence. Its
      // population IS known — fileHits.length — and it is shown capped at 6, so the header
      // now says which of those two numbers the reader is looking at.
      const shownHits = fileHits.slice(0, 6);
      lines.push(symbolList('ALSO IN', shownHits.map((f) => `- ${f}`), {
        symbol,
        population: exactly(fileHits.length),
      }));
    }
    lines.push(...readNext);
    return renderPacketLines(lines);
  }

  if (typeof consequences === 'string') {
    const trimmed = consequences.trim();
    // NO MATCH → the symbol is truly unknown; let the caller hard-error.
    if (/^NO MATCH/i.test(trimmed)) return null;
    // AMBIGUOUS MATCH (or any other informative string) → surface it verbatim
    // (it already lists the concrete candidate locations) plus the read-next.
    lines.push(`SYMBOL: ${symbol}`);
    // ★ "NO FEATURE MAPPING" WAS NEVER ESTABLISHED ON THIS PATH.
    //
    // Found by ef-manager (2026-08-09) while reviewing the timeout fix, and it is
    // the SAME defect 148 lines earlier — an unestablished negative rendered as a
    // fact about the code.
    //
    // This branch fires when graphConsequences returns a human-readable AMBIGUOUS
    // MATCH string. There is no features_touching in a string: consequences
    // short-circuits to candidates BEFORE computing one. So nothing here ever
    // looked for a feature — and the old wording claimed there was none.
    //
    // Disproved with data, not argued: `WorldBuffer` takes this exact path and is
    // anchors.symbols[0] of feature `world-buffer`. `GpuMaterial` likewise, of
    // `material-palette`. Both were being told they map to no feature.
    //
    // Worse than the timeout case in one respect: there, a lookup ran and failed.
    // Here nothing was attempted, and the output could not distinguish "we looked
    // and found none" from "ambiguity short-circuited before we looked". And by
    // the cost analysis this is the CHEAP path — the one large C++ repos land on
    // most often.
    lines.push('STATUS: known to graph; AMBIGUOUS — feature mapping NOT CHECKED');
    lines.push('  Ambiguity short-circuits the symbol→feature lookup, so this packet has NOT');
    lines.push('  established that the symbol maps to no feature. Do not read it as unmapped.');
    lines.push(snapshot);
    // ⛔ THE THIRD ROUTE. This branch kept the candidate rows and DROPPED the population that
    // was sitting in the same string. ef-manager, on real C++ with no overlay: `GpuMaterial`
    // printed five candidates with no count, no truncation marker and no cross-language
    // finding, while `graph_consequences` — the source of this very text — printed
    // "16 concrete candidates found", "SHOWING 5 OF 16 — 11 omitted" and the DUPLICATE finding
    // for the same symbol in the same repo. Eleven definitions silently absent, including the
    // sole C++ declaration.
    //
    // ★ Same cap-as-total defect fixed twice already in this verb, surviving in a THIRD branch:
    // a fix applied per-route does not cover the other routes reading the same data. And the
    // block is meticulous about a DIFFERENT unknown four lines up — it explains at length that
    // feature mapping was NOT CHECKED — so one unknown was disclosed with care while the other
    // was not disclosed at all.
    //
    // ⇒ Nothing is recomputed here. The population, the omission and the finding are carried
    // through from the text this branch is already reading.
    const consequenceLines = trimmed.split('\n');
    const allCandidates = consequenceLines.filter((l) => l.startsWith('- '));
    const candidateLines = allCandidates.slice(0, 6);
    const statedTotal = Number(trimmed.match(/(\d+)\s+concrete candidates/)?.[1] ?? NaN);
    // ⛔ A POPULATION CAN ITSELF BE CAPPED, AND "of N" SAYS IT WAS NOT.
    //
    // ef-manager built the case both of us had recorded as untested — 60 headers each defining
    // the same struct, above the 50-row retrieval cap. `graph_consequences` got it exactly
    // right: "AT LEAST 50 concrete candidates, identified from 50 of 60 matching rows — the
    // full ambiguity population is NOT established (retrieval was capped before grouping)".
    // Three distinct facts kept separate. This branch then printed `showing 5 of 50` — THE CAP
    // AS THE POPULATION, when the truth is 60 and the sibling says so in as many words.
    //
    // ★ That is the ORIGINAL defect — a cap reported as a finding — reappearing at the
    // truncation boundary. The fail-closed work taught this branch to carry a population;
    // nobody told it the population it carries can itself be a floor.
    //
    // ⇒ AND IT EXPOSES A FOURTH STATE the three-state vocabulary lacked: ATTESTED-AS-A-FLOOR.
    // Not UNKNOWN (50 is real and useful), not `of N` (50 is not the total). Rendering it as
    // `of N` is the only wrong choice available.
    //
    // ⇒ ef-manager's structural point, which the shared renderer does NOT address: a renderer
    // handed the bare integer 50 will faithfully print "of 50" in every branch at once, and the
    // parity arm passes with both routes agreeing on the same wrong word. The exactness must
    // travel WITH the value, not be re-derived at each call site.
    const populationIsFloor = /AT LEAST|NOT established/.test(trimmed);
    const rowsSeen = trimmed.match(/identified from (\d+) of (\d+) matching rows/);
    const crossLanguage = consequenceLines.find((l) => /CROSS-LANGUAGE DUPLICATE/.test(l));
    if (candidateLines.length) {
      // Two caps can apply: consequences already sampled, and this packet samples again.
      // The header states what is SHOWN HERE against the producer-attested population — and
      // says UNKNOWN rather than guessing when the producer did not state one.
      // The languages are recovered from the consequences text this branch is already
      // reading — the finding was computed upstream and was being discarded.
      const langsFromText = crossLanguage?.match(/\(([a-z+, ]+)\)\s*\.?\s*$/)?.[1]?.split(',').map((s) => s.trim()) ?? [];
      // ⚠ THE ROUTE NO LONGER BUILDS ITS OWN HEADER. It hands over the POPULATION FACTS and
      // emitCandidateList derives header, rows and disclosures from that one set of inputs —
      // so a header cannot disagree with the disclosures beneath it, and "minting" a
      // credential is the same act as computing the disclosure correctly.
      // ⚠ The population is now decided HERE, once, as a tagged value — not passed as an
      // integer beside a boolean the constructor defaults to `exact`. That default is how a
      // floor could render as a total if a caller forgot the flag.
      const population = !(Number.isInteger(statedTotal) && statedTotal >= candidateLines.length)
        ? unknownPopulation()
        : populationIsFloor
          ? atLeast(statedTotal, { rowsSeen: rowsSeen ? [rowsSeen[1], rowsSeen[2]] : null })
          : exactly(statedTotal);
      lines.push(candidateList({
        rows: candidateLines,
        symbol,
        population,
        languages: langsFromText.length > 1 ? langsFromText : (crossLanguage ? ['cpp', 'other'] : []),
      }));
    }
    // The disambiguating step comes first here: on this path the useful next move
    // is to narrow the target, not to re-ask the same ambiguous question.
    lines.push(`NEXT: pick a candidate above, then graph_consequences(target="<file>:<symbol>") — resolves the feature the ambiguity hid`);
    lines.push(...readNext);
    return renderPacketLines(lines);
  }

  return null;
}

// ----- main -----

async function graphPacketInner({ repoRoot, target, mode = 'orient', budget = null, live = false, since = null, files = [], audited = false, analyze = false, analyzeMode = 'clang-tidy', analyzeTimeoutMs }) {
  if (!repoRoot) return 'ERROR: repoRoot parameter is required';

  // Verify mode short-circuit: post-edit decision packet, no target required.
  // Routes to buildVerifyPacket which handles the W1.4 fixtures: clean+fresh,
  // edit+stale, edit+unavailable, edit+audited, edit+partial, plus untracked files.
  const earlyMode = normalizeMode(mode);
  if (earlyMode === 'verify') {
    const { buildVerifyPacket } = await import('./packet-verify.js');
    let analysis = null;
    if (analyze) {
      const { codeIntelAnalyze } = await import('./code_intel_analyze.js');
      analysis = await codeIntelAnalyze({ repoRoot, files, mode: analyzeMode, timeoutMs: analyzeTimeoutMs });
    }
    return buildVerifyPacket({ repoRoot, since, files, audited, analysis }).rendered;
  }

  if (!target) return 'ERROR: target parameter is required (task:<id>, feature:<id>, bare id, or bare symbol)';

  // Per architectural rule: read overlay + brief + manifest JSON directly.
  // No ensureFresh() call. No SQLite open. No verb dispatch. Static-first.
  const functionality = readFunctionality(repoRoot);
  const tasksArtifact = readTasks(repoRoot);
  const brief = readBrief(repoRoot);
  const manifest = readManifest(repoRoot);
  const snapshot = snapshotLine(brief, manifest, repoRoot);

  // Repo-size-aware budget (manifest.nodes is free here — already read above).
  // Precedence: explicit arg > APG_PACKET_BUDGET env > tier default.
  const { budgetTokens, caps } = resolvePacketBudget({
    explicit: budget,
    env: process.env.APG_PACKET_BUDGET,
    nodeCount: manifest?.nodes ?? 0,
  });
  const opts = optionsForMode(normalizeMode(mode), budgetTokens);
  // Let the read-first list grow with the repo (monotonic — only ever larger),
  // so god-repos surface enough entry points without re-grepping.
  opts.read_first = Math.max(opts.read_first, caps.read_first);

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
  let symbolConsequences = null; // retained for the graceful degrade path below
  let featureLookupTimedOut = false; // a timeout must never be rendered as "not found"
  // ★ CHEAP PATH FIRST. See resolveFeatureForSymbolCheap: the budgeted traversal
  // below could not finish on ANY bare symbol on a 12k-node C++ repo, so on the
  // repos this verb matters most for it was never running at all.
  if (!parsed.kind && !resolvedFeature && !resolvedTask) {
    const cheap = resolveFeatureForSymbolCheap(repoRoot, functionality, parsed.value);
    if (cheap?.feature) {
      resolvedFeature = cheap.feature;
      kind = 'feature';
      matchedViaSymbol = parsed.value;
      // Feed the same shape the expensive path produced, so DEFINED IN renders
      // identically whichever route got here.
      symbolConsequences = { matched: { symbols: cheap.locations.map((l) => ({
        label: parsed.value, type: l.type, file: l.file, line: l.line,
      })), symbols_total: cheap.locationsTotal, symbols_by_language: cheap.locationsByLanguage, symbols_census_exact: cheap.locationsCensusExact, files: [] } };
    } else if (cheap?.locations?.length) {
      // Known to the graph, anchored by no feature — the symbol-pointer packet's
      // case, reached without paying for the traversal.
      symbolConsequences = { matched: { symbols: cheap.locations.map((l) => ({
        label: parsed.value, type: l.type, file: l.file, line: l.line,
      })), symbols_total: cheap.locationsTotal, symbols_by_language: cheap.locationsByLanguage, symbols_census_exact: cheap.locationsCensusExact, files: [] } };
    }
  }

  if (!parsed.kind && !resolvedFeature && !resolvedTask && !symbolConsequences) {
    const { graphConsequences } = await import('./consequences.js');
    let mapped;
    try {
      const raw = await withTimeout(
        graphConsequences({ repoRoot, target: parsed.value }),
        LIVE_BUDGET_MS,
      );
      if (raw && raw.__timeout) {
        // ★ A TIMEOUT IS NOT AN ABSENCE.
        //
        // Root-caused 2026-08-09 from ef-manager: graph_packet("SimCoordinator")
        // on echoes returned ERROR: not found as feature, task, or symbol — while
        // graph_consequences on the SAME symbol, overlay and process resolved it
        // to TWO features. Measured: consequences takes 601ms on a 3958-node repo
        // and 4316ms on a 12126-node one. The budget here is 2000ms.
        //
        // So on any repo large enough to matter, the lookup timed out and the
        // packet reported the symbol as NOT FOUND. That is a latency fact rendered
        // as a fact about the code — the exact substitution this whole project
        // exists to remove, sitting in the flagship orientation verb.
        //
        // It also explains the count inversion ef-manager measured: a UNIQUE match
        // runs the full computation and blows the budget, while AMBIGUOUS matches
        // return early and cheap. Not inverted on count — inverted on COST. The
        // cleanest input takes the most expensive path.
        featureLookupTimedOut = true;
      }
      if (raw && !raw.__timeout) {
        // graphConsequences returns an object directly (not a JSON string),
        // unlike some other verbs. Handle both shapes defensively.
        if (typeof raw === 'object') mapped = raw;
        else if (typeof raw === 'string' && raw.trim().startsWith('{')) {
          mapped = JSON.parse(raw);
        } else if (typeof raw === 'string') {
          // AMBIGUOUS MATCH / NO MATCH come back as human-readable strings;
          // keep them for the symbol-pointer degrade path.
          symbolConsequences = raw;
        }
      }
      if (mapped) symbolConsequences = mapped;
    } catch {/* fall through to degrade path */}

    const featureHit = mapped?.features_touching?.[0];
    if (featureHit) {
      resolvedFeature = findFeature(functionality, featureHit.id);
      kind = 'feature';
      matchedViaSymbol = parsed.value;
    }
  }

  // FIX 3 (test-round-2026-05-31): graceful symbol degrade. The initialize
  // playbook advertises packet for "a feature/symbol", but a bare symbol that
  // resolves in the graph yet maps to NO feature (or is ambiguous) used to hard
  // reject — contradicting the playbook. Instead, when the symbol IS known to
  // the graph, emit a compact SYMBOL packet that points the agent at its
  // file(s)/feature and the right verbs for symbol context, rather than erroring.
  if (!resolvedFeature && !resolvedTask && !parsed.kind) {
    const symbolPacket = buildSymbolPointerPacket({
      symbol: parsed.value,
      consequences: symbolConsequences,
      snapshot,
      // Threaded in rather than looked up inside: the packet builder is pure over its inputs,
      // and a recommendation gated on a fact the builder cannot see is how the ungated line
      // survived in the first place.
      codeIntelAvailable: hasCodeIntelCollection(repoRoot),
    });
    if (symbolPacket) return symbolPacket;
  }

  // ★ TIMED OUT ≠ NOT FOUND. Say which one happened.
  //
  // Before this, a lookup that blew the 2000ms budget fell through to the same
  // ERROR as a symbol the graph has never heard of. A reader cannot act on that:
  // "not found" invites you to conclude the symbol does not exist, when in fact
  // it may map to several features and the tool simply ran out of time.
  if (!resolvedFeature && !resolvedTask && featureLookupTimedOut) {
    return renderPacketLines([
      `SYMBOL: ${parsed.value}`,
      'STATUS: feature lookup TIMED OUT — this is NOT "symbol not found"',
      snapshot,
      `  The symbol→feature lookup exceeded its ${LIVE_BUDGET_MS}ms budget. On large`,
      '  repos this is expected: the lookup runs a full cross-layer traversal.',
      '  NOTHING here says the symbol is absent or unmapped — only that this verb',
      '  could not finish in time. Do not read it as an absence.',
      `NEXT: graph_consequences(target="${parsed.value}") — the same lookup, unbudgeted; it is what timed out here`,
      `NEXT: graph_whereis(symbol="${parsed.value}") — cheapest way to locate it`,
      'NEXT: graph_packet(target="feature:<id>") — if graph_consequences names a feature, ask for it directly',
    ]);
  }

  if (!resolvedFeature && !resolvedTask) {
    // FIX B — overlay-empty hint. When the target is feature/task-shaped (an
    // explicit feature:/task: prefix, OR a bare id that would resolve via the
    // overlay) and the overlay is missing / has no features / all anchors are
    // broken, the silent "not found" reads as "tool broken." Emit a clear
    // OVERLAY NOT BUILT hint instead. Static-first path (no DB) — uses the
    // declared-anchor fallback in assessOverlayBuild. Bare *symbol* targets
    // that genuinely resolve in the graph never reach here (handled above), so
    // this only fires for the overlay-routed shapes.
    // ⛔ `|| !parsed.kind` MADE THE ERROR BELOW UNREACHABLE, AND SENT EVERY TYPO TO BUILD AN
    // OVERLAY. A bare unresolved token has no kind, so it was classed as overlay-routed and got
    // "OVERLAY NOT BUILT" — byte-identical for `renderPacket` (a misspelling of a symbol that
    // exists) and `ZZZ_definitely_not_a_symbol_12345`. The remedy offered was real; it was just
    // not the reader's problem. Found in the first field test of this code (ef-manager).
    //
    // ★ The comment that used to sit here said "bare symbol targets that genuinely resolve
    // never reach here". True — and the ones that do NOT resolve reach here, which is the
    // entire population the error below was written for.
    //
    // ⚠ THE FIX IS NOT "SAY NOT FOUND INSTEAD". A bare token on an overlay-less repo is
    // genuinely ambiguous: a misspelled symbol, or a feature id whose overlay was never built.
    // Nothing here can distinguish them, so asserting either is the same defect in different
    // words. An EXPLICIT feature:/task: target is not ambiguous and keeps the overlay hint.
    const explicitlyOverlayRouted = parsed.kind === 'feature' || parsed.kind === 'task';
    const build = assessOverlayBuild(repoRoot, {
      features: functionality?.features ?? [],
      tasks: tasksArtifact?.tasks ?? [],
    });
    if (explicitlyOverlayRouted && !build.built) {
      return [overlayNotBuiltHint(build.reason), snapshot].join('\n');
    }
    return [
      `ERROR: target "${target}" not found as feature, task, or symbol mapping to a feature`,
      ...(build.built
        ? []
        // Named as a possibility, not asserted as the cause — the reader knows which of the
        // two they typed, and this tool does not.
        : [`HINT: no feature overlay exists here, so if "${target}" is a FEATURE id it cannot`
          + ' resolve — run /graph-build-functionality. If it was meant to be a symbol, it is'
          + ' not in the graph under that name.']),
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
    //
    // ★ AND CARRY THE SYMBOL'S OWN LOCATION WITH IT.
    //
    // Field report (sc-manager / sc-coder, Sand Castle, 2026-08-09), from a real
    // 223-member census in a 50k-line header set: asking for a symbol returned
    // the broad owning feature and OMITTED the file that declares it.
    // graph_whereis found it instantly at game/UnifiedFluidRuntime.h:378.
    //
    // The branches were inverted relative to what a reader needs. DEFINED IN was
    // emitted ONLY by the symbol-pointer packet — the path taken when the symbol
    // maps to NO feature and the packet can say least. The moment a feature DID
    // resolve, the packet grew authority and lost the one line that says where
    // the thing actually is. Their verdict, which is the right one: a packet that
    // resolves to a feature but drops the defining declaration is worse than one
    // that returns nothing, because it looks like an answer.
    //
    // The locations are already computed — symbolConsequences is what produced
    // the feature match in the first place.
    const symHits = symbolConsequences?.matched?.symbols ?? [];
    // ⛔ THESE ROWS USED TO BEGIN WITH TWO SPACES, WHICH PUT THIS ENTIRE ROUTE OUTSIDE THE
    // LIST GRAMMAR. Not only did the header state no population — the detector could not see
    // the list at all, so nothing downstream could have noticed. Governed rows start "- ".
    const defLines = symHits.slice(0, 3)
      .filter((s) => s?.file)
      .map((s) => `- ${s.file}${s.line ? `:${s.line}` : ''} — ${s.type || 'symbol'}`);
    lines.splice(1, 0, `MATCHED VIA: symbol "${matchedViaSymbol}" → feature ${resolvedFeature.id}`);
    if (defLines.length) {
      // ⛔ THIS IS THE SECOND CAP, AND I FIXED THE OTHER ONE FIRST.
      //
      // The no-feature path got `symbols_total` and a "showing n of m" line. This branch
      // has its OWN cap and got nothing — so on the case that actually matters it stayed
      // broken. ef-manager, testing the fix on real echoes: `GpuMaterial` has SIXTEEN
      // definitions and the packet listed three, with no count and no marker of any kind.
      // Their words, and they are the point: a wrong number is at least a number a reader
      // can doubt; a silently complete-looking list of 3 offers nothing to doubt.
      //
      // ★ I fixed the axis I was looking at and did not enumerate the axes I moved —
      // again. The test I wrote used a NO-FEATURE fixture, so it never ran this branch.
      // Same resolver as the pointer-packet branch above — deliberately, so a repair here
      // cannot leave the other consumer fail-open (which is precisely the split that let this
      // branch stay broken for a day after I "fixed" the other one).
      const pop = resolvePopulation(symbolConsequences?.matched?.symbols_total, defLines.length);
      const total = pop.total;
      const byLang = symbolConsequences?.matched?.symbols_by_language ?? [];
      const sampled = pop.attested && total > defLines.length;
      // ⛔ THE THIRD BRANCH HERE WAS THE DEFECT, AND I REPORTED THIS FINDING FIXED WITHOUT IT.
      // When the population was attested and EQUAL to the shown count, the header was the bare
      // `DEFINED IN (…):` with no population at all — exactly the "is one row all of them?"
      // case a first-time reader could not answer. I converted buildSymbolPointerPacket, saw
      // "showing 1 of 1" in real output, and called the finding fixed generally: one branch, a
      // general claim, which is the fourth-route mistake for the third time.
      //
      // ⇒ The population is now a tagged value and the header comes from it, so there is no
      // branch left in which it can be omitted.
      const definedPopulation = pop.attested ? exactly(total) : unknownPopulation();
      const extra = [];
      if (sampled && byLang.length) {
        // Repo-size-independent in a way the sample can never be: two lines say "1 C++
        // header and 15 shader mirrors" whatever the cap happens to be.
        // ⛔ "ALL" WAS A COMPLETENESS CLAIM THE EXTRACTOR CANNOT SUPPORT. ef-manager, on real
        // C++: `LodChunkInstance` reported `ALL 4 BY LANGUAGE` and the true mirror count is 5.
        // The fifth is GLSL embedded in a C++ RAW STRING LITERAL —
        //   static const char* flatQuadVertSrc = R"( #version 450 struct LodChunkInstance {…} )"
        // — which tree-sitter never parses as a symbol, no `*.glsl` grep finds, and the shader
        // toolchain does not compile at build time. It is the MOST drift-prone copy of a
        // std430-mirrored struct, and `ALL` told the reader the enumeration was complete.
        //
        // ★ Same shape as every cap-as-total defect in this repo, one verb over: the number is
        // a FLOOR and the word said it was a total. PARSED is what the graph can actually
        // attest, and it costs one word.
        extra.push(`  PARSED ${total} BY LANGUAGE: ${byLang.map((b) => `${b.lang} ${b.count}`).join(' · ')}`);
      }
      // ⚠ NOT gated on `total` any more. It used to read `byLang.length > 1 && total > 1`;
      // with fail-closed `total` becoming null when unattested, `null > 1` is false and this
      // FINDING would have been silently suppressed exactly when the population is unknown.
      // The finding does not depend on the population: >1 language in `symbols_by_language`
      // already means >1 definition. Caught by re-reading my own diff, not by a test.
      if (byLang.length > 1) {
        // ★ graph_consequences ALREADY calls this a finding — "CROSS-LANGUAGE DUPLICATE …
        // usually a FINDING rather than a disambiguation problem". Two verbs, one repo,
        // one symbol, opposite treatment: one named the hazard, this one truncated it in
        // silence. Same sentence, same data, no new analysis required.
        // ⚠ The floor caveat rides HERE rather than on every packet, because this is the exact
        // condition where an unparsed mirror matters: a shader struct duplicated across
        // languages is the thing that drifts. ef-manager's rule — a disclosure that fires
        // conditionally carries information by appearing at all; one that fires always is
        // wallpaper and readers stop seeing it.
      }
      // ⇒ BOTH branches now assemble their disclosures from renderCandidateDisclosures, which
      // is why the FLOOR caveat can no longer exist on one and not the other — the divergence
      // ef-manager found by comparing the two survivors of the previous round.
      // Still offered when completeness is UNKNOWN — that case needs the remedy more, not less.
      // ⚠ No `limit=` here and no "unsampled": with no population there is no number to pass,
      // and promising an unsampled result from a verb that caps at 5 is the false promise this
      // round removed. What is true unconditionally is that whereis reports its own cap.
      if (!pop.attested) {
        extra.push(`  NEXT: graph_whereis(symbol="${matchedViaSymbol}") — lists them, and reports its own cap`);
      }
      // One typed occurrence carrying header, rows and every disclosure — not a header, a
      // spread of rows and a spread of extras assembled at the call site, which is what let
      // this route drift from its sibling for six iterations without anything noticing.
      lines.splice(2, 0, symbolList(
        'DEFINED IN',
        defLines,
        {
          symbol: matchedViaSymbol,
          population: definedPopulation,
          languages: byLang.map((b) => b.lang),
          notes: ['  (the symbol you asked for, not the feature)', ...extra],
        },
      ));
    }
  }

  // LIVE: enrichment block. Enrichment is explicit-only. The packet exists
  // to be a stable, cheap overlay-first context primitive; auto-enabling
  // live calls on weak/stale snapshots reintroduced the exact ensureFresh
  // latency risk M0.5 identified. Bare-symbol fallback may use one
  // budgeted graph_consequences call to map symbol→feature, but enrichment
  // still requires live=true.
  //
  // When live=true we run a budgeted
  // graph_consequences call and append the cheap-to-compute fields
  // (last_touched, co_consumer_files) that overlay JSON can't give us.
  // Strict 2s budget. Timeout / unavailable both still leave the rest
  // of the packet usable.
  if (live) {
    // For symbol-fallback path, prefer the ORIGINAL symbol target for
    // graph_consequences (which expects symbol/file, not feature id).
    // Without this, LIVE returned "unavailable" on symbol-fallback even
    // when enrichment would have worked on the symbol directly
    // (final-bench bug 2).
    const enrichValue = matchedViaSymbol
      ?? (resolvedFeature ? resolvedFeature.id : null)
      ?? (resolvedTask ? resolvedTask.id : null)
      ?? parsed.value;
    const enrich = await enrichLive({
      repoRoot,
      target,
      kind,
      value: enrichValue,
      opts,
    });
    if (enrich.status === 'enriched') {
      lines.push(`LIVE: enriched (${enrich.elapsed_ms}ms)`);
      // ⚠ THESE TWO WOULD HAVE FALSE-ACCUSED A REAL USER. They are list-shaped, they are
      // built by hand, and NO TEST EXERCISES THEM — the live-enrichment path needs live=true.
      // The suite was green with the seal on; a user calling graph_packet(live=true) would
      // have got a POPULATION NOT DISCLOSED caveat stapled to a perfectly good packet.
      //
      // ★ That is the failure direction I said I cared about and had not checked for. A
      // runtime check only sees executed routes, so "the suite is green" says nothing about
      // the routes the suite never runs. Found by enumerating header-then-rows pushes
      // statically instead of trusting the green — the same move that turned up the fourth
      // disclosure route, applied to my own new mechanism.
      if (enrich.last_touched.length) {
        lines.push(boundedListAll('LAST TOUCHED', enrich.last_touched));
      }
      if (enrich.co_consumer_files.length) {
        lines.push(boundedListAll('CO-CONSUMER FILES', enrich.co_consumer_files,
          (f) => (typeof f === 'string' ? f : (f.file ?? JSON.stringify(f)))));
      }
    } else {
      lines.push(`LIVE: ${enrich.status} (${enrich.detail}; ${enrich.elapsed_ms}ms)`);
    }
  } else {
    const symbolNote = matchedViaSymbol ? '; symbol mapped via budgeted lookup' : '';
    lines.push(`LIVE: skipped_under_budget (overlay-first${symbolNote}; pass live=true to enrich)`);
  }

  // EVIDENCE block injection (Plan #5b): when a code-intel collection has been
  // imported, append a compact provenance-tagged summary so non-verify modes
  // also expose compiler-backed facts. Budget-gated: `clampToBudget` drops the
  // tail when over budget, so EVIDENCE is the first thing trimmed if needed.
  // Surface is read-only — does not change the canonical packet schema for
  // existing callers (the EVIDENCE: line is a strict append).
  try {
    const { buildEvidenceBlock, renderEvidenceBlock } = await import('./packet-evidence.js');
    const symbolForEvidence = (kind === 'feature' || kind === 'task') ? null : (parsed?.value || target);
    const block = buildEvidenceBlock({ repoRoot, symbol: symbolForEvidence, files: [] });
    if (block && (block.available || block.reason === 'no_collection')) {
      lines.push(renderEvidenceBlock(block));
    }
  } catch { /* never block the packet on evidence lookup */ }

  // Cross-link footer (low-salience-wall tie-in, Code-Intel v2 / P1-2+P1-3).
  // graph_packet is a verb agents ALREADY reach for, so a one-line pointer here
  // raises the salience of the two new source-reading verbs they under-pick on
  // their own: graph_trace for a full call path, graph_explore for several
  // symbols' verbatim source. Light cross-link, not a rewrite — appended before
  // the budget clamp so it's trimmed first if the packet is over budget.
  lines.push('NEXT: for the full call path between two symbols use graph_trace(from,to); for several symbols\' source in one read use graph_explore(symbols).');

  // ⛔ CLAMP FIRST, SERIALIZE SECOND. This used to serialize and then rewrite the finished
  // text, which put a transform behind the guarantee: the seal validated a string the clamp
  // then edited. Every attempt to let that through by RECOGNISING the rewritten text failed in
  // one direction or the other — accepting an arbitrary truncation of a candidate list while
  // refusing a genuinely skeletonized bounded one.
  //
  // ⇒ Clamping an OCCURRENCE produces a new occurrence, so the emitted text IS the final text
  // and reconciliation is exact. READ FIRST holds the packet target's primary anchor files —
  // it is the section "containing the target" and must never be dropped (codegraph #564/#569).
  return renderPacketLines(clampOccurrences(lines, opts.budget_tokens, 'READ FIRST'));
}




export async function graphPacket(args) {
  const { out, scope } = await withSealScope(() => graphPacketInner(args));
  return sealPacketOutput(out, scope);
}
