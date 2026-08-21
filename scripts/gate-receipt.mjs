#!/usr/bin/env node
// EMIT A GATE RECEIPT. The numbers in a commit message must come from here, not from me.
//
//   node scripts/gate-receipt.mjs                       # PRECOMMIT_DIAGNOSTIC — never PASS
//   node scripts/gate-receipt.mjs --bind <commit>       # COMMIT_BOUND — clean detached worktree
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
function repoIdentity(cwd) {
  const git = (...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
  return { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), porcelain: git('status', '--porcelain=v1') };
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
  const bindIdx = argv.indexOf('--bind');
  const commitBound = bindIdx !== -1 && argv[bindIdx + 1];

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
    const before = repoIdentity(root);
    const gates = gatesFor(root).map((g) => runGate({ ...g, cwd: root }));
    const after = repoIdentity(root);
    const receiptClass = commitBound ? RECEIPT_CLASS.COMMIT_BOUND : RECEIPT_CLASS.PRECOMMIT_DIAGNOSTIC;
    const receipt = renderReceipt({
      receiptClass, before, after, gates,
      boundTo: commitBound ? `${before.commit} / tree ${before.tree}` : null,
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
          stdout: { ...g.stdout, text: undefined, artifact: g.label + '.stdout.txt' },
          stderr: { ...g.stderr, text: undefined, artifact: g.label + '.stderr.txt' },
        })),
        cleanup: cleanupNote.trim() || null,
      };
      writeFileSync(base, out + String.fromCharCode(10));
      writeFileSync(base.replace(/[.]txt$/, '') + '.json', JSON.stringify(json, null, 2) + String.fromCharCode(10));
      for (const g of gates) {
        writeFileSync(join(dir, g.label + '.stdout.txt'), g.stdout.text);
        writeFileSync(join(dir, g.label + '.stderr.txt'), g.stderr.text);
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
