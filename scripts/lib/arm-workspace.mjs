// WHERE AN ARM IS ALLOWED TO WRITE — and, more to the point, where it structurally cannot.
//
// ⛔ THE OPEN ITEM: self-review mutated files in THE CHECKOUT THE TEAM IS WORKING IN. The `finally`
// restore covers a thrown error; it does not cover SIGKILL, a power loss, or a closed terminal, and
// the residue is quiet because a mutant is a plausible edit to a real file, not a syntax error.
//
// ⇒ The weak fix is to audit every call site and be careful. That fails the moment someone adds a
// thirty-first arm and copies the wrong line. The strong fix is that THE MAIN REPO WORKSPACE HAS NO
// WORKING `write`. A mutation aimed at it throws, loudly, naming the rule — so the dangerous state
// is not merely unwritten, it is unconstructible.
//
// ⚠ The read side stays open on main, because reading the pristine source is exactly what an arm
// must do to compute its mutant. Read and write are separated for that reason rather than the
// whole object being sealed.
import { readFileSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, relative, isAbsolute, dirname, basename } from 'node:path';

/** Thrown when something tries to mutate the checkout the team is working in. */
export class ReadOnlyWorkspaceError extends Error {
  constructor(rel, root) {
    super(`REFUSED: attempted to write ${rel} into the READ-ONLY workspace at ${root}. `
      + 'Mutations run in a disposable per-arm worktree; a hard kill between mutate and restore '
      + 'must never be able to leave mutant bytes in the working checkout.');
    this.name = 'ReadOnlyWorkspaceError';
    this.rel = rel;
  }
}

export class Workspace {
  /**
   * @param {string} root      absolute path this workspace owns
   * @param {boolean} writable false for the main checkout, true for a disposable arm worktree
   * @param {string} kind      for receipts and error messages
   */
  constructor(root, { writable, kind }) {
    this.root = resolve(root);
    this.writable = writable === true;   // ⛔ fail closed: anything but an explicit true is read-only
    this.kind = kind;
  }

  /**
   * ⛔ CONTAINMENT, because a relative path is not automatically inside the root. `../../x` resolves
   * out of the workspace, and this object is the thing standing between a mutation and the rest of
   * the disk.
   */
  path(rel) {
    if (isAbsolute(rel)) throw new Error(`REFUSED: ${rel} is absolute; a workspace path must be repo-relative`);
    const abs = resolve(this.root, rel);

    // ⛔ THE LEXICAL CHECK IS NOT ENOUGH, AND I HAD ALREADY WRITTEN THE PHYSICAL ONE ELSEWHERE.
    //
    // resolve()+relative() is STRING arithmetic. It catches `..`, and it cannot see a junction: a
    // junction is lexically inside the root and physically anywhere. Demonstrated against this very
    // class, with both controls in one run:
    //
    //     ../escaped.txt   -> REFUSED    the lexical check does work
    //     ok.txt           -> wrote      the instrument can write
    //     deps/pwned.txt   -> ACCEPTED   and the bytes landed OUTSIDE the root
    //
    // ⛔⛔ AND THIS CLASS CREATES EXACTLY SUCH A JUNCTION, IN EVERY ARM: openArmWorkspace links
    // <arm>/node_modules to the MAIN CHECKOUT'S node_modules. So one path per arm was lexically
    // contained and physically in the tree this whole module exists to protect.
    //
    // ⇒ The same junction was ALREADY guarded for the other operation. disposeArmWorkspace removes
    // it FIRST, saying why: "removing the directory tree while a junction into the real node_modules
    // is still present is how a cleanup deletes the thing it was linking to." Same junction, two
    // operations, reasoned through for DELETE and never taught to WRITE.
    //
    // ⚠ REALPATH THE PARENT, not the target: realpathSync throws on a path that does not exist yet,
    // which is every write target. The parent is what a junction would redirect.
    // Found in field testing reviewing 1c05bde.
    const physicalParent = (() => {
      try { return realpathSync(dirname(abs)); } catch { return null; }
    })();
    const root = (() => { try { return realpathSync(this.root); } catch { return this.root; } })();
    const inside = physicalParent === null
      ? relative(this.root, abs)                    // parent absent: fall back to lexical, fail closed below
      : relative(root, join(physicalParent, basename(abs)));

    if (inside.startsWith('..') || isAbsolute(inside)) {
      throw new Error(`REFUSED: ${rel} resolves outside the workspace root ${this.root}`
        + (physicalParent !== null ? ' (checked on the REAL path — a junction or symlink cannot walk through)' : ''));
    }
    return abs;
  }

