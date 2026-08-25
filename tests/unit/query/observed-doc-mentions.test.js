// A DOC MENTION IS TWO FACTS, AND THE FIELD USED TO REPORT ONLY THE STRONGER ONE.
//
// The span EXISTS in the document — observed, and the edge stores the line so anyone can open
// it. The span REFERS TO THIS NODE — inferred, because a resolution rule ran. The field label
// was hardcoded `observed`, which reported the first half and dropped the second.
//
// Under the legacy extractor that was flatly false: a document containing the word "read" was
// labelled an OBSERVED reference to the function `read`. dev's ruling for the replacement is
// explicit — `provenance: INFERRED`, "the occurrence is observed; the identity mapping is
// inferred" — so the label is now DERIVED from the edges rather than asserted.
//
// ⚠ THE SPLIT THAT MATTERED STILL HOLDS, and it is why this file exists.
// `contracts_potentially_affected` comes from the curated overlay and is INFERRED — only as
// complete as whoever last curated it. Conflating the two is how an empty inferred list gets
// read as "no documents govern this". The two fields still disagree; the difference is that
// one of them now earns its label instead of claiming it.
//
// ★ the field test's best finding of 2026-08-10 depended on exactly this split: an OBSERVED
// field refuting an INFERRED one inside a single payload. That is impossible if both
// carry the same provenance label.
//
// ★★ CONVERTED FROM SOURCE-GREP 2026-08-11.
//
// The previous version asserted SQL fragments (`e.relation = 'MENTIONS'`,
// `COUNT(DISTINCT n.id) AS mention_count`, `ORDER BY mention_count DESC`) and variable
// names (`declaredDocSet`, `fileLabelRows`) over consequences.js. Those pin an
// implementation's spelling: rewrite the query with a JOIN or rename a local and the test
// goes red having found no defect, while a genuinely wrong ranking sails through.
//
// This builds a graph where the RIGHT ANSWER IS ORDER-SENSITIVE — one document mentions
// the target through many distinct nodes, another through many duplicate rows for the
// same node — so a count that fails to say DISTINCT ranks them the wrong way round.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphConsequences } from '../../../mcp/stdio/query/verbs/consequences.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;

