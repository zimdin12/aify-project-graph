#!/usr/bin/env node
// Plan #14 Step C — direct-verb microbench for cpp code-intel.
//
// Drives code_intel_references / code_intel_definitions / code_intel_hover /
// code_intel_diagnostics against a real Sand Castle (or any cpp repo with
// clangd + compile_commands.json) using locked ground truth from the task
// spec at bench/cpp-microbench.tasks.json. NOT an agent-productivity test
// — measures the TOOL surface, not what an LLM does with it. That's what
// bench-ab.mjs (Plan #17 D) covers separately.
//
// Per senior-dev's revised Plan #14 Step C: 6 tasks, scripted runner labeled
// "tool capability microbench". Ground truth co-locked with dev against
// real clangd 18.1.3 on Sand Castle (T1/T2/T4/T5 by dev's earlier validation;
// T3 added 2026-05-23 with `SampledFluidField::sample_pressure_adjusted_
// density_limit_cell` @ Fluid.cpp:479:20, 4 callsites).
//
// Usage:
//   node scripts/code-intel-microbench.mjs --spec bench/cpp-microbench.tasks.json
//   node scripts/code-intel-microbench.mjs --spec ... --dry-run
//   node scripts/code-intel-microbench.mjs --spec ... --out bench/microbench-out.json
//   node scripts/code-intel-microbench.mjs --spec ... --project-root /abs/path
//
// Output: per-task {pass, evidence, observed, durationMs, bytes} + summary.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  codeIntelReferences,
  codeIntelDefinitions,
  codeIntelHover,
  codeIntelDiagnostics,
} from '../mcp/stdio/query/verbs/code_intel_live.js';
import { shutdownAllSessions, _resetSessions } from '../mcp/stdio/code-intel/live.js';

function usage() {
  console.error('Usage: code-intel-microbench.mjs --spec <path> [--dry-run] [--out <path>] [--project-root <abs>]');
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { specPath: null, dryRun: false, outPath: null, projectRoot: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--spec') opts.specPath = argv[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--out') opts.outPath = argv[++i];
    else if (a === '--project-root') opts.projectRoot = argv[++i];
    else if (a === '-h' || a === '--help') usage();
    else { console.error(`unknown arg: ${a}`); usage(); }
  }
  if (!opts.specPath) usage();
  return opts;
}

function loadSpec(specPath) {
  return JSON.parse(fs.readFileSync(specPath, 'utf8'));
}

function bytesOf(obj) {
  try { return Buffer.byteLength(JSON.stringify(obj), 'utf8'); } catch { return null; }
}

function locEqual(a, b) {
  return a && b && a.file === b.file && a.startLine === b.startLine
    && (b.startCol == null || a.startCol === b.startCol);
}

function locsContain(observed, expected) {
  const matched = expected.every(exp => observed.some(obs => locEqual(obs, exp)));
  const surplus = observed.filter(obs => !expected.some(exp => locEqual(obs, exp)));
  return { matched, surplus, observed, expected };
}

function normalizeRefLoc(r) {
  return {
    file: r.file,
    startLine: r.range?.start?.line ?? r.startLine,
    startCol: r.range?.start?.col ?? r.startCol,
  };
}

function normalizeDefLoc(d) {
  return {
    file: d.file,
    startLine: d.range?.start?.line ?? d.startLine,
    startCol: d.range?.start?.col ?? d.startCol,
  };
}

// Dry-run synthetic results — let the harness run on hosts WITHOUT clangd
// to validate task-spec shape + assertion logic. Numbers are deterministic.
function dryRunResult(task) {
  switch (task.shape) {
    case 'absence-refusal':
      return {
        status: 'ok',
        freshness: 'unknown',
        referenceLocations: [],
        evidence: { ready: false, degraded: true, cause: 'cold_index', exhaustive: false, warnings: [] },
      };
    case 'references-accuracy':
    case 'multi-level-absence': {
      const refs = (task.expect.referenceLocations || []).map(loc => ({
        file: loc.file,
        range: { start: { line: loc.startLine, col: loc.startCol ?? 1 }, end: { line: loc.startLine, col: (loc.startCol ?? 1) + 1 } }
      }));
      return {
        status: 'ok',
        freshness: 'unknown',
        referenceLocations: refs,
        evidence: { ready: false, degraded: false, cause: 'unknown', exhaustive: false, warnings: [] },
      };
    }
    case 'hover-signature':
      return { status: 'ok', hover: { content: `void ${task.input.symbol.split('::').pop()}(...) — dry-run synthetic signature` } };
    case 'definition-jump': {
      const defs = (task.expect.definitions || []).map(loc => ({
        file: loc.file,
        range: { start: { line: loc.startLine, col: 1 }, end: { line: loc.startLine, col: 2 } }
      }));
      return { status: 'ok', definitions: defs };
    }
    case 'diagnostics-temp-patch':
      return { status: 'ok', diagnostics: [{ file: 'tmp/Gravity.cpp', severity: 'error', message: 'dry-run synthetic diagnostic' }] };
    default:
      return { status: 'error', errors: [{ code: 'unsupported_task_shape', message: task.shape }] };
  }
}

