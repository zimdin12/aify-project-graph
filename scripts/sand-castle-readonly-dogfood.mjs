#!/usr/bin/env node
// Plan #19 — multi-runtime read-only Sand Castle dogfood.
//
// Drives the three locked Sand Castle questions (Q1 step refs, Q2
// sample_pressure hover, Q3 body_count absence-refusal) via direct
// APG module calls. Same shape graph-senior-dev's codex arm produced.
//
// HARD CONSTRAINT: read-only. Never writes to the target tree. No
// temp-patch diagnostics question (T6 from the cpp-microbench) —
// other agents are actively building Sand Castle.
//
// Outputs a JSON envelope to stdout (and optionally --out <path>)
// matching the codex-arm shape so multi-runtime numbers can be
// cross-compared directly.
//
// Usage:
//   node scripts/sand-castle-readonly-dogfood.mjs \
//     --project-root /mnt/c/Users/Administrator/sand_castle
//   node scripts/sand-castle-readonly-dogfood.mjs --project-root ... --out bench/dogfood.json
//
// Honest behavior when clangd isn't on PATH:
// the code_intel_* verbs fail with `language_server_missing`. This
// script surfaces that as an envelope-level skip ("blocker") rather
// than fabricating numbers — matches the operator-instruction "report
// honestly when blocked."

import fs from 'node:fs';
import path from 'node:path';
import {
  codeIntelReferences,
  codeIntelDefinitions,
  codeIntelHover,
} from '../mcp/stdio/query/verbs/code_intel_live.js';
import { shutdownAllSessions, _resetSessions } from '../mcp/stdio/code-intel/live.js';
import os from 'node:os';

function usage() {
  console.error('Usage: sand-castle-readonly-dogfood.mjs --project-root <abs> [--out <path>] [--runtime <label>]');
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { projectRoot: null, outPath: null, runtime: 'claude-code-direct-call' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-root') opts.projectRoot = argv[++i];
    else if (a === '--out') opts.outPath = argv[++i];
    else if (a === '--runtime') opts.runtime = argv[++i];
    else if (a === '-h' || a === '--help') usage();
    else { console.error(`unknown arg: ${a}`); usage(); }
  }
  if (!opts.projectRoot) usage();
  return opts;
}

function approxTokens(obj) {
  // Cheap proxy: 1 token ≈ 4 chars of JSON. Good enough for cross-runtime
  // delta comparison; not load-bearing precision.
  try { return Math.round(JSON.stringify(obj).length / 4); } catch { return null; }
}

async function timed(fn) {
  const t = Date.now();
  const result = await fn();
  return { result, latencyMs: Date.now() - t };
}

function isMissingLspError(envelope) {
  return envelope?.status === 'error'
    && envelope?.errors?.[0]?.code === 'language_server_missing';
}

async function runQ1(repoRoot) {
  const { result, latencyMs } = await timed(() => codeIntelReferences({
    repoRoot, file: 'sim/fields/Gravity.cpp', line: 719, col: 45,
  }));
  return {
    question: 'Q1 refs GravityFieldService::step',
    mcp_tool_calls: 0,
    direct_code_intel_calls: 1,
    approx_response_tokens: approxTokens(result),
    latency_ms: latencyMs,
    status: result?.status,
    callsites: (result?.referenceLocations || []).map(r => ({
      file: r.file,
      line: r.range?.start?.line,
      col: r.range?.start?.col,
    })),
    evidence: result?.evidence ? {
      exhaustive: result.evidence.exhaustive,
      cause: result.evidence.cause,
    } : null,
    blocker: isMissingLspError(result) ? 'language_server_missing (clangd not on PATH)' : null,
  };
}

async function runQ2(repoRoot) {
  const { result, latencyMs } = await timed(() => codeIntelHover({
    repoRoot, file: 'sim/fields/Fluid.cpp', line: 479, col: 20,
  }));
  return {
    question: 'Q2 hover SampledFluidField::sample_pressure_adjusted_density_limit_cell',
    mcp_tool_calls: 0,
    direct_code_intel_calls: 1,
    approx_response_tokens: approxTokens(result),
    latency_ms: latencyMs,
    status: result?.status,
    hover_content: result?.hover?.content ?? null,
    blocker: isMissingLspError(result) ? 'language_server_missing (clangd not on PATH)' : null,
  };
}

