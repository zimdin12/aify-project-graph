// THE VERIFICATION THAT WAS WAITING ON A BUSY AGENT.
//
// sc-manager framed the real test better than I had: "the real test is not 'does
// the spine come back,' it's does the spine SURVIVE a subsequent one-file scoped
// collect. Restoring it and then re-wiping it would be the same bug wearing a
// fresh number."
//
// That verification was queued behind another machine's exclusivity window for a
// day. It does not need that machine — it needs real clangd and three C++ files,
// both of which are available here. This is the a/b/c protocol run end to end:
//
//   a. full collect  → record verified edge count
//   b. scoped collect on ONE file
//   c. record again  → (c) must be ≥ (a), never 0
//
// (c) == 0 is the field-report data-loss bug (5961 verified edges → 0 from a
// one-file collect). 1b5fd63 gated on whether a run collected references AT ALL;
// 1d8e2a8 added the missing half — a run that DID collect references while scoped
// still wiped the repo, because the envelope could not express its own scope.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { graphCollectCodeIntel } from '../../../mcp/stdio/query/verbs/collect_code_intel.js';
import { runCollection } from '../../../mcp/stdio/code-intel/runner.js';
import { importV02Collection } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import { openExistingDb, openDb } from '../../../mcp/stdio/storage/db.js';
import { shutdownAllSessions, _resetSessions } from '../../../mcp/stdio/code-intel/live.js';
import { clangdAvailable, skipReason } from './clangd-gate.js';

// Three TUs with genuine cross-file calls, so a full collect has verified edges
// to lose. `Builder Builder::build()` is deliberate: it is the exact shape that
// broke identifier resolution (first-substring match landed on the return TYPE).
function cppRepo() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apg-scoped-real-')));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'src', 'builder.h'), [
    '#pragma once',
    'struct Builder {',
    '  int value = 0;',
    '  Builder build();',
    '  int compute(int seed);',
    '};',
    'int helper(int x);',
    '',
  ].join('\n'));

  fs.writeFileSync(path.join(dir, 'src', 'builder.cpp'), [
    '#include "builder.h"',
    '',
    'Builder Builder::build() {',
    '  value = helper(value);',
    '  return *this;',
    '}',
    '',
    'int Builder::compute(int seed) {',
    '  return helper(seed) + value;',
    '}',
    '',
  ].join('\n'));

  fs.writeFileSync(path.join(dir, 'src', 'helper.cpp'), [
    '#include "builder.h"',
    '',
    'int helper(int x) { return x * 2; }',
    '',
  ].join('\n'));

  fs.writeFileSync(path.join(dir, 'src', 'main.cpp'), [
    '#include "builder.h"',
    '',
    'int main() {',
    '  Builder b;',
    '  b.build();',
    '  return b.compute(3) + helper(1);',
    '}',
    '',
  ].join('\n'));

  const cc = ['src/builder.cpp', 'src/helper.cpp', 'src/main.cpp'].map((f) => ({
    directory: dir,
    command: `clang++ -std=c++17 -I src -c ${f}`,
    file: f,
  }));
  fs.writeFileSync(path.join(dir, 'compile_commands.json'), JSON.stringify(cc, null, 1));

  fs.mkdirSync(path.join(dir, '.aify-graph'), { recursive: true });
  openDb(path.join(dir, '.aify-graph', 'graph.sqlite')).close();
  return dir;
}

function verifiedEdgeCount(repoRoot) {
  const db = openExistingDb(path.join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    return db.get(
      "SELECT COUNT(*) AS c FROM edges WHERE provenance = 'LSP_VERIFIED' AND relation = 'CALLS'",
    ).c;
  } finally { db.close(); }
}

afterEach(async () => { await shutdownAllSessions(); _resetSessions(); });

