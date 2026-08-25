#!/usr/bin/env node
// PostToolUse hook — the ONE mid-task signal measured worth sending.
//
// Fires when an edit DELETED an exported declaration that still has compiler-verified callers.
// Silent on everything else.
//
// Wire it into the host's settings (Claude Code example):
//   "hooks": { "PostToolUse": [ { "matcher": "Edit|Write|MultiEdit", "hooks": [ { "type": "command",
//     "command": "node /path/to/aify-project-graph/scripts/hooks/post-edit-deletion-guard.mjs" } ] } ] }
//
// WHY A HOOK AT ALL. Every adoption measurement here says entry-point reach works and MID-TASK reach
// does not: 12 of 17 skills never invoked, 7 of 1,049 subagent transcripts calling a graph verb,
// three of five agents TOLD to use the tools calling none. A hook does not require the agent to
// reach — which is why it beats any further attempt to persuade one that is otherwise routing fine.
//
// ⛔ WHY THIS RULE AND NOT "HERE ARE THE CALLERS". Measured on 83 real edits before anything was
// built: "callers of what you edited" fires on 85.5% of edits, "deleted something still called"
// on 4.8% (upper bound). The first ADDS DATA and this project's own finding is that behaviour
// changes only when a signal CONTRADICTS the agent's confidence. A frequent signal later disproved
// teaches agents to ignore the channel permanently, taking every future signal with it.
//
// ⛔ NEVER BLOCKS AND NEVER THROWS. Exit 0 on every path. This runs after every edit an agent
// makes; a hook that errors is worse than no hook, because it gets switched off.

import { existsSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { evaluateEdit, renderFindings, editedFilesFromPayload } from '../lib/deletion-guard.mjs';

async function main() {
  const repoRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // Cheapest possible guard, before reading stdin or importing anything heavy.
  if (!existsSync(join(repoRoot, '.aify-graph'))) return;

  let payload = {};
  try {
    const raw = await readStdin();
    payload = raw ? JSON.parse(raw) : {};
  } catch { return; }   // a payload we cannot parse means silence, never noise

  // The rule module is pure text and cheap. The DATABASE is the expensive import, so it is loaded
  // only after the text pre-filter has already said something was genuinely deleted.
  let rule;
  try { rule = await import('../../mcp/stdio/analysis/deleted-with-callers.js'); }
  catch { return; }

  // ⚠ THE CHEAP CHECK IS RUN HERE TOO, DELIBERATELY. `evaluateEdit` performs the same test and is
  // the single tested decision — but it is synchronous, and the lazy `await import` of the database
  // has to happen before it. Repeating a pure, side-effect-free text filter is the honest price for
  // not loading sqlite on the ~95% of edits that cannot fire. If these two ever disagree the hook
  // goes quiet, never loud.
  const editedFiles = editedFilesFromPayload(payload);
  if (editedFiles.length === 0) return;
  let earlyDiff = '';
  try { earlyDiff = gitDiff(repoRoot, editedFiles) || ''; } catch { return; }
  let earlyRemoved = [];
  try { earlyRemoved = rule.removedDeclarations(earlyDiff) || []; } catch { return; }
  if (earlyRemoved.length === 0) return;      // sqlite is never loaded on this path

  let dbMod;
  try { dbMod = await import('../../mcp/stdio/storage/db.js'); }
  catch { return; }

  const result = evaluateEdit({
    payload,
    repoRoot,
    isApgRepo: (root) => existsSync(join(root, '.aify-graph')),
    diffFor: () => earlyDiff,               // already computed; git is not run twice
    removedDeclarations: rule.removedDeclarations,
    findFindings: ({ diff, editedFiles: files }) => findWithDb(dbMod, rule, repoRoot, diff, files),
  });

  if (!result.fire) return;

  const text = renderFindings(result.findings);
  // Claude Code surfaces `additionalContext` from a PostToolUse hook to the agent; plain stdout is
  // also read by hosts that do not parse the envelope, so both are emitted.
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text },
  }));
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) { resolve(''); return; }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
    setTimeout(() => resolve(data), 2000).unref?.();   // never hang an agent's edit
  });
}

/** Unstaged diff for the edited files — what the agent just did, not what is committed. */
function gitDiff(repoRoot, files) {
  const rel = files
    .map((f) => (isAbsolute(f) ? relative(repoRoot, f) : f))
    .filter((f) => f && !f.startsWith('..'));
  if (rel.length === 0) return '';
  return execFileSync('git', ['diff', '--unified=0', '--', ...rel], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 22, timeout: 4000,
  });
}

/** The DB-backed half. Only reached when the text pre-filter already said something was deleted. */
function findWithDb(dbMod, rule, repoRoot, diff, editedFiles) {
  // ⛔ `openExistingDb` takes a PATH and THROWS when it is absent — it does not take a repo root.
  // The first version passed `repoRoot`, which threw, which the hook's own silence contract then
  // swallowed. The hook would have been permanently inert and every observation of it would have
  // looked exactly like "correctly quiet". That is the standing hazard of a fail-silent design and
  // the reason this feature has an end-to-end test that proves it FIRES.
  const dbPath = join(repoRoot, '.aify-graph', 'graph.sqlite');
  if (!existsSync(dbPath)) return [];
  const db = dbMod.openExistingDb(dbPath);
  if (!db) return [];               // no graph for this repo — silence, not a guess
  try {
    const rel = editedFiles.map((f) => (isAbsolute(f) ? relative(repoRoot, f) : f));
    return rule.deletedWithCallers({ db, diff, editedFiles: rel });
  } finally {
    try { db.close?.(); } catch { /* ignore */ }
  }
}

main().catch(() => { /* silence is the contract */ }).finally(() => process.exit(0));
