#!/usr/bin/env node
// Plan #17 D: codegraph-style benchmark harness.
//
// Mirrors github.com/colbymchenry/codegraph's measured methodology:
// headless `claude -p` runs with --strict-mcp-config, N runs per arm,
// median reported. Two arms per query: WITH = APG MCP server enabled,
// WITHOUT = empty MCP config. Built-in Read/Grep/Bash stay available
// to both. Metrics: cost_usd, total tokens, wall-clock, tool calls.
//
// Per senior-dev's lock: dogfood/exploratory, NOT in the standard unit
// suite. Dry-run/fixture mode lets CI exercise the harness logic
// without real `claude -p` credentials.
//
// Usage:
//   node scripts/bench-ab.mjs --config bench/example.json
//   node scripts/bench-ab.mjs --config bench/example.json --dry-run
//   node scripts/bench-ab.mjs --config bench/example.json --runs 4
//
// Config file shape (JSON):
//   {
//     "name": "apg vs no-graph on Sand Castle",
//     "repos": [
//       { "id": "sand_castle", "path": "/path/to/repo",
//         "query": "How does the gravity field compute step()?" }
//     ],
//     "runs": 4,                                  // runs per arm; default 4
//     "claudeBin": "claude",                      // resolvable from PATH
//     "withMcpConfig": ".claude/mcp.with-apg.json",
//     "withoutMcpConfig": ".claude/mcp.empty.json",
//     "timeoutMs": 600000                         // per-run cap
//   }
//
// Output: ./bench/results-<timestamp>.json with the full per-run data
// plus a summary table to stdout.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_RUNS = 4;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function usage() {
  console.error('Usage: bench-ab.mjs --config <path> [--dry-run] [--runs N] [--out <path>]');
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { dryRun: false, runs: null, configPath: null, outPath: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--config') opts.configPath = argv[++i];
    else if (a === '--runs') opts.runs = Number(argv[++i]);
    else if (a === '--out') opts.outPath = argv[++i];
    else if (a === '-h' || a === '--help') usage();
    else { console.error(`unknown arg: ${a}`); usage(); }
  }
  if (!opts.configPath) usage();
  return opts;
}

function loadConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const cfg = JSON.parse(raw);
  if (!Array.isArray(cfg.repos) || cfg.repos.length === 0) {
    throw new Error('config.repos must be a non-empty array');
  }
  return cfg;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function pctChange(withVal, withoutVal) {
  if (!withoutVal || withoutVal === 0) return null;
  return ((withVal - withoutVal) / withoutVal) * 100;
}

