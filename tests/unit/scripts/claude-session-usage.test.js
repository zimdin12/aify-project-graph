// ⛔⛔ THE TOKEN COUNT FOR A TRIAL RUN IS THE TRANSCRIPT'S SUM, AND IT IS REPORTED ONLY WHEN THE HARNESS'S OWN TOTAL
// AGREES WITH IT EXACTLY.
//
// The fixture is a real run cut down to the fields the counter reads: session 603ba72d, a headless `claude -p` run on
// 2026-10-02 with four API calls of its own and two in one subagent. Its stream's result.modelUsage, the session's
// cost-state, and the transcript summed over the session file plus subagents/ all read 12 / 1,106 / 174,981 / 64,149.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureRunTokens, baseModel } from '../../../scripts/lib/claude-session-usage.mjs';
import { readClaudeSession } from '../../../scripts/lib/claude-session-files.mjs';

const PROJECTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'claude-session', 'projects');
const SID = '603ba72d-f5a0-411b-b976-8e77f33d33d6';
const RUN = Object.freeze({ inputTokens: 12, outputTokens: 1106, cacheReadInputTokens: 174981, cacheCreationInputTokens: 64149 });

const real = () => {
  const read = readClaudeSession(SID, { projectsDir: PROJECTS });
  if (!read.ok) throw new Error(`fixture unreadable: ${read.reason}`);
  return read;
};
const call = (id, usage, extra = {}) => ({
  type: 'assistant', timestamp: '2026-10-02T12:00:01.000Z',
  message: { id, model: 'm', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage } },
  ...extra,
});
const costState = (modelUsage, startTime = Date.parse('2026-10-02T12:00:00.000Z')) => ({ type: 'cost-state', startTime, modelUsage });

describe('a real run: the transcript sum, checked against the harness', () => {
  it('★★★ POSITIVE CONTROL: session plus subagents equals what the run used, call by call deduped', () => {
    const run = measureRunTokens(real());
    expect(run.ok, JSON.stringify(run.detail)).toBe(true);
    expect(run.total).toEqual(RUN);
    expect(run.perModel).toEqual({ 'claude-opus-5-5': RUN });
    // Six calls from nine lines: one of the session's calls is written on two lines with the same usage.
    expect(run.calls).toBe(6);
    expect(run.session).toEqual({ inputTokens: 8, outputTokens: 783, cacheReadInputTokens: 142603, cacheCreationInputTokens: 28646 });
    expect(run.subagents).toEqual({ inputTokens: 4, outputTokens: 323, cacheReadInputTokens: 32378, cacheCreationInputTokens: 35503 });
  });

  it('★★★ NEGATIVE CONTROL: without the subagent file the count is REFUSED, not reported low', () => {
    // The session file alone reads 8 / 783 / 142,603 / 28,646, which is also exactly what the stream's result.usage
    // says. A counter that missed subagents/ would report it and nobody would doubt it.
    const run = measureRunTokens({ ...real(), subagents: [] });
    expect(run.ok).toBe(false);
    expect(run.reason).toBe('disagrees_with_harness');
    expect(run.detail).toContainEqual({ model: 'claude-opus-5-5', field: 'inputTokens', transcript: 8, harness: 12 });
  });
});

describe('every way the records cannot be trusted is a refusal, never a number', () => {
  it('★★★ a session with no API calls is refused, not counted as zero', () => {
    const run = measureRunTokens({ session: [costState({})], subagents: [] });
    expect(run).toMatchObject({ ok: false, reason: 'no_usage_records' });
  });

  it('★★★ no harness total means nothing can check the sum, so it is refused', () => {
    const run = measureRunTokens({ session: [call('a', { input_tokens: 5 })], subagents: [] });
    expect(run).toMatchObject({ ok: false, reason: 'no_harness_total' });
  });

  it('★★★ a file spanning two processes is refused: by two start times, and by a call older than the last', () => {
    const one = costState({ m: { inputTokens: 5 } });
    const two = { ...one, startTime: one.startTime + 60000 };
    expect(measureRunTokens({ session: [call('a', { input_tokens: 5 }), one, two], subagents: [] }))
      .toMatchObject({ ok: false, reason: 'more_than_one_process' });
    const early = call('a', { input_tokens: 5 }, { timestamp: '2026-10-02T11:59:00.000Z' });
    expect(measureRunTokens({ session: [early, one], subagents: [] }))
      .toMatchObject({ ok: false, reason: 'more_than_one_process' });
    // CONTROL: the same call inside the process's lifetime is accepted, so the refusal is about time, not shape.
    expect(measureRunTokens({ session: [call('a', { input_tokens: 5 }), one], subagents: [] }).ok).toBe(true);
  });

  it('★★★ one call repeated with DIFFERENT usage is refused rather than resolved by picking a line', () => {
    const run = measureRunTokens({
      session: [call('a', { input_tokens: 5 }), call('a', { input_tokens: 6 }), costState({ m: { inputTokens: 5 } })],
      subagents: [],
    });
    expect(run).toMatchObject({ ok: false, reason: 'conflicting_repeats' });
  });

  it('★★★ a context-window suffix on the harness\'s model name is the same model; another model is not', () => {
    // Observed on a real session: cost-state keyed `claude-opus-5-5[1m]`, every call said `claude-opus-5-5`.
    expect(baseModel('claude-opus-5-5[1m]')).toBe('claude-opus-5-5');
    const calls = [call('a', { input_tokens: 2, output_tokens: 4 })].map((c) => ({ ...c, message: { ...c.message, model: 'claude-opus-5-5' } }));
    expect(measureRunTokens({ session: [...calls, costState({ 'claude-opus-5-5[1m]': { inputTokens: 2, outputTokens: 4 } })], subagents: [] }).ok)
      .toBe(true);
    expect(measureRunTokens({ session: [...calls, costState({ 'claude-sonnet-5-5': { inputTokens: 2, outputTokens: 4 } })], subagents: [] }))
      .toMatchObject({ ok: false, reason: 'disagrees_with_harness' });
  });
});

describe('reading the session from disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'apg-claude-session-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('★★★ a line that does not parse makes the session unreadable, naming the file and line', () => {
    const sid = '00000000-0000-4000-8000-000000000001';
    mkdirSync(join(root, 'p'), { recursive: true });
    writeFileSync(join(root, 'p', `${sid}.jsonl`), '{"type":"user"}\n{"type":"assist\n');
    const read = readClaudeSession(sid, { projectsDir: root });
    expect(read).toMatchObject({ ok: false, reason: 'unparseable_line' });
    expect(read.detail).toMatch(/:2$/u);
  });

  it('★★★ an unknown session is not found, and the real one is found with its subagent file', () => {
    expect(readClaudeSession('00000000-0000-4000-8000-0000000000ff', { projectsDir: PROJECTS }))
      .toMatchObject({ ok: false, reason: 'session_not_found' });
    expect(real().files).toHaveLength(2);
  });
});
