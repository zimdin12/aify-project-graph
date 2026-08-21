// GATE RESULTS ARE TRANSPORTED, NEVER AUTHORED — AND ONLY A CLEAN EXACT-COMMIT RUN MAY SAY PASS.
//
// ⛔⛔ I PUBLISHED A FABRICATED GREEN. `cba6c24`'s message says "vitest 2456 passed / 318 files
// EXIT 0". The run immediately before it reported **exit 1**. I had the exit code in front of me
// and typed the passing figures anyway. graph-senior-dev's ruling: the remedy is not care, it is
// mechanical transport — a human summary may explain the numbers but must never originate them.
//
// ⛔⛔ AND THEN THE FIRST TRANSPORT REPEATED THE SHAPE ONE LEVEL UP. It printed
// `porcelain DIRTY (3 entries)` and, on the next line, `VERDICT all gates exited 0`. The dirt was
// DISCLOSED beside the verdict instead of DEGRADING it.
//
// ⇒ *"Commit/tree identity does not bind uncommitted bytes. Stable dirt at both endpoints is still
// an unnamed alternate tree."* The processes ran and their exits are real — but they certify some
// tree nobody has named, not the commit the receipt prints at the top.
//
// ⇒ **A disclosure the reader must act on is not a control. The verdict has to move.**
//
// TWO CLASSES, deliberately not interchangeable:
//
//   PRECOMMIT_DIAGNOSTIC   may run dirty · reports raw outcomes · NEVER says PASS
//                          author feedback only; unquotable as proof about any commit
//   COMMIT_BOUND           clean detached worktree at an exact commit/tree · identity sampled
//                          before and after · any dirt or movement REFUSES · only this may PASS

/** What a receipt is allowed to conclude. */
export const RECEIPT_CLASS = {
  PRECOMMIT_DIAGNOSTIC: 'PRECOMMIT_DIAGNOSTIC',
  COMMIT_BOUND: 'COMMIT_BOUND',
};

export const VERDICT = {
  PASS: 'PASS',
  FAILED: 'FAILED',
  REFUSE: 'REFUSE',
  UNBOUND_DIRTY: 'UNBOUND_DIRTY',
};

/** Which identity fields must hold across the run for a receipt to bind. */
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
 * Did this gate's PROCESS succeed?
 *
 * ⛔ EXIT, SIGNAL AND SPAWN FAILURE ARE THE AUTHORITY. Parsed counts are display-only: a receipt
 * whose status disagreed with its counts is resolved by the status, always.
 *
 * ⚠ A TIMEOUT IS TYPED SEPARATELY from an exit failure. "The suite said no" and "the suite never
 * finished" are different facts, and collapsing them would let a hang read as a verdict.
 */
export const gatePassed = (g) => g.exit === 0 && g.signal == null && g.spawnError == null && !g.timedOut;

/**
 * The verdict, derived from class + identity + gate outcomes. Nothing here is written by hand.
 *
 * ORDER IS LOAD-BEARING. Identity is settled before outcomes are consulted, because a gate result
 * observed against an unnamed tree is not evidence about the commit named at the top.
 */
export function receiptVerdict({ receiptClass, before, after, gates }) {
  const moved = identityMovement(before, after);
  if (moved.length) {
    return { verdict: VERDICT.REFUSE, reason: `identity moved during the run: ${moved.join(', ')}`, moved };
  }
  const dirty = (before.porcelain ?? '') !== '';
  if (receiptClass === RECEIPT_CLASS.COMMIT_BOUND && dirty) {
    return { verdict: VERDICT.REFUSE, reason: 'a commit-bound receipt requires a clean tree', moved };
  }
  if (receiptClass === RECEIPT_CLASS.PRECOMMIT_DIAGNOSTIC) {
    // ⛔ NEVER PASS, clean or not. This class does not run on an exact-commit detached carrier, so
    // it cannot certify a commit even when the working tree happens to be tidy.
    const failed = gates.filter((g) => !gatePassed(g));
    return {
      verdict: VERDICT.UNBOUND_DIRTY,
      reason: failed.length
        ? `${failed.length} gate(s) failed; and a diagnostic binds no commit either way`
        : 'gates exited 0, but a diagnostic run binds no commit',
      moved,
    };
  }
  const failed = gates.filter((g) => !gatePassed(g));
  if (failed.length) {
    return { verdict: VERDICT.FAILED, reason: `${failed.length} gate(s) failed: ${failed.map((g) => g.label).join(', ')}`, moved };
  }
  return { verdict: VERDICT.PASS, reason: 'every gate process exited 0 on a clean exact-commit carrier', moved };
}

/**
 * Render the receipt.
 *
 * ⚠ EVERY NUMBER ORIGINATES IN A PROCESS RESULT, and the verdict is computed rather than written.
 * The command is printed as its argv ARRAY, not reassembled into shell prose — a reconstructed
 * command line is a claim about what ran, and this repo has already paid for those.
 */
export function renderReceipt({ receiptClass, before, after, gates, boundTo, dependencyTransport }) {
  const { verdict, reason } = receiptVerdict({ receiptClass, before, after, gates });
  const lines = [];
  lines.push(`GATE RECEIPT [${receiptClass}] — numbers transported from the runs, not authored`);
  lines.push(`    binds      ${boundTo ?? '(nothing — diagnostic)'}`);
  lines.push(`    commit     ${before.commit}`);
  lines.push(`    tree       ${before.tree}`);
  lines.push(`    porcelain  ${(before.porcelain ?? '') === '' ? 'empty' : `DIRTY (${before.porcelain.split('\n').length} entries)`}`);
  if (dependencyTransport) lines.push(`    deps       ${dependencyTransport}`);
  for (const g of gates) {
    lines.push('');
    lines.push(`    gate       ${g.label}`);
    lines.push(`    argv       ${JSON.stringify(g.argv)}`);
    lines.push(`    exit       ${g.exit}${g.signal ? ` signal=${g.signal}` : ''}${g.timedOut ? ' TIMED OUT' : ''}${g.spawnError ? ` spawn-error=${g.spawnError}` : ''}`);
    lines.push(`    outHash    ${g.stdoutSha256?.slice(0, 16) ?? '(none)'} / ${g.stderrSha256?.slice(0, 16) ?? '(none)'}`);
    for (const c of g.countLines) lines.push(`   ${c}`);
  }
  lines.push('');
  lines.push(`    terminal   ${after.commit?.slice(0, 7)} / porcelain ${(after.porcelain ?? '') === '' ? 'empty' : 'DIRTY'}`);
  if (dependencyTransport) lines.push(`    cleanup    recorded below by the caller`);
  lines.push(`    VERDICT    ${verdict} — ${reason}`);
  return lines.join('\n');
}
