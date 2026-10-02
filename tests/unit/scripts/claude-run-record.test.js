// ⛔⛔ A TRIAL RUN'S TIME IS SPAWN TO EXIT ON THE LAUNCHER'S CLOCK, AND ITS TOKENS STAND ONLY WHEN THE STREAM, THE
// SESSION'S TRANSCRIPT AND THE SESSION'S HARNESS TOTAL ALL AGREE.
//
// Fixtures are the probe run of 2026-10-02 (session 603ba72d), cut to the fields read: its stream's init and result
// records, the launcher's clock around it, and its session files (see claude-session-usage.test.js).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureRun, measureRunTime, readStream } from '../../../scripts/lib/claude-run-record.mjs';
import { readClaudeSession, parseJsonl } from '../../../scripts/lib/claude-session-files.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'claude-session');
const SID = '603ba72d-f5a0-411b-b976-8e77f33d33d6';
const stream = () => parseJsonl(readFileSync(join(FIX, 'stream-603ba72d.jsonl'), 'utf8'), 'stream').records;
const clock = () => JSON.parse(readFileSync(join(FIX, 'clock-603ba72d.json'), 'utf8'));
const session = () => readClaudeSession(SID, { projectsDir: join(FIX, 'projects') });

describe('the probe run, measured whole', () => {
  it('★★★ POSITIVE CONTROL: time and tokens both stand, and they are the run\'s own figures', () => {
    const run = measureRun({ stream: stream(), clock: clock(), session: session() });
    expect(run.ok, JSON.stringify(run.detail)).toBe(true);
    expect(run.sessionId).toBe(SID);
    expect(run.time).toEqual({ ok: true, wallMs: 86978, harnessMs: 57148, startupMs: 29830 });
    expect(run.tokens.total).toEqual({ inputTokens: 12, outputTokens: 1106, cacheReadInputTokens: 174981, cacheCreationInputTokens: 64149 });
    expect(run.ended).toEqual({ subtype: 'success', isError: false, numTurns: 4 });
  });

  it('★★★ NEGATIVE CONTROL: a stream whose usage does not match the session read is refused', () => {
    // What happens when the session files belong to a different run than the stream: the transcript and its own
    // cost-state agree with each other, and only the stream can say they are not this run's.
    const other = stream().map((r) => (r.type === 'result'
      ? { ...r, modelUsage: { 'claude-opus-5-5': { ...r.modelUsage['claude-opus-5-5'], outputTokens: 999 } } }
      : r));
    const run = measureRun({ stream: other, clock: clock(), session: session() });
    expect(run).toMatchObject({ ok: false, reason: 'stream_disagrees_with_session' });
    expect(run.detail).toContainEqual({ model: 'claude-opus-5-5', field: 'outputTokens', transcript: 1106, harness: 999 });
  });

  it('★★★ a session that cannot be measured refuses the whole run', () => {
    const run = measureRun({ stream: stream(), clock: clock(), session: { ...session(), subagents: [] } });
    expect(run).toMatchObject({ ok: false, reason: 'disagrees_with_harness' });
  });
});

describe('the stream and the clock', () => {
  it('★★★ a stream without exactly one result is not a finished run', () => {
    expect(readStream(stream().filter((r) => r.type !== 'result'))).toMatchObject({ ok: false, reason: 'result_count' });
    const twice = [...stream(), stream().find((r) => r.type === 'result')];
    expect(readStream(twice)).toMatchObject({ ok: false, reason: 'result_count' });
  });

  it('★★★ a stream naming two sessions is refused', () => {
    const mixed = [...stream(), { type: 'assistant', session_id: '00000000-0000-4000-8000-000000000000' }];
    expect(readStream(mixed)).toMatchObject({ ok: false, reason: 'session_ids' });
  });

  it('★★★ the harness cannot have run longer than its process: one clock is wrong, so neither is reported', () => {
    expect(measureRunTime({ startMs: 0, endMs: 1000, result: { duration_ms: 1001 } }))
      .toMatchObject({ ok: false, reason: 'harness_longer_than_process' });
    // CONTROL: equal is possible, so the refusal sits at the boundary and not before it.
    expect(measureRunTime({ startMs: 0, endMs: 1000, result: { duration_ms: 1000 } }))
      .toEqual({ ok: true, wallMs: 1000, harnessMs: 1000, startupMs: 0 });
  });

  it('★★★ a missing or backwards clock, or a missing harness duration, is refused', () => {
    expect(measureRunTime({ startMs: undefined, endMs: 1000, result: { duration_ms: 5 } })).toMatchObject({ reason: 'bad_clock' });
    expect(measureRunTime({ startMs: 2000, endMs: 1000, result: { duration_ms: 5 } })).toMatchObject({ reason: 'bad_clock' });
    expect(measureRunTime({ startMs: 0, endMs: 1000, result: {} })).toMatchObject({ reason: 'no_harness_duration' });
  });
});
