// TOKENS FOR ONE HERMES RUN, from the harness's two records of it, refused when they do not agree.
//
// The sibling of claude-session-usage.mjs, for the rehearsal of the usefulness trial (aify-dashboard
// docs/PREREGISTRATION-v0.8.md). Measured on 2026-10-05 against a one-shot `hermes -z … --usage-file <json>` run
// (Hermes v0.21.5, gpt-6.1-sol, session 20261005_071349_bc5771). Hermes leaves two records:
//   - the --usage-file JSON: the main thread's counts at the top level, and helper calls (title generation,
//     compression, …) under `auxiliary.by_task`;
//   - state.db's session_model_usage: one row per (session, task), where task '' is the main thread.
// On that run they agreed on every field, so each is the other's control: the answer is reported only when they
// agree, and refused otherwise.
//
// ⚠ NOT COMPARABLE WITH CLAUDE'S FIELDS BY NAME. Claude's input_tokens EXCLUDES cache reads; whether Hermes'
// input_tokens includes its cache_read_tokens is NOT established (OpenAI-style counts usually do). The reader reports
// the raw fields and says so, rather than normalising on a guess.

/** The counts, as both records name them. */
export const HERMES_FIELDS = Object.freeze(['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens']);

const pick = (o) => Object.fromEntries(HERMES_FIELDS.map((k) => [k, Number(o?.[k] ?? 0)]));
const refused = (reason, detail) => ({ ok: false, reason, detail });

/** Every field on which two count records disagree. PURE. */
function differences(label, a, b) {
  return HERMES_FIELDS.filter((k) => a[k] !== b[k]).map((k) => ({ part: label, field: k, usageFile: a[k], stateDb: b[k] }));
}

/**
 * The tokens one hermes run used, or a refusal. PURE.
 * @param {{ usageFile: object, rows: object[] }} input  the parsed --usage-file JSON, and every session_model_usage row
 *   for the session it names.
 * @returns {{ ok: true, sessionId, model, main, auxiliary: Record<string, object>, total, completed }
 *   | { ok: false, reason, detail }}
 */
export function measureHermesRun({ usageFile, rows }) {
  if (!usageFile || typeof usageFile !== 'object') return refused('no_usage_file', 'the run left no usage report');
  if (!Array.isArray(rows) || rows.length === 0) return refused('no_state_rows', `no session_model_usage rows for ${usageFile.session_id}`);
  const models = [...new Set(rows.map((r) => r.model))];
  if (models.length !== 1 || models[0] !== usageFile.model) return refused('model_mismatch', { usageFile: usageFile.model, stateDb: models });

  const mainRows = rows.filter((r) => r.task === '' || r.task === null);
  if (mainRows.length !== 1) return refused('main_rows', `${mainRows.length} main-thread rows; a run has exactly one`);
  const main = pick(usageFile);
  const diff = differences('main', main, pick(mainRows[0]));

  const auxFile = usageFile.auxiliary?.by_task ?? {};
  const auxRows = Object.fromEntries(rows.filter((r) => r.task).map((r) => [r.task, pick(r)]));
  for (const task of new Set([...Object.keys(auxFile), ...Object.keys(auxRows)])) {
    diff.push(...differences(`aux:${task}`, pick(auxFile[task]), auxRows[task] ?? pick({})));
  }
  if (diff.length > 0) return refused('records_disagree', diff);

  const auxiliary = Object.fromEntries(Object.entries(auxFile).map(([t, v]) => [t, pick(v)]));
  const total = pick({});
  for (const part of [main, ...Object.values(auxiliary)]) for (const k of HERMES_FIELDS) total[k] += part[k];
  return { ok: true, sessionId: usageFile.session_id, model: usageFile.model, main, auxiliary, total, completed: usageFile.completed === true };
}
