// MUTATION TESTING THAT CANNOT EAT UNCOMMITTED WORK.
//
// ⛔ THE FAILURE THIS EXISTS FOR, 2026-09-05. The workflow was: edit a file, apply a mutant with a
// script, run the test, then `git checkout -- <file>` to undo the mutant. That checkout restores from
// the INDEX, so it reverted the mutant AND an extraction I had not committed yet. The next commit
// captured the tests without the function they imported, and the suite went red one commit later.
//
// "COMMIT BEFORE MUTATING" is the rule that prevents it, it is written in my own memory under its own
// name, and I walked into it anyway — because nothing enforced it. Every rule kept this session had a
// door behind it (the negative-assertion ratchet, the instruction line budget, the push gate). Every
// rule broken was one I was trusting myself to remember.
//
// ⭐ SO THIS DOES NOT GATE ON A CLEAN TREE — it removes git from the restore path entirely. The
// original bytes are held in memory and written back verbatim, so an uncommitted edit in the same
// file survives a mutation cycle. The bad state is unconstructible rather than guarded, which is
// strictly stronger than a check I could forget to run.
//
// ⚠ IT IS STILL NOT A SUBSTITUTE FOR COMMITTING FIRST. A crash between apply and restore leaves the
// mutant on disk; `restoreAll()` runs from a finally block and on SIGINT, but nothing survives a kill
// -9. Committing first remains the belt; this is the braces.
//
// ⚠ AND REMEMBER WHAT A MUTANT PROVES. A KILLED mutant licenses "this test is sensitive", never "this
// expectation is correct" — mutation is blind to a wrong baseline. A SURVIVING mutant is the one that
// carries information: it says the behaviour is unguarded, and tonight that is what exposed a clause
// I had justified with a false story.
import { readFileSync, writeFileSync } from 'node:fs';

/** Files whose original bytes we are holding, so a crash path can put them all back. */
const held = new Map();

let handlersInstalled = false;
function installHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { restoreAll(); process.exit(130); });
  }
  process.on('exit', () => restoreAll());
}

/**
 * Apply a mutation, holding the file's ORIGINAL BYTES in memory for restore.
 *
 * ⛔ `find` must occur EXACTLY ONCE. A mutation that lands in an unknown number of places is not the
 * inverse of a fix, it is a perturbation — and this repo has already recorded a mutant that changed
 * semantics rather than removing a fix, survived, and nearly made me doubt correct code.
 *
 * @param {string} file
 * @param {string} find exact text to replace
 * @param {string} replace
 * @returns {string} the original contents, also retained internally
 */
export function applyMutation(file, find, replace) {
  installHandlers();
  const original = readFileSync(file, 'utf8');
  const n = original.split(find).length - 1;
  if (n !== 1) {
    throw new Error(`mutate: anchor occurs ${n} times in ${file}, expected exactly 1 — `
      + 'a mutation with an unknown blast radius is a perturbation, not the inverse of a fix');
  }
  if (!held.has(file)) held.set(file, original);
  writeFileSync(file, original.replace(find, replace), 'utf8');
  return original;
}

/** Put one file back from the bytes we hold. Never consults git. */
export function restore(file) {
  const original = held.get(file);
  if (original === undefined) return false;
  writeFileSync(file, original, 'utf8');
  held.delete(file);
  return true;
}

/** Put every held file back. Safe to call twice; runs from `exit` and the signal handlers. */
export function restoreAll() {
  let n = 0;
  for (const file of [...held.keys()]) if (restore(file)) n += 1;
  return n;
}

/** Which files are currently mutated. Empty means nothing is outstanding. */
export function outstanding() {
  return [...held.keys()];
}

/**
 * Apply a mutation, run `body()`, and restore the original bytes whatever happens.
 *
 * @template T
 * @param {{file: string, find: string, replace: string}} spec
 * @param {() => T | Promise<T>} body
 * @returns {Promise<T>}
 */
export async function withMutation({ file, find, replace }, body) {
  applyMutation(file, find, replace);
  try {
    return await body();
  } finally {
    restore(file);
  }
}
