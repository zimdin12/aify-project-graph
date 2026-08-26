import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';
import { graphCallers } from '../../../mcp/stdio/query/verbs/callers.js';
import { graphPreflight } from '../../../mcp/stdio/query/verbs/preflight.js';
import { EXECUTION_FAMILY, CALL_FAMILY } from '../../../mcp/stdio/storage/taxonomy.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

// ⛔ "NO CALLERS" IS AN ABSENCE CLAIM AND ITS POPULATION WAS INVISIBLE.
//
// `graph_callers` walks the STRICT call graph — CALLS / INVOKES / PASSES_THROUGH — which is a
// deliberate, documented choice. The absence message said "NO CALLERS", and the trust caveat under
// it speaks only about EVIDENCE DEPTH ("heuristic, not exhaustive, verify with rg"). Nothing said a
// whole relation had never been consulted, so a reader learns the list might be short and never
// learns which question was asked.
//
// ⛔⛔ MEASURED THROUGH THE VERB ON FOUR PINNED REPOSITORIES: 381 labels carry a REFERENCES edge and
// no execution edge — click 272, fast-route 68, p-queue 26, fmt 15 — and the verb answers
// "NO CALLERS" for the great majority. `graph_preflight` counts the WIDER family, so the two
// contradicted each other on the same symbol in the same graph:
//
//     graph_callers("Class2")    ->  NO CALLERS for "Class2"
//     graph_preflight("Class2")  ->  CALLERS 1 total
//
// ⇒ Same shape as the LINKS_TO precedent recorded in taxonomy.js: "nothing in the receipt could
// tell 'the list was cut short' from 'a source was never consulted'."
//
// ⭐ CONTROLS TAKEN IN THE SAME PASS ON click, before this file existed: 29 of 29 symbols carrying a
// REFERENCES edge got the SCOPE line, and 29 of 29 whose only inbound edge was DEFINES correctly did
// not. A first attempt at that negative control examined ZERO symbols — every node has an inbound
// DEFINES edge, so "no edges at all" is an empty population — and an empty control proves nothing.

