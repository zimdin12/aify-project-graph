// ⛔ EVERY PROVIDER WROTE THE SAME EXTRACTOR STRING, AND THE INVALIDATION DELETES BY IT.
//
// `importer.js` built the label as `cpp-clangd#${dbHash8}` with `envelope.provider` never
// consulted, and identified the edges it may DELETE as `extractor LIKE 'cpp-clangd#%'`. Measured
// on this repo at 67bfffe — a JavaScript project with no C++ in it at all:
//
//     cpp-clangd#                                 -> typescript callees   2282
//     cpp-clangd#|was:EXTRACTED::javascript::0.9  -> javascript callees   1299
//     cpp-clangd#                                 -> javascript callees    906
//     anything pointing at a C++ callee                                      0
//
// 100% of the trust spine attributed to a C++ compiler front-end. Never observed firing here —
// one provider means nothing to cross — so this is a live hazard, not an observed loss, and the
// tests below construct the mixed repo this one is not.
//
// ★ A VALUE THAT READS AS A LABEL WAS DOING DUTY AS AN AUTHORITY BOUNDARY. Fourth instance in one
// session, after `status: ok`, the edges-only ledger witness, and `walkedNothing`.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importV02Collection, lspExtractorFor } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let dir;
afterEach(async () => {
  if (dir) { try { await rm(dir, { recursive: true, force: true }); } catch { /* win lock */ } }
  dir = undefined;
});

async function graph() {
  dir = await mkdtemp(join(tmpdir(), 'apg-extractor-'));
  await mkdir(join(dir, '.aify-graph'), { recursive: true });
  const db = openDb(join(dir, '.aify-graph', 'graph.sqlite'));
  const node = (id, lang, file) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ($id,'Function',$id,$f,1,2,$l,1,'{}')`, { id, l: lang, f: file });
  node('ts_caller', 'typescript', 'src/a.ts');
  node('ts_callee', 'typescript', 'src/b.ts');
  node('cpp_caller', 'cpp', 'sim/A.cpp');
  node('cpp_callee', 'cpp', 'sim/B.cpp');
  return db;
}

const edge = (db, from, to, extractor) => db.run(
  `INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
   VALUES ($f,$t,'CALLS','x',1,1,'LSP_VERIFIED',$e)`, { f: from, t: to, e: extractor });

const alive = (db, from, to) => db.get(
  'SELECT COUNT(*) c FROM edges WHERE from_id=$f AND to_id=$t', { f: from, t: to }).c;

/** A references-collecting envelope with records in the given language. */
const envelope = (provider, language, collectionId) => ({
  schema_version: '0.2',
  status: 'ok',
  provider,
  providerVersion: '0.1.0',
  projectRoot: dir,
  collectionId,
  language,
  operations: { references: { status: 'ok', count: 1 } },
  session: { collectedAt: new Date().toISOString(), freshnessValue: 'abcdef1234' },
  records: [
    {
      kind: 'symbol', language, symbolId: 's1', qname: 'q1', file: 'src/z',
      range: { start: { line: 1 }, end: { line: 1 } }, confidence: 1, result_state: 'found',
    },
  ],
});

describe('the extractor names its producer, and bounds what it may delete', () => {
  it('★★★ the label carries the ACTUAL provider, not a constant', async () => {
    expect(lspExtractorFor({ provider: 'ts-langserver', session: { freshnessValue: 'deadbeefcafe' } }))
      .toBe('ts-langserver#deadbeef');
    expect(lspExtractorFor({ provider: 'cpp-clangd', session: { compileDbHash: '0123456789' } }))
      .toBe('cpp-clangd#01234567');
    // ⚠ NEVER AN EMPTY HASH, and this is load-bearing rather than tidiness: a clangd run without
    // a compile DB would otherwise emit exactly `cpp-clangd#`, colliding with the legacy string
    // and making pre-fix rows indistinguishable from current ones.
    expect(lspExtractorFor({ provider: 'cpp-clangd', session: {} })).toBe('cpp-clangd#nohash');
    expect(lspExtractorFor({ provider: 'cpp-clangd', session: {} })).not.toBe('cpp-clangd#');
  });

  it('★★★ a TypeScript collect does NOT invalidate C++ edges', async () => {
    // ⛔ THE CROSS-PROVIDER DELETION. Under the old predicate both rows below read as
    // `cpp-clangd#...` and a single collect from either provider removed both.
    const db = await graph();
    edge(db, 'cpp_caller', 'cpp_callee', 'cpp-clangd#12345678');
    edge(db, 'ts_caller', 'ts_callee', 'ts-langserver#abcdef12');
    expect(alive(db, 'cpp_caller', 'cpp_callee')).toBe(1);

    importV02Collection(envelope('ts-langserver', 'typescript', 'c1'), db);

    expect(alive(db, 'cpp_caller', 'cpp_callee'), 'another provider’s evidence is not ours to delete').toBe(1);
    expect(alive(db, 'ts_caller', 'ts_callee'), 'CONTROL: it still invalidates its OWN edges').toBe(0);
    db.close();
  }, 30_000);

  it('★★★ a C++ collect does not invalidate TypeScript edges either', async () => {
    // The mirror, because a guard that only holds in one direction is half a guard — and this is
    // the direction the old `LIKE 'cpp-clangd#%'` predicate made worst, since the C++ prefix
    // matched literally everything.
    const db = await graph();
    edge(db, 'cpp_caller', 'cpp_callee', 'cpp-clangd#12345678');
    edge(db, 'ts_caller', 'ts_callee', 'ts-langserver#abcdef12');

    importV02Collection(envelope('cpp-clangd', 'cpp', 'c2'), db);

    expect(alive(db, 'ts_caller', 'ts_callee')).toBe(1);
    expect(alive(db, 'cpp_caller', 'cpp_callee'), 'CONTROL: its own edges still go').toBe(0);
    db.close();
  }, 30_000);

  it('★★★ MIGRATION: legacy `cpp-clangd#` rows are still reachable by the provider that made them', async () => {
    // ⛔ THE HAZARD ef-manager FLAGGED BEFORE THIS SHIPPED. Rename the label and every edge
    // already in the graph carries a string no new predicate matches — a ts re-collect would not
    // remove the stale ts edges it wrote yesterday. Permanently stale, immune to its own
    // provider's re-collect, and nothing errors.
    //
    // The claim is DERIVED, not assumed: a legacy row is adopted only by a collection that
    // actually observed its callee's language.
    const db = await graph();
    edge(db, 'ts_caller', 'ts_callee', 'cpp-clangd#');   // written by ts-langserver, mislabelled
    importV02Collection(envelope('ts-langserver', 'typescript', 'c3'), db);
    expect(alive(db, 'ts_caller', 'ts_callee'), 'the provider that made it can still retire it').toBe(0);
    db.close();
  }, 30_000);

  it('★★★ MIGRATION does not become a licence to delete other languages', async () => {
    // ⛔ THE CONTROL ON THE MIGRATION CLAUSE, and without it the clause simply restores the
    // old cross-provider behaviour under a new name. A legacy row whose callee is C++ is not
    // adopted by a TypeScript collection just because the string says `cpp-clangd#`.
    const db = await graph();
    edge(db, 'cpp_caller', 'cpp_callee', 'cpp-clangd#');
    importV02Collection(envelope('ts-langserver', 'typescript', 'c4'), db);
    expect(alive(db, 'cpp_caller', 'cpp_callee'),
      'a legacy label is unattributed, not automatically ours').toBe(1);
    db.close();
  }, 30_000);
});