function node(db, n) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id, $type, $label, $file_path, $start_line, $end_line, 'js_ts', 1, '{}')`,
    { start_line: 1, end_line: 1, ...n },
  );
}
// ⛔ THE PROVENANCE IS A PARAMETER, AND IT USED TO BE THE STRING 'EXTRACTED'.
//
// Production MENTIONS edges are INFERRED — dev's ruling: "the occurrence is observed; the
// identity mapping is inferred". This fixture asserted a shape production never emits, and the
// assertion below that the field is labelled `observed` PASSED because of it.
//
// That is the same defect that hid the doc-link layer for a day: a fixture inventing `File` nodes
// for `.md` paths while the indexer only ever made `Document` nodes, so 0 of 68 links resolved
// under a green suite. A fixture that does not mirror the producer tests the fixture.
function edge(db, e) {
  db.run(
    `INSERT INTO edges (from_id, to_id, relation, source_file, source_line, confidence, provenance, extractor)
     VALUES ($from_id, $to_id, $relation, $source_file, $source_line, 1, $provenance, 'test')`,
    { source_file: 'x', source_line: 1, provenance: 'INFERRED', ...e },
  );
}

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-docmentions-'));
  await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repoRoot, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoRoot, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'init'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));

  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  // The target, plus three sibling symbols in the same file.
  node(db, { id: 'target', type: 'Function', label: 'targetSymbol', file_path: 'src/target.js' });
  node(db, { id: 's1', type: 'Function', label: 'sib1', file_path: 'src/target.js' });
  node(db, { id: 's2', type: 'Function', label: 'sib2', file_path: 'src/target.js' });
  node(db, { id: 's3', type: 'Function', label: 'sib3', file_path: 'src/target.js' });

  node(db, { id: 'deep', type: 'Document', label: 'deep.md', file_path: 'docs/deep.md' });
  node(db, { id: 'shallow', type: 'Document', label: 'shallow.md', file_path: 'docs/shallow.md' });

  // deep.md mentions FOUR DISTINCT nodes → distinct count 4, row count 4.
  for (const t of ['target', 's1', 's2', 's3']) {
    edge(db, { from_id: 'deep', to_id: t, relation: 'MENTIONS' });
  }
  // shallow.md mentions ONE node.
  //
  // ⚠ THE FIXTURE I FIRST WROTE WAS IMPOSSIBLE, AND FINDING OUT IS A RESULT. I tried to
  // make shallow.md mention the SAME node six times, so a raw row count would outrank
  // deep.md's four distinct nodes and a COUNT(DISTINCT) would not. SQLite refused:
  //
  //     UNIQUE constraint failed: edges.from_id, edges.to_id, edges.relation
  //
  // The schema makes duplicate MENTIONS rows unrepresentable, so row-count inflation
  // cannot happen by that route at all — and the query's OWN COMMENT says so: "MENTIONS
  // is deduped per (document, node) pair, so a raw row count is 1 for every doc and the
  // ranking carries no signal." The DISTINCT is what makes breadth measurable, and the
  // old test asserted its spelling without ever exercising the ranking it produces.
  //
  // ⇒ So this fixture tests what IS discriminable: ranking by how many distinct symbols a
  // document actually mentions. Recorded rather than quietly dropped, because "the
  // assertion could not be made behavioural" is a finding about the assertion.
  //
  // ⚠ AND THE SECOND FIXTURE WAS ALSO WRONG: a single mention is below the weak-signal
  // FLOOR and is dropped entirely, so the list came back with one entry and nothing to
  // rank. That floor is correct behaviour — it is what stops a passing reference being
  // reported as a governing document — but it means a ranking test needs BOTH documents
  // above it. So shallow.md mentions three symbols and deep.md four.
  for (const t of ['target', 's1', 's2']) {
    edge(db, { from_id: 'shallow', to_id: t, relation: 'MENTIONS' });
  }
  db.close();
});

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
});

describe('documents_mentioning takes the provenance of its edges, and ranks by distinct nodes', () => {
  it('★★ ranks by how many symbols a document actually mentions', async () => {
    const res = await graphConsequences({ repoRoot, target: 'targetSymbol' });
    const docs = res.documents_mentioning;

    // Harness sanity first: if the MENTIONS query returns nothing, every ordering
    // assertion below passes vacuously — which is how a source-grep version stays green.
    expect(docs, 'the fixture must produce mentioning documents').toBeTruthy();
    const paths = (Array.isArray(docs) ? docs : docs.items ?? []).map((d) => (typeof d === 'string' ? d : d.path ?? d.file ?? JSON.stringify(d)));
    expect(paths.length, 'both documents mention the target').toBeGreaterThanOrEqual(2);

    const deepAt = paths.findIndex((p) => p.includes('deep.md'));
    const shallowAt = paths.findIndex((p) => p.includes('shallow.md'));
    expect(deepAt, 'deep.md must be present').toBeGreaterThanOrEqual(0);
    expect(shallowAt, 'shallow.md must be present').toBeGreaterThanOrEqual(0);
    // 4 mentioned symbols beats 1.
    expect(deepAt, 'the document mentioning more of this file must rank first').toBeLessThan(shallowAt);
  });

  it('★★ carries the provenance OF ITS EDGES, and still differs from the overlay field', async () => {
    // The split the field test's best finding depended on: an observed field refuting an
    // inferred one inside one payload is impossible if both carry the same label. That
    // split survives — these two still disagree — but the label is now earned rather than
    // asserted.
    const res = await graphConsequences({ repoRoot, target: 'targetSymbol' });

    expect(res.field_provenance?.documents_mentioning,
      'derived from the edges: production MENTIONS edges are INFERRED').toBe('inferred');
    expect(res.field_provenance?.contracts_potentially_affected).toBe('inferred');
  });

  it('★★★ an OBSERVED doc edge produces an OBSERVED label — the derivation runs both ways',
    async () => {
      // ⛔ WITHOUT THIS, THE PREVIOUS TEST ONLY PROVES I SWAPPED ONE HARDCODED STRING FOR
      // ANOTHER. `documents_mentioning: 'observed'` was a constant; replacing it with a
      // constant `'inferred'` would satisfy every assertion above and be exactly as wrong
      // the moment a curated overlay emits a doc edge.
      //
      // So this feeds the OTHER input and demands the other answer. It is the negative
      // control on a derivation: a rule that cannot produce both outcomes is not deriving
      // anything, it is a literal with extra steps.
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      db.run("UPDATE edges SET provenance = 'EXTRACTED' WHERE relation = 'MENTIONS'");
      db.close();

      const res = await graphConsequences({ repoRoot, target: 'targetSymbol' });
      expect(res.field_provenance?.documents_mentioning,
        'the label follows the edges, in both directions').toBe('observed');
    });

  it('★★★ a document mentioning ONE symbol is no longer dropped', async () => {
    // ⛔ THE FLOOR OF 3 WAS CALIBRATED ON AN EXTRACTOR THAT NO LONGER EXISTS. It suppressed
    // the legacy rule's long tail of word collisions — a document containing "read" got an
    // edge to the function `read`, so one mention meant nothing. Rule 2 requires the author
    // to have marked the span as code AND written it qualified AND for it to resolve to
    // exactly one node, so ONE reference now clears a higher bar than three collisions did.
    //
    // ★ AND THE STALE FLOOR FAILED IN THE REASSURING DIRECTION. Rule 2 emits 1 edge on this
    // repo; under a floor of 3, every caller would have received `documents_mentioning: []`
    // and read it as "no document governs this". The omission note only fires when
    // something was omitted, so nothing would have said otherwise.
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    node(db, { id: 'thin', type: 'Document', label: 'thin.md', file_path: 'docs/thin.md' });
    edge(db, { from_id: 'thin', to_id: 'target', relation: 'MENTIONS' });
    db.close();

    const res = await graphConsequences({ repoRoot, target: 'targetSymbol' });
    const paths = res.documents_mentioning.map((d) => d.file);
    expect(paths, 'a single qualified reference is a real reference').toContain('docs/thin.md');
  });

  it('★★★ the internal provenance carrier never reaches the caller', async () => {
    // It exists only to derive the field label. Shipping it would invite a consumer to
    // branch on an undocumented field that the contract does not promise.
    const res = await graphConsequences({ repoRoot, target: 'targetSymbol' });
    for (const d of res.documents_mentioning) {
      expect(Object.keys(d), 'edge_provenance is a carrier, not part of the contract')
        .not.toContain('edge_provenance');
    }
  });
});
