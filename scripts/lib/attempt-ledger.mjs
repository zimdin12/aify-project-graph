// EVERY ATTEMPT ON A CANDIDATE TREE IS RECORDED, SO A REFUSAL CANNOT BE RETRIED AWAY.
//
// ⛔⛔ THE FAILURE THIS EXISTS TO PREVENT IS MINE. The candidate class refused; my instinct was to
// run it again; it passed; the run after that refused. Under an uncontrolled environmental variable
// that is a coin flip reported as a verdict, and nothing in the receipt would have shown that
// earlier attempts existed.
//
// ⛔⛔⛔ AND THE FIRST VERSION OF THIS FILE LAUNDERED HISTORY THROUGH THREE SEPARATE DOORS, EACH
// WITH A COMMENT PROMISING IT DID NOT:
//
//   1. `Array.isArray(parsed) ? parsed : []` — a ledger containing `{}` is VALID JSON, so it read
//      as EMPTY HISTORY and granted a clean first attempt. The comment directly above it said "an
//      unreadable ledger is not an empty one". The code did the opposite of its own docstring.
//   2. The attempt was appended straight after the GATE, so a gate PASS followed by a custody move
//      or a failed CAS left `PASS` on the record — a plain retry then erased the transaction's
//      refusal. The same laundering, one layer later.
//   3. Read-modify-write on a single file: two processes read the same prefix and the second
//      overwrites the first. Lost attempts are indistinguishable from attempts that never happened.
//
// ⇒ So: fail closed on EVERY shape defect, record the TERMINAL TRANSACTION outcome rather than the
// gate's, and make appends atomic per-attempt rather than rewriting a shared array.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const LEDGER_DIR = '.candidate-attempts';

/**
 * Terminal outcomes. Retry permission is decided by THESE, never by the gate verdict alone.
 *
 * ⚠ `INCOMPLETE` exists so a crash is not silence: an attempt that started and never reached a
 * terminal state blocks a plain retry exactly like a refusal, because nobody knows what it did.
 */
export const OUTCOME = {
  GATE_REFUSE: 'GATE_REFUSE',
  GATE_FAILED: 'GATE_FAILED',
  GATE_PASS_CUSTODY_REFUSE: 'GATE_PASS_CUSTODY_REFUSE',
  GATE_PASS_CAS_REFUSE: 'GATE_PASS_CAS_REFUSE',
  PUBLISHED_EXACT_TREE: 'PUBLISHED_EXACT_TREE',
  WORKTREE_POSTCONDITION_REFUSE: 'WORKTREE_POSTCONDITION_REFUSE',
  INCOMPLETE: 'INCOMPLETE',
};

/** Only these mean the transaction succeeded. Everything else blocks a plain retry. */
const SUCCESS = new Set([OUTCOME.PUBLISHED_EXACT_TREE, OUTCOME.WORKTREE_POSTCONDITION_REFUSE]);

const REQUIRED_FIELDS = ['id', 'at', 'tree', 'outcome'];

/**
 * Is one row a well-formed attempt?
 *
 * ⛔ A ROW THAT CANNOT BE UNDERSTOOD IS NOT A ROW THAT DID NOT HAPPEN. Skipping malformed entries
 * would let a corrupted write erase a refusal, so any defect poisons the whole read.
 */
function rowProblem(row, i) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return `row ${i} is not an object`;
  for (const f of REQUIRED_FIELDS) {
    if (typeof row[f] !== 'string' || row[f] === '') return `row ${i} is missing "${f}"`;
  }
  if (!Object.values(OUTCOME).includes(row.outcome)) return `row ${i} has unknown outcome "${row.outcome}"`;
  return null;
}

/**
 * Every attempt recorded against this candidate tree.
 *
 * @returns {Array|null} null means the history is UNKNOWN — never treat it as empty.
 */
export function readAttempts(repo, tree) {
  const dir = join(repo, LEDGER_DIR, tree);
  if (!existsSync(dir)) return [];
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return null; }
  const rows = [];
  for (const f of files.sort()) {
    let parsed;
    try { parsed = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; }
    // ⛔ EVERY non-object shape refuses. `{}`, `null`, a number and a string are all valid JSON and
    // none of them is an attempt.
    const problem = rowProblem(parsed, f);
    if (problem) return null;
    rows.push(parsed);
  }
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Start an attempt. Written BEFORE the gate runs, as INCOMPLETE.
 *
 * ⛔ ATOMIC EXCLUSIVE CREATE, one file per attempt. The old version read an array, appended, and
 * rewrote the whole file — so two concurrent processes lost one another's attempts. `wx` fails if
 * the file exists, so no write can silently replace another.
 */
