// Code-Intel v2 / L2b — make clangd-derived LSP_VERIFIED edges VISIBLE and
// TRUSTWORTHY in the agent-facing verbs.
//
// Asserts:
//   (a) graph_callers marks the lsp-verified edge ([lsp✓]) AND emits the
//       `TRUST: lsp-verified (...)` banner naming the compile-db hash.
//   (b) a heuristic-only symbol emits the `TRUST: heuristic only (...)`
//       undercount caveat (and never the lsp banner).
//   (c) lsp-verified edges rank ABOVE heuristic ones (and are never the first
//       dropped under budget).
//
// Producer side (LSP_VERIFIED edges + code_intel_collections row) landed in
// L2a; this is the L2b consumer-surface test.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';
import { graphCallers } from '../../../mcp/stdio/query/verbs/callers.js';
import { graphCallees } from '../../../mcp/stdio/query/verbs/callees.js';
import { graphNeighbors } from '../../../mcp/stdio/query/verbs/neighbors.js';
import { graphImpact } from '../../../mcp/stdio/query/verbs/impact.js';
import { rankCallers } from '../../../mcp/stdio/query/rank.js';
import { enforceBudget } from '../../../mcp/stdio/query/budget.js';

const COMPILE_DB_HASH = 'deadbeefcafef00d';

