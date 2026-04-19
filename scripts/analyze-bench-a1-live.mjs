#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function pctDelta(a, b) {
  if (a == null || b == null || b === 0) return null;
  return ((a - b) / b) * 100;
}

function fmtPct(n) {
  return n == null ? 'n/a' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function fmtNum(n) {
  return n == null ? 'n/a' : Math.round(n).toLocaleString('en-US');
}

const args = process.argv.slice(2);
let outPath = null;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') outPath = args[++i];
  else files.push(args[i]);
}
if (files.length === 0) {
  console.error('usage: node scripts/analyze-bench-a1-live.mjs [--out path.md] bench-a1-live-*.json');
  process.exit(1);
}

const runs = [];
for (const file of files) {
  const json = JSON.parse(readFileSync(resolve(file), 'utf8'));
  for (const r of json.results || []) runs.push({ ...r, sourceFile: file });
}

const groups = new Map();
for (const r of runs) {
  const taskShape = r.taskShape || 'unknown';
  const key = `${r.repoId}::${taskShape}::${r.arm}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

const rows = [];
for (const [key, items] of groups.entries()) {
  const [repoId, taskShape, arm] = key.split('::');
  const ok = items.filter(r => r.code === 0);
  rows.push({
    repoId,
    taskShape,
    arm,
    runs: items.length,
    usable: ok.length,
    medianTokens: median(ok.map(r => r.effTok).filter(v => typeof v === 'number')),
    medianDurationMs: median(ok.map(r => r.dur).filter(v => typeof v === 'number')),
    medianCommands: median(ok.map(r => r.commands).filter(v => typeof v === 'number')),
    medianMcpCalls: median(ok.map(r => Array.isArray(r.mcpCalls) ? r.mcpCalls.length : 0)),
    passRate: ok.length ? ok.filter(r => r.score?.pass).length / ok.length : 0,
  });
}
rows.sort((a, b) => a.repoId.localeCompare(b.repoId) || a.taskShape.localeCompare(b.taskShape) || a.arm.localeCompare(b.arm));

const comparisons = [];
const pairKeys = [...new Set(rows.map(r => `${r.repoId}::${r.taskShape}`))];
for (const pair of pairKeys) {
  const [repoId, taskShape] = pair.split('::');
  const brief = rows.find(r => r.repoId === repoId && r.taskShape === taskShape && r.arm === 'brief-only');
  const lean = rows.find(r => r.repoId === repoId && r.taskShape === taskShape && r.arm === 'lean-mcp');
  if (!brief || !lean) continue;
  comparisons.push({
    repoId,
    taskShape,
    briefTokens: brief.medianTokens,
    leanTokens: lean.medianTokens,
    tokenDeltaPct: pctDelta(brief.medianTokens, lean.medianTokens),
    briefPass: brief.passRate,
    leanPass: lean.passRate,
    briefDurMs: brief.medianDurationMs,
    leanDurMs: lean.medianDurationMs,
    durDeltaPct: pctDelta(brief.medianDurationMs, lean.medianDurationMs),
    briefMcp: brief.medianMcpCalls,
    leanMcp: lean.medianMcpCalls,
  });
}
comparisons.sort((a, b) => a.repoId.localeCompare(b.repoId) || a.taskShape.localeCompare(b.taskShape));

const md = [];
md.push('# Bench A1 Live Analysis');
md.push('');
md.push(`Artifacts: ${files.map(f => `\`${f}\``).join(', ')}`);
md.push('');
md.push('## Per-arm summary');
md.push('');
md.push('| Repo | Task | Arm | Runs | Usable | Median eff tok | Median dur | Pass rate | Median cmds | Median MCP |');
md.push('|---|---|---|---:|---:|---:|---:|---:|---:|---:|');
for (const r of rows) {
  md.push(`| ${r.repoId} | ${r.taskShape} | ${r.arm} | ${r.runs} | ${r.usable} | ${fmtNum(r.medianTokens)} | ${fmtNum(r.medianDurationMs)} ms | ${(r.passRate * 100).toFixed(0)}% | ${fmtNum(r.medianCommands)} | ${fmtNum(r.medianMcpCalls)} |`);
}
md.push('');
md.push('## Brief vs lean comparison');
md.push('');
md.push('| Repo | Task | Brief tok | Lean tok | Token delta | Brief pass | Lean pass | Brief dur | Lean dur | Dur delta | Lean MCP |');
md.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const c of comparisons) {
  md.push(`| ${c.repoId} | ${c.taskShape} | ${fmtNum(c.briefTokens)} | ${fmtNum(c.leanTokens)} | ${fmtPct(c.tokenDeltaPct)} | ${(c.briefPass * 100).toFixed(0)}% | ${(c.leanPass * 100).toFixed(0)}% | ${fmtNum(c.briefDurMs)} ms | ${fmtNum(c.leanDurMs)} ms | ${fmtPct(c.durDeltaPct)} | ${fmtNum(c.leanMcp)} |`);
}
md.push('');
md.push('## Notes');
md.push('');
md.push('- Effective tokens = `input_tokens - cached_input_tokens + output_tokens`.');
md.push('- Negative token delta means brief-only is cheaper than lean-MCP.');
md.push('- Lean MCP median MCP calls is a direct product-routing signal.');

const output = md.join('\n') + '\n';
if (outPath) {
  writeFileSync(resolve(outPath), output);
  console.log(`wrote ${outPath}`);
} else {
  process.stdout.write(output);
}
