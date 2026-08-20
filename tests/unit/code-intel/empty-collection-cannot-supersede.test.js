// ⛔⛔ A ZERO-RECORD COLLECTION DESTROYED 62,066 RECORDS ON THE REAL REPO, LIVE.
//
// Reproduced 2026-08-20, not theorised. A full `scope:"all"` collection ran 455s, processed 200
// files and stored 62,066 records. The resume run immediately after found the ledger already
// drained, did nothing, and returned `status: "ok"` with ZERO files in 0 seconds — which is
// CORRECT; it succeeded at what it was asked. It then pruned every prior collection from the same
// provider.
//
//     before   1 collection · 200 files · 62,066 records
//     after    1 collection ·   0 files ·      0 records
//
// ⚠ AND THE IDENTICAL DEFECT IS DOCUMENTED AS FIXED 600 LINES ABOVE IT, IN THE SAME FILE:
//
//   "DATA-LOSS FIX (field report, HIGH). This was `envelope.status === 'ok'`, so a one-file
//    collect requesting ONLY symbols+diagnostics returned ok — it did succeed at what it was
//    asked — and was therefore treated as a globally authoritative snapshot. It then deleted
//    EVERY LSP_VERIFIED edge in the repo: 5961 verified edges -> 0"
//
// The fix was applied to EDGE INVALIDATION and not to RECORD PRUNING. Same condition, same file,
// same authority question, one function apart — a defect report naming one instance getting an
// instance-shaped fix.
//
// ★ AUTHORITY IS NOT SUCCESS. `status: ok` says the run did what it was asked. It says nothing
// about whether what it was asked covers what it is about to delete.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importV02Collection } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let dir;
afterEach(async () => {
  if (dir) { try { await rm(dir, { recursive: true, force: true }); } catch { /* win lock */ } }
  dir = undefined;
});

async function graphWithCollection() {
  dir = await mkdtemp(join(tmpdir(), 'apg-supersede-'));
  await mkdir(join(dir, '.aify-graph'), { recursive: true });
  const db = openDb(join(dir, '.aify-graph', 'graph.sqlite'));
  // A real, substantive prior collection — imported through the SAME path a collect uses, so the
  // fixture cannot be easier to satisfy than production.
  importV02Collection({
    schema_version: '0.2',
    status: 'ok',
    provider: 'ts-langserver',
    providerVersion: '0.1.0',
    projectRoot: dir,
    collectionId: 'prior',
    operations: { references: { status: 'ok', count: 2 } },
    session: { filesProcessed: 200, filesTotal: 200, indexedCommit: 'aaa' },
    records: [
      { kind: 'definitions', language: 'typescript', symbolId: 's1', qname: 'alpha', file: 'src/a.ts', range: { start: { line: 1 }, end: { line: 1 } }, confidence: 1, result_state: 'found' },
      { kind: 'references', language: 'typescript', symbolId: 's1', qname: 'alpha', file: 'src/b.ts', range: { start: { line: 5 }, end: { line: 5 } }, confidence: 1, result_state: 'found' },
    ],
  }, db);
  return db;
}

const recordCount = (db) => db.all('SELECT COUNT(*) c FROM code_intel_records')[0].c;

describe('a collection can only supersede what it had the authority to re-observe', () => {
  it('★★★ a ZERO-RECORD ok collection does NOT prune the prior one', async () => {
    const db = await graphWithCollection();

    // ⛔ POSITIVE CONTROL FIRST. If the prior import stored nothing, "the records survived" is
    // trivially true of records that never existed — the failure mode this repo has shipped
    // repeatedly tonight.
    const before = recordCount(db);
    expect(before, 'the prior collection must actually hold records').toBeGreaterThan(0);

    const stats = importV02Collection({
      schema_version: '0.2',
      status: 'ok',                 // ← genuinely ok: the resume run succeeded at doing nothing
      provider: 'ts-langserver',
      providerVersion: '0.1.0',
      projectRoot: dir,
      collectionId: 'empty-resume',
      operations: { references: { status: 'ok', count: 0 } },
      session: { filesProcessed: 0, filesTotal: 0, indexedCommit: 'bbb' },
      records: [],
    }, db);

    expect(recordCount(db), 'a run that observed nothing must not delete what a real run observed')
      .toBe(before);
    expect(stats.pruneSkipped, 'and it must SAY it declined, or "0 pruned" reads as "nothing to prune"')
      .toBeTruthy();
    db.close();
  }, 30_000);

  it('★★★ a collection WITH records still supersedes — the prune is not disabled', async () => {
    // ⛔ THE CONTROL THAT MATTERS. Without it, "never prune" passes the test above, and the
    // unbounded-growth defect the prune exists for comes straight back: sand_castle reached 1.03M
    // rows and 732MB across 13 runs, and stale evidence from superseded runs resurfaced in
    // getCodeIntelEvidenceForSymbol because it queries ACROSS collections.
    const db = await graphWithCollection();
    const before = recordCount(db);
    expect(before).toBeGreaterThan(0);

    const stats = importV02Collection({
      schema_version: '0.2',
      status: 'ok',
      provider: 'ts-langserver',
      providerVersion: '0.1.0',
      projectRoot: dir,
      collectionId: 'real-rerun',
      operations: { references: { status: 'ok', count: 1 } },
      session: { filesProcessed: 200, filesTotal: 200, indexedCommit: 'ccc' },
      records: [
        { kind: 'references', language: 'typescript', symbolId: 's1', qname: 'alpha', file: 'src/b.ts', range: { start: { line: 7 }, end: { line: 7 } }, confidence: 1, result_state: 'found' },
      ],
    }, db);

    expect(stats.collectionsPruned, 'a substantive re-collect DOES supersede').toBeGreaterThan(0);
    expect(db.all("SELECT COUNT(*) c FROM code_intel_records WHERE collection_id = 'prior'")[0].c,
      'the superseded collection is gone').toBe(0);
    db.close();
  }, 30_000);
  it('★★★ the EXACT envelope the live incident produced', async () => {
    // ⚠ MY FIRST TEST DOES NOT COVER THE REAL CASE. It carries a references operation, so it
    // is refused for having no records. The envelope that actually destroyed 62,066 rows is the
    // converged-resume return in `lsp-collect.js:174-186`, and it is refused for a different
    // reason: `operations: {}`. Two conditions, and a regression test that exercises only one of
    // them would let the other come back.
    //
    // Copied field-for-field from that return statement, not paraphrased:
    //   session: {...session0, filesProcessed: 0, filesTotal: 0, remaining: 0, complete: true,
    //             resumeLedger: 'active'}, operations: {}, status: 'ok', records: []
    // — and note `complete: true`, which is honest (the resume DID converge) and reads as
    // authority. No file scope is declared, so `walkedNothing` is false: this envelope claims
    // repo-wide reach while having examined nothing.
    const db = await graphWithCollection();
    const before = recordCount(db);
    expect(before).toBeGreaterThan(0);

    const stats = importV02Collection({
      schema_version: '0.2',
      status: 'ok',
      provider: 'ts-langserver',
      providerVersion: '0.1.0',
      projectRoot: dir,
      collectionId: 'converged-resume',
      operations: {},
      session: {
        filesProcessed: 0, filesTotal: 0, remaining: 0, complete: true,
        resumedFrom: 200, enumeratedTotal: 200, resumeLedger: 'active', indexedCommit: 'ddd',
      },
      records: [],
    }, db);

    expect(recordCount(db), 'the run that destroyed the spine must now be refused').toBe(before);
    expect(stats.pruneSkipped, 'and it says which authority it lacked')
      .toMatch(/references operation/i);
  }, 30_000);
});