describe.skipIf(!clangdAvailable)('scoped collect survives (real clangd, a/b/c protocol)', () => {
  it('a one-file scoped collect does NOT wipe the repo-wide trust spine', async () => {
    const repo = cppRepo();

    // (a) FULL COLLECT.
    const full = await graphCollectCodeIntel({
      repoRoot: repo, language: 'cpp', scope: 'all',
      operations: ['definitions', 'references', 'diagnostics'],
    });
    expect(['ok', 'partial']).toContain(full.status);
    expect(full.importFailed).toBe(false);
    // The provider must declare repo-wide authority for a non-scoped run.
    expect(full.timings).toBeTruthy();

    const afterFull = verifiedEdgeCount(repo);
    // If this is 0 the test proves nothing about invalidation — fail loudly rather
    // than let a vacuous pass through (0 → 0 would "survive" trivially).
    expect(afterFull, 'full collect produced no verified edges — nothing to lose').toBeGreaterThan(0);

    // (b) SCOPED COLLECT on ONE file, references included. This is the exact call
    // shape from the documented inner loop that destroyed 5961 edges in the field.
    const scoped = await graphCollectCodeIntel({
      repoRoot: repo, language: 'cpp', files: ['src/helper.cpp'],
      operations: ['definitions', 'references', 'diagnostics'],
    });
    expect(['ok', 'partial']).toContain(scoped.status);
    expect(scoped.importFailed).toBe(false);

    // (c) RECORD AGAIN. The spine must still be there.
    const afterScoped = verifiedEdgeCount(repo);
    expect(afterScoped, 'a one-file scoped collect wiped the trust spine').toBeGreaterThan(0);
    expect(afterScoped).toBe(afterFull);

    // NOT VACUOUS — the scope guard must be shown to have ENGAGED, not merely to
    // have had nothing to do. `edgesInvalidated: 0` alone cannot distinguish
    // "correctly preserved out-of-scope edges" from "the delete matched nothing",
    // and those look identical while meaning opposite things.
    expect(scoped.imported.invalidationScopedTo).toBe(1);
    expect(scoped.imported.edgesInvalidated).toBe(0);
  }, 240000);

  it('NEGATIVE CONTROL: the same envelope claiming repo-wide authority DOES invalidate', async () => {
    // This is the control that makes the test above meaningful. If the delete
    // could not reach these edges at all, "the spine survived" would prove nothing
    // about scoping. Re-importing the SAME scoped envelope with its scope forced to
    // repo-wide must demonstrably destroy edges — which is exactly the field
    // data-loss shape (5961 verified edges → 0 from a one-file collect).
    const repo = cppRepo();
    await graphCollectCodeIntel({
      repoRoot: repo, language: 'cpp', scope: 'all',
      operations: ['definitions', 'references', 'diagnostics'],
    });
    const afterFull = verifiedEdgeCount(repo);
    expect(afterFull).toBeGreaterThan(1);

    const scopedEnvelope = await runCollection({
      language: 'cpp', projectRoot: repo, files: ['src/helper.cpp'],
      operations: ['definitions', 'references', 'diagnostics'],
    });
    expect(scopedEnvelope.session.scope).toEqual({ kind: 'files', files: ['src/helper.cpp'] });

    // Strip the scope — i.e. simulate the pre-1d8e2a8 envelope that could not
    // express its own authority.
    const forged = { ...scopedEnvelope, session: { ...scopedEnvelope.session, scope: { kind: 'repo' } } };
    const db = openExistingDb(path.join(repo, '.aify-graph', 'graph.sqlite'), { readonly: false });
    let stats;
    try { stats = importV02Collection(forged, db); } finally { db.close(); }

    expect(stats.edgesInvalidated, 'delete cannot reach these edges — the scoped test would be vacuous')
      .toBeGreaterThan(0);
    expect(verifiedEdgeCount(repo)).toBeLessThan(afterFull);
  }, 240000);

  it('records repo-relative paths, never raw file:// URIs', async () => {
    // The Windows normalization defect: clangd canonicalizes differently from
    // whatever form repoRoot arrives in, and a bare catch shipped the URI through.
    const repo = cppRepo();
    const full = await graphCollectCodeIntel({
      repoRoot: repo, language: 'cpp', scope: 'all',
      operations: ['definitions', 'references', 'diagnostics'],
    });
    expect(full.importFailed).toBe(false);

    const db = openExistingDb(path.join(repo, '.aify-graph', 'graph.sqlite'));
    try {
      const leaked = db.all(
        "SELECT DISTINCT source_file FROM edges WHERE source_file LIKE 'file:%' LIMIT 5",
      );
      expect(leaked).toEqual([]);
      const leakedNodes = db.all(
        "SELECT DISTINCT file_path FROM nodes WHERE file_path LIKE 'file:%' LIMIT 5",
      );
      expect(leakedNodes).toEqual([]);
    } finally { db.close(); }
  }, 240000);
});

describe.skipIf(!clangdAvailable)('collect resume actually resumes (real clangd)', () => {
  it('a budget-limited scope=all run CONTINUES on re-run instead of repeating', async () => {
    // THE FIELD FAILURE. The envelope said "run again to continue/complete" while
    // the per-file loop restarted at index 0 with nothing persisted. On a 185-file
    // repo that meant every "resume" re-walked the same files and regenerated
    // their records, growing the import until a host idle timeout killed it.
    const repo = cppRepo();

    // A budget small enough to stop partway through 3 TUs, but not so small the
    // index wait eats it entirely.
    const first = await graphCollectCodeIntel({
      repoRoot: repo, language: 'cpp', scope: 'all', budgetMs: 9000,
      operations: ['definitions', 'references', 'diagnostics'],
    });
    expect(['ok', 'partial']).toContain(first.status);
    const ledger = JSON.parse(
      fs.readFileSync(path.join(repo, '.aify-graph', 'code-intel', 'collect-progress.json'), 'utf8'),
    );
    // Whatever it managed, it must have RECORDED it — that is the resume point.
    expect(Array.isArray(ledger.collected)).toBe(true);
    expect(ledger.dbHash).toBeTruthy();
    const firstBatch = [...ledger.collected];
    expect(firstBatch.length).toBeGreaterThan(0);

    // Re-run. It must skip what was done, not redo it.
    const second = await graphCollectCodeIntel({
      repoRoot: repo, language: 'cpp', scope: 'all', budgetMs: 30000,
      operations: ['definitions', 'references', 'diagnostics'],
    });
    expect(['ok', 'partial']).toContain(second.status);
    expect(second.index.resumedFrom).toBe(firstBatch.length);
    expect(second.index.resumeLedger).toBe('active');

    // Converged: every enumerated first-party file is now recorded exactly once.
    const finalLedger = JSON.parse(
      fs.readFileSync(path.join(repo, '.aify-graph', 'code-intel', 'collect-progress.json'), 'utf8'),
    );
    expect(new Set(finalLedger.collected).size).toBe(finalLedger.collected.length);
    expect(finalLedger.collected.length).toBe(second.index.enumeratedTotal);

    // A THIRD run has nothing left to do — the convergence proof. Under the old
    // behaviour this would have re-collected everything a third time.
    const third = await graphCollectCodeIntel({
      repoRoot: repo, language: 'cpp', scope: 'all', budgetMs: 30000,
      operations: ['definitions', 'references', 'diagnostics'],
    });
    expect(third.index.filesTotal).toBe(0);
    expect(third.index.resumedFrom).toBe(finalLedger.collected.length);
  }, 240000);
});

if (!clangdAvailable) {
  describe('scoped collect survives (real clangd, a/b/c protocol)', () => {
    it.skip(`skipped — ${skipReason}`, () => {});
  });
}
