// ⛔ THE REMEDY OUR OWN TOOL PRINTS WAS INERT IN EXACTLY THE STATE THAT TRIGGERS IT.
//
// ef-manager, sand_castle, 2026-08-20. A `graph_index(force=true)` destroyed the LSP-verified
// edges. The reindex printed, in its own words:
//
//   "this rebuild DROPPED the LSP-verified trust spine ... Run graph_collect_code_intel to
//    restore it — until then caller sets are heuristic-only."
//
// That call returned in 1.8 seconds having imported nothing, and was a FIXED POINT across
// repeated calls:
//
//   recordsImported 0 · edgesCreated 0 · index.filesTotal 0 · resumedFrom 200
//   invalidationSkipped "collection walked no files (already converged)"
//
// while the graph held ZERO edges of LSP provenance (EXTRACTED 27942, INFERRED 25010,
// AMBIGUOUS 5841, LSP_VERIFIED 0). Every field a caller could check read as success, and our
// documented completion criterion — `filesTotal: 0` — was satisfied on the FIRST call.
//
// THE MECHANISM: the resume ledger was invalidated by the COMPILE database's hash. A graph
// rebuild deletes the edges and never touches `compile_commands.json`, so the hash matched, the
// guard passed, and 200 "already collected" claims were honoured while the evidence they
// described had been deleted hours earlier. The ledger lives OUTSIDE `graph.sqlite`, so it
// survives precisely the operation that invalidates it.
//
// ★ THE GENERAL FORM, which is why the fix is not a second hash: a claim stored outside the thing
// it describes must carry that thing's identity, or it cannot know when it has been orphaned.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readLedger, writeLedger, ledgerEvidenceSurvives, graphEvidenceWitness, collectionComplete,
} from '../../../mcp/stdio/code-intel/collect-ledger.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let root;
afterEach(async () => {
  if (root) { try { await rm(root, { recursive: true, force: true }); } catch { /* win lock */ } }
  root = undefined;
});

// A project whose ledger claims 200 collected files, with a graph holding whatever the case needs.
async function projectWithLedger({ verifiedEdges }) {
  root = await mkdtemp(join(tmpdir(), 'apg-ledger-'));
  await mkdir(join(root, '.aify-graph', 'code-intel'), { recursive: true });
  const db = openDb(join(root, '.aify-graph', 'graph.sqlite'));
  const add = (id) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ('${id}','Function','f${id}','src/a.cpp',1,1,'cpp',1,'{}')`);
  add('a'); add('b');
  for (let i = 0; i < verifiedEdges; i++) {
    db.run(
      `INSERT OR IGNORE INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
       VALUES ('a','b','CALLS','src/a.cpp',${i + 1},1,'LSP_VERIFIED','clangd')`);
  }
  // One heuristic edge always present, so "the graph is empty" is never the reason a case passes.
  db.run(
    `INSERT OR IGNORE INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
     VALUES ('b','a','CALLS','src/a.cpp',1,1,'EXTRACTED','tree-sitter')`);
  db.close();

  writeLedger(root, { dbHash: 'HASH1', collected: new Set(['src/a.cpp', 'src/b.cpp']) }, '2026-08-20T00:00:00Z');
  return root;
}

describe('a ledger whose evidence was destroyed must not claim coverage', () => {
  it('★★★ ORPHANED: the graph holds no verified evidence, so prior coverage resets', async () => {
    // The sand_castle state exactly. Before the fix this returned 2 collected files, `pendingFiles`
    // subtracted them from the enumeration, the loop had nothing to do, and the response said so
    // in language a caller reads as success.
    await projectWithLedger({ verifiedEdges: 0 });
    const ledger = readLedger(root, 'HASH1', graphEvidenceWitness(root));
    expect(ledger.collected.size, 'claims about deleted edges are not coverage').toBe(0);
  }, 30_000);

  it('★★★ INTACT: verified evidence present, so a real resume still resumes', async () => {
    // ⚠ THE NEGATIVE CONTROL, and the whole reason the ledger exists. Without it the fix could
    // simply void the ledger always, every test above would pass, and we would have restored the
    // warm-redo bug this file was written to close — a 185-file repo growing a bigger import on
    // each "resume" instead of converging.
    await projectWithLedger({ verifiedEdges: 5 });
    const ledger = readLedger(root, 'HASH1', graphEvidenceWitness(root));
    expect(ledger.collected.size, 'a genuine resume must still skip collected files').toBe(2);
  }, 30_000);

  it('★★★ a changed COMPILE db still invalidates — the original guard is not weakened', async () => {
    await projectWithLedger({ verifiedEdges: 5 });
    expect(readLedger(root, 'DIFFERENT', graphEvidenceWitness(root)).collected.size).toBe(0);
  }, 30_000);

  it('★★★ an ABSENT witness fails closed', () => {
    // "Could not check" must never resolve to "still valid". Resetting costs a re-collect;
    // trusting costs a silent permanent no-op that reports success. Not symmetric.
    expect(ledgerEvidenceSurvives(null)).toBe(false);
    expect(ledgerEvidenceSurvives({})).toBe(false);
    expect(ledgerEvidenceSurvives({ verifiedEdges: 'lots' })).toBe(false);
    expect(ledgerEvidenceSurvives({ verifiedEdges: 0 })).toBe(false);
    expect(ledgerEvidenceSurvives({ verifiedEdges: 1 })).toBe(true);
  });

  it('★★★ a missing graph yields no witness rather than throwing', async () => {
    root = await mkdtemp(join(tmpdir(), 'apg-ledger-none-'));
    expect(graphEvidenceWitness(root), 'a witness must never blow up a collection').toBeNull();
    await writeFile(join(root, 'not-a-db'), 'x');
    expect(graphEvidenceWitness(join(root, 'not-a-db'))).toBeNull();
  }, 30_000);
});

describe('completion is two facts, not one derived boolean', () => {
  it('★★★ a run that processed everything it was HANDED is not complete if enumeration was capped', () => {
    // ⛔ THE CONTRADICTION INSIDE ONE PAYLOAD. sand_castle returned `filesTotal: 0` — our
    // documented "you are finished" signal — beside `enumeration_capped_at_200_of_267`. The old
    // predicate was `!budgetExhausted && filesProcessed >= filesTotal`, a statement about the
    // files this call was given, which cannot see that 67 were never enumerated. A cap reported
    // as a total, for the fourth time in this codebase.
    const c = collectionComplete({ filesProcessed: 200, filesTotal: 200, enumerationTruncated: true });
    expect(c.complete).toBe(false);
    expect(c.reason).toBe('enumeration_capped');
  });

  it('★★★ complete when nothing remained AND everything was enumerated', () => {
    // Negative control: a predicate that never grants completion is as useless as one that always
    // does, and would make every collection look permanently unfinished.
    const c = collectionComplete({ filesProcessed: 200, filesTotal: 200, enumerationTruncated: false });
    expect(c.complete).toBe(true);
    expect(c.reason).toBeNull();
  });

  it('★★★ each incompleteness names its own cause', () => {
    expect(collectionComplete({ budgetExhausted: true, filesProcessed: 5, filesTotal: 5 }).reason)
      .toBe('budget_exhausted');
    expect(collectionComplete({ filesProcessed: 3, filesTotal: 9 }).reason).toBe('files_remaining');
  });
});
