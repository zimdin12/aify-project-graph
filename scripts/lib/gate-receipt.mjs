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

import { createHash } from 'node:crypto';

const sha = (b) => createHash('sha256').update(b ?? '').digest('hex');

/**
 * Bound the raw output, and make the bound EXPLICIT rather than silent.
 *
 * A truncated artifact that does not say so is a lie by omission: a reader re-hashes it, gets a
 * different value, and cannot tell whether the evidence was clipped or tampered with. Both hashes
 * travel -- of the whole output, and of what was actually kept.
 */
export const MAX_CAPTURE = 256 * 1024;
export function capture(raw) {
  const full = raw ?? '';
  const kept = full.length > MAX_CAPTURE ? full.slice(0, MAX_CAPTURE) : full;
  return {
    originalBytes: Buffer.byteLength(full),
    capturedBytes: Buffer.byteLength(kept),
    truncated: kept.length !== full.length,
    fullHash: sha(full),
    capturedHash: sha(kept),
    text: kept,
  };
}

/** What a receipt is allowed to conclude. */
export const RECEIPT_CLASS = {
  PRECOMMIT_DIAGNOSTIC: 'PRECOMMIT_DIAGNOSTIC',
  COMMIT_BOUND: 'COMMIT_BOUND',
  // ⛔ THE CLASS THAT ENDS THE CHAIN. A COMMIT_BOUND receipt certifies its PARENT, so the commit
  // carrying it is never itself gated -- which is how an evidence child shipped raw ANSI and
  // reddened the suite while its own receipt was valid. The naive fix is another evidence child
  // certifying that one, and another, forever.
  //
  // ⇒ CANDIDATE_TREE_BOUND binds the exact TREE OBJECT `T` that is about to be committed, measured
  // BEFORE the commit exists. The receipt then travels in the COMMIT MESSAGE rather than inside T,
  // so it cannot be part of what it certifies. After the commit, `HEAD^{tree} === T` promotes the
  // result to the commit. Finite by construction.
  CANDIDATE_TREE_BOUND: 'CANDIDATE_TREE_BOUND',
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
 * ⚠ A CANDIDATE-TREE RUN IS EXPECTED TO HAVE A NON-EMPTY PORCELAIN — the staged evidence IS the
 * thing being gated. Its stability is enforced by the candidate tree hash instead, which is
 * strictly stronger: `porcelain` describes which paths changed, `T` names the exact content.
 */
export const CANDIDATE_IDENTITY_KEYS = ['commit'];

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
  const keys = receiptClass === RECEIPT_CLASS.CANDIDATE_TREE_BOUND ? CANDIDATE_IDENTITY_KEYS : IDENTITY_KEYS;
  const moved = keys.filter((k) => !(k in (before ?? {})) || !(k in (after ?? {})) || before[k] !== after[k]);
  if (moved.length) {
    return { verdict: VERDICT.REFUSE, reason: `identity moved during the run: ${moved.join(', ')}`, moved };
  }
  const dirty = (before.porcelain ?? '') !== '';
  if (receiptClass === RECEIPT_CLASS.COMMIT_BOUND && dirty) {
    return { verdict: VERDICT.REFUSE, reason: 'a commit-bound receipt requires a clean tree', moved };
  }
  if (receiptClass === RECEIPT_CLASS.CANDIDATE_TREE_BOUND) {
    // The candidate tree must be FULLY STAGED and stable across the run. Unstaged edits or
    // untracked files mean the bytes the gates read are not the bytes `T` names.
    // ⛔⛔ BOTH ENDS, FOR ALL THREE FIELDS. My first version checked `unstaged`/`untracked` only on
    // the ENTRY sample and compared only the tree hash afterwards. graph-senior-dev executed the
    // hole: `git write-tree` names the INDEX, so a gate that creates an unstaged edit or an
    // untracked file during the run does NOT move T — and the class returned PASS while the gates
    // had read or produced bytes T does not name. That is the exact defect this class exists to
    // close, committed inside the class that closes it.
    //
    // ⇒ I built this class around "sample both ends", applied it to the tree hash, and then checked
    // the working state at entry only. An entry condition is not an exit condition.
    const c = before.candidate ?? {};
    const a = after.candidate ?? {};
    if (!c.tree) return { verdict: VERDICT.REFUSE, reason: 'no candidate tree was recorded', moved };
    if (!a.tree) return { verdict: VERDICT.REFUSE, reason: 'no terminal candidate tree was recorded', moved };
    for (const [when, sample] of [['at entry', c], ['at exit', a]]) {
      // ⛔ IGNORED STATE IS THE UNNAMED POPULATION. Ignored files are in neither T nor
      // `ls-files --others`, yet gates can read them: `.aify-graph`, caches, generated configs.
      // The ONLY permitted entry is the dependency link the tool itself created, and even that is
      // disclosed rather than trusted. Anything else means the run read or produced bytes T does
      // not name -- which is the same defect as an unstaged edit, one layer further out.
      if ((sample.unexpectedIgnored?.length ?? 0) > 0) {
        return {
          verdict: VERDICT.REFUSE,
          reason: `unexpected ignored state ${when}: ${sample.unexpectedIgnored.slice(0, 4).join(', ')}`
            + `${sample.unexpectedIgnored.length > 4 ? ` (+${sample.unexpectedIgnored.length - 4} more)` : ''}`,
          moved,
        };
      }
      if (sample.unstaged) {
        return { verdict: VERDICT.REFUSE, reason: `unstaged changes ${when}: the working bytes are not the ones T names`, moved };
      }
      if (sample.untracked > 0) {
        return { verdict: VERDICT.REFUSE, reason: `${sample.untracked} untracked file(s) ${when}: the candidate tree is not the whole working state`, moved };
      }
    }
    if (c.tree !== a.tree) {
      return { verdict: VERDICT.REFUSE, reason: `the candidate tree moved during the run: ${c.tree} -> ${a.tree}`, moved };
    }
    const failedGates = gates.filter((g) => !gatePassed(g));
    if (failedGates.length) {
      return { verdict: VERDICT.FAILED, reason: `${failedGates.length} gate(s) failed: ${failedGates.map((g) => g.label).join(', ')}`, moved };
    }
    return { verdict: VERDICT.PASS, reason: `every gate process exited 0 against candidate tree ${c.tree}`, moved };
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
  if (before.candidate) {
    // The staged content this run gated, named exactly. Stronger than porcelain: porcelain says
    // WHICH paths differ, T says WHAT the bytes are.
    lines.push(`    candidate  tree ${before.candidate.tree}`);
    lines.push(`      at entry unstaged=${before.candidate.unstaged} untracked=${before.candidate.untracked}`);
    lines.push(`      at exit  unstaged=${after?.candidate?.unstaged} untracked=${after?.candidate?.untracked} tree=${after?.candidate?.tree}`);
    lines.push(`      ignored  UNEXPECTED entry=${before.candidate.unexpectedIgnored?.length ?? 'n/a'} exit=${after?.candidate?.unexpectedIgnored?.length ?? 'n/a'}`);
    if (before.candidate.preExistingRemoved?.length) {
      // ⚠ AMBIENT STATE THAT WAS ALREADY THERE. Disclosed every run so its producer stays visible.
      lines.push(`      ⚠ pre-existing generated state removed before the entry sample: ${before.candidate.preExistingRemoved.join(', ')}`);
    }
    if (after?.candidate?.declaredOutputs?.length) {
      lines.push(`      declared gate outputs: ${after.candidate.declaredOutputs.join(', ')}`);
      lines.push(`      produced             : ${(after.candidate.producedOutputs ?? []).join(', ') || '(none)'}`);
    }
  }
  if (dependencyTransport) lines.push(`    deps       ${dependencyTransport}`);
  if (before.dependencies) {
    // ⚠ NAMED, NOT IMMUTABLE. `closureInventoried:false` travels so nobody reads two lockfile
    // hashes as an inventory of the whole node_modules closure.
    const d = before.dependencies;
    lines.push(`    depsRoot   ${d.linkTargetRealpath}`);
    lines.push(`    node       ${d.node.version} ${d.node.sha256?.slice(0, 16) ?? '(unhashed)'}`);
    for (const l of d.lockfiles) lines.push(`    lock       ${l.present ? `${l.sha256?.slice(0, 16)} ${l.path}` : `ABSENT ${l.path}`}`);
    lines.push(`    runner     ${d.runner.present ? d.runner.sha256?.slice(0, 16) : 'ABSENT'}`);
    for (const n of d.native) lines.push(`    native     ${n.present ? (n.directory ? 'dir ' : `${n.sha256?.slice(0, 16)} `) : 'ABSENT '}${n.path.split(/[\/]/).slice(-3).join('/')}`);
    lines.push(`    env        ${JSON.stringify(d.env)}`);
    lines.push(`    ⚠ closureInventoried=${d.closureInventoried} — ${d.transport}`);
  }
  for (const g of gates) {
    lines.push('');
    lines.push(`    gate       ${g.label}`);
    lines.push(`    argv       ${JSON.stringify(g.argv)}`);
    lines.push(`    exit       ${g.exit}${g.signal ? ` signal=${g.signal}` : ''}${g.timedOut ? ' TIMED OUT' : ''}${g.spawnError ? ` spawn-error=${g.spawnError}` : ''}`);
    // FULL hashes, and the truncation state, because a prefix names bytes nobody can re-hash.
    for (const [name, cap] of [['stdout', g.stdout], ['stderr', g.stderr]]) {
      if (!cap) continue;
      lines.push(`    ${name}     ${cap.fullHash}`);
      lines.push(`               ${cap.originalBytes} bytes${cap.truncated ? ` TRUNCATED to ${cap.capturedBytes} (captured hash ${cap.capturedHash})` : ' (captured whole)'}`);
    }
    for (const c of g.countLines) lines.push(`   ${c}`);
  }
  lines.push('');
  lines.push(`    terminal   ${after.commit?.slice(0, 7)} / porcelain ${(after.porcelain ?? '') === '' ? 'empty' : 'DIRTY'}`);
  if (dependencyTransport) lines.push(`    cleanup    recorded below by the caller`);
  lines.push(`    VERDICT    ${verdict} — ${reason}`);
  return lines.join('\n');
}
