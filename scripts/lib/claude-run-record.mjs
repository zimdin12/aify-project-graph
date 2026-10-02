// ONE TRIAL RUN'S MEASURES: its tokens and its time, from what a headless `claude -p --output-format stream-json`
// run leaves behind, each refused rather than reported when it cannot be trusted.
//
// Three things are left behind, and each is a different instrument:
//   - the launcher's clock: when the process was spawned and when it exited;
//   - the stream on stdout, ending in one `result` record with the harness's own duration and per-model usage;
//   - the session files on disk, read by claude-session-usage.mjs.
//
// TIME is the launcher's wall-clock, spawn to exit: what a person waits for. The harness's `duration_ms` is recorded
// beside it and is shorter by the startup it does not count. On the probe run (session 603ba72d, 2026-10-02) that was
// 86,978 ms against 57,148 ms, about 30 s of hooks and MCP servers starting. Startup differs by arm (arm A loads the
// dashboard's tools), so it is part of the cost and stays in the primary figure.
//
// TOKENS are the session's transcript sum. They are reported only when the session's own cost-state agrees with them
// and the stream's result.modelUsage agrees too. The second check also proves the session files read are the ones this
// stream produced, and not another session's.
import { measureRunTokens, harnessTotals, disagreements } from './claude-session-usage.mjs';

const refused = (reason, detail) => ({ ok: false, reason, detail });

/** The stream's session id and its single result record, or a refusal. PURE. */
export function readStream(records) {
  const results = records.filter((r) => r?.type === 'result');
  if (results.length !== 1) {
    return refused('result_count', `${results.length} result records; a finished run has exactly one`);
  }
  const ids = [...new Set(records.map((r) => r?.session_id).filter(Boolean))];
  if (ids.length !== 1) return refused('session_ids', ids);
  return { ok: true, sessionId: ids[0], result: results[0] };
}

/**
 * Wall-clock and harness duration for one run, or a refusal. PURE.
 * ⛔ The harness cannot have run longer than the process it ran in: if it says so, one of the two clocks is wrong and
 * neither is reported.
 */
export function measureRunTime({ startMs, endMs, result }) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return refused('bad_clock', { startMs, endMs });
  }
  const wallMs = endMs - startMs;
  const harnessMs = result?.duration_ms;
  if (!Number.isFinite(harnessMs) || harnessMs < 0) return refused('no_harness_duration', harnessMs ?? null);
  if (harnessMs > wallMs) return refused('harness_longer_than_process', { wallMs, harnessMs });
  return { ok: true, wallMs, harnessMs, startupMs: wallMs - harnessMs };
}

/**
 * Tokens and time for one run, or the first refusal. PURE: the caller reads the stream, the clock and the session.
 * @param {{ stream: object[], clock: {startMs:number,endMs:number}, session: {session:object[],subagents:object[][]} }} input
 */
export function measureRun({ stream, clock, session }) {
  const s = readStream(stream);
  if (!s.ok) return s;
  // How the run ended is recorded, not judged: a run that hit its turn limit still spent what it spent. Whether such a
  // run counts is the protocol's call.
  const ended = { subtype: s.result.subtype ?? null, isError: s.result.is_error ?? null, numTurns: s.result.num_turns ?? null };
  const time = measureRunTime({ ...clock, result: s.result });
  if (!time.ok) return time;
  const tokens = measureRunTokens(session);
  if (!tokens.ok) return tokens;
  const diff = disagreements(tokens.perModel, harnessTotals({ modelUsage: s.result.modelUsage }));
  if (diff.length > 0) return refused('stream_disagrees_with_session', diff);
  return { ok: true, sessionId: s.sessionId, ended, time, tokens };
}
