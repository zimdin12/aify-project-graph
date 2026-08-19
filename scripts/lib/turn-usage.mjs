// TOKEN ACCOUNTING FOR A/B ARMS — and a refusal when the shape is ambiguous.
//
// ⛔ BOTH HARNESSES READ THE LAST TURN ONLY. `ab-runner.mjs` reversed the transcript and took
// the first `turn.completed` it found; `bench-a1-live.mjs` overwrote `turnUsage` on every event
// and kept whatever came last. Meanwhile `docs/v0.3-hardening-plan.md:486` has said, since
// v0.3, to "sum per-turn `message.usage`, not `result.usage`". The rule was written and the
// code did not follow it — this project's most-recorded defect shape, sitting in the instrument
// that judges every other claim.
//
// ★ IT IS ONE-SIDED, WHICH IS WHY IT MATTERS. Reading one turn under-counts whichever arm takes
// MORE turns. Arms do not take equal turns; that is usually the thing under test. So the error
// does not add noise, it adds a slope — and it points at whichever arm did more work.
//
// ⚠ THE ASSUMPTION NOBODY WROTE DOWN: taking the last turn is correct only if
// `turn.completed.usage` is CUMULATIVE. Summing is correct only if it is PER-TURN. Nothing in
// the harness asserted either, and a host is free to change it — a reference project had
// exactly that happen silently and published rewritten numbers before catching it.
//
// ⇒ So this does not pick a side. It reads the whole series and decides from the DATA, and
// when the data cannot distinguish the two readings it REFUSES to produce a scalar. An
// ambiguous total that looks like a number is worse than no number: the number gets quoted.

const totalOf = (u) => {
  if (!u || typeof u !== 'object') return null;
  // Host field names vary; sum the input/output pair when a total is not given outright.
  if (Number.isFinite(u.total_tokens)) return u.total_tokens;
  const inTok = u.input_tokens ?? u.prompt_tokens ?? u.total_input_tokens;
  const outTok = u.output_tokens ?? u.completion_tokens ?? u.total_output_tokens;
  if (Number.isFinite(inTok) || Number.isFinite(outTok)) {
    return (Number.isFinite(inTok) ? inTok : 0) + (Number.isFinite(outTok) ? outTok : 0);
  }
  return null;
};

// `turns` is every `turn.completed.usage` in transcript order.
//
// Returns { basis, total, series, reason } where basis is one of:
//   'single_turn'     — one turn; both readings agree by construction
//   'cumulative_last' — the series is non-decreasing AND grows; last value is the total
//   'per_turn_sum'    — the series decreases somewhere, so values are per-turn; sum them
//   'ambiguous'       — the two readings disagree and nothing distinguishes them; total is null
//   'no_usage'        — nothing to read
export function reconcileTurnUsage(turns) {
  const series = (Array.isArray(turns) ? turns : []).map(totalOf).filter((n) => Number.isFinite(n));
  if (series.length === 0) {
    return { basis: 'no_usage', total: null, series, reason: 'no turn.completed carried usage' };
  }
  if (series.length === 1) {
    return { basis: 'single_turn', total: series[0], series, reason: null };
  }

  const sum = series.reduce((a, b) => a + b, 0);
  const last = series[series.length - 1];
  // A cumulative counter never goes down. One decrease proves the values are per-turn.
  const decreases = series.some((n, i) => i > 0 && n < series[i - 1]);
  if (decreases) {
    return { basis: 'per_turn_sum', total: sum, series, reason: null };
  }
  // Non-decreasing. Cumulative fits — but so does a per-turn series that happens to be sorted.
  // ⚠ A CONSTANT SERIES IS THE TRAP: [100,100,100] is a cumulative counter that did not move,
  // AND a per-turn series of three identical turns. Nothing in the data separates them, so
  // neither reading may be published.
  const constant = series.every((n) => n === series[0]);
  if (constant) {
    return {
      basis: 'ambiguous',
      total: null,
      series,
      reason: `all ${series.length} turns report the same usage (${series[0]}); cumulative and `
        + 'per-turn readings are indistinguishable, so no total is emitted',
    };
  }
  return { basis: 'cumulative_last', total: last, series, reason: null };
}

// Pull every `turn.completed` usage out of a JSONL transcript, in order.
//
// ⚠ DEDUPED BY EVENT IDENTITY. A host may emit one event per content block, each carrying the
// SAME usage object; counting those separately inflates the total by however many blocks the
// turn happened to have. Keyed on the turn/message id when present, so a repeat is dropped
// rather than added.
export function collectTurnUsage(lines) {
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    if (!line || !line.includes('"turn.completed"')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.type !== 'turn.completed' || !ev.usage) continue;
    const id = ev.id ?? ev.turn_id ?? ev.message?.id ?? ev.item_id ?? null;
    if (id != null) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(ev.usage);
  }
  return out;
}
