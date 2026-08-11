// BEHAVIOURAL replacement for the source-grep half of tier-identity-check.test.js.
//
// graph-senior-dev's scope-4 audit (2026-08-10) found that 68 of 1,593 declared
// cases invoke ZERO production behaviour — they read implementation files and
// assert regexes, token order, or comments. All 68 would stay green if the named
// behaviour became unreachable while the matched source spelling survived.
//
// tier-identity-check.test.js was among them, and its worst case asserted on a
// production COMMENT:
//
//   expect(src).toMatch(/it is nothing,\s*\n?\s*\/\/ and the file must not be listed/)
//
// The `\/\/` in that regex is matching `//`. Delete the predicate, keep the
// comment, and the test passes. I wrote it the same day I shipped the fix it was
// meant to guard — the same stand-in defect the product has been fixed for all
// week, in the apparatus that is supposed to catch it.
//
// This file runs the code instead. It builds the exact shape the bug had — a test
// file whose only edge to the target is a symbol edge via a DIFFERENT symbol —
// and asserts the file is not listed.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphConsequences } from '../../../mcp/stdio/query/verbs/consequences.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

function initGit(repoRoot) {
  const runGit = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'ignore' });
  runGit('init', '-q');
  runGit('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init');
}

function insertNode(db, node) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id, $type, $label, $file_path, $start_line, $end_line, $language, $confidence, $extra)`,
    { start_line: 1, end_line: 1, language: 'cpp', confidence: 1, extra: '{}', ...node },
  );
}

function insertEdge(db, edge) {
  db.run(
    `INSERT INTO edges (from_id, to_id, relation, source_file, source_line, confidence, provenance, extractor)
     VALUES ($from_id, $to_id, $relation, $source_file, $source_line, $confidence, $provenance, $extractor)`,
    { source_line: 1, confidence: 1, provenance: 'EXTRACTED', extractor: 'test', ...edge },
  );
}

describe('tests_adjacent tiers — behaviour, not source text', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-tier-behav-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    initGit(repoRoot);
    const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
      schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    }));
  });

  afterEach(async () => {
    if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
  });

  it('★ a test file linked only via a DIFFERENT symbol is NOT listed', async () => {
    // The real shape of the echoes bug: tests/test_main.cpp had a CALLS edge to
    // `vec3` — a math type used by nearly every C++ file — and the tier reported
    // it as evidence that cylindricalLatBandsForBody was referenced.
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'target', type: 'Function', label: 'targetSymbol', file_path: 'src/target.cpp' });
    insertNode(db, { id: 'other', type: 'Class', label: 'vec3', file_path: 'src/math.h' });
    insertNode(db, { id: 'test', type: 'File', label: 'test_main.cpp', file_path: 'tests/test_main.cpp' });
    // The ONLY edge from the test file goes to `vec3`, never to the target.
    insertEdge(db, { from_id: 'test', to_id: 'other', relation: 'CALLS', source_file: 'tests/test_main.cpp' });
    db.close();

    const res = await graphConsequences({ repoRoot, target: 'targetSymbol' });

    expect(res.tests_adjacent, 'a vec3 edge is not evidence about targetSymbol').toEqual([]);
    expect(res.tests_adjacent_provenance).toBe('none');
  });

  it('★ and the no_test_coverage risk flag FIRES, because the false positive suppressed it', async () => {
    // The finding that outranked the fix: the false positive was not noise, it
    // DELETED a warning. With the bogus coverage claim gone, the safety flag that
    // it had been masking must appear.
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'target', type: 'Function', label: 'targetSymbol', file_path: 'src/target.cpp' });
    insertNode(db, { id: 'other', type: 'Class', label: 'vec3', file_path: 'src/math.h' });
    insertNode(db, { id: 'test', type: 'File', label: 'test_main.cpp', file_path: 'tests/test_main.cpp' });
    insertEdge(db, { from_id: 'test', to_id: 'other', relation: 'CALLS', source_file: 'tests/test_main.cpp' });
    db.close();

    const res = await graphConsequences({ repoRoot, target: 'targetSymbol' });

    expect(res.risk_flags.join(' ')).toMatch(/no_test_coverage/);
  });

  it('a test file that genuinely references the target IS listed', async () => {
    // The other half — the tightening must not delete true positives. Without
    // this, "list nothing" would pass the case above.
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'target', type: 'Function', label: 'targetSymbol', file_path: 'src/target.cpp' });
    insertNode(db, { id: 'test', type: 'File', label: 'test_target.cpp', file_path: 'tests/test_target.cpp' });
    insertEdge(db, { from_id: 'test', to_id: 'target', relation: 'CALLS', source_file: 'tests/test_target.cpp' });
    db.close();

    const res = await graphConsequences({ repoRoot, target: 'targetSymbol' });

    expect(res.tests_adjacent).toContain('tests/test_target.cpp');
    // NOT `import_linked` — there is no IMPORTS edge in this database at all. The
    // first run of this test returned `import_linked` here, which is how the
    // mislabel was found.
    expect(res.tests_adjacent_provenance).toBe('symbol_direct');
    expect(res.tests_adjacent_basis?.[0]).toMatchObject({
      test_file: 'tests/test_target.cpp', relation: 'CALLS', via_symbol: 'targetSymbol',
    });
  });

  it('★ the unverified caveat is ABSENT on verified linkage', async () => {
    // Behavioural replacement for framing-not-data.test.js's source-grep pair. That
    // one asserted the shape of the `testsUnverifiedForSymbol` declaration and broke
    // when the line was reflowed — while the behaviour it guarded got stricter.
    // A permanent caveat is noise, and noise on the trust surface is what makes real
    // banners ignorable. So the property is: verified linkage carries NO caveat.
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'target', type: 'Function', label: 'targetSymbol', file_path: 'src/target.cpp' });
    insertNode(db, { id: 'test', type: 'File', label: 'test_target.cpp', file_path: 'tests/test_target.cpp' });
    insertEdge(db, { from_id: 'test', to_id: 'target', relation: 'CALLS', source_file: 'tests/test_target.cpp' });
    db.close();

    const res = await graphConsequences({ repoRoot, target: 'targetSymbol' });

    expect(res.tests_adjacent_provenance).toBe('symbol_direct');
    expect(res.tests_adjacent_warning, 'a verified tier must not carry the caveat').toBeUndefined();
  });

  it('★ but an IMPORTS edge does NOT clear it — file evidence cannot discharge a symbol caveat', async () => {
    // ef-manager's granularity rule. `import_linked` is a true claim about the FILE;
    // `tests_unverified_for_symbol` is a claim about the SYMBOL. File-level evidence
    // cannot discharge it at any file size.
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'target', type: 'Function', label: 'targetSymbol', file_path: 'src/target.cpp' });
    insertNode(db, { id: 'src', type: 'File', label: 'target.cpp', file_path: 'src/target.cpp' });
    insertNode(db, { id: 'test', type: 'File', label: 'test_target.cpp', file_path: 'tests/test_target.cpp' });
    // A real structural include, and NOTHING touching the symbol itself.
    insertEdge(db, { from_id: 'test', to_id: 'src', relation: 'IMPORTS', source_file: 'tests/test_target.cpp' });
    db.close();

    const res = await graphConsequences({ repoRoot, target: 'targetSymbol' });

    expect(res.tests_adjacent_provenance).toBe('import_linked');
    expect(res.tests_adjacent_warning, 'file evidence must not clear a symbol caveat').toBeDefined();
  });

  it('★ and PRESENT when only a text mention was found', async () => {
    // The other half. Without it, deleting the warning entirely would pass the
    // case above — which is exactly how a caveat quietly disappears.
    //
    // NOTE ON THE TIER CHOSEN. This case was first written against
    // `symbol_referenced` and could not be made to fire. That is a real result, not
    // a fixture problem: after this morning's identity check, that tier requires
    // via_symbol to BE the target — and any edge satisfying it is also a direct edge
    // to the target symbol, so `symbol_direct` now takes it first. For FILE targets
    // `matchedSymbols` is empty, so it cannot fire there either. The tier is close to
    // unreachable, and I did not notice while its test grepped source text.
    // Logged for triage rather than deleted here; deletion is the team's call.
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'target', type: 'Function', label: 'targetSymbol', file_path: 'src/target.cpp' });
    // The mention search greps only files the graph already knows as File nodes with
    // a language — so the candidate list comes from the DB, not the working tree. A
    // test file present on disk but absent from the graph is invisible to this tier.
    insertNode(db, { id: 'tf', type: 'File', label: 'test_main.cpp', file_path: 'tests/test_main.cpp' });
    db.close();
    // No edges at all — only the name appearing in the test file's text.
    await mkdir(join(repoRoot, 'tests'), { recursive: true });
    await writeFile(join(repoRoot, 'tests', 'test_main.cpp'), 'void t() { targetSymbol(); }\n');

    const res = await graphConsequences({ repoRoot, target: 'targetSymbol' });

    expect(res.tests_adjacent_provenance).toBe('text_mentioned');
    // The caveat is TIER-SELECTED, so this asserts the text_mentioned wording rather
    // than the feature_declared one — a generic match would have passed against
    // either and so would not have caught a tier/warning mismatch.
    expect(res.tests_adjacent_warning).toMatch(/NAME appears in these tests as text, with no structural edge/);
  });
});