  exists(rel) { return existsSync(this.path(rel)); }

  read(rel) { return readFileSync(this.path(rel), 'utf8'); }

  write(rel, bytes) {
    // The one gate. Not a lint rule, not a convention, not a comment: the method itself.
    if (!this.writable) throw new ReadOnlyWorkspaceError(rel, this.root);
    writeFileSync(this.path(rel), bytes);
  }
}

/**
 * The team's checkout. Readable, and structurally incapable of being mutated.
 *
 * ⚠ Deliberately NOT parameterised by a `writable` flag a caller could pass. Offering the option is
 * offering the defect: the whole value here is that no call site can opt back in.
 */
export const mainRepoWorkspace = (repo) => new Workspace(repo, { writable: false, kind: 'MAIN_CHECKOUT (read-only)' });

/** Where a disposable arm worktree is built. */
export const ARM_WORKTREE_ROOT = '.self-review-worktrees';

/**
 * ⛔ HOOKS OFF, and this is a lesson already paid for. `git worktree add` fires post-checkout, and
 * this repo's post-checkout backgrounds a reindex against `git rev-parse --show-toplevel` — which
 * inside a new worktree resolves to that worktree. It created `.aify-graph/` there and raced
 * everything that sampled the directory, which is what refused three commits before it was found.
 *
 * An arm worktree is an evidence carrier, not a working checkout. Reindexing it is interference.
 */
const noHooks = (repo) => ['-c', `core.hooksPath=${join(repo, '.git', 'no-hooks-for-evidence-carriers')}`];

/**
 * Create a disposable worktree at an exact commit, with dependencies linked so tests can run.
 *
 * ⚠ THE DEPENDENCY LINK IS SHARED AND MUTABLE, and that is disclosed rather than implied. A junction
 * to the main tree's node_modules is not immutability; a mutation cannot reach it, but this does not
 * make the arm hermetic and must not be described as if it did.
 */
export function openArmWorkspace(repo, commit, absPath) {
  execFileSync('git', [...noHooks(repo), 'worktree', 'add', '--detach', absPath, commit],
    { cwd: repo, stdio: 'ignore' });

  const deps = join(absPath, 'node_modules');
  let transport = 'ABSENT — tests requiring dependencies will fail';
  if (!existsSync(deps) && existsSync(join(repo, 'node_modules'))) {
    try {
      execFileSync('cmd', ['/c', 'mklink', '/J', deps, join(repo, 'node_modules')], { stdio: 'ignore' });
      transport = `JUNCTION -> ${join(repo, 'node_modules')} (shared, mutable)`;
    } catch (e) { transport = `LINK FAILED: ${e.message}`; }
  }
  return { workspace: new Workspace(absPath, { writable: true, kind: 'ARM_WORKTREE (disposable)' }), transport };
}

/**
 * Dispose a workspace, reporting each step rather than returning one boolean.
 *
 * ⚠ A partial failure is not a success, and it is not a silent one either: the caller needs to know
 * that a registration survived, because that is exactly the state that blocks the next run.
 */
export function disposeArmWorkspace(repo, absPath) {
  const results = [];
  const step = (name, fn) => {
    try { fn(); results.push({ step: name, ok: true }); }
    catch (e) { results.push({ step: name, ok: false, reason: String(e.message || e).slice(0, 200) }); }
  };
  // The junction goes first: removing the directory tree while a junction into the real
  // node_modules is still present is how a cleanup deletes the thing it was linking to.
  step('remove-deps-junction', () => {
    const deps = join(absPath, 'node_modules');
    if (existsSync(deps)) execFileSync('cmd', ['/c', 'rmdir', deps], { stdio: 'ignore' });
  });
  step('remove-registration', () => execFileSync('git', ['worktree', 'remove', '--force', absPath], { cwd: repo, stdio: 'ignore' }));
  step('remove-directory', () => { if (existsSync(absPath)) rmSync(absPath, { recursive: true, force: true, maxRetries: 3 }); });
  step('prune', () => execFileSync('git', ['worktree', 'prune'], { cwd: repo, stdio: 'ignore' }));
  return results;
}
