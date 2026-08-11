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
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
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

// ★ THE SINK LIVES OUTSIDE THE QUERIED REPO. Two findings forced this, 2026-08-11.
//
// 1. SAFETY BOUNDARY (graph-senior-dev). The probe ran BEFORE `findSensitivePathArg`,
//    so a hidden verb call could mkdir+append beneath a caller-supplied path that the
//    very next check was about to reject as sensitive. The catch stopped the append from
//    throwing outward; it did not undo a successful unauthorised write. Telemetry must
//    never be the thing that touches a path the request is not yet allowed to touch.
//
// 2. NO-RESIDUE. Writing into the queried repo created a file that did not exist there,
//    which breaks the read-only/no-residue contract we hold ourselves to for repos we do
//    not own — the exact constraint protecting echoes. A probe that cannot be run against
//    a read-only repo is a probe that cannot measure the repos we most want to measure.
//
// So it writes to an APG-owned user-data path, keyed by canonical repo identity. No
// caller-supplied path is ever written to, which makes ordering against the sensitive-
// path gate moot rather than merely correct.
// APG_TELEMETRY_DIR redirects the sink. Present so tests do not write into a real home
// directory, and so an operator can relocate it — but note it is read ONCE at module
// load, deliberately: a per-call read would let a caller-supplied environment steer where
// we write, which is the authority problem this move was made to eliminate.
const SINK_DIR = process.env.APG_TELEMETRY_DIR || join(homedir(), '.aify-project-graph');
const SINK = join(SINK_DIR, 'deprecated-verb-calls.jsonl');

// One shot per (repo, verb) — NOT per verb.
//
// Keyed by verb alone, the first repo suppressed every later one while the comment
// claimed repo-scoped evidence. And `fired` was recorded BEFORE the write, so the first
// call with no resolvable repo — which is normal, since verbs default to server cwd —
// permanently consumed the one shot and left no durable trace at all. Both found by
// executable probe, not by reading.
const firedThisProcess = new Set();

/**
 * Record that a self-declared-redundant verb was actually called.
 * Best-effort and never throws: a telemetry breadcrumb must not be able to fail a
 * tool call. Returns true if this call was the first for that verb in this process.
 */
export function noteDeprecatedVerbCall(verbName, repoRoot) {
  const replacement = DEPRECATION_REPLACEMENTS[verbName];
  if (!replacement) return false;

  // Canonical repo identity, or a stable placeholder. Never used as a write target —
  // only as a key and a recorded field.
  let repoKey = '(unresolved)';
  try { if (repoRoot) repoKey = resolve(repoRoot); } catch { /* keep placeholder */ }

  // Explicit separator. A bare concatenation would let ("/a/b", "cd") and ("/a/bc", "d")
  // collide, silently suppressing a genuine call — and this key's whole job is to decide
  // whether a call was ever recorded.
  const shotKey = `${repoKey}::${verbName}`;
  if (firedThisProcess.has(shotKey)) return false;

  const line = `[aify-project-graph] DEPRECATION PROBE: ${verbName} was called (repo: ${repoKey}). `
    + `It is hidden from tools/list as redundant with ${replacement}. `
    + `This verb was a deletion candidate — the call is evidence it should NOT be deleted.\n`;
  try { process.stderr.write(line); } catch { /* stderr closed */ }

  // ★ MARK FIRED ONLY AFTER THE DURABLE SINK SUCCEEDS.
  //
  // Previously `fired` was set first, so a failed or skipped write consumed the one shot
  // and the evidence was silently never recorded — an absence indistinguishable from
  // "nobody called it", which is precisely the inference this probe exists to support.
  // A telemetry bug that erases its own evidence is worse than no telemetry.
  try {
    mkdirSync(SINK_DIR, { recursive: true });
    appendFileSync(
      SINK,
      `${JSON.stringify({ verb: verbName, replacement, repo: repoKey, at: new Date().toISOString() })}\n`,
      'utf8',
    );
    firedThisProcess.add(shotKey);
    return true;
  } catch {
    // Sink unwritable. Do NOT mark fired — a later call may succeed, and a durable
    // record we can act on is worth more than one deduplicated stderr line.
    return false;
  }
}

// ★ THE DENOMINATOR. Without it the probe records fires and nothing else.
//
// ef-manager, 2026-08-11: on a deferred-MCP host, 0 of 11 hidden verbs are reachable at
// all, because such a host builds its callable set FROM tools/list and these are filtered
// out of it. So `deprecated-verb-calls.jsonl` being empty after a week of real work meant
// NOTHING — reachability was zero.
//
// "Never fires → delete" would then be reasoning from a DEGRADED absence, which is this
// project's own refsNotFoundBreakdown rule turned on an instrument I built the same day:
// THE INDEX COULD NOT ANSWER is a statement about the index, not about the code.
//
// So each session records that the probe was ARMED and whether the host could reach an
// unlisted verb. A future reader then sees "0 calls across N armed sessions, M of them on
// hosts that could reach these verbs" and can separate REACHABLE-AND-UNWANTED from
// UNREACHABLE-EVERYWHERE. Only the first licenses deletion.
let armedThisProcess = false;
export function noteProbeArmed({ hostCanReachUnlisted }) {
  if (armedThisProcess) return;
  armedThisProcess = true;
  try {
    mkdirSync(SINK_DIR, { recursive: true });
    appendFileSync(
      SINK,
      `${JSON.stringify({ event: 'armed', hostCanReachUnlisted: !!hostCanReachUnlisted, watching: Object.keys(DEPRECATION_REPLACEMENTS).length, at: new Date().toISOString() })}\n`,
      'utf8',
    );
  } catch { /* best effort — an unrecorded arming under-counts the denominator, which
                is the SAFE direction: it makes the evidence look weaker, not stronger. */ }
}

// Exposed for tests and for whoever runs the deletion decision later.
export function _resetDeprecationProbeForTests() {
  firedThisProcess.clear();
}
