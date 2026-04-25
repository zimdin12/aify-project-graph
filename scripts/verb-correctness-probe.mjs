#!/usr/bin/env node
// Verb-correctness probe: exercises each of the 21 graph verbs on apg's own
// graph and writes a JSON report. For each verb we run 3 inputs
// (easy / cross-cutting / edge case), capture the output_shape, check one
// hand-coded semantic invariant, measure size, and record any failures.
//
// Verb outputs come in three shapes when called directly:
//   (A) plain text — MCP-formatted lines like "NODE ... / EDGE ... / PATH ..."
//   (B) JSON string — JSON.stringify(obj) (e.g. graph_pull, graph_find)
//   (C) object      — plain JS object (e.g. graph_health, graph_status)
// We normalize before asserting invariants.
//
// Usage: node scripts/verb-correctness-probe.mjs
// Exit 0 if all invariants pass, 1 otherwise.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const GRAPH_DIR = join(REPO_ROOT, '.aify-graph');
const OUT_PATH = process.argv[2]
  ? resolve(process.argv[2])
  : join(REPO_ROOT, 'docs/dogfood/verb-correctness-2026-04-25.json');

import { graphStatus } from '../mcp/stdio/query/verbs/status.js';
import { graphIndex } from '../mcp/stdio/query/verbs/index.js';
import { graphHealth } from '../mcp/stdio/query/verbs/health.js';
import { graphConsequences } from '../mcp/stdio/query/verbs/consequences.js';
import { graphPull } from '../mcp/stdio/query/verbs/pull.js';
import { graphChangePlan } from '../mcp/stdio/query/verbs/change_plan.js';
import { graphPath } from '../mcp/stdio/query/verbs/path.js';
import { graphImpact } from '../mcp/stdio/query/verbs/impact.js';
import { graphCallers } from '../mcp/stdio/query/verbs/callers.js';
import { graphCallees } from '../mcp/stdio/query/verbs/callees.js';
import { graphNeighbors } from '../mcp/stdio/query/verbs/neighbors.js';
import { graphWhereis } from '../mcp/stdio/query/verbs/whereis.js';
import { graphSearch } from '../mcp/stdio/query/verbs/search.js';
import { graphFind } from '../mcp/stdio/query/verbs/find.js';
import { graphLookup } from '../mcp/stdio/query/verbs/lookup.js';
import { graphFile } from '../mcp/stdio/query/verbs/file.js';
import { graphModuleTree } from '../mcp/stdio/query/verbs/module_tree.js';
import { graphPreflight } from '../mcp/stdio/query/verbs/preflight.js';
import { graphSummary } from '../mcp/stdio/query/verbs/summary.js';
import { graphReport } from '../mcp/stdio/query/verbs/report.js';
import { graphOnboard } from '../mcp/stdio/query/verbs/onboard.js';

// ------------------------ helpers ------------------------

function jsize(v) {
  if (v == null) return 0;
  if (typeof v === 'string') return Buffer.byteLength(v, 'utf8');
  return Buffer.byteLength(JSON.stringify(v), 'utf8');
}

// Try to coerce a raw verb output into a structured form. Returns
// { kind: 'object'|'json-string'|'text'|'nullish', value, raw }.
function normalize(raw) {
  if (raw == null) return { kind: 'nullish', value: null, raw };
  if (typeof raw === 'object') return { kind: 'object', value: raw, raw };
  if (typeof raw === 'string') {
    // Some verbs prepend "SNAPSHOT WARNINGS\n ...\n\n<body>" — strip that
    // leading block before attempting JSON.parse.
    let body = raw;
    if (body.startsWith('SNAPSHOT WARNINGS')) {
      const firstBlank = body.indexOf('\n\n');
      if (firstBlank >= 0) body = body.slice(firstBlank + 2);
    }
    const t = body.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        return { kind: 'json-string', value: JSON.parse(t), raw };
      } catch { /* fall through */ }
    }
    return { kind: 'text', value: body, raw };
  }
  return { kind: 'other', value: raw, raw };
}

function topLevelKeys(normalized) {
  const { kind, value } = normalized;
  if (kind === 'object' || kind === 'json-string') {
    if (Array.isArray(value)) return ['<array>'];
    return Object.keys(value ?? {});
  }
  if (kind === 'text') return ['<text>'];
  if (kind === 'nullish') return [];
  return ['<other>'];
}

