#!/usr/bin/env node
// Locally-runnable A1 benchmark — Cell 3 (compact vs verbose output).
// Passive-tax and brief-vs-MCP cells require codex exec and go through
// scripts/ab-runner.mjs with --tasks=a1.
//
// Runs in-process: toggles AIFY_GRAPH_OUTPUT between calls (dev's renderer
// fix makes compact resolution recompute per-call). Verifies information
// preservation: every path:line and relation in verbose must appear in
// compact.

import { A1_CELLS } from '../tests/ab/tasks-a1.mjs';
import { graphImpact } from '../mcp/stdio/query/verbs/impact.js';
import { graphCallers } from '../mcp/stdio/query/verbs/callers.js';
import { graphPath } from '../mcp/stdio/query/verbs/path.js';
import { graphReport } from '../mcp/stdio/query/verbs/report.js';
import { graphChangePlan } from '../mcp/stdio/query/verbs/change_plan.js';

const VERBS = {
  graph_impact: graphImpact,
  graph_callers: graphCallers,
  graph_path: graphPath,
  graph_report: graphReport,
  graph_change_plan: graphChangePlan,
};

const REPO_ROOTS = {
  'aify-project-graph': '/mnt/c/Docker/aify-project-graph',
  'lc-api': '/mnt/c/Users/Administrator/lc-api',
  'echoes': '/mnt/c/Users/Administrator/echoes_of_the_fallen',
};

function tokens(s) { return Math.ceil(s.length / 4); }

function anchorsIn(text) {
  const paths = new Set((text.match(/[\w\-/.]+\.(?:js|ts|py|php|cpp|h|hpp|go|rs|java):\d+/g) ?? []));
  const relations = new Set((text.match(/\b(CALLS|REFERENCES|USES_TYPE|TESTS|INVOKES|PASSES_THROUGH|IMPLEMENTS|EXTENDS)\b/g) ?? []));
  return { paths, relations };
}

async function runLocalCell(id, cell) {
  const repo = REPO_ROOTS[cell.repoId];
  if (!repo) return { id, status: 'SKIP', reason: 'repo root unknown' };
  const fn = VERBS[cell.verb];
  if (!fn) return { id, status: 'SKIP', reason: `verb ${cell.verb} not in local set` };

  const args = { repoRoot: repo, symbol: cell.symbol, ...(cell.args ?? {}) };

  process.env.AIFY_GRAPH_OUTPUT = 'verbose';
  const verbose = await fn(args);
  process.env.AIFY_GRAPH_OUTPUT = 'compact';
  const compact = await fn(args);
  delete process.env.AIFY_GRAPH_OUTPUT;

  const vTok = tokens(verbose);
  const cTok = tokens(compact);
  const deltaPct = Math.round(((cTok - vTok) / vTok) * 100);

  const vAnchors = anchorsIn(verbose);
  const cAnchors = anchorsIn(compact);
  const lostPaths = [...vAnchors.paths].filter(p => !cAnchors.paths.has(p));
  const lostRelations = [...vAnchors.relations].filter(r => !cAnchors.relations.has(r));
  const infoPreserved = lostPaths.length === 0 && lostRelations.length === 0;

  const passesToken = deltaPct <= (cell.pass_criteria.token_delta_max_pct ?? 0);
  const passes = passesToken && infoPreserved;

  return {
    id,
    status: passes ? 'PASS' : 'FAIL',
    verb: cell.verb,
    verbose_tokens: vTok,
    compact_tokens: cTok,
    delta_pct: deltaPct,
    info_preserved: infoPreserved,
    lost_paths: lostPaths.slice(0, 3),
    lost_relations: lostRelations,
    target_max_pct: cell.pass_criteria.token_delta_max_pct,
  };
}

const results = [];
for (const [id, cell] of Object.entries(A1_CELLS)) {
  if (cell.mode !== 'local') continue;
  process.stdout.write(`  running ${id}... `);
  try {
    const r = await runLocalCell(id, cell);
    results.push(r);
    console.log(r.status);
  } catch (err) {
    results.push({ id, status: 'ERROR', error: err.message });
    console.log('ERROR:', err.message);
  }
}

console.log('\n=== A1 local bench (Cell 3: compact vs verbose output) ===');
for (const r of results) {
  if (r.status === 'SKIP' || r.status === 'ERROR') {
    console.log(`${r.status} ${r.id}: ${r.reason || r.error}`);
    continue;
  }
  console.log(
    `${r.status} ${r.id.padEnd(30)} verbose=${String(r.verbose_tokens).padStart(4)}tok ` +
    `compact=${String(r.compact_tokens).padStart(4)}tok ${String(r.delta_pct).padStart(4)}% ` +
    `info=${r.info_preserved ? 'OK' : 'LOST'}${r.lost_paths.length ? ' lost=' + r.lost_paths.join(',') : ''}`
  );
}

const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
