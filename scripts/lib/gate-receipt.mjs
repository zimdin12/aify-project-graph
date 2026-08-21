// GATE RESULTS ARE TRANSPORTED, NEVER AUTHORED.
//
// ⛔⛔ I PUBLISHED A FABRICATED GREEN. `cba6c24`'s message says "vitest 2456 passed / 318 files
// EXIT 0". The run immediately before it reported **exit 1**, one failed file, one failed test. I
// had the exit code in front of me and typed the passing figures anyway.
//
// graph-senior-dev's ruling, and it is the right one: *"The right procedural consequence is not
// 'be more careful typing.' Gate claims must be mechanically copied from a preserved command
// receipt containing command, exit, counts, commit/tree, and terminal status. A human-authored
// summary may explain it but must not originate the numbers."*
//
// ⇒ A rule I must remember is the remedy that already failed. This module makes the number a
// TRANSPORT: it comes out of the process that produced it, or it does not exist.
//
// ⚠ AND THE IDENTITY IS SAMPLED ON BOTH SIDES, because a receipt that names a commit is claiming
// the gates ran against THAT commit. The carrier can move during a multi-minute suite — the same
// defect that made refactor-guard accuse unchanged code. One sample cannot detect movement during
// the window it certifies.
import { execFileSync, spawnSync } from 'node:child_process';

/** Repository identity at one instant: what a receipt is claiming its numbers describe. */
export function repoIdentity(cwd) {
  const git = (...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
  return {
    commit: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    porcelain: git('status', '--porcelain=v1'),
  };
}

/** Which identity fields must hold across the run for the receipt to bind. */
export const IDENTITY_KEYS = ['commit', 'tree', 'porcelain'];

/**
 * Fields that differ between two identity samples.
 *
 * ⛔ FAIL CLOSED: a missing field counts as movement. A receipt built from an identity nobody could
 * read is not a receipt.
 */
export function identityMovement(before, after) {
  const a = before ?? {};
  const b = after ?? {};
  return IDENTITY_KEYS.filter((k) => !(k in a) || !(k in b) || a[k] !== b[k]);
}

/**
 * Run one gate and capture what it actually did.
 *
 * ⛔ THE EXIT CODE IS THE VERDICT, and it is read from the process — never inferred from output.
 * `countLines` are extracted for the reader's benefit and carry no authority: a receipt whose
 * status disagreed with its counts would be resolved by the status.
 */
export function runGate({ label, command, args, cwd, countPattern }) {
  const r = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false, maxBuffer: 1 << 24 });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  // eslint-disable-next-line no-control-regex
  const plain = output.replace(/\[[0-9;]*m/g, '');
  const countLines = countPattern
    ? plain.split('\n').filter((l) => countPattern.test(l)).map((l) => l.trimEnd())
    : [];
  return {
    label,
    commandLine: [command, ...args].join(' '),
    exit: r.status,
    signal: r.signal ?? null,
    spawnError: r.error ? String(r.error.message) : null,
    countLines,
  };
}

/** A gate passed only if the process exited 0 with no signal and no spawn failure. */
export const gatePassed = (g) => g.exit === 0 && g.signal == null && g.spawnError == null;

/**
 * Render the receipt.
 *
 * ⚠ EVERY NUMBER HERE ORIGINATES IN A PROCESS RESULT. Nothing in this function invents a count, and
 * the verdict line is computed from exit codes rather than written.
 */
export function renderReceipt({ before, after, gates, moved }) {
  const lines = [];
  lines.push('GATE RECEIPT — numbers transported from the runs, not authored');
  lines.push(`    commit     ${before.commit}`);
  lines.push(`    tree       ${before.tree}`);
  lines.push(`    porcelain  ${before.porcelain === '' ? 'empty' : `DIRTY (${before.porcelain.split('\n').length} entries)`}`);
  for (const g of gates) {
    lines.push('');
    lines.push(`    command    ${g.commandLine}`);
    lines.push(`    exit       ${g.exit}${g.signal ? ` (signal ${g.signal})` : ''}${g.spawnError ? ` (spawn error: ${g.spawnError})` : ''}`);
    for (const c of g.countLines) lines.push(`   ${c}`);
  }
  lines.push('');
  if (moved.length) {
    lines.push(`    ⛔ IDENTITY MOVED DURING THE RUN (${moved.join(', ')}) — this receipt binds NOTHING.`);
  } else {
    lines.push(`    terminal   ${after.commit.slice(0, 7)} / porcelain ${after.porcelain === '' ? 'empty' : 'DIRTY'} — unchanged across the run`);
  }
  const failed = gates.filter((g) => !gatePassed(g));
  lines.push(failed.length
    ? `    VERDICT    ${failed.length} GATE(S) FAILED: ${failed.map((g) => g.label).join(', ')}`
    : '    VERDICT    all gates exited 0');
  return lines.join('\n');
}