async function runQ3(repoRoot) {
  const { result, latencyMs } = await timed(() => codeIntelReferences({
    repoRoot, file: 'sim/fields/Gravity.cpp', line: 584, col: 34,
  }));
  const ev = result?.evidence ?? {};
  const safeToClaimDead = ev.exhaustive === true;
  return {
    question: 'Q3 absence GravityFieldService::body_count',
    mcp_tool_calls: 0,
    direct_code_intel_calls: 1,
    approx_response_tokens: approxTokens(result),
    latency_ms: latencyMs,
    status: result?.status,
    reference_count: (result?.referenceLocations || []).length,
    evidence: { exhaustive: ev.exhaustive, cause: ev.cause, fallback: ev.fallback },
    dead_code_claim: safeToClaimDead
      ? 'YES (evidence.exhaustive=true)'
      : 'NO — refusing dead-code claim because evidence.exhaustive is false (Plan #14 contract).',
    blocker: isMissingLspError(result) ? 'language_server_missing (clangd not on PATH)' : null,
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  const repoRoot = path.resolve(opts.projectRoot);
  if (!fs.existsSync(repoRoot)) {
    console.error(`project-root does not exist: ${repoRoot}`);
    process.exit(2);
  }

  // Guard against latent LspClient defect: when `clangd` (or any language
  // server) isn't on PATH, the child_process spawn emits an async 'error'
  // event AFTER getLiveSession's try/catch returns, so the verb appears to
  // "succeed" then crashes the script later. We trap it here so the
  // dogfood report writes an honest "blocked" envelope instead of dying.
  // Note for future cleanup: fix LspClient.start() to listen for the early
  // 'error' event and reject the start() promise; that's the right home.
  let trappedSpawnError = null;
  const trapHandler = (err) => {
    if (err?.code === 'ENOENT' && /clangd|pyright|tsserver|intelephense/.test(String(err?.path ?? ''))) {
      trappedSpawnError = err;
    } else {
      throw err;
    }
  };
  process.on('uncaughtException', trapHandler);

  _resetSessions();
  const startedAt = new Date().toISOString();
  const results = [];
  try {
    results.push(await runQ1(repoRoot));
    results.push(await runQ2(repoRoot));
    results.push(await runQ3(repoRoot));
  } finally {
    try { await shutdownAllSessions(); } catch { /* swallow */ }
  }

  process.off('uncaughtException', trapHandler);
  // Backfill blockers if the spawn crashed before any verb completed
  if (trappedSpawnError && results.length === 0) {
    for (const q of ['Q1 step refs', 'Q2 sample_pressure hover', 'Q3 body_count absence']) {
      results.push({
        question: q,
        blocker: `language_server_missing: ${trappedSpawnError.path} not on PATH`,
        status: 'error',
      });
    }
  }

  const allBlocked = results.every(r => r.blocker != null);
  const envelope = {
    runtime: opts.runtime,
    apg_mcp_tools_exposed: false,
    method: 'direct APG code-intel module calls, read-only',
    host: { platform: os.platform(), node: process.version },
    projectRoot: repoRoot,
    startedAt,
    finishedAt: new Date().toISOString(),
    overallStatus: allBlocked ? 'blocked' : 'ok',
    trappedSpawnError: trappedSpawnError ? {
      code: trappedSpawnError.code,
      path: trappedSpawnError.path,
      syscall: trappedSpawnError.syscall,
      note: 'LspClient defect — spawn-error fires async past getLiveSession try/catch; trapped here so the dogfood reports cleanly.',
    } : null,
    results,
  };

  const outPath = opts.outPath ?? path.join('bench', `dogfood-${opts.runtime}-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(envelope, null, 2));

  process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
  process.stderr.write(`\nWrote ${outPath}\n`);
  if (allBlocked) process.exitCode = 1;
}

main().catch(err => { console.error(err?.stack || err); process.exit(1); });