async function runReferences(task, projectRoot) {
  const { file, line, col } = task.input;
  return codeIntelReferences({ repoRoot: projectRoot, file, line, col });
}

async function runDefinitions(task, projectRoot) {
  const { file, line, col } = task.input;
  return codeIntelDefinitions({ repoRoot: projectRoot, file, line, col });
}

async function runHover(task, projectRoot) {
  const { file, line, col } = task.input;
  return codeIntelHover({ repoRoot: projectRoot, file, line, col });
}

async function runDiagnosticsTempPatch(task, projectRoot) {
  // Copy template file to a temp dir, append a deliberately broken line,
  // then run code_intel_diagnostics against the temp project. Temp tree
  // is discarded — tracked Sand Castle source is NEVER mutated.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-microbench-T6-'));
  const srcAbs = path.join(projectRoot, task.input.templateFile);
  const dstRel = task.input.templateFile;
  const dstAbs = path.join(tmpDir, dstRel);
  fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
  let content;
  try {
    content = fs.readFileSync(srcAbs, 'utf8');
  } catch (err) {
    return { status: 'error', errors: [{ code: 'template_read_failed', message: err.message }] };
  }
  // Patch: introduce an obvious syntax error at the end. Bounded — the
  // diagnostic surface should fire on this without ambiguity.
  const patched = content + '\n\n// Plan #14 Step C T6 deliberate syntax error:\nstatic int = ;\n';
  fs.writeFileSync(dstAbs, patched);
  // Optional: copy compile_commands.json so clangd has the same command set.
  const cdb = path.join(projectRoot, 'compile_commands.json');
  if (fs.existsSync(cdb)) fs.copyFileSync(cdb, path.join(tmpDir, 'compile_commands.json'));
  try {
    return await codeIntelDiagnostics({ repoRoot: tmpDir, files: [dstRel] });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* swallow */ }
  }
}

function evaluateTask(task, observed) {
  const expect = task.expect || {};
  const out = { id: task.id, shape: task.shape, ok: false, reasons: [] };
  if (task.shape === 'absence-refusal') {
    const ev = observed.evidence || {};
    const exhaustiveOk = ev.exhaustive === false;
    const causeOk = Array.isArray(expect['evidence.cause'])
      ? expect['evidence.cause'].includes(ev.cause)
      : ev.cause != null;
    if (!exhaustiveOk) out.reasons.push(`evidence.exhaustive must be false, got ${ev.exhaustive}`);
    if (!causeOk) out.reasons.push(`evidence.cause must be one of ${JSON.stringify(expect['evidence.cause'])}, got ${ev.cause}`);
    out.ok = exhaustiveOk && causeOk;
    return out;
  }
  if (task.shape === 'references-accuracy' || task.shape === 'multi-level-absence') {
    const observedLocs = (observed.referenceLocations || []).map(normalizeRefLoc);
    const expected = expect.referenceLocations || [];
    const cmp = locsContain(observedLocs, expected);
    if (!cmp.matched) out.reasons.push(`missing ${expected.length - expected.filter(e => observedLocs.some(o => locEqual(o, e))).length}/${expected.length} expected callsites`);
    if (expect.minCallsiteCount != null && observedLocs.length < expect.minCallsiteCount) {
      out.reasons.push(`observed ${observedLocs.length} callsites, expected ≥ ${expect.minCallsiteCount}`);
    }
    out.ok = cmp.matched && (expect.minCallsiteCount == null || observedLocs.length >= expect.minCallsiteCount);
    out.observed = observedLocs;
    out.expected = expected;
    return out;
  }
  if (task.shape === 'hover-signature') {
    const content = observed.hover?.content || '';
    const contains = (expect['hover.content.contains'] || []).every(s => content.toLowerCase().includes(String(s).toLowerCase()));
    const notNull = expect['hover.notNull'] !== true || observed.hover != null;
    if (!contains) out.reasons.push(`hover content missing one of: ${JSON.stringify(expect['hover.content.contains'])}`);
    if (!notNull) out.reasons.push('hover is null when notNull expected');
    out.ok = contains && notNull;
    return out;
  }
  if (task.shape === 'definition-jump') {
    const observedLocs = (observed.definitions || []).map(normalizeDefLoc);
    const expected = expect.definitions || [];
    const cmp = locsContain(observedLocs, expected);
    if (!cmp.matched) out.reasons.push(`expected definition not found (expected ${JSON.stringify(expected)}, got ${JSON.stringify(observedLocs)})`);
    if (expect.minCount != null && observedLocs.length < expect.minCount) out.reasons.push(`observed ${observedLocs.length} definitions, expected ≥ ${expect.minCount}`);
    out.ok = cmp.matched;
    out.observed = observedLocs;
    return out;
  }
  if (task.shape === 'diagnostics-temp-patch') {
    const count = (observed.diagnostics || []).length;
    if (expect.minDiagnostics != null && count < expect.minDiagnostics) out.reasons.push(`observed ${count} diagnostics, expected ≥ ${expect.minDiagnostics}`);
    out.ok = !(expect.minDiagnostics != null && count < expect.minDiagnostics);
    out.observedCount = count;
    return out;
  }
  out.reasons.push(`unsupported shape ${task.shape}`);
  return out;
}

