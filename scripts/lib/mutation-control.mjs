// A MUTATION CONTROL THAT CANNOT SILENTLY FAIL TO MUTATE.
//
// ⛔ THE HAZARD, MEASURED: on 2026-08-22 a mutation control failed to apply SIX TIMES in one day,
// and every single time the suite then reported a GREEN from an unmutated tree. An inert control
// and a survived mutation produce identical output — "5 passed, exit 0" — and the green is the
// reassuring direction, so nothing collides and nothing prompts a second look.
//
// Each of those six was caught by a hand-written site-count assertion. That is the problem. The
// guard against a silent no-op depended on remembering to write the guard, which is an ATTENTIONAL
// control standing in the one tool used to check everything else. the field test named it: six catches
// is not a run of bad luck, it is a standing hazard whose only defence is vigilance.
//
// ⇒ Here the count is not optional. `sites` is REQUIRED, the edit is refused unless the match count
// is exactly that number, and there is no path that applies without checking. A no-op is
// structurally impossible rather than caught by habit.
//
// ⚠ AND THE SPEC IS A FILE, NOT ARGV. Passing a multi-line JS fragment through a shell mangled
// backslashes, backticks and quotes repeatedly during that same session — the control was
// destroyed by its own delivery mechanism more than once. JSON in, no shell in the middle.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const sha = (b) => createHash('sha256').update(b).digest('hex');

export const OUTCOME = Object.freeze({
  /** The mutation applied and the command FAILED — the control discriminates. */
  CAUGHT: 'CAUGHT',
  /** The mutation applied and the command PASSED — nothing detects this change. */
  SURVIVED: 'SURVIVED',
  /** The edit was not applied. NOTHING was measured. */
  REFUSED: 'REFUSED',
  /** Applied and run, but the tree could not be restored — the checkout is dirty. */
  RESTORE_FAILED: 'RESTORE_FAILED',
});

/**
 * Validate a spec before touching anything.
 *
 * ⛔ `sites` HAS NO DEFAULT. A default would be the hazard reintroduced: the whole point is that
 * the author must state how many occurrences they expect, so a `from` that silently matches zero —
 * or three — is refused instead of quietly doing something else.
 *
 * ⛔⛔ AND THE TWIN HAZARD IS REAL, MEASURED THE SAME DAY. Reverting this repo's P0 fix meant
 * changing `return null;` in freshness/git.js — which occurs THREE TIMES in that file. Only one is
 * the target; the other two are in `parseStatusLine` and have nothing to do with it. A replace-all
 * would have mutated three sites and the experiment would have been watching a different thing
 * fail, while looking exactly like a success.
 *
 * ⇒ So the failure modes are TWO, not one: the edit that applies NOWHERE, and the edit that applies
 * in MORE PLACES THAN THE EXPERIMENT NAMES. Both produce a red or a green that means something
 * other than what the author thinks. An `equals` check catches both; a "did it apply?" check
 * catches only the first.
 */
export function specProblem(spec) {
  if (!spec || typeof spec !== 'object') return 'spec must be an object';
  for (const k of ['file', 'from', 'to', 'run']) {
    if (typeof spec[k] !== 'string' || !spec[k]) return `spec.${k} must be a non-empty string`;
  }
  if (!Number.isInteger(spec.sites) || spec.sites < 1) {
    return 'spec.sites must be a positive integer — it has no default, because an unstated '
      + 'expectation is how a mutation silently applies to nothing';
  }
  if (spec.from === spec.to) return 'spec.from and spec.to are identical — that edit is a no-op by construction';
  return null;
}

/**
 * Apply, run, restore, report.
 *
 * ⚠ RESTORATION IS VERIFIED BY HASH, not assumed from a successful write. A control that leaves a
 * mutant behind has converted a measurement into a defect, and the next run would measure the
 * residue rather than the code.
 */
export function runMutationControl(spec, { exec = spawnSync, read = readFileSync, write = writeFileSync } = {}) {
  const problem = specProblem(spec);
  if (problem) return { outcome: OUTCOME.REFUSED, reason: problem };

  let original;
  try { original = read(spec.file, 'utf8'); }
  catch (e) { return { outcome: OUTCOME.REFUSED, reason: `cannot read ${spec.file}: ${e.code ?? e.message}` }; }
  const originalSha = sha(original);

  // ⛔ THE GATE. Not a warning, not a log line — the function returns here.
  const found = original.split(spec.from).length - 1;
  if (found !== spec.sites) {
    return {
      outcome: OUTCOME.REFUSED,
      reason: `expected ${spec.sites} occurrence(s) of the anchor, found ${found}. NOTHING WAS `
        + 'MEASURED — a run after this refusal would report the UNMUTATED tree, and its green would '
        + 'mean nothing.',
      found,
    };
  }

  write(spec.file, original.split(spec.from).join(spec.to));

  const parts = spec.run.trim().split(/\s+/u);
  const r = exec(parts[0], parts.slice(1), { encoding: 'utf8', shell: true });
  const exit = r.status;
  const signal = r.signal ?? null;
  const stderr = String(r.stderr ?? '').slice(0, 4000);

  // Restore FIRST, before deciding anything, so a thrown verdict cannot strand a mutant.
  write(spec.file, original);
  const restoredSha = sha(read(spec.file, 'utf8'));
  if (restoredSha !== originalSha) {
    return {
      outcome: OUTCOME.RESTORE_FAILED,
      reason: `the file did not restore byte-identically (${originalSha.slice(0, 12)} -> ${restoredSha.slice(0, 12)}). `
        + 'The checkout now holds mutant bytes.',
      exit,
    };
  }

  // ⛔ THE VERDICT IS THE COMMAND'S OWN EXIT CODE. Not a grep of its output — a broken grep and a
  // passing suite look the same, and ANSI colouring has defeated that instrument here before.
  const passed = exit === 0 && signal === null;
  return {
    outcome: passed ? OUTCOME.SURVIVED : OUTCOME.CAUGHT,
    exit,
    signal,
    sites: found,
    reason: passed
      ? 'the mutation applied and the command still PASSED — nothing in the suite detects this change'
      : 'the mutation applied and the command FAILED — the control discriminates',
    stderr,
  };
}
