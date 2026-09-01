#!/usr/bin/env node
// Step B's production-consumer arm, end to end through the shipped verb.
//
// PREREGISTERED DISPOSITIONS (fixed before execution, so the result cannot choose the gate):
//   A. Caller isolation succeeds -> B closes extraction/partition AND the consumer claim.
//   B. Isolation fails but shipped output moves from namespace-CONFLATED to namespace-PURE
//      candidates/refusal -> B closes as a prerequisite with a bounded identity-presentation
//      claim and NO caller-set correctness. Name-keyed edge fanout becomes the next defect.
//   C. No shipped output changes at all -> the partition finding closes only the internal
//      extractor substep. Record "carrier produced; no load-bearing consumer demonstrated".
//
// TWO POPULATIONS, REPORTED SEPARATELY:
//   1. TARGET SELECTION — which node ids/qnames the verb resolves the symbol to.
//   2. EDGE ATTRIBUTION — which callers are attached to those targets, in the SHIPPED output.
// If selection isolates while both caller sets stay identical, that is B working and edge
// binding unsound — not "isolation failed".
//
// ⚠ Membership is parsed from rendered OUTPUT LINES and reported beside an INDEPENDENT database
// census, so renderer truncation or an ambiguity refusal cannot masquerade as caller exclusion.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = path.join(REPO, 'tests/fixtures/identity-callers');
const EXPECTED_CALLERS = ['alphaCaller', 'betaCaller'];
const TOP_K = 20;
const DEPTH = 1;
const FILE_FILTER = undefined;
const EDGE_FETCH_CAP = 100; // mirrors callers.js; recorded so a cap hit cannot look like exclusion

function buildRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-callers-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@test');
  git('config', 'user.name', 'test');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'init');
  return dir;
}

function classify(text) {
  if (/^ERROR/m.test(text)) return 'ERROR';
  if (/AMBIGUOUS MATCH/.test(text)) return 'REFUSED_AMBIGUOUS';
  if (/NO CALLERS/.test(text)) return 'NO_CALLERS';
  if (/NO MATCH|no match/.test(text)) return 'NO_MATCH';
  return 'CALLERS_LISTED';
}

// Membership from rendered LINES, not a whole-text substring: a name appearing inside a hint or a
// candidate list is not the same as it being rendered as a caller edge.
function membershipFromOutput(text) {
  const lines = text.split('\n');
  const present = new Set();
  for (const caller of EXPECTED_CALLERS) {
    const re = new RegExp(`(^|[^A-Za-z0-9_])${caller}([^A-Za-z0-9_]|$)`);
    if (lines.some((line) => re.test(line) && !/AMBIGUOUS|Retry|candidates/.test(line))) present.add(caller);
  }
  return [...present].sort();
}