describe('Code-Intel v2 L2b — LSP_VERIFIED surface', () => {
  let repoRoot;
  let head;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-lsp-surface-'));
    const run = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'ignore' });
    run('init', '-q');
    run('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init');
    head = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

    mkdirSync(join(repoRoot, '.aify-graph'), { recursive: true });
    writeFileSync(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: head, indexedAt: new Date().toISOString(),
      nodes: 0, edges: 0,
      schemaVersion: 4, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    }));

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      const node = (id, label, file_path) => ({
        id, type: 'Function', label, file_path,
        start_line: 1, end_line: 1, language: 'cpp', confidence: 1,
        structural_fp: '', dependency_fp: '', extra: {},
      });
      // Symbol WITH lsp-verified evidence: `RenderPass::execute` has one
      // clangd-verified caller and one heuristic caller.
      upsertNode(db, node('fn:lspVerifiedCaller', 'DispatchFrame', 'src/dispatch.cpp'));
      upsertNode(db, node('fn:heuristicCaller', 'maybeCaller', 'src/guess.cpp'));
      upsertNode(db, node('fn:target', 'execute', 'src/renderpass.cpp'));

      upsertEdge(db, {
        from_id: 'fn:lspVerifiedCaller', to_id: 'fn:target', relation: 'CALLS',
        source_file: 'src/dispatch.cpp', source_line: 42, confidence: 0.5,
        provenance: 'LSP_VERIFIED', extractor: `cpp-clangd#${COMPILE_DB_HASH.slice(0, 8)}`,
      });
      upsertEdge(db, {
        from_id: 'fn:heuristicCaller', to_id: 'fn:target', relation: 'CALLS',
        source_file: 'src/guess.cpp', source_line: 7, confidence: 0.99,
        provenance: 'INFERRED', extractor: 'cpp',
      });

      // ALL-VERIFIED symbol: `cleanExecute` has a single clangd-verified caller
      // and NO heuristic edges — the only shape that may earn the index-ready
      // "exhaustive" attestation (audit 2026-06-12 B4).
      upsertNode(db, node('fn:cleanCaller', 'CleanDispatch', 'src/clean.cpp'));
      upsertNode(db, node('fn:cleanTarget', 'cleanExecute', 'src/cleanpass.cpp'));
      upsertEdge(db, {
        from_id: 'fn:cleanCaller', to_id: 'fn:cleanTarget', relation: 'CALLS',
        source_file: 'src/clean.cpp', source_line: 11, confidence: 0.5,
        provenance: 'LSP_VERIFIED', extractor: `cpp-clangd#${COMPILE_DB_HASH.slice(0, 8)}`,
      });

      // Heuristic-ONLY symbol: `parseConfig` has a single INFERRED caller and
      // no clangd evidence at all.
      upsertNode(db, node('fn:plainCaller', 'bootstrap', 'src/boot.cpp'));
      upsertNode(db, node('fn:plainTarget', 'parseConfig', 'src/config.cpp'));
      upsertEdge(db, {
        from_id: 'fn:plainCaller', to_id: 'fn:plainTarget', relation: 'CALLS',
        source_file: 'src/boot.cpp', source_line: 3, confidence: 0.8,
        provenance: 'INFERRED', extractor: 'cpp',
      });

      // Heuristic-only ISOLATED symbol: a node with NO edges at all, so the
      // traversal verbs hit their empty-result/absence path (I1).
      upsertNode(db, node('fn:islandTarget', 'isolatedFn', 'src/island.cpp'));

      // A fresh clangd collection row vouching for the LSP_VERIFIED edge.
      db.run(
        `INSERT INTO code_intel_collections
           (collection_id, provider, provider_version, project_root, language, status,
            freshness_basis, freshness_value, compile_db_hash, indexed_commit,
            operations_json, collected_at, errors_json)
         VALUES ($id, $provider, $pv, $root, $lang, $status,
            $fb, $fv, $hash, $commit, $ops, $at, NULL)`,
        {
          id: 'ci-1', provider: 'cpp-clangd', pv: '0.1.0', root: repoRoot, lang: 'cpp',
          status: 'ok', fb: 'compile_db_hash', fv: COMPILE_DB_HASH, hash: COMPILE_DB_HASH,
          commit: head, ops: JSON.stringify({ calls: { status: 'ok', count: 1 } }),
          at: new Date().toISOString(),
        },
      );
    } finally {
      db.close();
    }
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('(a) marks the lsp edge and shows the lsp-verified TRUST line', async () => {
    const out = await graphCallers({ repoRoot, symbol: 'execute' });
    expect(typeof out).toBe('string');
    // Edge marker: clangd ground truth is tagged distinctly.
    expect(out).toContain('[lsp✓]');
    // TRUST banner names the provider + compile-db hash (8 chars).
    expect(out).toMatch(/TRUST: lsp-verified \(cpp-clangd, compile-db deadbeef, collected /);
    // Fresh collection (HEAD == indexed_commit, hash matches) → NOT stale.
    expect(out).not.toContain('STALE');
    // It must NOT fall back to the heuristic-only caveat.
    expect(out).not.toContain('heuristic only');
  });

  it('(b) heuristic-only symbol shows the undercount caveat, not the lsp line', async () => {
    const out = await graphCallers({ repoRoot, symbol: 'parseConfig' });
    expect(typeof out).toBe('string');
    expect(out).toContain('TRUST: heuristic only (tree-sitter)');
    expect(out).toContain('graph_collect_code_intel');
    expect(out).not.toContain('[lsp✓]');
    expect(out).not.toContain('lsp-verified');
  });

  it('(d) FIX A/B: indexReady=true + ALL-verified result → "index-ready, N callers" attestation', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      // Stamp the existing collection as index-ready with the new columns.
      db.run(`UPDATE code_intel_collections SET index_ready = 1, mode = 'indexed', refs_found = 5, refs_not_found = 0 WHERE collection_id = 'ci-1'`);
    } finally {
      db.close();
    }
    // cleanExecute has ONLY an LSP_VERIFIED caller → clean set → exhaustive banner.
    const out = await graphCallers({ repoRoot, symbol: 'cleanExecute' });
    expect(out).toContain('[lsp✓]');
    expect(out).toMatch(/TRUST: lsp-verified \(cpp-clangd, index-ready, \d+ caller/);
    expect(out).not.toContain('lsp-partial');
  });

  it('(d2) B4: indexReady=true but MIXED verified+heuristic result → lsp-partial FLOOR, not exhaustive', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      db.run(`UPDATE code_intel_collections SET index_ready = 1, mode = 'indexed', refs_found = 5, refs_not_found = 0 WHERE collection_id = 'ci-1'`);
    } finally {
      db.close();
    }
    // `execute` has one LSP_VERIFIED + one heuristic caller — must NOT earn the
    // "index-ready, N callers" delete-licensing banner.
    const out = await graphCallers({ repoRoot, symbol: 'execute' });
    expect(out).toContain('[lsp✓]');           // the verified edge is still marked
    expect(out).toContain('lsp-partial');       // but the banner is a floor
    expect(out).toMatch(/FLOOR/);
    expect(out).not.toMatch(/TRUST: lsp-verified \(cpp-clangd, index-ready, \d+ caller/);
  });

  it('(e) FIX A/B: indexReady=false → lsp-partial "index NOT ready" banner', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      db.run(`UPDATE code_intel_collections SET index_ready = 0, mode = 'indexed', refs_found = 1, refs_not_found = 3 WHERE collection_id = 'ci-1'`);
    } finally {
      db.close();
    }
    const out = await graphCallers({ repoRoot, symbol: 'execute' });
    // Still surfaces the verified edge, but the banner is HONEST that the
    // index was not ready and the set may undercount.
    expect(out).toContain('[lsp✓]');
    expect(out).toContain('TRUST: lsp-partial');
    expect(out).toContain('index NOT ready');
    expect(out).toContain('re-collect');
    expect(out).toMatch(/3 symbol\(s\) unresolved/);
    expect(out).not.toMatch(/TRUST: lsp-verified/);
  });

  // I1 / R2-2026-05-31 — absence claims are the most dangerous output (an agent
  // may delete on them). On a heuristic-only symbol with NO edges, callers/
  // callees/neighbors/impact must NOT return a bare "NO …" line: it must carry
  // the heuristic non-exhaustive caveat + a verify hint (code_intel_references /
  // rg). CRITICALLY: graph-edge traversal NEVER claims an exhaustive/trustworthy
  // absence even when an index-ready collection exists — that was the HIGH-
  // severity R2 trust bug (a repo-level index-ready signal is not evidence THIS
  // symbol's callers were exhaustively resolved by clangd).
  describe('(I1) ungated absence claims', () => {
    it('graph_callers absence carries the non-exhaustive verify caveat', async () => {
      const out = await graphCallers({ repoRoot, symbol: 'isolatedFn' });
      expect(out).toContain('NO CALLERS');
      expect(out).toMatch(/NOT exhaustive/);
      expect(out).toMatch(/code_intel_references|verify with rg/);
      expect(out).not.toMatch(/TRUSTWORTHY|exhaustive absence|lsp-verified-exhaustive/);
    });

    it('graph_callees absence carries the non-exhaustive verify caveat', async () => {
      const out = await graphCallees({ repoRoot, symbol: 'isolatedFn' });
      expect(out).toContain('NO CALLEES');
      expect(out).toMatch(/NOT exhaustive/);
      expect(out).toMatch(/code_intel_references|verify with rg/);
      expect(out).not.toMatch(/TRUSTWORTHY|exhaustive absence|lsp-verified-exhaustive/);
    });

    it('graph_neighbors absence carries the non-exhaustive verify caveat', async () => {
      const out = await graphNeighbors({ repoRoot, symbol: 'isolatedFn' });
      expect(out).toContain('NO NEIGHBORS');
      expect(out).toMatch(/NOT exhaustive/);
      expect(out).toMatch(/code_intel_references|verify with rg/);
      expect(out).not.toMatch(/TRUSTWORTHY|exhaustive absence|lsp-verified-exhaustive/);
    });

    it('graph_impact absence carries the non-exhaustive verify caveat', async () => {
      const out = await graphImpact({ repoRoot, symbol: 'isolatedFn' });
      expect(out).toContain('NO IMPACT');
      expect(out).toMatch(/NOT exhaustive/);
      expect(out).toMatch(/code_intel_references|verify with rg/);
      expect(out).not.toMatch(/TRUSTWORTHY|exhaustive absence|lsp-verified-exhaustive/);
    });

    // R2-2026-05-31 HIGH bug repro: an INDEX-READY collection must NOT flip the
    // graph-traversal absence to a "trustworthy/exhaustive" claim. This is the
    // assertion that was testing the bug (it used to expect TRUSTWORTHY); it now
    // asserts the honest heuristic caveat regardless of index readiness.
    it('graph_callers absence stays heuristic even with an index-ready collection', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      try {
        db.run(`UPDATE code_intel_collections SET index_ready = 1, mode = 'indexed', refs_found = 5, refs_not_found = 0 WHERE collection_id = 'ci-1'`);
      } finally {
        db.close();
      }
      const out = await graphCallers({ repoRoot, symbol: 'isolatedFn' });
      expect(out).toContain('NO CALLERS');
      expect(out).toMatch(/NOT exhaustive/);
      expect(out).toContain('code_intel_references');
      // The disqualifying false claim must never appear from a graph verb.
      expect(out).not.toMatch(/TRUSTWORTHY/);
      expect(out).not.toMatch(/exhaustive absence/);
      expect(out).not.toMatch(/lsp-verified-exhaustive/);
    });
  });

  it('(c) lsp-verified edges rank above heuristic edges', () => {
    // Heuristic edge has HIGHER confidence (0.99) than the verified edge (0.5);
    // verified must still sort first because it is ground truth.
    const edges = [
      { from_label: 'maybeCaller', provenance: 'INFERRED', confidence: 0.99, depth: 1 },
      { from_label: 'DispatchFrame', provenance: 'LSP_VERIFIED', confidence: 0.5, depth: 1 },
    ];
    const ranked = rankCallers(edges);
    expect(ranked[0].provenance).toBe('LSP_VERIFIED');

    // And under a budget of 1, the heuristic edge is the one dropped.
    const { kept, dropped } = enforceBudget(edges, 1);
    expect(kept).toHaveLength(1);
    expect(kept[0].provenance).toBe('LSP_VERIFIED');
    expect(dropped).toBe(1);
  });
});

