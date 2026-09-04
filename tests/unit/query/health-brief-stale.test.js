import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

describe('graph_health — brief stale detection', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-health-brief-stale-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.close();
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('flags briefStaleVsManifest when brief.json graph_indexed_at lags manifest.indexedAt', async () => {
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc1234',
      indexedAt: '2026-04-21T19:17:53.115Z',
      nodes: 100,
      edges: 200,
      schemaVersion: 4,
      extractorVersion: '0.1.0',
      status: 'ok',
      dirtyFiles: [],
      dirtyEdges: [],
      dirtyEdgeCount: 42,
    }));

    await writeFile(join(repoRoot, '.aify-graph', 'brief.json'), JSON.stringify({
      graph_indexed_at: '1900-01-01T00:00:00.000Z',
      repo: {
        trust: {
          level: 'strong',
          unresolved_edges: 0,
          issues: [],
        },
      },
    }));

    const result = await graphHealth({ repoRoot });
    expect(result.briefStaleVsManifest).toBe(true);
    expect(result.summary).toContain('brief-stale: regenerate with graph-brief.mjs');
  });

  it('swallows malformed brief.json during stale check and still returns health', async () => {
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc1234',
      indexedAt: '2026-04-21T19:17:53.115Z',
      nodes: 100,
      edges: 200,
      schemaVersion: 4,
      extractorVersion: '0.1.0',
      status: 'ok',
      dirtyFiles: [],
      dirtyEdges: [],
      dirtyEdgeCount: 42,
    }));

    await writeFile(join(repoRoot, '.aify-graph', 'brief.json'), '{not valid json');

    const result = await graphHealth({ repoRoot });
    expect(result.indexed).toBe(true);
    expect(result.trust).toBe('strong');
    expect(result.briefStaleVsManifest).toBe(false);
    expect(result.summary).not.toContain('brief-stale');
  });

  // ⛔⛔ AND SWALLOWING IT MEANT NOBODY WAS TOLD, WHICH IS A DIFFERENT DEFECT FROM THE ONE ABOVE.
  //
  // Found by the R1(c) sweep, ranked to the top because the try crosses a process boundary
  // (`readFileSync` + `JSON.parse`). `let briefStaleVsManifest = false` with an empty catch means a
  // brief.json that cannot be parsed produces the same output as a brief that is perfectly current:
  // no verdict, no next action, nothing.
  //
  // ⚠ THE TEST ABOVE IS RIGHT AND STAYS UNTOUCHED. `briefStaleVsManifest` must NOT flip to `true` on
  // a parse failure — the brief is not KNOWN to be stale, and asserting it would fabricate a fact,
  // which is the same trap `lsp-evidence.js` documented as "a probe failure must not fabricate
  // staleness". The repair is not to overload that boolean; it is to report the SEPARATE fact that
  // the check could not run.
  //
  // ⚠ AND THE COMMENT IN THE CATCH CONFLATES TWO CASES. It says "brief.json missing or malformed",
  // but `existsSync` already handles MISSING before the try — so the catch only ever sees MALFORMED,
  // where the default is wrong. The comment argues the case where `false` is correct while the value
  // also covers the case where it is not. Fifth appearance of that tell in this arc.
  //
  // ⚠ NOT A HYPOTHETICAL CORRUPTION: a truncated write is exactly what a full disk produces, and
  // this machine reached 0 bytes free earlier today.
  it('★★★ a brief.json that cannot be PARSED is reported, not silently treated as fine', async () => {
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc1234', indexedAt: '2026-04-21T19:17:53.115Z', nodes: 100, edges: 200,
      schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
      dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 42,
    }));
    // A truncated object — the shape a partial write leaves behind.
    await writeFile(join(repoRoot, '.aify-graph', 'brief.json'), '{"graph_indexed_at": "2026-04-2');

    const result = await graphHealth({ repoRoot });
    expect(result.briefUnreadable, 'the check could not run, and that is its own fact').toBe(true);
    expect(result.briefStaleVsManifest, 'and it is still not KNOWN to be stale').toBe(false);
    expect(result.summary, 'a reader must learn the orientation artifact is unusable')
      .toContain('brief-unreadable');
  });

  it('★★ POSITIVE CONTROL: a well-formed, current brief is not reported unreadable', async () => {
    // ⛔ Without this, a flag hardcoded true would satisfy the test above while accusing every
    // healthy repo — and a warning that always fires is discarded as completely as one that never
    // fires. This repo has shipped a guard of that shape before.
    const indexedAt = '2026-04-21T19:17:53.115Z';
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc1234', indexedAt, nodes: 100, edges: 200,
      schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
      dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 42,
    }));
    await writeFile(join(repoRoot, '.aify-graph', 'brief.json'),
      JSON.stringify({ graph_indexed_at: indexedAt }));

    const result = await graphHealth({ repoRoot });
    expect(result.briefUnreadable).toBe(false);
    expect(result.briefStaleVsManifest).toBe(false);
  });

  it('★★★ a MISSING brief is not an unreadable one — the distinction the comment lost', async () => {
    // `existsSync` gates the try, so a missing brief never reaches the catch. Reporting it as
    // unreadable would fire on every repo that has simply never generated one, which is the
    // warning-wall failure this project has already had to tear out.
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc1234', indexedAt: '2026-04-21T19:17:53.115Z', nodes: 100, edges: 200,
      schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
      dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 42,
    }));
    // No brief.json written at all.
    const result = await graphHealth({ repoRoot });
    expect(result.briefUnreadable, 'nothing to read is not the same as unreadable').toBe(false);
  });
});
