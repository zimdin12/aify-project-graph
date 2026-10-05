// ⛔⛔ A HERMES RUN'S TOKENS ARE REPORTED ONLY WHEN ITS TWO RECORDS AGREE: the --usage-file report and state.db's
// session_model_usage rows.
//
// Fixtures are a real one-shot run of 2026-10-05 (hermes v0.21.5, gpt-6.1-sol, session 20261005_071349_bc5771): its
// usage file as written, and its two state.db rows (task '' for the main thread, task 'title_generation').
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureHermesRun } from '../../../scripts/lib/hermes-run-usage.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'hermes-run');
const usageFile = () => JSON.parse(readFileSync(join(FIX, 'usage-20261005_071349_bc5771.json'), 'utf8'));
const rows = () => JSON.parse(readFileSync(join(FIX, 'state-rows-20261005_071349_bc5771.json'), 'utf8'));

describe('a real hermes run', () => {
  it('★★★ POSITIVE CONTROL: main thread and helper calls both stand, and the total is their sum', () => {
    const run = measureHermesRun({ usageFile: usageFile(), rows: rows() });
    expect(run.ok, JSON.stringify(run.detail)).toBe(true);
    expect(run.main).toEqual({ input_tokens: 17774, output_tokens: 5, cache_read_tokens: 3968, cache_write_tokens: 0, reasoning_tokens: 0 });
    expect(run.auxiliary).toEqual({ title_generation: { input_tokens: 236, output_tokens: 34, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0 } });
    expect(run.total.input_tokens).toBe(17774 + 236);
    expect(run.model).toBe('gpt-6.1-sol');
    expect(run.completed).toBe(true);
  });

  it('★★★ NEGATIVE CONTROL: a helper call missing from state.db is refused, not dropped', () => {
    const run = measureHermesRun({ usageFile: usageFile(), rows: rows().filter((r) => r.task === '') });
    expect(run).toMatchObject({ ok: false, reason: 'records_disagree' });
    expect(run.detail).toContainEqual({ part: 'aux:title_generation', field: 'input_tokens', usageFile: 236, stateDb: 0 });
  });
});

describe('what cannot be measured is refused', () => {
  it('★★★ main-thread counts that differ between the records are refused', () => {
    const changed = rows().map((r) => (r.task === '' ? { ...r, output_tokens: 6 } : r));
    expect(measureHermesRun({ usageFile: usageFile(), rows: changed })).toMatchObject({ ok: false, reason: 'records_disagree' });
  });

  it('★★★ no usage file, no rows, two main rows, or another model: each refused by name', () => {
    expect(measureHermesRun({ usageFile: null, rows: rows() })).toMatchObject({ ok: false, reason: 'no_usage_file' });
    expect(measureHermesRun({ usageFile: usageFile(), rows: [] })).toMatchObject({ ok: false, reason: 'no_state_rows' });
    const twoMain = [...rows(), rows().find((r) => r.task === '')];
    expect(measureHermesRun({ usageFile: usageFile(), rows: twoMain })).toMatchObject({ ok: false, reason: 'main_rows' });
    const other = rows().map((r) => ({ ...r, model: 'gpt-5' }));
    expect(measureHermesRun({ usageFile: usageFile(), rows: other })).toMatchObject({ ok: false, reason: 'model_mismatch' });
  });
});