// ⛔ THE DIRECTION OF AN ERROR IS PART OF THE ERROR.
//
// HEURISTIC_TRUST_LINE said only "may undercount C++ virtual/cross-TU dispatch". True, and a reader
// takes from it that the caller list is at least a SUBSET of the truth — incomplete but safe to act
// on. Measured on the real graph:
//
//     graph_callers("has")        100 callers, essentially all of them `Map.has()` / `Set.has()`
//     graph_callers("writeFile")   70 callers, resolved onto a symbol declared in a TEST file
//
// Tree-sitter resolves a call BY NAME, so every `x.has(y)` in the corpus was attributed to whichever
// node happened to be labelled `has`. On a common name the list is not a subset of the truth; it is
// mostly not the truth at all.
//
// ⇒ A caveat that names the SAFE direction while the dangerous one dominates is worse than no
// caveat: it tells the reader which way to lean and the lean is wrong. Someone reading "may
// undercount" before a deletion concludes the risk is a caller they cannot see, when the live risk
// is that most of what they CAN see is a name collision.
describe('the heuristic trust line names BOTH directions', () => {
  it('★★★⛔ it warns about overcounting, not only undercounting', async () => {
    const { HEURISTIC_TRUST_LINE } = await import('../../../mcp/stdio/query/lsp-evidence.js');
    expect(HEURISTIC_TRUST_LINE, 'the dominant error on a common name').toMatch(/OVERCOUNT/);
    expect(HEURISTIC_TRUST_LINE, 'and the one it already named').toMatch(/UNDERCOUNT/);
    expect(HEURISTIC_TRUST_LINE, 'and the mechanism, so the reader can predict WHEN')
      .toMatch(/BY NAME/);
  });

  it('★★★ it stays ONE line — it prints on every caller answer in the product', async () => {
    // ⚠ This is paid for constantly, so it cannot grow. The constraint is why both directions are
    // stated in the shortest form that keeps them distinguishable rather than explained.
    const { HEURISTIC_TRUST_LINE } = await import('../../../mcp/stdio/query/lsp-evidence.js');
    expect(HEURISTIC_TRUST_LINE.includes('\n'), 'one line').toBe(false);
    expect(HEURISTIC_TRUST_LINE.length, 'and a bounded one').toBeLessThan(320);
  });
});
