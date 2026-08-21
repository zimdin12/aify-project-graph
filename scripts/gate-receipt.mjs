#!/usr/bin/env node
// EMIT A GATE RECEIPT. The numbers in a commit message must come from here, not from me.
//
//   node scripts/gate-receipt.mjs                       # PRECOMMIT_DIAGNOSTIC — never PASS
//   node scripts/gate-receipt.mjs --bind <commit>       # COMMIT_BOUND — clean detached worktree
//   node scripts/gate-receipt.mjs --finalize <tree>     # verify HEAD^{tree} === <tree> AFTER the
//                                                       # commit. Until this existed, that equality
//                                                       # was caller PROSE enforced by nothing.
//   node scripts/gate-receipt.mjs --candidate-tree      # CANDIDATE_TREE_BOUND — gates the STAGED
//                                                       # tree about to be committed. Put the
//                                                       # receipt in the COMMIT MESSAGE, not in the
//                                                       # tree, or it certifies itself.
//   ...--out FILE                                       # write it, for pasting verbatim
//
// ⛔ EXITS NON-ZERO UNLESS THE VERDICT IS PASS, so a green receipt cannot be obtained from a red
// run — nor from a dirty tree, nor from a diagnostic. `cba6c24` published "EXIT 0" over an observed
// exit 1 because the number and the run were connected only by my attention.
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  RECEIPT_CLASS, VERDICT, receiptVerdict, renderReceipt, capture,
} from './lib/gate-receipt.mjs';
// ⛔ The ambient population, ENUMERATED. A materialized tree fixes SOURCE attribution and nothing
// else -- node_modules is ignored, so it cannot come from T. This names what remains rather than
// implying a hermeticity the run does not have.
import { dependencyCarrier, unexpectedIgnored } from './lib/dependency-carrier.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b ?? '').digest('hex');

/** Repository identity at one instant: what a receipt is claiming its numbers describe. */
function repoIdentity(cwd, withCandidate = false) {
  const git = (...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
  const out = { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), porcelain: git('status', '--porcelain=v1') };
  if (withCandidate) {
    // ⛔ `write-tree` NAMES THE STAGED CONTENT, which is strictly stronger than porcelain: porcelain
    // says WHICH paths differ, T says exactly WHAT the bytes are. Unstaged edits and untracked files
    // are recorded separately because both mean the working bytes the gates read are NOT the bytes
    // T names -- and a receipt that gated different bytes than it certifies is the whole defect.
    let unstaged = false;
    try { execFileSync('git', ['diff', '--quiet'], { cwd, stdio: 'ignore' }); } catch { unstaged = true; }
    const untracked = git('ls-files', '--others', '--exclude-standard')
      .split(String.fromCharCode(10)).filter(Boolean).length;
    out.candidate = { tree: git('write-tree'), unstaged, untracked };
  }
  return out;
}

/**
 * Run one gate and capture what it actually did.
 *
 * ⛔ ARGV IS CARRIED AS AN ARRAY. A reconstructed shell string is a CLAIM about what ran; the array
 * is the thing that was passed. Raw output is hashed so a quoted count can be tied back to bytes.
 */
function runGate({ label, argv, cwd, countPattern, timeoutMs }) {
  const [command, ...args] = argv;
  const r = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false, maxBuffer: 1 << 24, timeout: timeoutMs });
  // ⚠ The ANSI escape is BUILT, never typed: a literal 0x1b in source is a raw control byte,
  // and `no-raw-nul-bytes` caught exactly that in this file's first version.
  // ESC and '[' are both BUILT from char codes: a literal 0x1b here is a raw control byte in
  // source (no-raw-nul-bytes caught exactly that in this file's first version), and writing
  // the bracket as an escape made the pattern a character class that matched only by accident.
  const ansi = new RegExp(String.fromCharCode(27, 91) + '[0-9;]*m', 'g');
  const plain = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(ansi, '');
  return {
    label,
    argv,
    exit: r.status,
    signal: r.signal ?? null,
    // ⚠ TYPED SEPARATELY from an exit failure: "the suite said no" and "the suite never finished"
    // are different facts, and a hang must not read as a verdict.
    timedOut: r.error?.code === 'ETIMEDOUT',
    spawnError: r.error && r.error.code !== 'ETIMEDOUT' ? String(r.error.message) : null,
    // FULL 64-hex hashes PLUS the bytes themselves. The first evidence commit carried 16-hex
    // PREFIXES inside prose and no raw output: a prefix in prose is not an immutable content
    // carrier, because nothing can be re-hashed against it. It names bytes nobody kept.
    stdout: capture(r.stdout),
    stderr: capture(r.stderr),
    countLines: countPattern ? plain.split('\n').filter((l) => countPattern.test(l)).map((l) => l.trimEnd()) : [],
  };
}

