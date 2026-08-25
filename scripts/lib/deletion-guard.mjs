// The decision behind the PostToolUse deletion guard, separated from the plumbing so it can be
// tested without a repository, a database, or a live host.
//
// WHY THIS EXISTS. Every adoption measurement on this project says the same thing: entry-point
// reach works and MID-TASK reach does not. Agents invoke a skill deliberately at the start of a
// task and then never reach for anything again — 12 of 17 skills never invoked, 7 of 1,049 subagent
// transcripts calling a graph verb, and in a controlled A/B three of five agents TOLD to use the
// tools called none.
//
// ⇒ A HOOK DOES NOT REQUIRE THE AGENT TO REACH. That is the whole argument for it, and it is why
// the roadmap calls this the strongest adoption lever available.
//
// ⛔ IT IS ALSO THE HIGHEST SLOP RISK IN THE PROJECT, so the rule was measured BEFORE being built:
//
//     rule A  "here are the callers of what you edited"       71/83 edits = 85.5%   DEAD
//     rule B  "you deleted an exported symbol that has        4/83 edits = 4.8%     VIABLE
//              callers"                                       (upper bound)
//
// Rule A is not a tuning problem. Nearly every edit to a connected codebase has callers elsewhere,
// so it ADDS DATA — and this project's own finding is that behaviour changes only when a field
// CONTRADICTS the agent's confidence. A frequent signal later disproved teaches agents to ignore it
// permanently, which would poison the channel for every future signal.
//
// Rule B is what a contradiction looks like: you removed something, and something still needs it.

/** Tools whose result can delete a declaration. Anything else is not our business. */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/**
 * Which files did this hook payload touch? Defensive about shape, because a payload format that
 * shifts under us must make the hook SILENT, never noisy or crashy.
 */
export function editedFilesFromPayload(payload) {
  const input = payload?.tool_input ?? payload?.toolInput ?? {};
  const candidates = [
    input.file_path, input.filePath, input.path,
    ...(Array.isArray(input.edits) ? input.edits.map((e) => e?.file_path ?? e?.filePath) : []),
    ...(Array.isArray(input.files) ? input.files : []),
  ];
  return [...new Set(candidates.filter((f) => typeof f === 'string' && f.length > 0))];
}

/** Did a tool run that could possibly have deleted something? */
export function isEditTool(payload) {
  const name = payload?.tool_name ?? payload?.toolName ?? '';
  return EDIT_TOOLS.has(name);
}

/**
 * The whole decision, with every side effect injected.
 *
 * ⭐ ORDERED CHEAPEST-GUARD-FIRST, AND THAT ORDER IS LOAD-BEARING. This runs after EVERY edit an
 * agent makes. Opening a graph database on each one would be a per-edit latency tax on the 95% of
 * edits that cannot fire, which is how a correct feature becomes something an operator disables.
 * The text-only pre-filter (`removedDeclarations`) runs before anything touches disk.
 *
 * @param {object} args
 * @param {object} args.payload            the raw hook payload
 * @param {(p: string) => boolean} args.isApgRepo
 * @param {(files: string[]) => string} args.diffFor    unified diff for the edited files
 * @param {(diff: string) => {name: string, exported: boolean}[]} args.removedDeclarations
 * @param {(args: object) => object[]} args.findFindings  the DB-backed rule
 * @param {string} args.repoRoot
 * @returns {{fire: boolean, reason: string, findings?: object[]}}
 */
export function evaluateEdit({ payload, isApgRepo, diffFor, removedDeclarations, findFindings, repoRoot }) {
  if (!isEditTool(payload)) return { fire: false, reason: 'not_an_edit_tool' };

  const editedFiles = editedFilesFromPayload(payload);
  if (editedFiles.length === 0) return { fire: false, reason: 'no_edited_files_in_payload' };

  if (!isApgRepo(repoRoot)) return { fire: false, reason: 'not_an_apg_repo' };

  let diff = '';
  try { diff = diffFor(editedFiles) || ''; } catch { return { fire: false, reason: 'diff_unavailable' }; }
  if (!diff.trim()) return { fire: false, reason: 'empty_diff' };

  // ⭐ THE CHEAP PRE-FILTER. Pure text, no database. A declaration that was MODIFIED is a -/+ pair
  // on the same name and is not a deletion — getting that wrong once inflated a measured rate from
  // 4.8% to 15.7%, which reads as "too noisy" and would have killed a viable rule.
  let removed = [];
  try { removed = removedDeclarations(diff) || []; } catch { return { fire: false, reason: 'parse_failed' }; }
  if (removed.length === 0) return { fire: false, reason: 'nothing_deleted' };

  let findings = [];
  try { findings = findFindings({ diff, editedFiles }) || []; } catch { return { fire: false, reason: 'lookup_failed' }; }
  if (findings.length === 0) return { fire: false, reason: 'deleted_but_no_callers' };

  return { fire: true, reason: 'deleted_symbol_has_callers', findings };
}

/**
 * Render the contradiction for the agent.
 *
 * ⚠ SAYS WHAT IS WRONG AND WHAT TO DO, in that order, and nothing else. A hook that fires rarely
 * gets exactly one chance to be worth reading; padding it with context the agent did not ask for is
 * how a rare signal becomes a skipped one.
 */
export function renderFindings(findings) {
  const lines = ['⛔ You deleted a symbol that still has callers.'];
  for (const f of findings) {
    const shown = f.callers.slice(0, 5);
    lines.push('');
    lines.push(`  ${f.symbol} — ${f.callers.length} caller${f.callers.length === 1 ? '' : 's'}:`);
    for (const c of shown) lines.push(`    ${c.file}${c.caller ? `  (${c.caller})` : ''}`);
    if (f.callers.length > shown.length) lines.push(`    … and ${f.callers.length - shown.length} more`);
  }
  lines.push('');
  lines.push('These are compiler-verified call edges, not text matches. Either restore the symbol, '
    + 'or update the callers above. If you believe they are stale, re-check with code_intel_references.');
  return lines.join('\n');
}
