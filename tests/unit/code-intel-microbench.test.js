// Plan #14 Step C microbench tests — dry-run path only.
// Real-data path needs Sand Castle + clangd on a host; the dry-run
// path is what we can validate in CI / on Windows. Exercises:
//   - Task spec parsing
//   - Per-shape assertion logic (T1 refusal, T2/T3 ref-set match,
//     T4 hover, T5 def, T6 diagnostics)
//   - Summary + output JSON shape

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const SCRIPT = path.resolve('scripts/code-intel-microbench.mjs');
const SPEC = path.resolve('bench/cpp-microbench.tasks.json');

function runDryRun({ extraArgs = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-microbench-'));
  const outPath = path.join(dir, 'out.json');
  execFileSync(process.execPath, [SCRIPT, '--spec', SPEC, '--dry-run', '--out', outPath, ...extraArgs], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { envelope: JSON.parse(fs.readFileSync(outPath, 'utf8')), outPath };
}

describe('code-intel-microbench dry-run', () => {
  it('produces an envelope with summary + per-task results', () => {
    const { envelope } = runDryRun();
    expect(envelope.schema_version).toBe('0.1');
    expect(envelope.dryRun).toBe(true);
    expect(envelope.results.length).toBe(6); // T1..T6
    expect(envelope.summary.total).toBe(6);
  });

  it('all 6 tasks pass in dry-run (synthetic ground-truth matches expected)', () => {
    const { envelope } = runDryRun();
    expect(envelope.summary.passed).toBe(6);
    expect(envelope.summary.failed).toBe(0);
    expect(envelope.summary.passRate).toBe(1);
  });

  it('T1 (absence-refusal) asserts evidence.exhaustive=false + cause∈{cold_index,unknown}', () => {
    const { envelope } = runDryRun();
    const t1 = envelope.results.find(r => r.id === 'T1');
    expect(t1.shape).toBe('absence-refusal');
    expect(t1.pass).toBe(true);
    expect(t1.evidence?.exhaustive).toBe(false);
    expect(['cold_index', 'unknown']).toContain(t1.evidence?.cause);
  });

  it('T2 ref-accuracy asserts both known callsites of step()', () => {
    const { envelope } = runDryRun();
    const t2 = envelope.results.find(r => r.id === 'T2');
    expect(t2.pass).toBe(true);
    const observed = t2.observed || [];
    const hasLine771 = observed.some(o => o.file === 'sim/fields/Gravity.cpp' && o.startLine === 771);
    const hasLine781 = observed.some(o => o.file === 'sim/fields/Gravity.cpp' && o.startLine === 781);
    expect(hasLine771).toBe(true);
    expect(hasLine781).toBe(true);
  });

  it('T3 (locked 2026-05-23) asserts the 4 callsites of sample_pressure_adjusted_density_limit_cell', () => {
    const { envelope } = runDryRun();
    const t3 = envelope.results.find(r => r.id === 'T3');
    expect(t3.pass).toBe(true);
    const lines = (t3.observed || []).map(o => o.startLine).sort((a, b) => a - b);
    expect(lines).toEqual([523, 597, 671, 772]);
  });

  it('T4 hover content contains the symbol name', () => {
    const { envelope } = runDryRun();
    const t4 = envelope.results.find(r => r.id === 'T4');
    expect(t4.pass).toBe(true);
  });

  it('T5 definition jump asserts Gravity.h:277', () => {
    const { envelope } = runDryRun();
    const t5 = envelope.results.find(r => r.id === 'T5');
    expect(t5.pass).toBe(true);
    const obs = t5.observed || [];
    expect(obs.some(o => o.file === 'sim/fields/Gravity.h' && o.startLine === 277)).toBe(true);
  });

  it('T6 diagnostics-temp-patch asserts ≥1 diagnostic', () => {
    const { envelope } = runDryRun();
    const t6 = envelope.results.find(r => r.id === 'T6');
    expect(t6.pass).toBe(true);
  });

  it('records per-task bytes and durationMs', () => {
    const { envelope } = runDryRun();
    for (const r of envelope.results) {
      expect(r.bytes).toBeGreaterThan(0);
      expect(r.durationMs).toBeGreaterThanOrEqual(0);
    }
    expect(envelope.summary.bytesTotal).toBeGreaterThan(0);
  });
});

describe('code-intel-microbench task spec contract', () => {
  it('spec is locked at v0.1 with 6 tasks T1..T6', () => {
    const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
    expect(spec.schema_version).toBe('0.1');
    expect(spec.tasks.map(t => t.id)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6']);
  });

  it('T3 ground truth matches dev-locked symbol + 4 callsites (2026-05-23)', () => {
    const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
    const t3 = spec.tasks.find(t => t.id === 'T3');
    expect(t3.input.symbol).toBe('SampledFluidField::sample_pressure_adjusted_density_limit_cell');
    expect(t3.input.file).toBe('sim/fields/Fluid.cpp');
    expect(t3.input.line).toBe(479);
    expect(t3.input.col).toBe(20);
    const lines = (t3.expect.referenceLocations || []).map(r => r.startLine).sort((a, b) => a - b);
    expect(lines).toEqual([523, 597, 671, 772]);
  });
});
