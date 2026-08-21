// A REAL arm that gets REAL-killed. Not a simulation of one.
//
// ⛔ The whole point of the isolation slice is what survives a SIGKILL, and SIGKILL is precisely the
// thing you cannot fake in-process: no `finally`, no exit hook, no `catch` runs. A test that mocks
// the kill tests the mock. So this is a separate process the parent actually kills.
//
// It opens an arm exactly as self-review will, mutates INSIDE the worktree, announces readiness on
// stdout, and then blocks forever waiting to die.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ISOLATION_ROOT, armManifest, writeManifest, manifestPathFor, heartbeatPathFor, beat,
} from '../../scripts/lib/arm-isolation.mjs';

const [repo, runId, target, mutantText] = process.argv.slice(2);
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

const commit = git('rev-parse', 'HEAD');
const tree = git('rev-parse', 'HEAD^{tree}');
const worktree = join(repo, ISOLATION_ROOT, `arm-${runId}`);

// ⛔ ORDER IS THE CONTROL: the OUTSIDE manifest is written BEFORE the worktree exists. A kill in the
// gap therefore leaves a record naming a directory that was never created — recoverable. The reverse
// order would leave a directory nobody can attribute, which is the state this design exists to
// prevent. Cheap to get right here, impossible to reconstruct later.
mkdirSync(join(repo, ISOLATION_ROOT), { recursive: true });
writeManifest(manifestPathFor(repo, runId), armManifest({
  runId, specId: 'hostile-kill', target, commit, tree, worktree, pid: process.pid,
}));
beat(heartbeatPathFor(repo, runId));

git('worktree', 'add', '--detach', worktree, commit);

// Mutate INSIDE the worktree. The main checkout is never opened for writing.
const inside = join(worktree, target);
writeFileSync(inside, `${readFileSync(inside, 'utf8')}\n${mutantText}\n`);

process.stdout.write(`READY ${worktree}\n`);
// Block forever. The parent kills us here, between mutate and restore — the exact window.
setInterval(() => beat(heartbeatPathFor(repo, runId)), 1000);
