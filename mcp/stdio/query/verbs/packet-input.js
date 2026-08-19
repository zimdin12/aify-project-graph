// packet:input — the artifacts, probes, budget and target resolution a packet is built from.
//
// Extracted from packet.js in Phase 0 slice 1. MECHANICAL MOVE ONLY: no behaviour change, proven
// by scripts/refactor-guard.mjs over a frozen 55-entry corpus and by the full suite.
//
// AUTHORITY (scripts/authority-ledger.mjs): reads on-disk artifacts and DB availability probes,
// decides how much output is allowed and which mode shape applies, and turns a caller string into
// a resolved overlay entity. It decides nothing about presentation and renders no governed list.
//
// ⛔ NEVER IMPORT packet.js. That is the cycle graph-senior-dev pre-registered as one of the
// three failures I would cause; packet-authority-boundaries.test.js fails if it appears.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { computeTrustLevel } from './health.js';
import { getTrackedDirtyFilesSync } from '../../freshness/git.js';
import { getUnresolvedCounts } from '../../freshness/unresolved-metrics.js';
import { getPacketTokenBudget } from '../response-budget.js';
import { openExistingDb } from '../../storage/db.js';

// Section caps come first; the final token-estimate clamp is a safety
// rail. Predictable shape → prompt-cache friendly.
export const DEFAULTS = {
  features: 6,
  read_first: 8,
  contracts: 6,
  tests: 6,
  risks: 6,
  budget_tokens: 800,
};

export const CHAR_PER_TOKEN_EST = 4; // rough; matches our existing brief-budget heuristic

export const PACKET_MODES = new Set(['orient', 'plan', 'debug', 'review', 'audit', 'verify']);

export const MODE_OVERRIDES = {
  orient: {},
  plan: { read_first: 10, contracts: 8, tests: 8, risks: 8 },
  debug: { read_first: 10, tests: 10, risks: 8 },
  review: { read_first: 8, contracts: 8, tests: 10, risks: 10 },
  audit: { read_first: 10, contracts: 10, tests: 10, risks: 12 },
  verify: { read_first: 8, contracts: 4, tests: 8, risks: 8 },
};

export function esTokens(s) { return Math.ceil((s || '').length / CHAR_PER_TOKEN_EST); }

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

export function normalizeMode(mode) {
  const value = typeof mode === 'string' ? mode.trim().toLowerCase() : 'orient';
  return PACKET_MODES.has(value) ? value : 'orient';
}

export function optionsForMode(mode, budgetTokens) {
  return {
    ...DEFAULTS,
    ...(MODE_OVERRIDES[mode] ?? {}),
    budget_tokens: budgetTokens,
    mode,
  };
}

export function loadJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function readBrief(repoRoot) {
  const path = join(repoRoot, '.aify-graph', 'brief.json');
  return loadJsonSafe(path);
}

export function readFunctionality(repoRoot) {
  const path = join(repoRoot, '.aify-graph', 'functionality.json');
  return loadJsonSafe(path);
}

export function readTasks(repoRoot) {
  const path = join(repoRoot, '.aify-graph', 'tasks.json');
  return loadJsonSafe(path);
}

export function readManifest(repoRoot) {
  const path = join(repoRoot, '.aify-graph', 'manifest.json');
  return loadJsonSafe(path);
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
export function hasCodeIntelCollection(repoRoot) {
  try {
    const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      return Boolean(db.get('SELECT 1 AS x FROM code_intel_collections LIMIT 1')?.x);
    } finally { db.close(); }
  } catch { return false; }
}

export function safeGitHead(repoRoot) {
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
export function safeDirtyCount(repoRoot) {
  try {
    return getTrackedDirtyFilesSync(repoRoot).length;
  } catch { return 0; }
}

export function trustTier(unresolvedEdges) {
  // Reuse the shared computeTrustLevel from health.js so packet's SNAPSHOT
  // line never disagrees with graph_health on the same snapshot
  // (validation-gate bug 2). Returns 'missing' when count is unknown.
  if (unresolvedEdges == null) return 'missing';
  return computeTrustLevel(unresolvedEdges);
}

export function snapshotLine(brief, manifest, repoRoot) {
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

export function shortSha(s) {
  if (typeof s !== 'string') return '?';
  return s === '?' ? '?' : s.slice(0, 7);
}

// Parse `feature:<id>` / `feature/<id>` / `task:<id>` / `task/<id>` shapes.
// Bare ids are auto-detected against the loaded overlay/tasks.
export function parseTarget(target) {
  if (typeof target !== 'string' || !target) return { kind: 'unknown', value: target };
  const m = target.match(/^(feature|task)[:/](.+)$/i);
  if (m) return { kind: m[1].toLowerCase(), value: m[2].trim() };
  return { kind: null, value: target };
}

export function findFeature(functionality, value) {
  const features = functionality?.features ?? [];
  return features.find((f) => f.id === value)
    || features.find((f) => (f.label || '').toLowerCase() === value.toLowerCase());
}

export function findTask(tasksArtifact, value) {
  const tasks = tasksArtifact?.tasks ?? [];
  return tasks.find((t) => t.id === value);
}