export function beginAttempt(repo, tree, meta = {}) {
  const id = randomUUID();
  const dir = join(repo, LEDGER_DIR, tree);
  mkdirSync(dir, { recursive: true });
  const row = { id, at: new Date().toISOString(), tree, outcome: OUTCOME.INCOMPLETE, ...meta };
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(row, null, 2)}\n`, { flag: 'wx' });
  return row;
}

/** Move an attempt to its terminal outcome. The file is replaced in place, by id. */
export function concludeAttempt(repo, tree, id, outcome, detail = {}) {
  if (!Object.values(OUTCOME).includes(outcome)) throw new Error(`unknown outcome ${outcome}`);
  const p = join(repo, LEDGER_DIR, tree, `${id}.json`);
  const row = { ...JSON.parse(readFileSync(p, 'utf8')), outcome, concludedAt: new Date().toISOString(), ...detail };
  writeFileSync(p, `${JSON.stringify(row, null, 2)}\n`);
  return row;
}

/**
 * Structured supersession authority.
 *
 * ⛔ FREE TEXT IS NOT AUTHORITY. The first version accepted any string, so the same operator typing
 * "retry" satisfied it — which is not independent approval of anything. A supersession must name
 * WHICH attempts it supersedes, WHO approved it, and the message that carries that approval.
 */
export function parseSupersession(raw) {
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { invalid: 'supersession must be JSON' }; }
  for (const f of ['supersedes', 'reason', 'approver', 'approvalMessageId']) {
    if (f === 'supersedes') {
      if (!Array.isArray(parsed[f]) || parsed[f].length === 0) return { invalid: 'supersedes must be a non-empty array of attempt ids' };
    } else if (typeof parsed[f] !== 'string' || parsed[f] === '') {
      return { invalid: `supersession is missing "${f}"` };
    }
  }
  return parsed;
}

/**
 * May this attempt proceed?
 *
 * @returns {{allowed:boolean, reason:string, blocking:Array}}
 */
export function retryPermission(attempts, supersession = null) {
  if (attempts === null) {
    return { allowed: false, reason: 'the attempt ledger for this tree is unreadable or malformed — history unknown', blocking: [] };
  }
  const blocking = attempts.filter((a) => !SUCCESS.has(a.outcome));
  if (blocking.length === 0) return { allowed: true, reason: 'no blocking prior attempts on this tree', blocking: [] };

  if (!supersession) {
    return {
      allowed: false,
      blocking,
      reason: `${blocking.length} prior non-successful attempt(s) on this exact tree `
        + `(${blocking.map((b) => b.outcome).join(', ')}). A plain retry is refused: re-running until `
        + 'green launders a refusal. Supply structured --supersedes authority.',
    };
  }
  if (supersession.invalid) return { allowed: false, blocking, reason: `supersession rejected: ${supersession.invalid}` };

  // ⛔ THE SUPERSESSION MUST NAME THE ATTEMPTS IT OVERRIDES. Superseding "whatever went before"
  // would let one approval cover attempts nobody had seen when it was granted.
  const named = new Set(supersession.supersedes);
  const unnamed = blocking.filter((b) => !named.has(b.id));
  if (unnamed.length) {
    return {
      allowed: false,
      blocking,
      reason: `supersession does not name ${unnamed.length} blocking attempt(s): ${unnamed.map((u) => u.id).join(', ')}`,
    };
  }
  return {
    allowed: true,
    blocking,
    reason: `superseding ${blocking.length} attempt(s) — ${supersession.reason} `
      + `[approver ${supersession.approver}, ${supersession.approvalMessageId}]`,
  };
}

/** Render the full history for the final receipt. ALL attempts travel, not just the successful one. */
export function renderAttempts(attempts) {
  if (attempts === null) return '    attempts   ⛔ UNREADABLE — history unknown';
  if (!attempts.length) return '    attempts   (none recorded)';
  return [`    attempts   ${attempts.length} on this exact candidate tree:`]
    .concat(attempts.map((a, i) => `      ${i + 1}. ${a.at} ${a.outcome}`
      + `${a.reason ? ` — ${a.reason}` : ''}${a.id ? ` [${a.id.slice(0, 8)}]` : ''}`))
    .join('\n');
}

/**
 * Is this message file fit to become a commit?
 *
 * ⛔ MY OWN WRAPPER COMMITTED A MESSAGE READING "placeholder". The mechanism did exactly what it was
 * built to do; I handed it a throwaway file while exercising the ledger. A preflight is the control
 * that stops an operator error becoming published history, and it runs BEFORE the gate so nothing
 * expensive precedes the cheap refusal.
 */
export const MESSAGE_SENTINELS = ['placeholder', 'tbd', 'todo', 'wip', 'test', 'xxx', 'temp'];

export function messageProblem(text) {
  const lines = (text ?? '').split('\n');
  const subject = (lines[0] ?? '').trim();
  if (subject === '') return 'the message has no subject line';
  // ⚠ THE SENTINEL CHECK COMES FIRST, deliberately. "placeholder" is 11 characters, so a
  // length-first order reported "too short to describe a change" — true, and the least useful
  // thing to say about it. A refusal should name the actual problem, not the first rule that
  // happens to catch it.
  if (MESSAGE_SENTINELS.includes(subject.toLowerCase())) return `the subject is the placeholder "${subject}"`;
  if (subject.length < 12) return `the subject is ${subject.length} characters — too short to describe a change`;
  if (/GATE RECEIPT \[/.test(text)) return 'the message already contains a receipt — it would be embedded twice';
  return null;
}