describe('an absence claim names the population it searched', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-absence-pop-'));
    const run = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'ignore' });
    run('init', '-q');
    run('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init');
    mkdirSync(join(repoRoot, '.aify-graph'), { recursive: true });
    const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    writeFileSync(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
      schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    }));

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      const node = (id, label, file_path, type = 'Class') => ({
        id, type, label, file_path, start_line: 1, end_line: 1,
        language: 'python', confidence: 1, structural_fp: '', dependency_fp: '', extra: {},
      });
      // ReferencedOnly — the observed shape: a test names the class but never calls it.
      upsertNode(db, node('cls:refonly', 'ReferencedOnly', 'src/app.py'));
      upsertNode(db, node('fn:atest', 'test_uses_it', 'tests/test_app.py', 'Test'));
      upsertEdge(db, {
        from_id: 'fn:atest', to_id: 'cls:refonly', relation: 'REFERENCES',
        source_file: 'tests/test_app.py', source_line: 12, confidence: 0.95,
        provenance: 'EXTRACTED', extractor: 'python',
      });

      // TrulyUnused — an inbound edge exists, but in NEITHER family. This is the negative control,
      // and it is deliberately not "a node with no edges": every real node has an inbound DEFINES,
      // so that population is empty and a control drawn from it never runs.
      upsertNode(db, node('cls:unused', 'TrulyUnused', 'src/app.py'));
      upsertNode(db, node('file:app', 'app.py', 'src/app.py', 'File'));
      upsertEdge(db, {
        from_id: 'file:app', to_id: 'cls:unused', relation: 'DEFINES',
        source_file: 'src/app.py', source_line: 40, confidence: 1,
        provenance: 'EXTRACTED', extractor: 'python',
      });
    } finally { db.close(); }
  });

  afterEach(async () => {
    if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* ignore */ } }
  });

  it('⛔ says NO CALLERS and then names what it did not search', async () => {
    const out = String(await graphCallers({ repoRoot, symbol: 'ReferencedOnly' }));

    expect(out).toMatch(/^NO CALLERS/m);
    expect(out).toMatch(/^SCOPE: /m);
    // The searched family and the skipped one are both named, with the count the graph holds.
    for (const r of EXECUTION_FAMILY) expect(out).toContain(r);
    expect(out).toContain('REFERENCES');
    expect(out).toMatch(/1 REFERENCES/);
    // And it says plainly what the absence does NOT mean.
    expect(out).toMatch(/does NOT mean/i);
  });

  it('⛔ THE REGRESSION GUARD FOR A FAIL-SILENT BUG: the note survives the async boundary', async () => {
    // The first working version read the database AFTER an `await`. Callers `return` this async
    // function's promise, so the enclosing `finally { db.close() }` had already run — every call
    // threw "The database connection is not open" and the catch returned ''. The output was
    // byte-identical to having no feature at all, and only removing the catch revealed it.
    //
    // ⇒ A fail-silent path cannot be verified by observing it. This asserts the line is PRESENT.
    const out = String(await graphCallers({ repoRoot, symbol: 'ReferencedOnly' }));
    expect(out).toMatch(/^SCOPE: this verb searched/m);
  });

  it('⭐ NEGATIVE CONTROL: a symbol with no edge in either family gets NO scope line', async () => {
    // Without this, the assertions above are satisfied by a verb that appends SCOPE unconditionally.
    const out = String(await graphCallers({ repoRoot, symbol: 'TrulyUnused' }));
    expect(out).toMatch(/^NO CALLERS/m);
    expectAbsentWithLiveMatcher(
      /^SCOPE: /m,
      {
        forbidden: 'SCOPE: this verb searched the strict call graph (CALLS/INVOKES/PASSES_THROUGH)',
        allowed: 'TRUST: absence is from the heuristic graph and is NOT exhaustive',
      },
      out,
      'a symbol with nothing in the wider family must not be given a scope caveat',
    );
  });

  it('⛔ the skipped relations are DERIVED from the taxonomy, not restated', async () => {
    // If a relation joins CALL_FAMILY tomorrow, the note must cover it with no edit here. Asserting
    // against a literal list would pass while the feature silently stopped being complete.
    const skipped = CALL_FAMILY.filter((r) => !EXECUTION_FAMILY.includes(r));
    expect(skipped.length).toBeGreaterThan(0);
    const out = String(await graphCallers({ repoRoot, symbol: 'ReferencedOnly' }));
    for (const r of skipped) expect(out).toContain(r);
  });

  it('⛔ THE CONTRADICTION IS GONE: the two verbs still differ, and now say why', async () => {
    // preflight legitimately counts the WIDER family — that is its job. The defect was that both
    // used the bare word "callers" for two different populations with nothing to reconcile them.
    const callers = String(await graphCallers({ repoRoot, symbol: 'ReferencedOnly' }));
    const preflight = String(await graphPreflight({ repoRoot, symbol: 'ReferencedOnly' }));

    expect(callers).toMatch(/^NO CALLERS/m);       // strict call graph: genuinely none
    expect(preflight).toMatch(/^CALLERS 1 total/m); // wider family: one
    // The reconciliation an agent needs is present in the narrower answer.
    expect(callers).toMatch(/^SCOPE: /m);
    // ⚠ The remedy names graph_impact, NOT graph_preflight: the default tool profile does not list
    // preflight, and the repo's remedy-reachability guard rejects pointing a reader at a verb they
    // cannot call. The reconciliation still has to be reachable, so it names the one that is.
    expect(callers).toContain('graph_impact');
  });

  it('⛔ preflight counts the WIDER family — derived, so it cannot drift from graph_callers', async () => {
    const out = String(await graphPreflight({ repoRoot, symbol: 'ReferencedOnly' }));
    // A REFERENCES-only symbol is counted, which is exactly what EXECUTION_FAMILY alone would miss.
    expect(out).toMatch(/^CALLERS 1 total/m);
    expect(out).toMatch(/test_uses_it/);
  });
});
