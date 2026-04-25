#!/usr/bin/env node
// Latency reconnaissance for the M0.5 milestone.
//
// Times the lean-visible verbs (graph_pull, graph_consequences, graph_change_plan)
// 3x each on apg (~2k nodes) and an optional medium-scale fixture
// (mem0-fork ~9k nodes by default; pass --repo=PATH to override).
//
// Reports per-verb mean / min / max plus a coarse breakdown of where
// time is spent (rebuild check vs verb work) so M1 packet design knows
// which sources are cheap enough to compose synchronously.
//
// Output: docs/dogfood/latency-profile-2026-04-25.json (or --out=PATH).
//
// Usage:
//   node scripts/verb-latency-profile.mjs
//   node scripts/verb-latency-profile.mjs --repo=C:/path/to/repo --out=path.json

import { writeFileSync } from 'node:fs';
import { graphPull } from '../mcp/stdio/query/verbs/pull.js';
import { graphConsequences } from '../mcp/stdio/query/verbs/consequences.js';
import { graphChangePlan } from '../mcp/stdio/query/verbs/change_plan.js';
import { ensureFresh } from '../mcp/stdio/freshness/orchestrator.js';

const ITERATIONS = 3;

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => a.slice(2).split('=')),
);

const REPOS = [
  {
    id: 'apg',
    label: 'aify-project-graph (small, ~2k nodes)',
    repoRoot: 'C:/Docker/aify-project-graph',
    targets: {
      symbol: 'ensureFresh',
      task_or_feature: 'freshness',
      file_for_consequences: 'mcp/stdio/freshness/orchestrator.js',
    },
  },
  {
    id: 'mem0-fork',
    label: 'mem0-fork (medium, ~9k nodes)',
    repoRoot: args.repo || 'C:/Docker/aify-openmemory/mem0-fork',
    targets: {
      // Picked symbols that exist in mem0; fall back gracefully if not
      symbol: 'Memory',
      task_or_feature: 'graph_memory',
      file_for_consequences: 'mem0/memory/main.py',
    },
  },
];

async function timeIt(label, fn) {
  const t0 = process.hrtime.bigint();
  let result, error;
  try { result = await fn(); }
  catch (e) { error = e.message; }
  const elapsed_ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { label, elapsed_ms, error: error ?? null, ok: !error };
}

async function profileVerb({ name, runner, iterations = ITERATIONS }) {
  const runs = [];
  for (let i = 0; i < iterations; i += 1) {
    runs.push(await timeIt(`${name} run ${i + 1}`, runner));
  }
  const okRuns = runs.filter((r) => r.ok);
  const elapseds = okRuns.map((r) => r.elapsed_ms);
  return {
    name,
    iterations: runs.length,
    successful: okRuns.length,
    runs,
    mean_ms: elapseds.length ? elapseds.reduce((a, b) => a + b, 0) / elapseds.length : null,
    min_ms: elapseds.length ? Math.min(...elapseds) : null,
    max_ms: elapseds.length ? Math.max(...elapseds) : null,
  };
}

async function profileRepo(repoConfig) {
  const { id, label, repoRoot, targets } = repoConfig;
  console.error(`\n[${id}] profiling ${label} (${repoRoot})`);

  // Warm up: pre-rebuild so the timing isn't dominated by initial index build
  // and to verify the snapshot is queryable.
  const warm = await timeIt('warmup ensureFresh', () => ensureFresh({ repoRoot, force: false }));
  console.error(`  warmup: ensureFresh ${warm.elapsed_ms.toFixed(0)}ms ok=${warm.ok}`);
  if (!warm.ok) {
    return { id, label, repoRoot, error: warm.error, warmup: warm };
  }

  const verbs = [
    {
      name: 'graph_pull (file kind, default layers)',
      runner: () => graphPull({ repoRoot, node: targets.file_for_consequences }),
    },
    {
      name: 'graph_pull (file kind, +relations)',
      runner: () => graphPull({
        repoRoot, node: targets.file_for_consequences,
        layers: ['code', 'functionality', 'tasks', 'activity', 'relations'],
      }),
    },
    {
      name: 'graph_pull (feature kind)',
      runner: () => graphPull({ repoRoot, node: targets.task_or_feature }),
    },
    {
      name: 'graph_consequences (file target)',
      runner: () => graphConsequences({ repoRoot, target: targets.file_for_consequences }),
    },
    {
      name: 'graph_consequences (symbol target)',
      runner: () => graphConsequences({ repoRoot, target: targets.symbol }),
    },
    {
      name: 'graph_change_plan (symbol)',
      runner: () => graphChangePlan({ repoRoot, symbol: targets.symbol }),
    },
  ];

  const results = [];
  for (const v of verbs) {
    const r = await profileVerb(v);
    results.push(r);
    console.error(`  ${v.name}: mean=${r.mean_ms?.toFixed(0)}ms min=${r.min_ms?.toFixed(0)}ms max=${r.max_ms?.toFixed(0)}ms`);
  }

  return { id, label, repoRoot, warmup: warm, verbs: results };
}

const out = {
  schema_version: 1,
  ran_at: new Date().toISOString(),
  iterations_per_verb: ITERATIONS,
  repos: [],
};

for (const repoConfig of REPOS) {
  out.repos.push(await profileRepo(repoConfig));
}

// Summary across repos: which verbs cross common thresholds?
const THRESHOLDS_MS = [200, 1000, 2000, 5000];
const summary = { thresholds_ms: THRESHOLDS_MS, exceeded: {} };
for (const repo of out.repos) {
  if (!repo.verbs) continue;
  for (const v of repo.verbs) {
    const key = v.name;
    if (!summary.exceeded[key]) summary.exceeded[key] = {};
    for (const t of THRESHOLDS_MS) {
      summary.exceeded[key][`>${t}ms`] = summary.exceeded[key][`>${t}ms`] || [];
      if (v.mean_ms != null && v.mean_ms > t) {
        summary.exceeded[key][`>${t}ms`].push(repo.id);
      }
    }
  }
}
out.summary = summary;

const outPath = args.out || 'docs/dogfood/latency-profile-2026-04-25.json';
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.error(`\nartifact: ${outPath}`);