const PROVENANCE_SET = new Set(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']);

function isNum(x) { return typeof x === 'number' && !Number.isNaN(x); }
function nonEmpty(x) {
  if (x == null) return false;
  if (Array.isArray(x)) return x.length > 0;
  if (typeof x === 'object') return Object.keys(x).length > 0;
  if (typeof x === 'string') return x.length > 0;
  return true;
}

function collectProvenances(v, out = []) {
  if (v == null) return out;
  if (Array.isArray(v)) { v.forEach((x) => collectProvenances(x, out)); return out; }
  if (typeof v === 'object') {
    if ('provenance' in v && v.provenance != null) out.push(v.provenance);
    if ('prov' in v && v.prov != null) out.push(v.prov);
    for (const k of Object.keys(v)) collectProvenances(v[k], out);
  }
  return out;
}

// Parse "EDGE <from_id>→<to_id> <REL>" lines out of text-verb output.
// Returns [{ from, to, relation }].
function parseEdgeLines(text) {
  const edges = [];
  const re = /^EDGE\s+(\S+?)→(\S+?)\s+([A-Z_]+)/gm;
  let m;
  while ((m = re.exec(text)) !== null) edges.push({ from: m[1], to: m[2], relation: m[3] });
  return edges;
}

// Parse "NO MATCH" / "NO IMPACT" / "NO CALLERS" / "not found" style responses
function isNoMatch(text) {
  return /^(NO MATCH|NO IMPACT|NO CALLERS|NO CALLEES|NO PATH|NO SCOPE|NO RESULTS|No path|not found|not indexed|not resolved|0 results|empty)/im.test(text);
}

// ------------------------ probe runner ------------------------

async function runProbe(verbName, fn, input, invariant) {
  const call = { input: input.__label };
  let raw, err;
  try { raw = await fn({ repoRoot: REPO_ROOT, ...stripLabel(input) }); }
  catch (e) { err = e; }

  if (err) {
    call.output_shape = ['<throw>'];
    call.size_bytes = 0;
    call.invariant_passed = false;
    call.reason = `threw: ${err.message}`;
    call.output = { error: err.message, stack: err.stack?.split('\n').slice(0, 4) };
    return call;
  }

  const normalized = normalize(raw);
  call.output_kind = normalized.kind;
  call.output_shape = topLevelKeys(normalized);
  call.size_bytes = jsize(raw);

  let verdict;
  try { verdict = invariant(normalized, stripLabel(input)); }
  catch (e) { verdict = `invariant threw: ${e.message}`; }

  if (verdict === true) {
    call.invariant_passed = true;
  } else {
    call.invariant_passed = false;
    call.reason = typeof verdict === 'string' ? verdict : 'invariant returned falsy';
    // full raw output so we can debug
    call.output = typeof raw === 'string' ? raw : raw;
  }
  return call;
}

function stripLabel(input) {
  const { __label, ...rest } = input;
  return rest;
}

// ------------------------ verb specs ------------------------
//
// invariant signature: (normalized, input) -> true | string reason

const SPECS = [
  // ---- graph_status — object with nodes/edges numeric and >0
  ['graph_status', graphStatus, [
    { __label: 'default (easy)' },
    { __label: 'default (cross-cut)' },
    { __label: 'default (edge)' },
  ], (n) => {
    if (n.kind !== 'object') return `expected object, got ${n.kind}`;
    const v = n.value;
    if (!isNum(v.nodes) || !isNum(v.edges)) return 'nodes/edges missing or non-numeric';
    if (v.nodes <= 0) return 'nodes <= 0 on indexed graph';
    if (v.indexed !== true) return `expected indexed=true, got ${v.indexed}`;
    return true;
  }],

  // ---- graph_index — object with artifacts
  ['graph_index', graphIndex, [
    { __label: 'force=false (easy)' },
    { __label: 'force=false (cross)', force: false },
    { __label: 'force=false (edge)', force: false },
  ], (n) => {
    if (n.kind !== 'object') return `expected object, got ${n.kind}`;
    if (!('artifacts' in n.value)) return 'missing artifacts field';
    if (n.value.indexed !== true) return `indexed=${n.value.indexed}`;
    return true;
  }],

  // ---- graph_health — trust ∈ {strong,ok,weak} AND unresolvedEdges is a number
  ['graph_health', graphHealth, [
    { __label: 'default (easy)' },
    { __label: 'default (cross)' },
    { __label: 'default (edge)' },
  ], (n) => {
    if (n.kind !== 'object') return `expected object, got ${n.kind}`;
    const v = n.value;
    if (!['strong', 'ok', 'weak', 'missing'].includes(v.trust)) return `trust=${v.trust}`;
    if (v.indexed && !isNum(v.unresolvedEdges)) return 'unresolvedEdges not numeric';
    return true;
  }],

  // ---- graph_consequences — matched.symbols+files+referenced_in non-empty on existing target
  ['graph_consequences', graphConsequences, [
    { __label: 'graphHealth (easy)', target: 'graphHealth' },
    { __label: 'openExistingDb (cross-cutting)', target: 'openExistingDb' },
    { __label: 'ZzzNonExistentSymbolXyz (edge)', target: 'ZzzNonExistentSymbolXyz' },
  ], (n, input) => {
    if (n.kind === 'text') {
      // NO MATCH response for nonsense input
      if (isNoMatch(n.value) && /ZzzNonExistent/.test(input.target)) return true;
      return `unexpected text output: ${n.value.slice(0, 120)}`;
    }
    if (n.kind !== 'object' && n.kind !== 'json-string') return `expected object, got ${n.kind}`;
    const v = n.value;
    const matched = v.matched ?? {};
    const anyHit = nonEmpty(matched.symbols) || nonEmpty(matched.files) || nonEmpty(matched.referenced_in);
    if (!anyHit) return 'matched.symbols+files+referenced_in all empty for existing target';
    return true;
  }],

  // ---- graph_pull — JSON string, node.kind must align with input shape
  ['graph_pull', graphPull, [
    { __label: 'path=scripts/ab-runner.mjs (easy)', node: 'scripts/ab-runner.mjs' },
    { __label: 'symbol=graphHealth (cross)', node: 'graphHealth' },
    { __label: 'feature=nonexistent (edge)', node: 'feature:nonexistent-xyz' },
  ], (n, input) => {
    // Nonsense input may fall back to text NO MATCH
    if (n.kind === 'text') {
      if (isNoMatch(n.value)) return true;
      return `unexpected text: ${n.value.slice(0, 120)}`;
    }
    if (n.kind !== 'object' && n.kind !== 'json-string') return `expected json, got ${n.kind}`;
    const v = n.value;
    const node = v.node ?? {};
    const kind = (node.kind ?? '').toLowerCase();
    if (input.node.includes('/') && !input.node.startsWith('feature:')) {
      // file path
      if (kind && !/file|directory/.test(kind)) return `expected file/dir kind, got ${kind}`;
    } else if (input.node.startsWith('feature:')) {
      if (kind && !/feature|unknown/.test(kind)) return `expected feature kind, got ${kind}`;
    } else {
      // plain symbol
      if (kind && !/symbol|function|class|method|interface|type|variable|code|unknown/.test(kind)) {
        return `expected symbol-like kind, got ${kind}`;
      }
    }
    return true;
  }],

  // ---- graph_change_plan — text output, must reference the symbol OR return NO MATCH
  ['graph_change_plan', graphChangePlan, [
    { __label: 'graphHealth (easy)', symbol: 'graphHealth' },
    { __label: 'openExistingDb (cross)', symbol: 'openExistingDb' },
    { __label: 'std::vector<int>::iterator (edge)', symbol: 'std::vector<int>::iterator' },
  ], (n, input) => {
    if (n.kind === 'text') {
      if (isNoMatch(n.value)) return true;
      // Must contain CHANGE_PLAN header mentioning the symbol
      if (!/CHANGE_PLAN/.test(n.value)) return 'no CHANGE_PLAN header in text';
      // On easy/cross cases we also want the symbol echoed back
      if (input.symbol && !n.value.includes(input.symbol.split('::').pop())) {
        return `symbol "${input.symbol}" not referenced in output`;
      }
      return true;
    }
    if (n.kind === 'object' || n.kind === 'json-string') return true;
    return `unexpected kind ${n.kind}`;
  }],

  // ---- graph_path — root path must mention the input symbol AND provenance tokens (if present) must be in set
  ['graph_path', graphPath, [
    { __label: 'graphHealth (easy)', symbol: 'graphHealth' },
    { __label: 'graphConsequences (cross)', symbol: 'graphConsequences' },
    { __label: 'ZzzNoSymXyz (edge)', symbol: 'ZzzNoSymXyz' },
  ], (n, input) => {
    if (n.kind === 'text') {
      if (isNoMatch(n.value)) return true;
      if (!/PATH\s+/.test(n.value)) return 'no PATH header';
      // root symbol must appear on the PATH line
      const m = n.value.match(/PATH\s+(\S+)/);
      if (!m) return 'could not parse PATH header';
      if (m[1] !== input.symbol) return `root=${m[1]} != input=${input.symbol}`;
      // provenance tokens (prov=XXX) must be in set
      const provs = [...n.value.matchAll(/prov=([A-Z]+)/g)].map((mm) => mm[1]);
      for (const p of provs) if (!PROVENANCE_SET.has(p)) return `unexpected prov=${p}`;
      return true;
    }
    if (n.kind === 'object' || n.kind === 'json-string') {
      const provs = collectProvenances(n.value);
      for (const p of provs) if (!PROVENANCE_SET.has(p)) return `unexpected prov=${p}`;
      return true;
    }
    return `unexpected kind ${n.kind}`;
  }],

  // ---- graph_impact — either NO IMPACT, or edges have no from==to self-loops
  ['graph_impact', graphImpact, [
    { __label: 'graphHealth (easy)', symbol: 'graphHealth' },
    { __label: 'openExistingDb (cross)', symbol: 'openExistingDb' },
    { __label: 'ZzzNoSymXyz (edge)', symbol: 'ZzzNoSymXyz' },
  ], (n) => {
    if (n.kind === 'text') {
      if (isNoMatch(n.value)) return true;
      const edges = parseEdgeLines(n.value);
      for (const e of edges) if (e.from === e.to) return `self-loop ${e.from}`;
      return true;
    }
    return `unexpected kind ${n.kind}`;
  }],

  // ---- graph_callers — NO CALLERS OR every edge has from != to
  ['graph_callers', graphCallers, [
    { __label: 'graphHealth (easy)', symbol: 'graphHealth' },
    { __label: 'openExistingDb (cross)', symbol: 'openExistingDb' },
    { __label: 'ZzzNoSymXyz (edge)', symbol: 'ZzzNoSymXyz' },
  ], (n) => {
    if (n.kind === 'text') {
      if (isNoMatch(n.value)) return true;
      const edges = parseEdgeLines(n.value);
      for (const e of edges) if (e.from === e.to) return `self-loop caller ${e.from}`;
      return true;
    }
    return `unexpected kind ${n.kind}`;
  }],

  // ---- graph_callees — edges no self-loops; relation is CALLS-ish
  ['graph_callees', graphCallees, [
    { __label: 'graphHealth (easy)', symbol: 'graphHealth' },
    { __label: 'graphConsequences (cross)', symbol: 'graphConsequences' },
    { __label: 'ZzzNoSymXyz (edge)', symbol: 'ZzzNoSymXyz' },
  ], (n) => {
    if (n.kind === 'text') {
      if (isNoMatch(n.value)) return true;
      const edges = parseEdgeLines(n.value);
      for (const e of edges) if (e.from === e.to) return `self-loop callee ${e.from}`;
      return true;
    }
    return `unexpected kind ${n.kind}`;
  }],

  // ---- graph_neighbors — either NO MATCH OR has EDGE lines, each with a relation token
  ['graph_neighbors', graphNeighbors, [
    { __label: 'graphHealth (easy)', symbol: 'graphHealth' },
    { __label: 'openExistingDb (cross)', symbol: 'openExistingDb' },
    { __label: 'ZzzNoSymXyz (edge)', symbol: 'ZzzNoSymXyz' },
  ], (n) => {
    if (n.kind === 'text') {
      if (isNoMatch(n.value)) return true;
      const edges = parseEdgeLines(n.value);
      // allow zero edges but also allow non-EDGE NODE-only output
      for (const e of edges) {
        if (!e.relation) return 'edge missing relation';
        if (e.from === e.to) return `self-loop neighbor ${e.from}`;
      }
      return true;
    }
    return `unexpected kind ${n.kind}`;
  }],

  // ---- graph_whereis — NO MATCH OR a NODE line with file_path ending in code extension
  ['graph_whereis', graphWhereis, [
    { __label: 'graphHealth (easy)', symbol: 'graphHealth' },
    { __label: 'openExistingDb (cross)', symbol: 'openExistingDb' },
    { __label: 'Foo::Bar::baz (edge)', symbol: 'Foo::Bar::baz' },
  ], (n, input) => {
    if (n.kind !== 'text') return `expected text, got ${n.kind}`;
    if (isNoMatch(n.value)) return true;
    // NODE <id> <type> <label> <file:line>
    if (!/NODE\s+\S+\s+\S+\s+\S+/.test(n.value)) return 'no NODE line';
    // for existing inputs, expect the label we searched to appear
    if (input.symbol === 'graphHealth' && !n.value.includes('graphHealth')) return 'label not in output';
    return true;
  }],

  // ---- graph_search — NO MATCH OR at least one result line (NODE ... with a file_path)
  ['graph_search', graphSearch, [
    { __label: 'query=graph (easy)', query: 'graph' },
    { __label: 'query=health (cross)', query: 'health' },
    { __label: 'query=ZzzNoMatchXyz (edge)', query: 'ZzzNoMatchXyz' },
  ], (n, input) => {
    if (n.kind !== 'text') return `expected text, got ${n.kind}`;
    if (isNoMatch(n.value)) return true;
    if (input.query === 'ZzzNoMatchXyz') {
      // May be empty / NO RESULTS; just tolerate whatever text
      return true;
    }
    // should have a NODE line on real queries
    if (!/NODE\s/.test(n.value)) return 'no NODE lines on non-empty query';
    return true;
  }],

  // ---- graph_find — JSON string with layers_searched and hits object
  ['graph_find', graphFind, [
    { __label: 'query=health (easy)', query: 'health' },
    { __label: 'query=graph (cross)', query: 'graph' },
    { __label: 'query=ZzzNoMatchXyz (edge)', query: 'ZzzNoMatchXyz' },
  ], (n) => {
    if (n.kind !== 'object' && n.kind !== 'json-string') return `expected json, got ${n.kind}`;
    const v = n.value;
    if (!Array.isArray(v.layers_searched)) return 'layers_searched not array';
    if (typeof v.hits !== 'object' || v.hits == null) return 'hits missing';
    return true;
  }],

  // ---- graph_lookup — NO MATCH OR "<file>:<line>" format
  ['graph_lookup', graphLookup, [
    { __label: 'graphHealth (easy)', symbol: 'graphHealth' },
    { __label: 'openExistingDb (cross)', symbol: 'openExistingDb' },
    { __label: 'Ns::Qualified::name (edge)', symbol: 'Ns::Qualified::name' },
  ], (n) => {
    if (n.kind !== 'text') return `expected text, got ${n.kind}`;
    if (isNoMatch(n.value)) return true;
    // Should contain a "path:line" citation
    if (!/\S+:\d+/.test(n.value)) return 'no file:line citation in lookup output';
    return true;
  }],

  // ---- graph_file — text, "FILE <basename> <path>" header OR NO MATCH
  ['graph_file', graphFile, [
    { __label: 'scripts/ab-runner.mjs (easy)', path: 'scripts/ab-runner.mjs' },
    { __label: 'verbs/health.js (cross)', path: 'mcp/stdio/query/verbs/health.js' },
    { __label: 'does/not/exist.xyz (edge)', path: 'does/not/exist.xyz' },
  ], (n, input) => {
    if (n.kind !== 'text') return `expected text, got ${n.kind}`;
    if (isNoMatch(n.value)) return true;
    if (!/FILE\s+\S+\s+\S+/.test(n.value)) return 'no FILE header';
    // path must be echoed
    if (!n.value.includes(input.path)) return `input path not referenced`;
    return true;
  }],

  // ---- graph_module_tree — text, at least one NODE/DEFINES/SUBSYS line
  ['graph_module_tree', graphModuleTree, [
    { __label: 'path=. (easy)', path: '.' },
    { __label: 'path=mcp/stdio/query (cross)', path: 'mcp/stdio/query' },
    { __label: 'path=does/not/exist (edge)', path: 'does/not/exist' },
  ], (n, input) => {
    if (n.kind !== 'text') return `expected text, got ${n.kind}`;
    if (isNoMatch(n.value)) return true;
    if (input.path === 'does/not/exist') return true; // may just print nothing
    if (!/(NODE|DEFINES|SUBSYS|DIR|TREE|\w+\/)/.test(n.value)) return 'no tree-like content';
    return true;
  }],

  // ---- graph_preflight — text with PREFLIGHT header and tier SAFE|REVIEW|CONFIRM
  ['graph_preflight', graphPreflight, [
    { __label: 'graphHealth (easy)', symbol: 'graphHealth' },
    { __label: 'openExistingDb (cross)', symbol: 'openExistingDb' },
    { __label: 'ZzzNoSymXyz (edge)', symbol: 'ZzzNoSymXyz' },
  ], (n) => {
    if (n.kind !== 'text') return `expected text, got ${n.kind}`;
    if (isNoMatch(n.value)) return true;
    if (!/PREFLIGHT\s+/.test(n.value)) return 'no PREFLIGHT header';
    if (!/\b(SAFE|REVIEW|CONFIRM)\b/.test(n.value)) return 'no SAFE/REVIEW/CONFIRM tier in output';
    return true;
  }],

  // ---- graph_summary — text, NODE header + some context
  ['graph_summary', graphSummary, [
    { __label: 'graphHealth (easy)', symbol: 'graphHealth' },
    { __label: 'openExistingDb (cross)', symbol: 'openExistingDb' },
    { __label: 'ZzzNoSymXyz (edge)', symbol: 'ZzzNoSymXyz' },
  ], (n, input) => {
    if (n.kind !== 'text') return `expected text, got ${n.kind}`;
    if (isNoMatch(n.value)) return true;
    if (!/NODE\s+/.test(n.value)) return 'no NODE header';
    if (input.symbol && input.symbol !== 'ZzzNoSymXyz' && !n.value.includes(input.symbol)) {
      return `symbol not echoed`;
    }
    return true;
  }],

  // ---- graph_report — text containing REPO / LANGS / ENTRY
  ['graph_report', graphReport, [
    { __label: 'default (easy)' },
    { __label: 'top_k=5 (cross)', top_k: 5 },
    { __label: 'top_k=50 (edge)', top_k: 50 },
  ], (n) => {
    if (n.kind !== 'text') return `expected text, got ${n.kind}`;
    if (!/REPO\s+/.test(n.value)) return 'no REPO header';
    if (!/LANGS?\s+/.test(n.value)) return 'no LANGS section';
    return true;
  }],

  // ---- graph_onboard — text with ONBOARD header and SCOPE
  ['graph_onboard', graphOnboard, [
    { __label: 'path=. (easy)', path: '.' },
    { __label: 'path=mcp/stdio (cross)', path: 'mcp/stdio' },
    { __label: 'path=does/not/exist (edge)', path: 'does/not/exist' },
  ], (n) => {
    if (n.kind !== 'text') return `expected text, got ${n.kind}`;
    if (isNoMatch(n.value)) return true;
    if (!/ONBOARD/.test(n.value)) return 'no ONBOARD header';
    return true;
  }],
];

// ------------------------ main ------------------------

async function main() {
  if (!existsSync(GRAPH_DIR)) {
    console.error(`No .aify-graph/ at ${GRAPH_DIR} — run /graph-build-all first.`);
    process.exit(2);
  }

  let commit = 'unknown';
  try { commit = execSync('git rev-parse HEAD', { cwd: REPO_ROOT }).toString().trim(); } catch {}
  let indexedAt = null;
  try {
    const manifest = JSON.parse(readFileSync(join(GRAPH_DIR, 'manifest.json'), 'utf8'));
    indexedAt = manifest.indexedAt ?? null;
  } catch {}

  const report = {
    commit,
    indexedAt,
    generatedAt: new Date().toISOString(),
    verbs: {},
    summary: {
      total_calls: 0,
      passed: 0,
      failed_invariants: [],
      size_highlights: [],
    },
  };

  for (const [verbName, fn, inputs, invariant] of SPECS) {
    const calls = [];
    for (const input of inputs) {
      process.stderr.write(`[probe] ${verbName} · ${input.__label} ... `);
      const result = await runProbe(verbName, fn, input, invariant);
      process.stderr.write(`${result.invariant_passed ? 'ok' : 'FAIL'} (${result.size_bytes}B)\n`);
      calls.push(result);
      report.summary.total_calls++;
      if (result.invariant_passed) {
        report.summary.passed++;
      } else {
        report.summary.failed_invariants.push({
          verb: verbName,
          input: result.input,
          reason: result.reason,
        });
      }
      // flag easy-case bloat (>5kb)
      if (input === inputs[0] && result.size_bytes > 5000) {
        report.summary.size_highlights.push({
          verb: verbName,
          input: result.input,
          size_bytes: result.size_bytes,
          note: 'easy-case >5kb',
        });
      }
    }
    report.verbs[verbName] = calls;
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
  console.error(`\nWrote ${OUT_PATH}`);
  console.error(`total=${report.summary.total_calls} passed=${report.summary.passed} failed=${report.summary.failed_invariants.length}`);

  process.exit(report.summary.failed_invariants.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('probe crashed:', e);
  process.exit(2);
});