// Run `claude -p` once and parse the JSON envelope (--output-format json).
// Returns { ok, cost_usd, tokens, durationMs, toolCalls, raw }.
// When opts.dryRun, returns synthetic numbers so CI / harness tests work.
function runOne({ claudeBin, repoPath, query, mcpConfigPath, timeoutMs, dryRun, arm, runIndex, repoId }) {
  if (dryRun) {
    // Deterministic synthetic numbers — varied per arm/run so the median
    // computation has something to bite on. WITH arm is artificially cheaper
    // to mirror real-world expectations; CI just verifies the SHAPE.
    const baseCost = arm === 'with' ? 0.40 : 0.65;
    const baseTokens = arm === 'with' ? 500_000 : 1_400_000;
    const baseDur = arm === 'with' ? 60_000 : 120_000;
    const baseTools = arm === 'with' ? 8 : 22;
    const jitter = (i) => 1 + ((i % 3) - 1) * 0.05; // -5%, 0, +5%
    return {
      ok: true,
      cost_usd: +(baseCost * jitter(runIndex)).toFixed(4),
      tokens: Math.round(baseTokens * jitter(runIndex)),
      durationMs: Math.round(baseDur * jitter(runIndex)),
      toolCalls: Math.round(baseTools * jitter(runIndex)),
      raw: { dryRun: true, arm, runIndex, repoId }
    };
  }

  const args = [
    '-p', query,
    '--mcp-config', mcpConfigPath,
    '--strict-mcp-config',
    '--output-format', 'json',
  ];
  const started = Date.now();
  const r = spawnSync(claudeBin, args, {
    cwd: repoPath,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const durationMs = Date.now() - started;
  if (r.status !== 0 || !r.stdout) {
    return { ok: false, error: r.stderr || `exit=${r.status}`, durationMs };
  }
  let parsed;
  try { parsed = JSON.parse(r.stdout); } catch (e) {
    return { ok: false, error: 'failed to parse claude stdout JSON', durationMs };
  }
  return {
    ok: true,
    cost_usd: parsed.total_cost_usd ?? null,
    tokens: (parsed.input_tokens ?? 0) + (parsed.cache_creation_input_tokens ?? 0) + (parsed.cache_read_input_tokens ?? 0) + (parsed.output_tokens ?? 0),
    durationMs,
    toolCalls: parsed.num_tool_uses ?? null,
    raw: parsed,
  };
}

function summarizeArm(runs) {
  const ok = runs.filter(r => r.ok);
  if (!ok.length) return null;
  return {
    runs: runs.length,
    successful: ok.length,
    cost_usd_median: median(ok.map(r => r.cost_usd).filter(v => v != null)),
    tokens_median: median(ok.map(r => r.tokens).filter(v => v != null)),
    durationMs_median: median(ok.map(r => r.durationMs).filter(v => v != null)),
    toolCalls_median: median(ok.map(r => r.toolCalls).filter(v => v != null)),
  };
}

function summarizeRepo({ repo, withArm, withoutArm }) {
  if (!withArm || !withoutArm) return null;
  return {
    repoId: repo.id,
    query: repo.query,
    delta: {
      cost_pct: pctChange(withArm.cost_usd_median, withoutArm.cost_usd_median),
      tokens_pct: pctChange(withArm.tokens_median, withoutArm.tokens_median),
      duration_pct: pctChange(withArm.durationMs_median, withoutArm.durationMs_median),
      toolCalls_pct: pctChange(withArm.toolCalls_median, withoutArm.toolCalls_median),
    },
  };
}

function formatTable(perRepoSummary) {
  const head = `| Repo | Cost Δ | Tokens Δ | Time Δ | Tool calls Δ |\n|---|---|---|---|---|`;
  const rows = perRepoSummary.map(s =>
    `| ${s.repoId} | ${fmtPct(s.delta.cost_pct)} | ${fmtPct(s.delta.tokens_pct)} | ${fmtPct(s.delta.duration_pct)} | ${fmtPct(s.delta.toolCalls_pct)} |`
  );
  return [head, ...rows].join('\n');
}

function fmtPct(v) {
  if (v == null) return '—';
  const sign = v < 0 ? '' : '+';
  return `${sign}${v.toFixed(1)}%`;
}

async function main() {
  const opts = parseArgs(process.argv);
  const cfg = loadConfig(opts.configPath);
  const runs = opts.runs ?? cfg.runs ?? DEFAULT_RUNS;
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const claudeBin = cfg.claudeBin ?? 'claude';

  const startedAt = new Date().toISOString();
  const results = {
    schema_version: '0.1',
    startedAt,
    runs,
    dryRun: opts.dryRun,
    config: { name: cfg.name ?? 'unnamed', source: opts.configPath },
    repos: [],
  };

  for (const repo of cfg.repos) {
    const armRuns = { with: [], without: [] };
    for (const arm of ['with', 'without']) {
      const mcpConfigPath = arm === 'with' ? cfg.withMcpConfig : cfg.withoutMcpConfig;
      for (let i = 0; i < runs; i++) {
        const r = runOne({
          claudeBin, repoPath: repo.path, query: repo.query,
          mcpConfigPath, timeoutMs, dryRun: opts.dryRun,
          arm, runIndex: i, repoId: repo.id,
        });
        armRuns[arm].push(r);
        if (!opts.dryRun) {
          process.stderr.write(`[${repo.id}/${arm}/${i + 1}] ${r.ok ? 'ok' : 'FAIL: ' + r.error}\n`);
        }
      }
    }
    const withSummary = summarizeArm(armRuns.with);
    const withoutSummary = summarizeArm(armRuns.without);
    results.repos.push({
      repo,
      withArm: { runs: armRuns.with, summary: withSummary },
      withoutArm: { runs: armRuns.without, summary: withoutSummary },
      summary: summarizeRepo({ repo, withArm: withSummary, withoutArm: withoutSummary }),
    });
  }

  const outPath = opts.outPath ?? path.join('bench', `results-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));

  console.log(`Wrote ${outPath}\n`);
  const perRepoSummary = results.repos.map(r => r.summary).filter(Boolean);
  if (perRepoSummary.length) console.log(formatTable(perRepoSummary));
  else console.log('(no successful arms; check stderr)');
}

main().catch(e => { console.error(e?.stack || e); process.exit(1); });
