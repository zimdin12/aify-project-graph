// A REAL arm, driven into REAL adversarial states. Not a simulation of them.
//
// ⛔ SIGKILL is precisely the thing that cannot be faked in-process: no `finally`, no exit hook, no
// `catch` runs. A test that mocks the kill tests the mock. So this is a separate process the parent
// actually kills.
//
// ⛔⛔ AND THE SECOND ADVERSARY IS A PROCESS THAT IS ALIVE AND SILENT. Windows has no SIGSTOP, so I
// cannot literally suspend it here — but I do not need to, and reaching for a Sysinternals tool
// would test the tool. The defect being probed is that THE FILESYSTEM CANNOT DISTINGUISH a
// suspended process from a dead one: both hold custody of a directory and both stop writing beats.
// A live process that stops beating IS that adversary, exactly, from the classifier's point of view.
// Modelling it any other way would only add a dependency without adding a distinction.
//
// modes:
//   kill    — beat forever; the parent kills it mid-window
//   silent  — beat once, then STAY ALIVE and stop beating; `RESUME` on stdin starts it beating again
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ISOLATION_ROOT, armManifest, writeManifest, manifestPathFor, heartbeatPathFor, writeBeat,
} from '../../scripts/lib/arm-isolation.mjs';

const [repo, runId, target, mutantText, mode = 'kill'] = process.argv.slice(2);
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

const commit = git('rev-parse', 'HEAD');
const tree = git('rev-parse', 'HEAD^{tree}');
const worktree = join(repo, ISOLATION_ROOT, `arm-${runId}`);
const runToken = randomUUID();

// ⛔ ORDER IS THE CONTROL: the OUTSIDE manifest is written BEFORE the worktree exists. A kill in the
// gap leaves a record naming a directory that was never created — recoverable, and typed
// NOT_MATERIALIZED. The reverse order would leave a directory nobody can attribute, which is the
// state this design exists to prevent. Cheap to get right here, impossible to reconstruct later.
mkdirSync(join(repo, ISOLATION_ROOT), { recursive: true });
writeManifest(manifestPathFor(repo, runId), armManifest({
  runId, runToken, specId: 'hostile', target, commit, tree, worktree, pid: process.pid,
}));

let seq = 0;
const beatPath = heartbeatPathFor(repo, runId);
const emit = () => writeBeat(beatPath, { runToken, seq: seq++ });
emit();

git('worktree', 'add', '--detach', worktree, commit);

// Mutate INSIDE the worktree. The main checkout is never opened for writing.
const inside = join(worktree, target);
writeFileSync(inside, `${readFileSync(inside, 'utf8')}\n${mutantText}\n`);

process.stdout.write(`READY ${worktree}\n`);

let timer = mode === 'kill' ? setInterval(emit, 1000) : null;
if (mode === 'silent') {
  // Alive, holding the directory, emitting nothing — indistinguishable from dead, by design.
  process.stdin.on('data', (d) => {
    if (String(d).includes('RESUME') && !timer) {
      emit();
      timer = setInterval(emit, 1000);
      process.stdout.write('RESUMED\n');
    }
  });
  setInterval(() => {}, 1 << 30);   // keep the loop alive without beating
}
