// EVERY ATTEMPT ON A CANDIDATE TREE IS RECORDED, SO A REFUSAL CANNOT BE RETRIED AWAY.
//
// ⛔⛔ THE FAILURE THIS EXISTS TO PREVENT IS MINE, AND I ALMOST COMMITTED IT. The candidate class
// refused; my immediate instinct was to run it again. It passed the next time, and the run after
// that refused. Under an uncontrolled environmental variable, **re-running until green is how a
// real refusal gets laundered into a receipt** — and nothing in the receipt would have shown that
// earlier attempts existed.
//
// graph-senior-dev: *"After the first REFUSE/FAILED, `--commit-with` must refuse a plain retry for
// the same T. A retry requires an explicit supersession reason/authority and must carry all prior
// attempts into the final receipt."*
//
// ⇒ So a PASS is no longer self-describing. A PASS that is the third attempt is a different fact
// from a PASS that is the first, and the receipt must say which.
//
// ⚠ THE LEDGER LIVES OUTSIDE T. It is written to a gitignored directory, because a file inside the
// tree being gated would change the very hash it is recording attempts against — the receipt
// self-reference problem, one layer down. Its contents travel into the final commit MESSAGE
// instead, which is not part of any tree.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const LEDGER_DIR = '.candidate-attempts';

const ledgerPath = (repo, tree) => join(repo, LEDGER_DIR, `${tree}.json`);

/** Every attempt recorded against this candidate tree, oldest first. */
export function readAttempts(repo, tree) {
  const p = ledgerPath(repo, tree);
  if (!existsSync(p)) return [];
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // ⛔ AN UNREADABLE LEDGER IS NOT AN EMPTY ONE. Returning [] would silently grant a clean first
    // attempt to a tree that may already have refusals recorded — the exact laundering this
    // prevents. The caller must treat this as unknown history.
    return null;
  }
}

/** Append one attempt. Never rewrites history; the file only grows. */
export function recordAttempt(repo, tree, attempt) {
  const prior = readAttempts(repo, tree);
  if (prior === null) throw new Error(`refusing to append to an unreadable attempt ledger for ${tree}`);
  mkdirSync(join(repo, LEDGER_DIR), { recursive: true });
  const next = [...prior, attempt];
  writeFileSync(ledgerPath(repo, tree), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * May this attempt proceed to a commit?
 *
 * @returns {{allowed:boolean, reason:string, priorFailures:number}}
 */
export function retryPermission(attempts, { supersedes } = {}) {
  if (attempts === null) {
    return { allowed: false, reason: 'the attempt ledger for this tree is unreadable — history unknown', priorFailures: -1 };
  }
  const failures = attempts.filter((a) => a.verdict !== 'PASS');
  if (failures.length === 0) return { allowed: true, reason: 'first attempt on this tree', priorFailures: 0 };
  if (!supersedes) {
    return {
      allowed: false,
      priorFailures: failures.length,
      reason: `${failures.length} prior non-PASS attempt(s) on this exact tree `
        + `(${failures.map((f) => f.verdict).join(', ')}). A plain retry is refused: re-running until `
        + 'green launders a refusal. Pass --supersedes "<reason>" to proceed, and it will travel in the receipt.',
    };
  }
  return {
    allowed: true,
    priorFailures: failures.length,
    reason: `superseding ${failures.length} prior non-PASS attempt(s): ${supersedes}`,
  };
}

/**
 * Render the full attempt history for the final receipt.
 *
 * ⛔ ALL ATTEMPTS TRAVEL, not just the successful one. A reader must be able to see that a PASS was
 * the third try and what the first two said, without going looking for a file they do not know
 * exists.
 */
export function renderAttempts(attempts) {
  if (!attempts?.length) return '    attempts   (none recorded)';
  return [`    attempts   ${attempts.length} on this exact candidate tree:`]
    .concat(attempts.map((a, i) => `      ${i + 1}. ${a.at} ${a.verdict}`
      + `${a.reason ? ` — ${a.reason}` : ''}${a.materialization ? ` [${a.materialization}]` : ''}`))
    .join('\n');
}
