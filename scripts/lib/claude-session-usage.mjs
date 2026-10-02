// TOKENS FOR ONE CLAUDE CODE RUN, read from the harness's own session records, and refused when they do not add up.
//
// The usefulness trial (aify-dashboard docs/PREREGISTRATION-v0.8.md, amended at 81ecd2a) records input, output and
// cache tokens per run "from the harness's own usage records". This reads them. `turn-usage.mjs` is the sibling for
// Codex's `turn.completed` events, which is a different record shape; nothing here applies to it.
//
// What the records are, measured on 2026-10-02 against a fresh headless run with one subagent (session 603ba72d):
//
// 1. Every assistant line carries `message.usage` for ONE API call. A call spans several lines (one per content
//    block) that repeat the same usage, so a call is counted once, by `message.id`.
// 2. ⛔ A SUBAGENT'S CALLS ARE NOT IN THE SESSION FILE. They are in `<session>/subagents/agent-*.jsonl`. Reading the
//    session file alone gave 8 / 783 / 142,603 / 28,646 where the run used 12 / 1,106 / 174,981 / 64,149. The smaller
//    numbers are also exactly what the stream's `result.usage` reports, so they look right. They are not.
// 3. The harness writes a `cost-state` record holding its own per-model totals for the PROCESS. On that run the
//    transcript sum (session plus subagents) equalled it on every field, so the per-call reading is established
//    against a total the harness reports, not inferred from the shape of the numbers.
// 4. ⛔ A RESUMED SESSION BREAKS THAT. cost-state covers only the last process, and the file holds every process's
//    calls. On interactive sessions measured the same day the two disagreed by up to a factor of 70 on input tokens.
//    Trial runs are fresh headless sessions, so a file spanning more than one process is refused, not windowed.
//
// ⇒ The harness's totals are the CONTROL, not the answer. The answer is the transcript sum; it is reported only when
//   the control agrees with it exactly, and refused otherwise. A cost-state alone could not tell a missing subagent
//   file from a run that spawned none.

/** The four token counts, as cost-state names them, with the field each comes from in an API call's usage. */
export const TOKEN_FIELDS = Object.freeze({
  inputTokens: 'input_tokens',
  outputTokens: 'output_tokens',
  cacheReadInputTokens: 'cache_read_input_tokens',
  cacheCreationInputTokens: 'cache_creation_input_tokens',
});

const COUNTS = Object.keys(TOKEN_FIELDS);
const zero = () => Object.fromEntries(COUNTS.map((k) => [k, 0]));

/**
 * The model a usage belongs to, without a context-window suffix. Observed: cost-state keyed one session's totals
 * `claude-opus-5-5[1m]` while every call in its transcript said `claude-opus-5-5`, and the numbers matched exactly.
 */
export function baseModel(name) {
  return String(name).replace(/\[[^\]]*\]$/u, '');
}

const refused = (reason, detail) => ({ ok: false, reason, detail });

/**
 * Sum the API calls in a set of records, one per `message.id`. PURE.
 * Returns { perModel, calls, conflicts }: `conflicts` lists ids whose repeated lines disagree on usage.
 */
export function tallyCalls(records) {
  const byId = new Map();
  const conflicts = [];
  for (const r of records) {
    if (r?.type !== 'assistant' || !r.message?.usage) continue;
    const { id, model, usage } = r.message;
    const counts = Object.fromEntries(COUNTS.map((k) => [k, usage[TOKEN_FIELDS[k]] ?? 0]));
    const seen = byId.get(id);
    if (seen === undefined) byId.set(id, { model: baseModel(model), counts, timestamp: r.timestamp });
    else if (COUNTS.some((k) => seen.counts[k] !== counts[k])) conflicts.push(id);
  }
  const perModel = {};
  for (const { model, counts } of byId.values()) {
    const sum = perModel[model] ??= zero();
    for (const k of COUNTS) sum[k] += counts[k];
  }
  return { perModel, calls: [...byId.values()], conflicts };
}

/** The models with any tokens at all. A model that spent nothing cannot be compared, and is not a disagreement. */
const spent = (perModel) => Object.fromEntries(Object.entries(perModel).filter(([, c]) => COUNTS.some((k) => c[k] !== 0)));

/** cost-state's totals in the same shape, suffixes folded the same way. PURE. */
export function harnessTotals(costState) {
  const perModel = {};
  for (const [model, u] of Object.entries(costState.modelUsage ?? {})) {
    const sum = perModel[baseModel(model)] ??= zero();
    for (const k of COUNTS) sum[k] += u[k] ?? 0;
  }
  return perModel;
}

/**
 * Every field on which two per-model tallies disagree, as { model, field, transcript, harness }. PURE.
 * Empty means they agree exactly, which is the only agreement accepted.
 */
export function disagreements(transcript, harness) {
  const a = spent(transcript);
  const b = spent(harness);
  const out = [];
  for (const model of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    for (const field of COUNTS) {
      const t = a[model]?.[field] ?? 0;
      const h = b[model]?.[field] ?? 0;
      if (t !== h) out.push({ model, field, transcript: t, harness: h });
    }
  }
  return out;
}

/**
 * The tokens one run used, or a refusal. PURE.
 *
 * @param {{ session: object[], subagents: object[][] }} input  parsed records of the session file and of each
 *   subagent file. The caller reads them; see `readClaudeSession` in claude-session-files.mjs.
 * @returns {{ ok: true, perModel, total, session, subagents, calls }
 *   | { ok: false, reason: string, detail }}
 */
export function measureRunTokens({ session, subagents }) {
  const own = tallyCalls(session);
  if (own.calls.length === 0) return refused('no_usage_records', 'the session file holds no API call with usage');

  const costStates = session.filter((r) => r?.type === 'cost-state');
  if (costStates.length === 0) {
    return refused('no_harness_total', 'no cost-state record, so nothing independent can check the sum');
  }
  const last = costStates.at(-1);
  const starts = [...new Set(costStates.map((c) => c.startTime))];
  if (starts.length > 1) {
    return refused('more_than_one_process', `${starts.length} process start times; the harness total covers only the last`);
  }

  const theirs = subagents.map((records) => tallyCalls(records));
  const all = tallyCalls([...session, ...subagents.flat()]);
  if (all.conflicts.length > 0) {
    return refused('conflicting_repeats', `call(s) ${all.conflicts.join(', ')} repeat with different usage`);
  }
  const early = all.calls.filter((c) => Date.parse(c.timestamp) < last.startTime);
  if (early.length > 0) {
    return refused('more_than_one_process', `${early.length} call(s) predate the process the harness total covers`);
  }

  const diff = disagreements(all.perModel, harnessTotals(last));
  if (diff.length > 0) return refused('disagrees_with_harness', diff);

  const total = zero();
  for (const counts of Object.values(all.perModel)) for (const k of COUNTS) total[k] += counts[k];
  const sumOf = (tallies) => {
    const s = zero();
    for (const t of tallies) for (const c of Object.values(t.perModel)) for (const k of COUNTS) s[k] += c[k];
    return s;
  };
  return {
    ok: true,
    perModel: all.perModel,
    total,
    session: sumOf([own]),
    subagents: sumOf(theirs),
    calls: all.calls.length,
  };
}
