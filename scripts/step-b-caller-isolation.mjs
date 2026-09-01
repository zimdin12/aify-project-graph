#!/usr/bin/env node
// Step B's production-consumer arm, end to end through the shipped verb.
//
// PREREGISTERED DISPOSITIONS (fixed before the first execution, so the result could not choose
// the gate). The transcript landed on B.
//   A. Caller isolation succeeds -> B closes extraction/partition AND the consumer claim.
//   B. Isolation fails but shipped output moves namespace-CONFLATED to namespace-PURE candidate
//      identities -> B closes as a prerequisite, bounded identity-presentation claim, NO
//      caller-set correctness.
//   C. Nothing observable changes -> partition finding closes only the internal extractor substep.
//
// TWO POPULATIONS, REPORTED SEPARATELY:
//   1. TARGET SELECTION  — which candidate identities the shipped verb renders.
//   2. EDGE ATTRIBUTION  — which callers attach to those targets.
// Collapsing them would hide where a failure lives.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CPP_FIXTURE = path.join(REPO, 'tests/fixtures/identity-callers');
const JS_FIXTURE = path.join(REPO, 'tests/fixtures/identity-callers-js');
const EXPECTED_CALLERS = ['alphaCaller', 'betaCaller'];
const DEFINITION_TYPES = new Set(['Method', 'Function']);
const TOP_K = 20;
const DEPTH = 1;
const FILE_FILTER = undefined;
const EDGE_FETCH_CAP = 100; // mirrors callers.js (not exported); recorded, never asserted on

function buildRepo(fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-callers-'));
  fs.cpSync(fixture, dir, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@test');
  git('config', 'user.name', 'test');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'init');
  return dir;
}

// ⛔ FAIL-CLOSED ELIGIBILITY. An edge that EXISTS is not an edge that REACHES A DEFINITION.
//
// The first run of this arm passed two controls — "CALLS edges exist" and "both caller nodes
// exist" — while proving nothing about attribution, because every edge terminated on an
// unresolved External stub. Non-empty is not relevant. This returns a TYPED verdict with exact
// counts and membership, never a pass/fail, so an arm that cannot measure attribution says so
// instead of reporting a caller absence that belongs to the edge layer.
function attributionEligibility(edges, expectedCallers) {
  const concrete = edges.filter((e) => DEFINITION_TYPES.has(e.ttype));
  const covered = expectedCallers.filter((caller) =>
    concrete.some((e) => e.caller === caller));
  const byType = edges.reduce((acc, e) => {
    acc[e.ttype ?? 'null'] = (acc[e.ttype ?? 'null'] ?? 0) + 1;
    return acc;
  }, {});
  const detail = `edges=${edges.length} concrete=${concrete.length} byTargetType=${JSON.stringify(byType)} callersWithConcreteEdge=${JSON.stringify(covered)}`;
  if (edges.length === 0) return { status: 'UNAVAILABLE', reason: 'NO_EDGES', detail };
  if (concrete.length === 0) return { status: 'UNAVAILABLE', reason: 'ALL_TARGETS_UNRESOLVED', detail };
  if (covered.length < expectedCallers.length) {
    return { status: 'UNAVAILABLE', reason: 'CALLER_WITHOUT_CONCRETE_EDGE', detail };
  }
  return { status: 'AVAILABLE', reason: 'EVERY_EXPECTED_CALLER_HAS_A_CONCRETE_TARGET', detail };
}

function classify(text) {
  if (/^ERROR/m.test(text)) return 'ERROR';
  if (/AMBIGUOUS MATCH/.test(text)) return 'REFUSED_AMBIGUOUS';
  if (/NO CALLERS/.test(text)) return 'NO_CALLERS';
  if (/NO MATCH|no match/.test(text)) return 'NO_MATCH';
  return 'CALLERS_LISTED';
}

// Membership from rendered LINES, not whole-text substring: a name inside a candidate list or a
// retry hint is not the same as it being rendered as a caller edge.
function membershipFromOutput(text, callers) {
  const lines = text.split('\n');
  return callers.filter((caller) => {
    const re = new RegExp(`(^|[^A-Za-z0-9_])${caller}([^A-Za-z0-9_]|$)`);
    return lines.some((line) => re.test(line) && !/AMBIGUOUS|Retry|candidates/.test(line));
  }).sort();
}