/** The gates every slice must satisfy. Declared here so a receipt cannot quietly omit one. */
function gatesFor(root) {
  // ⛔ THE RUNNER IS SPAWNED DIRECTLY, NOT THROUGH `npx`. The transport's first execution reported
  // `spawn-error=spawnSync npx.cmd EINVAL` and refused green for a gate that never ran — the exact
  // behaviour it exists for, demonstrated against its own author. Resolving the runner's own entry
  // removes the Windows shim from between a gate and its verdict.
  return [
    // ⚠ `producesIgnored` DECLARES a bounded output path. Measured: running the suite creates
    // `.aify-graph/` in the worktree -- it is not a checkout artifact and not ambient noise, it is
    // this gate's own product. A declared output may appear at EXIT; anything undeclared refuses.
    { label: 'vitest', argv: [process.execPath, join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run'],
      countPattern: /^\s*(Test Files|Tests)\s/, timeoutMs: 30 * 60_000,
      // ⚠ EXPLICIT ROOTS, not a bare name. `.aify-graph` at any depth would permit an unexpected
      // one under any subtree; these are the paths the suite is known to write.
      producesIgnored: ['.aify-graph', 'tests/fixtures/**/.aify-graph'] },
    { label: 'authority-ledger', argv: [process.execPath, join(root, 'scripts', 'authority-ledger.mjs'), '--check'],
      countPattern: /ALL FILES COMPLETE/, timeoutMs: 5 * 60_000 },
  ];
}

/** Ignored paths actually present in a materialized worktree. */
function ignoredIn(cwd) {
  return execFileSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'],
    { cwd, encoding: 'utf8' })
    .split(String.fromCharCode(10)).filter(Boolean);
}

/**
 * Materialize the staged tree T as a real filesystem, WITHOUT touching any ref.
 *
 * ⛔ `git commit-tree` creates an UNREFERENCED commit object naming T. No branch moves, no history
 * changes, and the object is unreachable once the worktree is gone. That is what lets a candidate
 * run observe a filesystem built FROM T rather than hoping the ambient checkout equals it --
 * measured: HEAD and branch are unchanged, and the temp commit's tree is exactly T.
 */
function materialize(T) {
  const tempCommit = execFileSync('git', ['commit-tree', T, '-p', 'HEAD', '-m', 'candidate materialization (unreferenced)'],
    { cwd: REPO, encoding: 'utf8' }).trim();
  // ⛔ RUN-UNIQUE, NOT TREE-DERIVED. The name used to be `apg-materialized-<T12>` — deterministic
  // from the tree — so two consecutive runs on an UNCHANGED tree resolved to the SAME directory.
  // Vitest workers from the previous run outlive its disposal by moments and recreate `.aify-graph`
  // at that path, which the next run then saw as pre-existing ambient state at entry.
  //
  // ⇒ That is the intermittency: PASS when the previous run's workers had finished, REFUSE when
  // they had not. The "unidentified ambient producer" was THIS TOOL'S OWN PREVIOUS RUN, reaching
  // forward into the next one through a shared path.
  //
  // ⚠ The pid keeps it unique per process while the tree prefix keeps it attributable.
  const worktree = join(REPO, '..', `apg-materialized-${T.slice(0, 12)}-${process.pid}`);
  if (existsSync(worktree)) {
    rmSync(worktree, { recursive: true, force: true });
    // ⛔ `rmSync(force:true)` SWALLOWS FAILURES. A previous run holding a sqlite handle leaves the
    // directory behind, and reusing it would inherit that run's generated state as though it were
    // a fresh materialization -- silently, and in the reassuring direction.
    if (existsSync(worktree)) {
      throw new Error(`refusing to reuse ${worktree}: it still exists after removal, so its `
        + 'generated state would be inherited as if fresh. Release the handle or remove it by hand.');
    }
  }
  execFileSync('git', ['worktree', 'add', '--detach', worktree, tempCommit], { cwd: REPO, stdio: 'ignore' });
  return { tempCommit, worktree };
}

