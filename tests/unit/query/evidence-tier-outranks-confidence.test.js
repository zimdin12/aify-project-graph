import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';
import { graphPreflight } from '../../../mcp/stdio/query/verbs/preflight.js';
import { graphFile } from '../../../mcp/stdio/query/verbs/file.js';
import { provenanceRank, provenanceRankSql } from '../../../mcp/stdio/query/lsp-evidence.js';

// ⛔ CONFIDENCE IS NOT AN EVIDENCE TIER, AND TWO VERBS RANKED BY IT.
//
// Measured on the pinned click arm:
//
//     EXTRACTED     n=10976   conf 0.75..1.00  (avg 0.933)
//     LSP_VERIFIED  n=1460    conf 0.95..0.95  (avg 0.950)
//     AMBIGUOUS     n=1145    conf 0.75..0.95  (avg 0.930)
//
// The ranges overlap and the averages are indistinguishable, so `ORDER BY confidence DESC LIMIT n`
// cannot rank tiers — the candidates tie and SQLite breaks the tie arbitrarily.
//
// ⛔ WHAT THAT DID TO THE DELETION-SAFETY VERB. `graph_preflight("Context")` rendered five
// EXTRACTED callers, every one of them from a test file, while 124 LSP_VERIFIED callers existed on
// that same symbol in that same graph. The verified evidence was not missing — it lost a coin toss
// and was never shown. After the fix the same call returns five LSP_VERIFIED callers in
// src/click/core.py, each tagged.
//
// ⛔⛔ AND THE READER COULD NOT HAVE TOLD. `preflight` and `graph_file` build their edge lines by
// hand — `conf=` and nothing else — while the other eight verbs route through the shared renderer
// that tags provenance. `preflight`'s query SELECTED `e.provenance` and the render dropped it, so a
// heuristic caller and a compiler-verified one printed as byte-identical strings. That is the
// original "EXTRACTED and AMBIGUOUS are indistinguishable" finding, which was withdrawn TWICE after
// checking the shared renderer — the one place where it was already false.
//
// ⇒ The fixture below is built so confidence ALONE picks the wrong rows: the heuristic edges carry
// HIGHER confidence than the verified ones. A verb that still sorts by confidence returns the
// heuristic set and fails.