async function loadArm(checkoutRoot) {
  const at = (rel) => pathToFileURL(path.join(checkoutRoot, rel)).href;
  return {
    extractFile: (await import(at('mcp/stdio/ingest/extractors/generic.js'))).extractFile,
    getLanguageConfig: (await import(at('mcp/stdio/ingest/languages/index.js'))).getLanguageConfig,
    graphIndex: (await import(at('mcp/stdio/query/verbs/index.js'))).graphIndex,
    graphCallers: (await import(at('mcp/stdio/query/verbs/callers.js'))).graphCallers,
    expandClassRollupTargets: (await import(at('mcp/stdio/query/verbs/target_rollup.js'))).expandClassRollupTargets,
    openDb: (await import(at('mcp/stdio/storage/db.js'))).openDb,
  };
}

function edgesInto(db, label) {
  return db.all(
    `SELECT src.label AS caller, tgt.id AS tid, tgt.type AS ttype,
            json_extract(tgt.extra,'$.qname') AS tq, tgt.file_path AS tf
       FROM edges e JOIN nodes src ON src.id = e.from_id JOIN nodes tgt ON tgt.id = e.to_id
      WHERE e.relation = 'CALLS' AND tgt.label = $label
      ORDER BY src.label, tq`,
    { label },
  );
}

async function arm(checkoutRoot, label) {
  const api = await loadArm(checkoutRoot);
  console.log(`\n${'='.repeat(76)}\n=== ${label}   ${checkoutRoot}\n${'='.repeat(76)}`);
  console.log(`  ARGS top_k=${TOP_K} depth=${DEPTH} file=${FILE_FILTER ?? '(none)'} edge_fetch_cap=${EDGE_FETCH_CAP}`);

  // ── CONTROL 1 (pre-import): the CALLS refs exist at EXTRACTION ────────────────────────────
  const callersPath = 'src/callers.cpp';
  const callersSrc = fs.readFileSync(path.join(CPP_FIXTURE, callersPath), 'utf8');
  const extracted = api.extractFile({ filePath: callersPath, source: callersSrc, config: api.getLanguageConfig(callersPath) });
  const nodeById = new Map((extracted.nodes ?? []).map((n) => [n.id, n]));
  const renderRefs = (extracted.refs ?? []).filter((r) => r.relation === 'CALLS' && r.target === 'render');
  const extractedCallers = [...new Set(renderRefs.map((r) => nodeById.get(r.from_id)?.label ?? '?'))].sort();
  console.log(`  CONTROL extraction  : ${renderRefs.length} CALLS refs -> 'render' from ${JSON.stringify(extractedCallers)}`);
  if (!(renderRefs.length >= 2 && EXPECTED_CALLERS.every((c) => extractedCallers.includes(c)))) {
    console.log('  ⛔ EXTRACTION CONTROL FAILED — nothing below can be trusted');
  }

  const repoRoot = buildRepo(CPP_FIXTURE);
  await api.graphIndex({ repoRoot });
  const db = api.openDb(path.join(repoRoot, '.aify-graph', 'graph.sqlite'));

  // ── CONTROL 2 (post-import): caller NODES exist ───────────────────────────────────────────
  const callerNodeLabels = [...new Set(db.all(
    "SELECT label FROM nodes WHERE label IN ('alphaCaller','betaCaller')").map((r) => r.label))].sort();
  console.log(`  CONTROL caller nodes: ${JSON.stringify(callerNodeLabels)}`);
  if (!EXPECTED_CALLERS.every((c) => callerNodeLabels.includes(c))) {
    console.log('  ⛔ A CALLER NODE IS MISSING — a later absence would be node extraction, not edge admission');
  }

  // ── CONTROL 3: fail-closed attribution eligibility ────────────────────────────────────────
  const edges = edgesInto(db, 'render');
  for (const e of edges) console.log(`      ${String(e.caller).padEnd(13)} -> type=${String(e.ttype).padEnd(9)} qname=${String(e.tq).padEnd(28)} ${e.tf || '(no file)'}`);
  const eligibility = attributionEligibility(edges, EXPECTED_CALLERS);
  console.log(`  ATTRIBUTION ${eligibility.status}: ${eligibility.reason}`);
  console.log(`      ${eligibility.detail}`);
  if (eligibility.status === 'UNAVAILABLE') {
    console.log('      ⛔ Any "caller absent" below is the EDGE LAYER, not namespace isolation.');
  }

  // ── POPULATION 1: TARGET SELECTION ────────────────────────────────────────────────────────
  console.log('  --- population 1: TARGET SELECTION (shipped candidate identities) ---');
  const raw = {};
  for (const symbol of ['alpha::Widget::render', 'beta::Widget::render', 'render']) {
    const text = String(await api.graphCallers({ repoRoot, symbol, top_k: TOP_K, depth: DEPTH, file: FILE_FILTER }));
    raw[symbol] = text;
    let ids = [];
    try { ids = api.expandClassRollupTargets(db, symbol)?.targetIds ?? []; } catch { /* refusal path */ }
    console.log(`      ${symbol.padEnd(24)} disposition=${classify(text).padEnd(18)} renderedCallers=${JSON.stringify(membershipFromOutput(text, EXPECTED_CALLERS))} selectedTargets=${ids.length}`);
  }
  console.log('  --- raw: bare query ---');
  console.log(raw.render.split('\n').map((l) => `      | ${l}`).join('\n'));
  console.log('  --- raw: alpha-qualified ---');
  console.log(raw['alpha::Widget::render'].split('\n').map((l) => `      | ${l}`).join('\n'));

  try { db.close(); } catch { /* already closed */ }
  try { fs.rmSync(repoRoot, { recursive: true, force: true }); } catch { /* Windows handle */ }
}

