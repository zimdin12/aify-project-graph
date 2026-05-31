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

      // Heuristic-ONLY symbol: `parseConfig` has a single INFERRED caller and
      // no clangd evidence at all.
      upsertNode(db, node('fn:plainCaller', 'bootstrap', 'src/boot.cpp'));
      upsertNode(db, node('fn:plainTarget', 'parseConfig', 'src/config.cpp'));
      upsertEdge(db, {
        from_id: 'fn:plainCaller', to_id: 'fn:plainTarget', relation: 'CALLS',
        source_file: 'src/boot.cpp', source_line: 3, confidence: 0.8,
        provenance: 'INFERRED', extractor: 'cpp',
      });

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
    expect(out).toMatch(/TRUST: lsp-verified \(clangd, compile-db deadbeef, collected /);
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

  it('(d) FIX A/B: indexReady=true → "index-ready, N callers" attestation', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      // Stamp the existing collection as index-ready with the new columns.
      db.run(`UPDATE code_intel_collections SET index_ready = 1, mode = 'indexed', refs_found = 5, refs_not_found = 0 WHERE collection_id = 'ci-1'`);
    } finally {
      db.close();
    }
    const out = await graphCallers({ repoRoot, symbol: 'execute' });
    expect(out).toContain('[lsp✓]');
    expect(out).toMatch(/TRUST: lsp-verified \(clangd, index-ready, \d+ caller/);
    expect(out).not.toContain('lsp-partial');
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
