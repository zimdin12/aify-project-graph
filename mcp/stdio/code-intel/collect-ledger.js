// COLLECT LEDGER — makes "run again to continue" TRUE.
//
// The budget-exhausted envelope has always said:
//   "run graph_collect_code_intel again to continue/complete (warm runs are ~fast)"
// and the per-file loop has always been `for (let i = 0; i < files.length; i++)`,
// starting at 0 every time with nothing recorded about what was already done. A
// second run was a WARM REDO, not a resume: clangd's index is hot so it reaches
// further, but it re-walks the same files from the beginning and regenerates their
// records — which is why a 185-file repo produced a bigger and bigger import on
// each "resume" instead of converging (Sand Castle, 2026-07-30: attempt 1 covered
// 15/185, attempt 2 ran ~30 min and was killed by a host idle timeout).
//
// An instruction telling a user to do something the code does not do is the same
// defect class this pass removed from the query verbs. This closes it in the
// collect path.
//
// KEYED BY COMPILE-DB HASH. The ledger is only valid for the toolchain state it
// was gathered under; a changed compile DB means the previous collection's
// coverage says nothing about the new one, so the ledger resets rather than
// letting a stale entry mask an uncollected file.

import fs from 'node:fs';
import path from 'node:path';

const LEDGER_VERSION = 1;

export function ledgerPath(projectRoot) {
  return path.join(projectRoot, '.aify-graph', 'code-intel', 'collect-progress.json');
}

export function readLedger(projectRoot, dbHash) {
  try {
    const raw = JSON.parse(fs.readFileSync(ledgerPath(projectRoot), 'utf8'));
    if (raw?.version !== LEDGER_VERSION) return emptyLedger(dbHash);
    // A different compile DB invalidates every claim in here.
    if (!dbHash || raw.dbHash !== dbHash) return emptyLedger(dbHash);
    return {
      version: LEDGER_VERSION,
      dbHash: raw.dbHash,
      collected: new Set(Array.isArray(raw.collected) ? raw.collected : []),
      updatedAt: raw.updatedAt ?? null,
    };
  } catch {
    return emptyLedger(dbHash);
  }
}

function emptyLedger(dbHash) {
  return { version: LEDGER_VERSION, dbHash: dbHash ?? null, collected: new Set(), updatedAt: null };
}

// Best-effort persist. A ledger write failure must never fail a collection that
// otherwise succeeded — the worst case is that the next run redoes work, which is
// exactly the old behaviour.
export function writeLedger(projectRoot, ledger, nowIso) {
  try {
    const dir = path.dirname(ledgerPath(projectRoot));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ledgerPath(projectRoot), JSON.stringify({
      version: LEDGER_VERSION,
      dbHash: ledger.dbHash,
      collected: [...ledger.collected].sort(),
      updatedAt: nowIso ?? null,
    }, null, 1));
    return true;
  } catch {
    return false;
  }
}

export function clearLedger(projectRoot) {
  try { fs.rmSync(ledgerPath(projectRoot), { force: true }); return true; } catch { return false; }
}

// Split an enumerated file list into what still needs collecting and what a prior
// run already covered. Only ever applied to an ENUMERATED list (scope=all/changed):
// an explicit files[] request is the caller stating what they want, and must be
// honoured verbatim even if it was collected before.
export function pendingFiles(files, ledger) {
  const remaining = [];
  const alreadyCollected = [];
  for (const f of files) {
    if (ledger.collected.has(f)) alreadyCollected.push(f);
    else remaining.push(f);
  }
  return { remaining, alreadyCollected };
}