describe('evidence tier outranks confidence, and the tier is visible', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-tier-'));
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
      const node = (id, label, file_path) => ({
        id, type: 'Function', label, file_path,
        start_line: 1, end_line: 1, language: 'python', confidence: 1,
        structural_fp: '', dependency_fp: '', extra: {},
      });
      upsertNode(db, node('fn:target', 'target', 'src/target.py'));
      // graph_file resolves a File node, then queries the symbols declared in it.
      upsertNode(db, { ...node('file:target', 'target.py', 'src/target.py'), type: 'File' });

      // ⛔ THE INVERSION, MADE EXPLICIT. Six heuristic callers at conf=1.00, two verified at 0.95.
      // Sorted by confidence the verified pair is last and falls outside every top-5. Sorted by
      // tier it leads. Real graphs tie at 0.95 instead, which is the same defect with a coin toss
      // in place of a guarantee — this fixture just makes the failure deterministic.
      for (let i = 0; i < 6; i += 1) {
        upsertNode(db, node(`fn:h${i}`, `test_heuristic_${i}`, `tests/test_${i}.py`));
        upsertEdge(db, {
          from_id: `fn:h${i}`, to_id: 'fn:target', relation: 'CALLS',
          source_file: `tests/test_${i}.py`, source_line: 10 + i, confidence: 1.0,
          provenance: 'AMBIGUOUS', extractor: 'python',
        });
      }
      for (let i = 0; i < 2; i += 1) {
        upsertNode(db, node(`fn:v${i}`, `real_caller_${i}`, 'src/app.py'));
        upsertEdge(db, {
          from_id: `fn:v${i}`, to_id: 'fn:target', relation: 'CALLS',
          source_file: 'src/app.py', source_line: 100 + i, confidence: 0.95,
          provenance: 'LSP_VERIFIED', extractor: 'pyright#1',
        });
      }
    } finally { db.close(); }
  });

  afterEach(async () => {
    if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* ignore */ } }
  });

  describe('the ranking owner', () => {
    it('⭐ ranks compiler ground truth above the AST, and the AST above heuristics', () => {
      expect(provenanceRank('LSP_VERIFIED')).toBeGreaterThan(provenanceRank('EXTRACTED'));
      expect(provenanceRank('EXTRACTED')).toBeGreaterThan(provenanceRank('AMBIGUOUS'));
      expect(provenanceRank('EXTRACTED')).toBeGreaterThan(provenanceRank('INFERRED'));
    });

    it('⛔ an UNKNOWN provenance sorts LAST, never first', () => {
      // The fail-closed direction. A provenance this build has never heard of must not be promoted
      // above evidence we can vouch for — that would let a future tag manufacture trust silently.
      expect(provenanceRank('SOMETHING_NEW')).toBe(0);
      expect(provenanceRank(undefined)).toBe(0);
      expect(provenanceRank('SOMETHING_NEW')).toBeLessThan(provenanceRank('AMBIGUOUS'));
    });

    it('⛔ the SQL is GENERATED from the same map — not restated in a second language', () => {
      // A hand-written CASE would be a parallel list to keep in sync, which is a defect with a
      // delay on it. Every tier in the map must appear in the generated expression.
      const sql = provenanceRankSql('e.provenance');
      for (const p of ['LSP_VERIFIED', 'EXTRACTED', 'INFERRED', 'AMBIGUOUS']) {
        expect(sql).toContain(`'${p}' THEN ${provenanceRank(p)}`);
      }
      expect(sql).toContain('ELSE 0');
    });

    it('⛔ it refuses to interpolate anything that is not a plain column name', () => {
      // The expression is string-interpolated into SQL, so the guard is the only thing between it
      // and an injection if a call site ever passes a value instead of a literal.
      expect(() => provenanceRankSql('provenance')).not.toThrow();
      expect(() => provenanceRankSql('e.provenance')).not.toThrow();
      expect(() => provenanceRankSql('e.provenance; DROP TABLE nodes')).toThrow();
      expect(() => provenanceRankSql('(SELECT 1)')).toThrow();
      expect(() => provenanceRankSql('')).toThrow();
    });
  });

  describe('graph_preflight — the verb that answers "is this safe to change"', () => {
    it('⛔ shows the VERIFIED callers, not the higher-confidence heuristic ones', async () => {
      const out = await graphPreflight({ repoRoot, symbol: 'target' });
      const shown = String(out).split('\n').filter((l) => /conf=/.test(l));

      expect(shown.length).toBeGreaterThan(0);
      // Both verified callers must appear despite carrying the LOWER confidence.
      expect(shown.filter((l) => /real_caller_/.test(l))).toHaveLength(2);
      // And they must lead — a reader who stops after the first line still sees the best evidence.
      expect(shown[0]).toMatch(/real_caller_/);
    });

    it('⛔ TAGS the tier — the row already carried provenance and the render dropped it', async () => {
      const out = await graphPreflight({ repoRoot, symbol: 'target' });
      const shown = String(out).split('\n').filter((l) => /conf=/.test(l));

      // Verified lines are marked, so an agent can tell ground truth from a guess at a glance.
      for (const l of shown.filter((x) => /real_caller_/.test(x))) expect(l).toMatch(/\[lsp/);
      // Heuristic lines are marked as heuristic — not silently equal to the verified ones.
      for (const l of shown.filter((x) => /test_heuristic_/.test(x))) expect(l).toMatch(/prov=AMBIGUOUS/);
    });

    it('⭐ THE TAG DISCRIMINATES: it is neither always-on nor always-off', async () => {
      // Each assertion above passes for a renderer that stamps every line. Counting both outcomes
      // in one pass is the cheapest proof the tag tracks the data.
      const shown = String(await graphPreflight({ repoRoot, symbol: 'target' }))
        .split('\n').filter((l) => /conf=/.test(l));
      const verified = shown.filter((l) => /\[lsp/.test(l));
      const heuristic = shown.filter((l) => /prov=AMBIGUOUS/.test(l));
      expect(verified.length).toBeGreaterThan(0);
      expect(heuristic.length).toBeGreaterThan(0);
      expect(verified.length + heuristic.length).toBe(shown.length);
    });
  });

  describe('graph_file — the same hand-rolled line, the same two defects', () => {
    it('⛔ ranks incoming edges by tier and tags them', async () => {
      const out = await graphFile({ repoRoot, path: 'src/target.py', top_k: 3 });
      const shown = String(out).split('\n').filter((l) => /conf=/.test(l));

      expect(shown.length).toBeGreaterThan(0);
      // top_k=3 with 8 candidates means truncation fires: both verified edges must survive it.
      expect(shown.filter((l) => /real_caller_/.test(l))).toHaveLength(2);
      for (const l of shown.filter((x) => /real_caller_/.test(x))) expect(l).toMatch(/\[lsp/);
    });
  });
});