/** Link the dependency carrier into a fresh worktree, and DISCLOSE how it got there. */
function linkDeps(worktree) {
  const target = join(worktree, 'node_modules');
  if (process.platform === 'win32') {
    spawnSync('cmd', ['/c', 'mklink', '/J', target, join(REPO, 'node_modules')], { encoding: 'utf8' });
  } else {
    spawnSync('ln', ['-s', join(REPO, 'node_modules'), target], { encoding: 'utf8' });
  }
  return `node_modules ${process.platform === 'win32' ? 'JUNCTION' : 'SYMLINK'} -> ${join(REPO, 'node_modules')} (shared, mutable)`;
}

function main() {
  const argv = process.argv;

  // ⛔ THE POSTCONDITION, MACHINE-ENFORCED. A candidate receipt binds tree T; only `HEAD^{tree} === T`
  // promotes that result to the commit. I had been asserting that equality in shell and reporting it
  // in prose -- which is precisely the "a human must remember to check" shape this whole transport
  // exists to remove. graph-senior-dev: "the gate tool itself neither commits nor enforces the
  // post-commit equality."
  // ⛔⛔ THE WRAPPER, because the human step is where I failed. I ran the candidate gate, it
  // returned REFUSE, and I committed anyway -- my shell block called `git commit` unconditionally
  // instead of gating on the exit code. The receipt in that message says REFUSE verbatim, so
  // nothing was falsified, but committing over an observed refusal is the same ACT as publishing a
  // fabricated green: proceeding past a measurement that said stop.
  //
  // ⇒ `--commit-with <msgfile>` makes the sequence atomic: run the candidate gate, commit ONLY on
  // PASS, then finalize against the exact T the run produced. No copied tree argument, no
  // remembered exit code.
  const cwIdx = argv.indexOf('--commit-with');
  if (cwIdx !== -1 && argv[cwIdx + 1]) {
    const msgFile = argv[cwIdx + 1];
    const receiptFile = `${msgFile}.receipt`;
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--candidate-tree', '--out', receiptFile],
      { cwd: REPO, encoding: 'utf8' });
    console.log(r.stdout ?? '');
    if (r.status !== 0) {
      console.error('REFUSED: the candidate gate did not PASS — nothing was committed.');
      process.exit(1);
    }
    const receipt = readFileSync(receiptFile, 'utf8');
    const T = /candidate  tree ([0-9a-f]{40})/.exec(receipt)?.[1];
    if (!T) { console.error('REFUSED: could not read the candidate tree from the receipt.'); process.exit(2); }
    writeFileSync(msgFile, `${readFileSync(msgFile, 'utf8')}
${receipt}`);
    execFileSync('git', ['commit', '-F', msgFile], { cwd: REPO, stdio: 'inherit' });
    const actual = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: REPO, encoding: 'utf8' }).trim();
    const ok = actual === T;
    console.log(`FINALIZE  expected ${T}
          actual   ${actual}
          ${ok ? 'BOUND' : 'REFUSED — committed tree is not the gated tree'}`);
    process.exit(ok ? 0 : 1);
  }

  const finIdx = argv.indexOf('--finalize');
  if (finIdx !== -1 && argv[finIdx + 1]) {
    const expected = argv[finIdx + 1];
    const actual = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: REPO, encoding: 'utf8' }).trim();
    const porcelain = execFileSync('git', ['status', '--porcelain=v1'], { cwd: REPO, encoding: 'utf8' }).trim();
    const ok = actual === expected && porcelain === '';
    console.log(`FINALIZE  expected ${expected}`);
    console.log(`          actual   ${actual}`);
    console.log(`          porcelain ${porcelain === '' ? 'empty' : 'DIRTY'}`);
    console.log(`          ${ok ? 'BOUND — the candidate receipt now certifies this commit'
      : 'REFUSED — the committed tree is not the gated tree; the receipt binds nothing'}`);
    process.exit(ok ? 0 : 1);
  }
  const bindIdx = argv.indexOf('--bind');
  const commitBound = bindIdx !== -1 && argv[bindIdx + 1];
  const candidateTree = argv.includes('--candidate-tree');

  let root = REPO;
  let worktree = null;
  let dependencyTransport = null;
  let cleanupNote = '';

  let candidateTreeHash = null;
  let materialization = null;

  if (commitBound) {
    worktree = join(REPO, '..', `apg-receipt-${argv[bindIdx + 1].slice(0, 7)}`);
    if (existsSync(worktree)) rmSync(worktree, { recursive: true, force: true });
    execFileSync('git', ['worktree', 'add', '--detach', worktree, argv[bindIdx + 1]], { cwd: REPO, stdio: 'ignore' });
    dependencyTransport = linkDeps(worktree);
    root = worktree;
  } else if (candidateTree) {
    // ⛔ THE CANDIDATE RUN NO LONGER OBSERVES THE AMBIENT CHECKOUT. It observes a filesystem
    // materialized FROM T. The old version computed T and then ran gates against whatever the
    // working directory happened to contain -- which is only the same thing if nothing ignored
    // influences the tests, and `.aify-graph`, caches and generated configs are all ignored.
    candidateTreeHash = execFileSync('git', ['write-tree'], { cwd: REPO, encoding: 'utf8' }).trim();
    materialization = materialize(candidateTreeHash);
    worktree = materialization.worktree;
    dependencyTransport = linkDeps(worktree);
    root = worktree;
  }

  try {
    const before = repoIdentity(root, candidateTree);
    // ⛔ IGNORED STATE IS CHECKED AT BOTH ENDS, and the ONLY permitted entry is the dependency link
    // we ourselves created. Ignored files are in neither T nor `ls-files --others`, yet gates read
    // them -- that is the unnamed population. Measured on a fresh materialization: ZERO ignored
    // entries, so anything present is either ours or something a gate produced.
    // ⛔ ENTRY IS STRICT: nothing ignored beyond the dependency link. This is what catches a STALE
    // materialization -- if a previous run's worktree could not be deleted (a held sqlite handle
    // does exactly that), reusing the directory would silently inherit its generated state.
    // ⛔⛔ NO AUTO-DELETION. My previous version REMOVED unexpected pre-entry state and could then
    // PASS -- converting an observed unknown producer into a clean-looking entry by deletion. That
    // is the orphan-sweep error again: disclosure does not make deletion a control, and if the
    // producer is live the removal can race it.
    //
    // ⇒ Unexpected pre-entry state now REFUSES, and an inventory is preserved for attribution.
    //
    // ★ AND THE PRODUCER IS IDENTIFIED, so this is defence rather than a workaround. It was THIS
    // TOOL'S OWN PREVIOUS RUN: the worktree name was derived from T, so consecutive runs on an
    // unchanged tree resolved to the SAME path; vitest workers outlive disposal by moments, hold
    // the sqlite handles, and recreate `.aify-graph` there. Measured: with a live child, disposal
    // leaves the directory present, containing ONLY `.aify-graph` with graph.sqlite/-shm/-wal, and
    // removal succeeds once the handles release. Run-unique paths remove the shared channel.
    const ignoredEntry = candidateTree ? unexpectedIgnored(ignoredIn(root)) : [];
    const declaredGates = gatesFor(root);
    const gates = declaredGates.map((g) => runGate({ ...g, cwd: root }));
    // ⚠ EXIT ALLOWS ONLY WHAT A GATE DECLARED IT WOULD PRODUCE, and the declaration is part of the
    // receipt rather than a silent exception.
    const declaredOutputs = declaredGates.flatMap((g) => g.producesIgnored ?? []);
    const ignoredExit = candidateTree
      ? unexpectedIgnored(ignoredIn(root), ['node_modules', ...declaredOutputs]) : [];
    const after = repoIdentity(root, candidateTree);
    if (candidateTree) {
      before.candidate = {
        ...before.candidate, tree: candidateTreeHash, unexpectedIgnored: ignoredEntry,
      };
      after.candidate = {
        ...after.candidate, tree: candidateTreeHash, unexpectedIgnored: ignoredExit,
        declaredOutputs, producedOutputs: ignoredIn(root).filter((x) => declaredOutputs.some((d) => x.split(/[\/]/).includes(d))),
      };
      before.dependencies = dependencyCarrier(root, join(root, 'node_modules'));
    }
    const receiptClass = commitBound ? RECEIPT_CLASS.COMMIT_BOUND
      : candidateTree ? RECEIPT_CLASS.CANDIDATE_TREE_BOUND
        : RECEIPT_CLASS.PRECOMMIT_DIAGNOSTIC;
    const receipt = renderReceipt({
      receiptClass, before, after, gates,
      boundTo: commitBound ? `${before.commit} / tree ${before.tree}`
        : candidateTree ? `CANDIDATE TREE ${candidateTreeHash} materialized at ${materialization.tempCommit.slice(0, 12)} (unreferenced)`
          : null,
      dependencyTransport,
    });
    const { verdict } = receiptVerdict({ receiptClass, before, after, gates });

    if (worktree) {
      // Recorded, not assumed: the disposable carrier and its dependency link are removed.
      spawnSync('cmd', ['/c', 'rmdir', join(worktree, 'node_modules')], { encoding: 'utf8' });
      execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: REPO, stdio: 'ignore' });
      rmSync(worktree, { recursive: true, force: true });
      execFileSync('git', ['worktree', 'prune'], { cwd: REPO, stdio: 'ignore' });
      cleanupNote = `\n    cleanup    worktree removed: ${!existsSync(worktree)} · junction removed · worktree pruned`;
    }

    const out = receipt + cleanupNote;
    console.log(out);
    const outIdx = argv.indexOf('--out');
    if (outIdx !== -1 && argv[outIdx + 1]) {
      // The MACHINE-READABLE receipt is the carrier; the prose above is RENDERED FROM IT, never
      // authored beside it. Raw output is written as its own artifact so every recorded hash has a
      // preimage a reader can re-hash -- the defect the first evidence commit shipped, which carried
      // 16-hex prefixes in prose and no bytes at all.
      const base = argv[outIdx + 1];
      const dir = dirname(base);
      const json = {
        receiptClass,
        verdict,
        boundTo: commitBound ? { commit: before.commit, tree: before.tree } : null,
        identity: { before, after },
        node: process.version,
        platform: process.platform,
        dependencyTransport,
        gates: gates.map((g) => ({
          label: g.label,
          argv: g.argv,
          exit: g.exit,
          signal: g.signal,
          timedOut: g.timedOut,
          spawnError: g.spawnError,
          countLines: g.countLines,
          stdout: { ...g.stdout, text: undefined, artifact: g.label + '.stdout.b64', encoding: 'base64' },
          stderr: { ...g.stderr, text: undefined, artifact: g.label + '.stderr.b64', encoding: 'base64' },
        })),
        cleanup: cleanupNote.trim() || null,
      };
      writeFileSync(base, out + String.fromCharCode(10));
      writeFileSync(base.replace(/[.]txt$/, '') + '.json', JSON.stringify(json, null, 2) + String.fromCharCode(10));
      // BASE64 ENCODED TRANSPORT, not the raw preimage on disk. Raw runner output contains ANSI
      // escapes (0x1b), and `no-raw-nul-bytes` forbids control bytes in tracked files -- my first
      // evidence commit shipped two such artifacts and turned the suite red. Encoding keeps the
      // EXACT bytes recoverable while the tracked file holds none of them: decode, then re-hash
      // against fullHash. Labelled encoded transport so nobody mistakes it for the raw file.
      for (const g of gates) {
        writeFileSync(join(dir, g.label + '.stdout.b64'), Buffer.from(g.stdout.text, 'utf8').toString('base64'));
        writeFileSync(join(dir, g.label + '.stderr.b64'), Buffer.from(g.stderr.text, 'utf8').toString('base64'));
      }
    }
    process.exit(verdict === VERDICT.PASS ? 0 : 1);
  } catch (err) {
    if (worktree && existsSync(worktree)) rmSync(worktree, { recursive: true, force: true });
    console.error(`gate-receipt failed: ${err.message}`);
    process.exit(2);
  }
}

if (process.argv[1]?.endsWith('gate-receipt.mjs')) main();