async function arm(checkoutRoot, label) {
  const at = (rel) => pathToFileURL(path.join(checkoutRoot, rel)).href;
  const { extractFile } = await import(at('mcp/stdio/ingest/extractors/generic.js'));
  const { getLanguageConfig } = await import(at('mcp/stdio/ingest/languages/index.js'));
  const { graphIndex } = await import(at('mcp/stdio/query/verbs/index.js'));
  const { graphCallers } = await import(at('mcp/stdio/query/verbs/callers.js'));
  const { expandClassRollupTargets } = await import(at('mcp/stdio/query/verbs/target_rollup.js'));
  const { openDb } = await import(at('mcp/stdio/storage/db.js'));

  console.log(`\n${'='.repeat(76)}\n=== ${label}   ${checkoutRoot}\n${'='.repeat(76)}`);
  console.log(`  ARGS top_k=${TOP_K} depth=${DEPTH} file=${FILE_FILTER ?? '(none)'} edge_fetch_cap=${EDGE_FETCH_CAP}`);

  // ── CONTROL 1 (pre-import): the CALLS refs must exist at EXTRACTION ───────────────────────
  const callersPath = 'src/callers.cpp';
  const callersSrc = fs.readFileSync(path.join(FIXTURE, callersPath), 'utf8');
  const extracted = extractFile({ filePath: callersPath, source: callersSrc, config: getLanguageConfig(callersPath) });
  const nodeById = new Map((extracted.nodes ?? []).map((n) => [n.id, n]));
  const renderRefs = (extracted.refs ?? []).filter((r) => r.relation === 'CALLS' && r.target === 'render');
  const extractedCallers = [...new Set(renderRefs.map((r) => nodeById.get(r.from_id)?.label ?? '?'))].sort();
  console.log(`  CONTROL extraction : ${renderRefs.length} CALLS refs -> 'render' from ${JSON.stringify(extractedCallers)}`);
  const extractionOk = renderRefs.length >= 2 && EXPECTED_CALLERS.every((c) => extractedCallers.includes(c));
  if (!extractionOk) console.log('  ⛔ EXTRACTION CONTROL FAILED — nothing below can be trusted');

  const repoRoot = buildRepo();
  await graphIndex({ repoRoot });
  const db = openDb(path.join(repoRoot, '.aify-graph', 'graph.sqlite'));

  // ── CONTROL 2 (post-import): caller NODES exist, and the edge population is non-empty ─────
  const callerNodes = db.all(
    `SELECT label, id FROM nodes WHERE label IN ('alphaCaller','betaCaller') ORDER BY label`,
  );
  const callerNodeLabels = [...new Set(callerNodes.map((r) => r.label))].sort();
  console.log(`  CONTROL caller nodes: ${JSON.stringify(callerNodeLabels)}`);
  const nodesOk = EXPECTED_CALLERS.every((c) => callerNodeLabels.includes(c));
  if (!nodesOk) console.log('  ⛔ A CALLER NODE IS MISSING — a later absence would be node extraction, not edge admission');

  const edges = db.all(
    `SELECT src.label AS caller, tgt.id AS tid, json_extract(tgt.extra,'$.qname') AS tq, tgt.file_path AS tf
       FROM edges e JOIN nodes src ON src.id = e.from_id JOIN nodes tgt ON tgt.id = e.to_id
      WHERE e.relation = 'CALLS' AND tgt.label = 'render' ORDER BY src.label, tq`,
  );
  console.log(`  CONTROL persisted   : ${edges.length} CALLS edges into a node labelled 'render'${edges.length >= EDGE_FETCH_CAP ? '  ⚠ AT/OVER FETCH CAP' : ''}`);
  for (const e of edges) console.log(`      ${String(e.caller).padEnd(13)} -> ${String(e.tq).padEnd(34)} ${e.tf}`);
  if (edges.length === 0) console.log('  ⛔ EDGE POPULATION EMPTY — isolation cannot be earned from this arm');

  // ── POPULATION 1: TARGET SELECTION ───────────────────────────────────────────────────────
  console.log('  --- population 1: TARGET SELECTION ---');
  for (const symbol of ['alpha::Widget::render', 'beta::Widget::render']) {
    let picked = { targetIds: [] };
    try { picked = expandClassRollupTargets(db, symbol) ?? picked; } catch (error) { console.log(`      ${symbol} THREW ${error.message}`); }
    const qnames = (picked.targetIds ?? []).map((id) =>
      db.get("SELECT json_extract(extra,'$.qname') AS q FROM nodes WHERE id = $id", { id })?.q ?? '(none)').sort();
    console.log(`      ${symbol.padEnd(24)} -> ${qnames.length} target(s) ${JSON.stringify(qnames)}`);
  }

  // ── POPULATION 2: EDGE ATTRIBUTION, from the SHIPPED output ──────────────────────────────
  console.log('  --- population 2: EDGE ATTRIBUTION (shipped graph_callers) ---');
  const raw = {};
  for (const symbol of ['alpha::Widget::render', 'beta::Widget::render', 'render']) {
    const text = String(await graphCallers({ repoRoot, symbol, top_k: TOP_K, depth: DEPTH, file: FILE_FILTER }));
    raw[symbol] = text;
    // independent DB census for the same symbol's selected targets
    let ids = [];
    try { ids = expandClassRollupTargets(db, symbol)?.targetIds ?? []; } catch { /* recorded above */ }
    const census = ids.length
      ? db.all(`SELECT DISTINCT n.label AS caller FROM edges e JOIN nodes n ON n.id = e.from_id
                 WHERE e.to_id IN (${ids.map((_, i) => `$t${i}`).join(',')}) AND e.relation='CALLS' ORDER BY caller`,
        Object.fromEntries(ids.map((id, i) => [`t${i}`, id]))).map((r) => r.caller)
      : [];
    console.log(`      ${symbol.padEnd(24)} disposition=${classify(text).padEnd(18)} output=${JSON.stringify(membershipFromOutput(text))}  dbCensus=${JSON.stringify(census)}`);
  }

  console.log('  --- raw output, bare query (truncation and refusals must stay visible) ---');
  console.log(raw.render.split('\n').map((l) => `      | ${l}`).join('\n'));
  console.log('  --- raw output, alpha-qualified ---');
  console.log(raw['alpha::Widget::render'].split('\n').map((l) => `      | ${l}`).join('\n'));

  fs.rmSync(repoRoot, { recursive: true, force: true });
}

await arm(process.argv[2] ?? 'C:/Docker/apg-preb', 'pre-B');
await arm(REPO, 'post-B');
