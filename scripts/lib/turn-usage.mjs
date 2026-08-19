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
// ⇒ So this does not pick a side, and — after graph-senior-dev executed my first attempt — it
// does not INFER one either. Only a DECREASE proves anything from the values (a counter that
// goes down is not a counter). Every non-decreasing series fits both readings, because a
// per-turn series naturally grows as context grows. The reading is a property of the HOST, so
// an adapter DECLARES it; absent a declaration the total is refused. An ambiguous total that
// looks like a number is worse than no number: the number gets quoted.

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
//   'cumulative_last' — the adapter DECLARED cumulative; last value is the total
//   'per_turn_sum'    — the series decreases (proof), or the adapter DECLARED per-turn; sum them
//   'ambiguous'       — both readings fit and no adapter declared which; total is null
//   'contradiction'   — the declared contract and the data disagree; total is null
//   'no_usage'        — nothing to read
export function reconcileTurnUsage(turns, { semantics = null } = {}) {
  const series = (Array.isArray(turns) ? turns : []).map(totalOf).filter((n) => Number.isFinite(n));
  if (series.length === 0) {
    return { basis: 'no_usage', total: null, series, reason: 'no turn.completed carried usage' };
  }
  if (series.length === 1) {
    return { basis: 'single_turn', total: series[0], series, reason: null };
  }

  const sum = series.reduce((a, b) => a + b, 0);
  const last = series[series.length - 1];
  // A cumulative counter never goes down. One decrease proves the values are per-turn — this is
  // the ONLY inference the values themselves support.
  const decreases = series.some((n, i) => i > 0 && n < series[i - 1]);
  if (decreases) {
    if (semantics === 'cumulative') {
      return {
        basis: 'contradiction',
        total: null,
        series,
        reason: 'the adapter declares cumulative usage but the series decreases; a counter that '
          + 'goes down is not a counter, so the declared contract and the data disagree',
      };
    }
    return { basis: 'per_turn_sum', total: sum, series, reason: null };
  }

  // ⛔ MY FIRST VERSION CALLED A GROWING SERIES CUMULATIVE AND TOOK THE LAST VALUE. That is the
  // same inference-from-shape I have spent the week removing from everything else.
  // graph-senior-dev executed it: [100,200,300] returns 300, but a PER-TURN series naturally
  // grows as context grows, so the true total may be 600. The comment even conceded both
  // readings fit and then picked one.
  //
  // ⇒ EVERY NON-DECREASING MULTI-TURN SERIES IS AMBIGUOUS FROM VALUES ALONE, not only a constant
  // one. The reading is a property of the HOST, not of the numbers, so it has to be DECLARED.
  if (semantics === 'per_turn') return { basis: 'per_turn_sum', total: sum, series, reason: null };
  if (semantics === 'cumulative') return { basis: 'cumulative_last', total: last, series, reason: null };
  return {
    basis: 'ambiguous',
    total: null,
    series,
    reason: `${series.length} turns with a non-decreasing series (${series.join(', ')}); `
      + 'cumulative and per-turn readings both fit, and no adapter declared usageSemantics. '
      + 'Establish it against a provider-reported total on a frozen transcript, then pass it.',
  };
}

// Pull every `turn.completed` usage out of a JSONL transcript, in order.
//
// ⚠ DEDUPED BY EVENT IDENTITY. A host may emit one event per content block, each carrying the
// SAME usage object; counting those separately inflates the total by however many blocks the
// turn happened to have. Keyed on the turn/message id when present, so a repeat is dropped
// rather than added.
// ⛔ THIS HAD NO DENOMINATOR. It silently skipped `turn.completed` events with missing usage and
// lines that failed to parse, so a transcript where half the turns lost their usage produced a
// confident total over the half that survived — the census-with-no-population defect, in the
// collector feeding the reconciler that refuses for exactly that reason.
//
// ⚠ AND IDENTITY-LESS DEDUP IS UNSAFE. Dropping a repeat by payload equality assumes two turns
// cannot legitimately report identical usage. They can. Only an explicit event id may dedup;
// without one, repeats are COUNTED and the ambiguity is reported rather than resolved.
export function collectTurnUsage(lines) {
  const seen = new Set();
  const usages = [];
  let completedSeen = 0;
  let missingUsage = 0;
  let parseFailures = 0;
  let unidentified = 0;

  for (const line of lines) {
    if (!line || !line.includes('"turn.completed"')) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      parseFailures += 1;
      continue;
    }
    if (ev?.type !== 'turn.completed') continue;
    completedSeen += 1;
    if (!ev.usage) { missingUsage += 1; continue; }
    const id = ev.id ?? ev.turn_id ?? ev.message?.id ?? ev.item_id ?? null;
    if (id == null) unidentified += 1;
    else {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    usages.push(ev.usage);
  }

  return {
    usages,
    coverage: {
      completedSeen,
      usageSeen: usages.length,
      missingUsage,
      parseFailures,
      unidentified,
      // The collector states whether it saw the whole population; the caller decides what to do
      // about it. Reporting a total over a partial transcript is the thing being prevented.
      complete: parseFailures === 0 && missingUsage === 0 && completedSeen > 0,
    },
  };
}
