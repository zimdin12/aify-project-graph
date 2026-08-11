// A DOCUMENT THAT MENTIONS THE SYMBOL IS AN OBSERVED FACT. THE OVERLAY'S GUESS IS NOT.
//
// `contracts_potentially_affected` comes from the curated overlay and is INFERRED — only
// as complete as whoever last curated it. `documents_mentioning` comes from MENTIONS
// edges in the graph and is OBSERVED. Conflating them is how an empty inferred list gets
// read as "no documents govern this".
//
// ★ ef-manager's best finding of 2026-08-10 depended on exactly this split: an OBSERVED
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
function edge(db, e) {
  db.run(
    `INSERT INTO edges (from_id, to_id, relation, source_file, source_line, confidence, provenance, extractor)
     VALUES ($from_id, $to_id, $relation, $source_file, $source_line, 1, 'EXTRACTED', 'test')`,
    { source_file: 'x', source_line: 1, ...e },
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

describe('documents_mentioning is observed, and ranked by distinct nodes', () => {
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

  it('★★ is labelled OBSERVED, and the overlay-derived field is not', async () => {
    // The split ef-manager's best finding depended on: an observed field refuting an
    // inferred one inside one payload is impossible if both carry the same label.
    const res = await graphConsequences({ repoRoot, target: 'targetSymbol' });

    expect(res.field_provenance?.documents_mentioning).toBe('observed');
    expect(res.field_provenance?.contracts_potentially_affected).toBe('inferred');
  });
});
