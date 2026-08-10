// IS THIS TASK STILL OPEN? — one classifier, because trackers do not agree.
//
// Measured on echoes (2026-08-10), whose tasks.json is ClickUp-sourced:
//
//   "to do" 42 · "complete" 46 · "open" 12 · "in_progress" 1
//   "closed_workflow_neutral" 1
//
// The previous test was an inline regex, `/open|progress|active|todo|in_progress/i`,
// duplicated at two call sites. `/todo/` does NOT match `"to do"` — ClickUp writes
// it with a space — so 42 of 101 tasks were silently classified as closed and
// dropped from open_tasks_on_those_features. graph_consequences reported ZERO open
// tasks on a feature that had four.
//
// That is a source-specific failure in a layer documented as source-agnostic:
// APG imports from ClickUp, Asana, Linear, Jira, Plane, GitHub Issues and
// plaintext, and every one of them spells its statuses differently. A hardcoded
// vocabulary is a bet that every tracker uses ours.
//
// ★ UNKNOWN STATUSES COUNT AS OPEN, DELIBERATELY.
//
// The failure above was silent: work existed and the reader was told it did not.
// Classifying an unrecognised status as closed reproduces that — a Plane or Asana
// state we have never seen would vanish rather than surface. An unknown status is
// unknown, and the honest default for "there may be work here" is to show it and
// say the classification was uncertain. Callers that need to know get
// `classifyTaskStatus`, which reports `unknown` distinctly from `open`.

/** Normalise across tracker spellings: "To Do", "to_do", "TO-DO" → "todo". */
function normalise(status) {
  return String(status ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

// Terminal states. Everything not listed here is treated as live work.
// Kept as an explicit CLOSED list rather than an explicit OPEN list precisely so
// that an unseen tracker's in-progress state fails toward visible, not hidden.
const CLOSED = new Set([
  'complete', 'completed', 'closed', 'done', 'resolved', 'fixed',
  'cancelled', 'canceled', 'wontfix', 'wontdo', 'duplicate', 'archived',
  'closedworkflowneutral', 'shipped', 'released', 'merged', 'abandoned',
  'rejected', 'invalid', 'obsolete',
]);

// Recognised live states — used only to tell `open` apart from `unknown`.
// Membership here is NOT what makes a task open; absence from CLOSED is.
const OPEN = new Set([
  'open', 'todo', 'backlog', 'new', 'ready', 'triage', 'planned',
  'inprogress', 'progress', 'active', 'doing', 'started', 'inreview',
  'review', 'blocked', 'onhold', 'paused', 'reopened',
]);

/**
 * @returns {'open'|'closed'|'unknown'} — `unknown` is treated as open by
 * `isTaskOpen`, but reported separately so a caller can say so.
 */
export function classifyTaskStatus(status) {
  const n = normalise(status);
  if (!n) return 'unknown';
  if (CLOSED.has(n)) return 'closed';
  if (OPEN.has(n)) return 'open';
  return 'unknown';
}

/** True for live work AND for statuses we do not recognise. See the header. */
export function isTaskOpen(status) {
  return classifyTaskStatus(status) !== 'closed';
}
