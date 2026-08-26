// scripts/install-agent-hook.mjs
//
// Wires the deletion-guard PostToolUse hook into an agent host's settings.json.
//
//   node scripts/install-agent-hook.mjs            # install (idempotent)
//   node scripts/install-agent-hook.mjs --check    # report only, exit 1 if absent
//   node scripts/install-agent-hook.mjs --settings <path>   # target a specific file
//
// ⛔ WHY THIS EXISTS. Every adoption measurement this project has taken says the same thing: entry
// point reach works and MID-TASK reach does not — 12 of 17 skills never invoked, 7 of 1,049 subagent
// transcripts calling a graph verb, three of five agents TOLD to use the tools calling none. A hook
// is the only mechanism that does not require the agent to reach for anything.
//
// The hook itself was built, tested as a real process, and then sat UNWIRED, because enabling it
// meant hand-editing settings.json. That is the same shape as this repo's other reach failures:
// `sync-skills.mjs` mirrors inside the repo and never installs; `graph_pull` had a docs layer
// reachable only by an argument nobody knew to pass. **A capability whose last step is a manual edit
// is a capability most people do not have.**
//
// ⚠ A CORRUPT settings.json BREAKS THE HOST ENTIRELY, so every write here is: parse -> back up ->
// write -> re-read and re-parse -> restore the backup if the re-read fails. The file is never left
// in a state this script has not successfully parsed.

import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HOOK_COMMAND = `node ${join(REPO_ROOT, 'scripts', 'hooks', 'post-edit-deletion-guard.mjs').replace(/\\/g, '/')}`;
export const MATCHER = 'Edit|Write|MultiEdit';
const EVENT = 'PostToolUse';

export function defaultSettingsPath() {
  return join(homedir(), '.claude', 'settings.json');
}

// The hook is identified by the SCRIPT it runs, not by the matcher or by position. A host may
// legitimately hold several PostToolUse entries; ours is the one naming this file.
const isOurs = (h) => typeof h?.command === 'string' && h.command.includes('post-edit-deletion-guard');

export function hasHook(settings) {
  const groups = settings?.hooks?.[EVENT];
  if (!Array.isArray(groups)) return false;
  return groups.some((g) => Array.isArray(g?.hooks) && g.hooks.some(isOurs));
}

/**
 * Add the hook to a settings OBJECT, returning a new object. Pure — no file access — so the merge
 * logic can be tested without a filesystem, and so a caller can diff before committing to a write.
 *
 * ⚠ IDEMPOTENT BY COMMAND, not by deep equality: re-running after the repo moves updates nothing and
 * duplicates nothing, and a second copy of the hook would double every message an agent sees.
 */
export function withHook(settings, command = HOOK_COMMAND) {
  if (hasHook(settings)) return settings;
  const next = { ...(settings ?? {}) };
  next.hooks = { ...(next.hooks ?? {}) };
  const groups = Array.isArray(next.hooks[EVENT]) ? [...next.hooks[EVENT]] : [];
  // Reuse an existing group with the same matcher rather than adding a competing one — hosts run
  // every matching group, and two groups for one matcher is a confusing thing to leave behind.
  const at = groups.findIndex((g) => g?.matcher === MATCHER && Array.isArray(g?.hooks));
  if (at >= 0) groups[at] = { ...groups[at], hooks: [...groups[at].hooks, { type: 'command', command }] };
  else groups.push({ matcher: MATCHER, hooks: [{ type: 'command', command }] });
  next.hooks[EVENT] = groups;
  return next;
}

function readSettings(path) {
  if (!existsSync(path)) return { settings: {}, existed: false };
  const raw = readFileSync(path, 'utf8');
  try {
    return { settings: JSON.parse(raw), existed: true };
  } catch (err) {
    // ⛔ REFUSE RATHER THAN REWRITE. A settings file we cannot parse is one we must not touch:
    // overwriting it would destroy configuration the user cannot get back.
    throw new Error(`refusing to modify ${path}: it is not valid JSON (${err.message})`);
  }
}

function main(argv) {
  const check = argv.includes('--check');
  const at = argv.indexOf('--settings');
  const path = at >= 0 && argv[at + 1] ? argv[at + 1] : defaultSettingsPath();

  const { settings, existed } = readSettings(path);
  if (hasHook(settings)) {
    console.log(`already installed: ${EVENT} -> post-edit-deletion-guard  (${path})`);
    return 0;
  }
  if (check) {
    console.log(`NOT installed: ${EVENT} -> post-edit-deletion-guard is absent from ${path}`);
    console.log('Run: node scripts/install-agent-hook.mjs');
    return 1;
  }

  const next = withHook(settings);
  if (existed) copyFileSync(path, `${path}.apg-bak`);
  else mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');

  // ⚠ READ BACK WHAT WAS WRITTEN, not the object we intended to write. The failure being guarded
  // against is a settings file the host can no longer parse, and only re-parsing the bytes on disk
  // can rule that out.
  try {
    const verify = JSON.parse(readFileSync(path, 'utf8'));
    if (!hasHook(verify)) throw new Error('hook absent after write');
  } catch (err) {
    if (existed) copyFileSync(`${path}.apg-bak`, path);
    throw new Error(`write verification failed, ${existed ? 'backup restored' : 'file left in place'}: ${err.message}`);
  }

  console.log(`installed: ${EVENT} ${MATCHER} -> post-edit-deletion-guard  (${path})`);
  if (existed) console.log(`backup: ${path}.apg-bak`);
  console.log('The hook fires only when an edit deletes an exported declaration that still has');
  console.log('compiler-verified callers. It never blocks and never throws.');
  return 0;
}

// ⛔ pathToFileURL, NOT STRING CONCATENATION. `file://${path}` yields two slashes where Node's
// `import.meta.url` has three on Windows (`file:///C:/...`), so the comparison silently failed,
// main() never ran, and the process exited 0 having done NOTHING. Every process-driven test failed
// on that — except the idempotence one, which PASSED because two runs that both do nothing leave
// the file identical.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
