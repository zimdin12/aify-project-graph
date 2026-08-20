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
import { openExistingDb } from '../storage/db.js';

const LEDGER_VERSION = 1;

export function ledgerPath(projectRoot) {
  return path.join(projectRoot, '.aify-graph', 'code-intel', 'collect-progress.json');
}

/**
 * ⛔ THIS LEDGER GUARDED THE WRONG DATABASE, AND THE REMEDY OUR OWN TOOL PRINTS WENT INERT.
 *
 * ef-manager, sand_castle, 2026-08-20. A `graph_index(force=true)` destroyed the LSP-verified
 * edges; the reindex printed "Run graph_collect_code_intel to restore it". That call returned in
 * **1.8 seconds** having imported nothing, and was a FIXED POINT across repeated calls:
 *
 *     recordsImported 0 · edgesCreated 0 · index.filesTotal 0 · resumedFrom 200
 *     invalidationSkipped "collection walked no files (already converged)"
 *
 * while the graph held ZERO edges of LSP provenance. Every field a caller could check read as
 * success. There was no way to discover the failure from the response.
 *
 * The mechanism: `dbHash` is the hash of the COMPILE database (compile-db.js). A graph rebuild
 * destroys the edges and never touches `compile_commands.json`, so the hash matched, the guard
 * passed, and 200 "already collected" claims were honoured while the evidence they described had
 * been deleted hours earlier. The ledger lives OUTSIDE `graph.sqlite`, so it survives exactly the
 * operation that invalidates it.
 *
 * ⚠ `dbHash` also does damage as a NAME. There are two databases in this system and the field
 * names neither, so a reader — including me, reviewing this file before — reads "the database
 * changed" and supplies whichever one they were already thinking about.
 *
 * ⇒ THE FIX IS NOT A SECOND HASH BESIDE THE FIRST. That is another list of things somebody must
 * remember to invalidate on, and the next artifact added inherits the same bug. The ledger's
 * claims are about EDGES IN THE GRAPH, so the ledger must be checked against the graph:
 *
 *   ★ A claim stored outside the thing it describes must carry that thing's identity, or it
 *     cannot know when it has been orphaned.
 *
 * `graphWitness` reports what the graph actually holds. A ledger claiming collected files while
 * the graph holds no verified evidence is orphaned and resets. Absent or unreadable witness FAILS
 * CLOSED — an unverifiable claim of prior coverage is exactly the state that produced the silent
 * no-op, and "could not check" must never resolve to "still valid".
 *
 * @param {string} projectRoot
 * @param {string} dbHash                       - compile-DB identity (toolchain state)
 * @param {{verifiedEdges:number}|null} graphWitness - what the GRAPH holds now
 */
export function readLedger(projectRoot, dbHash, graphWitness) {
  try {
    const raw = JSON.parse(fs.readFileSync(ledgerPath(projectRoot), 'utf8'));
    if (raw?.version !== LEDGER_VERSION) return emptyLedger(dbHash);
    // A different compile DB invalidates every claim in here.
    if (!dbHash || raw.dbHash !== dbHash) return emptyLedger(dbHash);

    const collected = new Set(Array.isArray(raw.collected) ? raw.collected : []);
    if (collected.size > 0 && !ledgerEvidenceSurvives(graphWitness)) return emptyLedger(dbHash);

    return {
      version: LEDGER_VERSION,
      dbHash: raw.dbHash,
      collected,
      updatedAt: raw.updatedAt ?? null,
    };
  } catch {
    return emptyLedger(dbHash);
  }
}

/**
 * Does the graph still hold the evidence this ledger claims to have produced?
 *
 * ⚠ FAILS CLOSED ON AN ABSENT WITNESS, deliberately. A caller that cannot establish what the
 * graph contains cannot establish that prior coverage still counts, and resetting the ledger
 * costs a re-collect while trusting it costs a silent permanent no-op. Those are not symmetric.
 */
export function ledgerEvidenceSurvives(graphWitness) {
  if (!graphWitness || typeof graphWitness.verifiedEdges !== 'number') return false;
  return graphWitness.verifiedEdges > 0;
}

/**
 * Read what the GRAPH currently holds, so a ledger claim can be checked against it.
 *
 * Read-only, one indexed COUNT, and never throws: a witness that could blow up a collection would
 * be traded away the first time it did. It returns null on any failure, which `ledgerEvidenceSurvives`
 * treats as "cannot confirm" — the fail-closed direction.
 *
 * ⚠ THE QUESTION IS "DOES VERIFIED EVIDENCE EXIST", NOT "DOES THE COLLECTION ROW EXIST". The
 * collection row SURVIVES a graph rebuild — the reindex says so in its own words: "the stored
 * collection was indexed at <old> but HEAD is <new>, so its evidence cannot be re-stamped as
 * verified". So a row-presence check would have passed while the edges were gone, which is the
 * same mistake one level over: checking a neighbouring artifact instead of the thing claimed.
 */
export function graphEvidenceWitness(projectRoot) {
  let db = null;
  try {
    const dbPath = path.join(projectRoot, '.aify-graph', 'graph.sqlite');
    if (!fs.existsSync(dbPath)) return null;
    db = openExistingDb(dbPath, { readonly: true });
    const row = db.all("SELECT COUNT(*) AS c FROM edges WHERE provenance = 'LSP_VERIFIED'")[0];
    return { verifiedEdges: Number(row?.c ?? 0) };
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* best-effort */ }
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

/**
 * ⛔ A COMPLETION SIGNAL THAT COEXISTS WITH ITS OWN REFUTATION IS NOT A SIGNAL.
 *
 * The same sand_castle payload carried BOTH of these:
 *
 *     index.filesTotal 0                                  -> "nothing left to do"
 *     reason "enumeration_capped_at_200_of_267"            -> "67 files were never enumerated"
 *
 * `complete` was `!budgetExhausted && filesProcessed >= filesTotal`, which is a statement about
 * the files this call was HANDED. It cannot see that enumeration stopped early, so a run that
 * processed everything it was given reported completion over a corpus it had never been shown —
 * a cap reported as a total, the defect this project has now found in four separate places.
 *
 * ⇒ Completion is TWO facts and they are both stated: nothing remained of what we were given,
 * AND we were given everything there was. A derived boolean may not stand in for the pair; the
 * caller gets the reason with it so "not complete" is actionable rather than merely discouraging.
 */
export function collectionComplete({
  budgetExhausted = false,
  filesProcessed = 0,
  filesTotal = 0,
  enumerationTruncated = false,
} = {}) {
  const processedAll = filesProcessed >= filesTotal;
  const complete = !budgetExhausted && processedAll && !enumerationTruncated;
  return {
    complete,
    reason: complete ? null
      : budgetExhausted ? 'budget_exhausted'
        : !processedAll ? 'files_remaining'
          : 'enumeration_capped',
  };
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
