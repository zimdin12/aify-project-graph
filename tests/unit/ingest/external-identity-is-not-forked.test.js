import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { resolveRefs } from '../../../mcp/stdio/ingest/resolver.js';
import { importCodeIntelRecords } from '../../../mcp/stdio/ingest/code-intel/importer.js';

// ⛔ TWO PRODUCERS DERIVE External IDS DIFFERENTLY, AND BLIND RE-MINTING WOULD FORK ONE TARGET.
//
//   code-intel : `external:${hash([qname])}`               label = last segment of the qname
//   tree-sitter: `external:${sha1(family:label).slice(16)}` label = the normalized target
//
// So `std::vector::push_back` imported from a compiler collection, and a tree-sitter CALLS ref to
// `push_back`, are the same conceptual target under two different ids. When External was excluded
// from ordinary resolution, the naive repair — "filter them out, then always call
// createExternalNode" — would mint a second stub beside the first and throw away the one carrying
// higher-provenance evidence.
//
// ⚠ THIS PATH WAS REASONED AND COMMENTED, NOT TESTED, and I said so when I sent the change for
// review rather than letting the comment stand in for a test. This is that test.
//
// ⭐ The fixture uses the REAL importer, not an imitation of it. A hand-built node with an invented
// id would prove the lookup works on a shape no producer emits.

describe('External identity is not forked between producers', () => {
  let dir;
  let db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apg-identity-'));
    db = openDb(join(dir, 'graph.sqlite'));
  });
  afterEach(() => {
    try { db.close(); } catch { /* already closed */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const seedCaller = () => upsertNode(db, {
    id: 'fn:caller', type: 'Function', label: 'caller', file_path: 'src/a.cpp',
    start_line: 1, end_line: 9, language: 'cpp', confidence: 1,
    structural_fp: '', dependency_fp: '', extra: {},
  });

  const importCollectionTarget = () => importCodeIntelRecords(db, [{
    kind: 'call',
    relation: 'CALLS',
    source: { qname: 'app::run', file: 'src/a.cpp', line: 1 },
    target: { qname: 'std::vector::push_back' },
    file: 'src/a.cpp',
    start_line: 5,
    language: 'cpp',
    confidence: 0.9,
  }]);

  const treeSitterRef = () => ({
    from_id: 'fn:caller', relation: 'CALLS', target: 'push_back',
    source_file: 'src/a.cpp', source_line: 7, confidence: 0.7,
    provenance: 'EXTRACTED', extractor: 'cpp', language: 'cpp',
  });

  const externalRows = () => db.all("SELECT id, label FROM nodes WHERE type = 'External'");

  it('⭐ CONTROL: the two producers really do derive different ids', () => {
    // ⛔ WITHOUT THIS THE WHOLE FILE IS VACUOUS. If the tree-sitter id happened to equal the
    // code-intel one, "reused" and "re-minted" would be indistinguishable and every assertion below
    // would pass against a broken implementation.
    importCollectionTarget();
    const codeIntelId = externalRows()[0].id;

    // Mint the tree-sitter id in a SEPARATE graph, by running the same ref with nothing to reuse.
    const otherDir = mkdtempSync(join(tmpdir(), 'apg-identity-b-'));
    const other = openDb(join(otherDir, 'graph.sqlite'));
    upsertNode(other, {
      id: 'fn:caller', type: 'Function', label: 'caller', file_path: 'src/a.cpp',
      start_line: 1, end_line: 9, language: 'cpp', confidence: 1,
      structural_fp: '', dependency_fp: '', extra: {},
    });
    const minted = resolveRefs({ db: other, refs: [treeSitterRef()] })
      .nodes.filter((n) => n.type === 'External');
    other.close();
    rmSync(otherDir, { recursive: true, force: true });

    expect(minted, 'the ref must mint a terminal when there is nothing to reuse').toHaveLength(1);
    expect(minted[0].id, 'if these matched, this whole file would prove nothing')
      .not.toBe(codeIntelId);
  });

  it('⛔ a tree-sitter ref REUSES the collection-imported terminal', () => {
    importCollectionTarget();
    const codeIntelId = externalRows()[0].id;
    seedCaller();

    const { nodes, edges } = resolveRefs({ db, refs: [treeSitterRef()] });

    expect(edges).toHaveLength(1);
    expect(edges[0].to_id, 'the edge must land on the collection-imported node').toBe(codeIntelId);
    expect(nodes.filter((n) => n.type === 'External'), 'nothing new may be minted').toHaveLength(0);
  });

  it('⛔⛔ THE CASE MY FIRST VERSION DODGED: a ref carrying the FULL QUALIFIED NAME reuses too', () => {
    // ⛔ THIS FILE ORIGINALLY TESTED ONLY THE LEAF (`push_back`), which is the convenient case: the
    // importer stores the leaf as `label`, so a leaf-targeted ref matched by label and passed. A
    // review probe used the qualified name a C++ ref actually carries — and it MISSED the candidate
    // and minted `std::vector::push_back` as a second terminal beside the collection's node. The
    // exact identity fork this file claims to prevent, live, underneath a green test.
    //
    // ⇒ Choosing the input that makes a test pass is not testing. The lookup now matches
    // `extra.qname` exactly before falling back to a unique label.
    importCollectionTarget();
    const codeIntelId = externalRows()[0].id;
    seedCaller();

    const { nodes, edges } = resolveRefs({
      db,
      refs: [{
        from_id: 'fn:caller', relation: 'CALLS', target: 'std::vector::push_back',
        source_file: 'src/a.cpp', source_line: 8, confidence: 0.7,
        provenance: 'EXTRACTED', extractor: 'cpp', language: 'cpp',
      }],
    });

    expect(edges).toHaveLength(1);
    expect(edges[0].to_id, 'the qualified ref must land on the collection node').toBe(codeIntelId);
    expect(nodes.filter((n) => n.type === 'External'), 'nothing may be minted').toHaveLength(0);
  });

  it('⛔⛔ and the graph still holds exactly ONE terminal for that label', () => {
    // The forking failure would leave two: the qname-derived node from the collection and a
    // family+label twin from tree-sitter, splitting the callers of one real function.
    importCollectionTarget();
    seedCaller();
    resolveRefs({ db, refs: [treeSitterRef()] });

    const pushBacks = externalRows().filter((n) => n.label === 'push_back');
    expect(pushBacks, 'one target, one terminal').toHaveLength(1);
  });

  it('⭐ the higher-provenance evidence survives the reuse', () => {
    // Reuse is only worth anything if it keeps what the collection knew. The qname is the part
    // tree-sitter cannot supply.
    importCollectionTarget();
    seedCaller();
    resolveRefs({ db, refs: [treeSitterRef()] });

    const row = db.get("SELECT extra FROM nodes WHERE type = 'External' AND label = 'push_back'");
    const extra = typeof row.extra === 'string' ? JSON.parse(row.extra) : row.extra;
    expect(extra.qname, 'the qname the collection carried must not be discarded')
      .toBe('std::vector::push_back');
    expect(extra.code_intel).toBe(true);
  });
});
