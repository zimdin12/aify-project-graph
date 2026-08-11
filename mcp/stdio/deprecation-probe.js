// ★ THE CHEAPEST POSSIBLE INSTRUMENT FOR A DECISION NOBODY COULD MAKE.
//
// Eleven verbs are hidden from tools/list because a comment says they are redundant.
// The comment has been right there for months and nothing happened, which is the point
// ef-manager made on 2026-08-10 and the reason this file exists:
//
//   A COMMENT IS A NOTE TO NOBODY. It has no owner, no date, no trigger and no
//   consequence. A failing test creates obligation; a runtime deprecation creates
//   obligation; a comment creates none. Writing the eleven down WAS the entire action
//   taken, and then eleven of them accumulated.
//
// Deleting them was blocked on a real limit, correctly stated by the reporter: with no
// telemetry, "nobody calls X" is unclaimable. This dissolves that limit instead of
// arguing past it.
//
//   never fires  → delete it, and we now HAVE the evidence we said we lacked
//   fires        → the comment was WRONG, which is better than a deletion
//
// Either way the unknown resolves itself. That is why it is one log line per verb and
// not a feature: it is not built to be useful, it is built to make a question decidable.
//
// ⚠ DURABLE ON PURPOSE. stderr is lost when the process dies, so a stderr-only probe
// would leave "it never fired" unfalsifiable next month — the same shape as every
// unverified absence in this codebase. The breadcrumb outlives the session, so a future
// reader checks a file instead of trusting a recollection.
//
// ⚠ AND IT DOES NOT GATE, WARN THE CALLER, OR CHANGE THE RESPONSE. An agent calling one
// of these gets exactly what it got yesterday. A probe that alters the behaviour it
// measures produces compliance data, which is the defect D1′ ran into — the subject was
// TOLD to call graph_health first, so first-call-is-health measured obedience.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HIDDEN_FULL_TOOL_NAMES } from './hidden-tools.js';

// verb → what to use instead. Sourced from HIDDEN_FULL_TOOL_NAMES' own comment in
// server.js, so this map records the CLAIM being tested, not a fresh opinion.
export const DEPRECATION_REPLACEMENTS = {
  // 1. Legacy locators the briefs replaced.
  graph_lookup: 'graph_search / graph_whereis, or .aify-graph/brief.agent.md',
  graph_summary: '.aify-graph/brief.agent.md',
  graph_report: '.aify-graph/brief.agent.md',
  // 2. Planning verbs redundant with graph_packet modes — both share computeDecision
  //    with packet's verify/plan paths.
  graph_change_plan: 'graph_packet(mode="plan")',
  graph_preflight: 'graph_packet(mode="verify")',
  // 3. Analytics long-tail — graph_digest is the ONE front door and composes these.
  graph_overview: 'graph_digest',
  graph_hotspots: 'graph_digest',
  graph_cycles: 'graph_digest',
  graph_module_tree: 'graph_digest',
  // 4. Code-intel long-tail — specialist follow-ups behind the live primaries.
  code_intel_replay: 'code_intel_references / code_intel_hierarchy',
  code_intel_analyze: 'code_intel_references / code_intel_diagnostics',
};

// ★ THE COVERAGE INVARIANT, ENFORCED AT IMPORT AND NOT BY A TEST.
//
// The probe's entire value is the sentence "this verb was never called". That sentence
// is only true if the verb was WATCHED. A hidden verb missing from the map above would
// be silent for the same reason a dead verb is silent, and the deletion decision would
// be made on an undercount — an unverified absence, which is the defect class this
// whole codebase has been chasing.
//
// A test would catch it too, but only when someone runs the suite. This fails the
// server at startup, which is the moment the omission is created. Same argument as the
// one-shot log itself: a check with a consequence beats a note.
for (const name of HIDDEN_FULL_TOOL_NAMES) {
  if (!DEPRECATION_REPLACEMENTS[name]) {
    throw new Error(
      `deprecation-probe: '${name}' is hidden as redundant but has no replacement mapped. `
      + `Add it to DEPRECATION_REPLACEMENTS — an unwatched hidden verb cannot be shown to be unused, `
      + `so leaving it out silently corrupts the deletion evidence.`,
    );
  }
}
for (const name of Object.keys(DEPRECATION_REPLACEMENTS)) {
  if (!HIDDEN_FULL_TOOL_NAMES.has(name)) {
    throw new Error(
      `deprecation-probe: '${name}' has a replacement mapped but is no longer hidden. `
      + `Either it was un-hidden (drop it from the map) or it was renamed (fix the map) — `
      + `a probe entry for a listed verb would record ordinary use as deletion evidence.`,
    );
  }
}

// One shot PER PROCESS per verb. A long-lived MCP server answering a hundred calls to
// the same dead verb should say so once — the question is "does anything call it", and
// the hundredth line answers nothing the first did not.
const firedThisProcess = new Set();

/**
 * Record that a self-declared-redundant verb was actually called.
 * Best-effort and never throws: a telemetry breadcrumb must not be able to fail a
 * tool call. Returns true if this call was the first for that verb in this process.
 */
export function noteDeprecatedVerbCall(verbName, repoRoot) {
  const replacement = DEPRECATION_REPLACEMENTS[verbName];
  if (!replacement) return false;
  if (firedThisProcess.has(verbName)) return false;
  firedThisProcess.add(verbName);

  const line = `[aify-project-graph] DEPRECATION PROBE: ${verbName} was called. `
    + `It is hidden from tools/list as redundant with ${replacement}. `
    + `This verb was a deletion candidate — the call is evidence it should NOT be deleted.\n`;
  try { process.stderr.write(line); } catch { /* stderr closed */ }

  // Durable half. Scoped to the repo being queried so the evidence lands next to the
  // graph it is about, and so several repos do not fight over one file.
  if (!repoRoot) return true;
  try {
    const dir = join(repoRoot, '.aify-graph');
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, 'deprecated-verb-calls.jsonl'),
      `${JSON.stringify({ verb: verbName, replacement, at: new Date().toISOString() })}\n`,
      'utf8',
    );
  } catch { /* unwritable repo — the stderr half still fired */ }
  return true;
}

// Exposed for tests and for whoever runs the deletion decision later.
export function _resetDeprecationProbeForTests() {
  firedThisProcess.clear();
}