async function runTask(task, ctx) {
  const start = Date.now();
  let result;
  try {
    if (ctx.dryRun) {
      result = dryRunResult(task);
    } else {
      switch (task.verb) {
        case 'code_intel_references': result = await runReferences(task, ctx.projectRoot); break;
        case 'code_intel_definitions': result = await runDefinitions(task, ctx.projectRoot); break;
        case 'code_intel_hover': result = await runHover(task, ctx.projectRoot); break;
        case 'code_intel_diagnostics':
          if (task.shape === 'diagnostics-temp-patch') {
            result = await runDiagnosticsTempPatch(task, ctx.projectRoot);
          } else {
            result = { status: 'error', errors: [{ code: 'unsupported_diagnostics_shape', message: task.shape }] };
          }
          break;
        default:
          result = { status: 'error', errors: [{ code: 'unknown_verb', message: task.verb }] };
      }
    }
  } catch (err) {
    result = { status: 'error', errors: [{ code: 'exception', message: err.message }] };
  }
  const durationMs = Date.now() - start;
  const verdict = evaluateTask(task, result || {});
  return {
    id: task.id,
    shape: task.shape,
    verb: task.verb,
    pass: verdict.ok,
    reasons: verdict.reasons,
    durationMs,
    bytes: bytesOf(result),
    observed: verdict.observed,
    expected: verdict.expected,
    rawStatus: result?.status,
    evidence: result?.evidence,
  };
}

function summarize(results) {
  const passed = results.filter(r => r.pass).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length ? +(passed / results.length).toFixed(3) : null,
    bytesTotal: results.reduce((acc, r) => acc + (r.bytes || 0), 0),
    durationTotalMs: results.reduce((acc, r) => acc + (r.durationMs || 0), 0),
  };
}

function formatTable(results) {
  const head = `| Task | Shape | Pass | Bytes | Latency |\n|---|---|---|---|---|`;
  const rows = results.map(r =>
    `| ${r.id} | ${r.shape} | ${r.pass ? '✅' : '❌'} | ${r.bytes ?? '—'} | ${r.durationMs}ms |`
  );
  return [head, ...rows].join('\n');
}

async function main() {
  const opts = parseArgs(process.argv);
  const spec = loadSpec(opts.specPath);
  const projectRoot = opts.projectRoot || spec.projectRoot;
  if (!projectRoot && !opts.dryRun) {
    console.error('projectRoot required (set --project-root or spec.projectRoot)');
    process.exit(2);
  }
  const ctx = { dryRun: opts.dryRun, projectRoot };

  if (!opts.dryRun) _resetSessions();

  const results = [];
  for (const task of spec.tasks) {
    process.stderr.write(`[${task.id}] ${task.shape} … `);
    const r = await runTask(task, ctx);
    process.stderr.write(`${r.pass ? 'PASS' : 'FAIL'} (${r.durationMs}ms)\n`);
    if (!r.pass) for (const reason of r.reasons) process.stderr.write(`        · ${reason}\n`);
    results.push(r);
  }

  if (!opts.dryRun) await shutdownAllSessions();

  const summary = summarize(results);
  const envelope = {
    schema_version: '0.1',
    runAt: new Date().toISOString(),
    dryRun: opts.dryRun,
    projectRoot,
    spec: opts.specPath,
    summary,
    results,
  };
  const outPath = opts.outPath ?? path.join('bench', `microbench-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(envelope, null, 2));
  console.log(`Wrote ${outPath}\n`);
  console.log(formatTable(results));
  console.log(`\nSummary: ${summary.passed}/${summary.total} pass · ${summary.bytesTotal}B total · ${summary.durationTotalMs}ms total`);
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error(err?.stack || err); process.exit(1); });
