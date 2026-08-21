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
import { writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  RECEIPT_CLASS, VERDICT, receiptVerdict, renderReceipt, capture,
} from './lib/gate-receipt.mjs';

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
    { label: 'vitest', argv: [process.execPath, join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run'],
      countPattern: /^\s*(Test Files|Tests)\s/, timeoutMs: 30 * 60_000 },
    { label: 'authority-ledger', argv: [process.execPath, join(root, 'scripts', 'authority-ledger.mjs'), '--check'],
      countPattern: /ALL FILES COMPLETE/, timeoutMs: 5 * 60_000 },
  ];
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

  if (commitBound) {
    worktree = join(REPO, '..', `apg-receipt-${argv[bindIdx + 1].slice(0, 7)}`);
    if (existsSync(worktree)) rmSync(worktree, { recursive: true, force: true });
    execFileSync('git', ['worktree', 'add', '--detach', worktree, argv[bindIdx + 1]], { cwd: REPO, stdio: 'ignore' });
    dependencyTransport = linkDeps(worktree);
    root = worktree;
  }

  try {
    const before = repoIdentity(root, candidateTree);
    const gates = gatesFor(root).map((g) => runGate({ ...g, cwd: root }));
    const after = repoIdentity(root, candidateTree);
    const receiptClass = commitBound ? RECEIPT_CLASS.COMMIT_BOUND
      : candidateTree ? RECEIPT_CLASS.CANDIDATE_TREE_BOUND
        : RECEIPT_CLASS.PRECOMMIT_DIAGNOSTIC;
    const receipt = renderReceipt({
      receiptClass, before, after, gates,
      boundTo: commitBound ? `${before.commit} / tree ${before.tree}`
        : candidateTree ? `CANDIDATE TREE ${before.candidate.tree} (not yet committed)`
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
