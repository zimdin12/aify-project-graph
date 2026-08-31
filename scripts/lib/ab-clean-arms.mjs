// CLEAN ARM BUILDS — mandatory for the native field tier.
//
// ⛔ WHY THIS EXISTS RATHER THAN A BLINDER. Mutating the working tree and reverting produced an arm
// whose every tool response announced buildId "<SHA>+1dirty", named the modified file in
// loadedDirtyFiles, and warned the agent not to diff its own behaviour. Normalising that away is
// permitted only in the separately-labelled mechanism tier, and reported as a different estimand.
// In the native tier the carriers must be absent NATURALLY, which means each arm is its own COMMIT
// in its own worktree and no process ever loads uncommitted code.
//
// ⛔ AND EACH ARM MUST BE ITS OWN PROCESS. Node loads a module once per process, so two arms sharing
// a process both execute whichever copy loaded first — the edit lands on disk, a probe finds it
// there, and the measurement is of nothing. This repository has already shipped that exact void
// experiment once; scripts/ab-graph-effect.mjs documents it.
//
// ⚠ THE MAIN CHECKOUT IS NEVER MUTATED. Arms are detached worktrees created from commits that
// already exist. A hard kill between mutate and restore cannot leave mutant bytes in main, because
// main is never written.
import { execFileSync } from 'node:child_process';
import { rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = 'C:/Docker/aify-project-graph';

// A unique path that does NOT yet exist — git creates it. See createMutantCommit for why.
const armPath = (kind) => join(tmpdir(), `apg-${kind}-${randomUUID().slice(0, 8)}`);

const git = (args, cwd = ROOT) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/**
 * Create the TREATMENT commit: the gate-disabled mutant, committed on its own branch so it can be
 * checked out clean.
 *
 * ⚠ Committed on a THROWAWAY branch off the control commit, never on main. The branch exists only
 * so a worktree can check it out without a dirty tree; it is deleted with the arms.
 */
export function createMutantCommit({ baseCommit, branch = `ab-mutant-${Date.now()}` }) {
  // ⛔ NOT mkdtempSync. It CREATES the directory, and git then registers a path form it cannot
  // delete later — observed as `failed to delete '<path>': Invalid argument`, which left a
  // throwaway branch behind. git must create the worktree directory itself.
  const wt = armPath('mkmutant');
  git(['worktree', 'add', '--detach', wt, baseCommit]);
  try {
    const target = join(wt, 'mcp', 'stdio', 'storage', 'publication-schema.js');
    const before = readFileSync(target, 'utf8');
    const needle = '  const generationState = classifyAttestation({ dbGeneration, manifestGeneration, manifestUsable });';
    if (!before.includes(needle)) {
      throw new Error('the mutation anchor is not present at ' + baseCommit
        + ' — refusing to create a mutant commit that may not disable anything');
    }
    const after = before.replace(needle,
      '  const generationState = ATTESTATION.ATTESTED; // GATE-DISABLED (A/B treatment arm)');
    if (after === before) throw new Error('mutation produced identical bytes — it did not apply');
    writeFileSync(target, after);
    git(['checkout', '-b', branch], wt);
    git(['add', 'mcp/stdio/storage/publication-schema.js'], wt);
    git(['-c', 'user.name=ab', '-c', 'user.email=ab@local', 'commit', '-q', '-m',
      'ab(treatment): gate-disabled arm — classifyPublication always ATTESTED'], wt);
    const sha = git(['rev-parse', 'HEAD'], wt);
    return { branch, commit: sha };
  } finally {
    disposeArm({ path: wt });
  }
}

/**
 * Check out one arm as a CLEAN detached worktree.
 *
 * @returns {{path, commit, dirty: boolean}} `dirty` MUST be false — a dirty arm is void, not
 *          normalisable, in the native tier.
 */
export function checkoutArm({ commit, label }) {
  const path = armPath(`arm-${label}`);
  git(['worktree', 'add', '--detach', path, commit]);
  const porcelain = git(['status', '--porcelain'], path);
  return { path, commit: git(['rev-parse', 'HEAD'], path), dirty: porcelain.length > 0, label };
}

/** Remove an arm worktree. Safe to call twice. */
export function disposeArm(arm) {
  if (!arm?.path) return;
  // ⚠ BELT AND BRACES, because `worktree remove` has failed here with Invalid argument on a
  // Windows temp path. Remove the directory ourselves if git will not, then PRUNE so git's registry
  // does not keep a stale entry pointing at a directory that no longer exists.
  try { git(['worktree', 'remove', '--force', arm.path]); }
  catch { /* fall through to manual removal */ }
  if (existsSync(arm.path)) { try { rmSync(arm.path, { recursive: true, force: true }); } catch { /* locked */ } }
  try { git(['worktree', 'prune']); } catch { /* nothing to prune */ }
}

/** Delete a throwaway mutant branch. */
export function disposeBranch(branch) {
  if (!branch) return;
  try { git(['branch', '-D', branch]); } catch { /* already gone */ }
}

/**
 * Build both arms clean, from two real commits.
 *
 * ⛔ REFUSES A DIRTY ARM. If either worktree reports uncommitted changes the pair is void: the
 * native tier's whole premise is that no `+dirty` cue can exist to leak, and a dirty arm means the
 * premise failed rather than that a blinder is needed.
 */
export function buildCleanArmPair({ baseCommit }) {
  const mutant = createMutantCommit({ baseCommit });
  const control = checkoutArm({ commit: baseCommit, label: 'control' });
  const treatment = checkoutArm({ commit: mutant.commit, label: 'treatment' });
  if (control.dirty || treatment.dirty) {
    disposeArm(control); disposeArm(treatment); disposeBranch(mutant.branch);
    throw new Error('an arm worktree is dirty — the native tier requires clean builds, and a dirty '
      + 'arm is VOID rather than something to normalise away');
  }
  return { control, treatment, branch: mutant.branch };
}