// ── POSITIVE CONTROL FOR THE ELIGIBILITY PREDICATE ──────────────────────────────────────────
// Without this, a predicate that ALWAYS answers UNAVAILABLE would pass every arm unnoticed —
// which is exactly the failure mode the first run of this script demonstrated. This fixture has
// a concrete Function target for each expected caller, so the predicate must say AVAILABLE.
async function positiveControl() {
  const api = await loadArm(REPO);
  console.log(`\n${'='.repeat(76)}\n=== POSITIVE CONTROL — the predicate must be able to say AVAILABLE\n${'='.repeat(76)}`);
  const repoRoot = buildRepo(JS_FIXTURE);
  await api.graphIndex({ repoRoot });
  const db = api.openDb(path.join(repoRoot, '.aify-graph', 'graph.sqlite'));

  const helperEdges = [...edgesInto(db, 'alphaHelper'), ...edgesInto(db, 'betaHelper')];
  for (const e of helperEdges) console.log(`      ${String(e.caller).padEnd(13)} -> type=${String(e.ttype).padEnd(9)} ${e.tf}`);
  const verdict = attributionEligibility(helperEdges, EXPECTED_CALLERS);
  console.log(`  ATTRIBUTION ${verdict.status}: ${verdict.reason}`);
  console.log(`      ${verdict.detail}`);
  console.log(`  ${verdict.status === 'AVAILABLE' ? '✓ predicate discriminates' : '⛔ PREDICATE IS A DEAD GUARD — it cannot say AVAILABLE'}`);

  // Same fixture, METHOD call rather than a plain function call. Recorded because it shows the
  // unresolved-target problem is NOT C++-specific: `w.render()` lands on External in JS too.
  const methodEdges = edgesInto(db, 'render');
  const methodVerdict = attributionEligibility(methodEdges, EXPECTED_CALLERS);
  console.log(`  same fixture, METHOD call 'render': ${methodVerdict.status} — ${methodVerdict.detail}`);

  try { db.close(); } catch { /* already closed */ }
  try { fs.rmSync(repoRoot, { recursive: true, force: true }); } catch { /* Windows handle */ }
}

await arm(process.argv[2] ?? 'C:/Docker/apg-preb', 'pre-B');
await arm(REPO, 'post-B');
await positiveControl();
