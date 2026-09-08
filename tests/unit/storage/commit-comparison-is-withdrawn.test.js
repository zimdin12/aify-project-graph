// ⛔ THE STRUCTURAL DELTA'S COMMIT-TO-COMMIT CLAIM IS WITHDRAWN, NOT QUALIFIED.
//
// A digest is keyed by commit sha and written from whatever the indexer PARSED. Nothing binds the
// parsed bytes to that commit's content, and two demonstrated paths publish source the commit never
// held — neither of which needs an edit during the run:
//
//   1. INHERITED ROWS. Index dirty, restore the file, commit something unrelated, index clean. Only
//      the changed file is processed, so the stale symbol survives in the graph and is published
//      under the new commit. The tree is clean at both endpoints and HEAD never moves.
//   2. `git update-index --assume-unchanged` hides a modified file from porcelain entirely, so the
//      status check cannot see it at all.
//
// 454e4097 checked the working tree at the start and end of a run and treated that as attribution.
// It is not: it attests TREE STATE, not the provenance of the rows the graph carries. I lowered an
// acceptance predicate to what was cheap to build and called it satisfied.
//
// ⭐ SO THE ANSWER IS WITHHELD RATHER THAN CAVEATED. A caveat beside an available delta still hands
// over the unsupported number, and this project has shipped that shape before. The comparison
// refuses at the SHARED boundary, so every consumer inherits it and none can page past it.
//
// ⚠ WHAT IS DELIBERATELY *NOT* DONE HERE: no event store, no content-manifest schema, no new
// publication path. Binding a digest to its consumed inputs is a different product with its own
// scope decision, and building it to avoid saying "unavailable" would be the same mistake in a
// larger form.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';
import { buildDigest, computeDelta, symbolKey } from '../../../mcp/stdio/storage/structural-digest.mjs';
import { writeStructuralDigest } from '../../../mcp/stdio/storage/structural-digest-store.js';
import { deltaBetween, deltaFromPrevious } from '../../../mcp/stdio/storage/delta-between.js';
import { ensurePublicationTables } from '../../../mcp/stdio/storage/publication-schema.js';

const created = [];
afterEach(() => {
  while (created.length) {
    const d = created.pop();
    try { rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch { /* win lock */ }
  }
});

const git = (r, ...a) => execFileSync('git', ['-C', r, ...a], { encoding: 'utf8' }).trim();
const V = 'ext-1';
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

const sym = (qname, file) => ({ qname, file, layer: null });
const digestFor = (commit, edges) => buildDigest({
  commit,
  extractorVersion: V,
  symbols: [sym('alpha', 'src/a.js'), sym('beta', 'src/b.js')],
  edges,
});

/** A database holding TWO version-compatible digests — a pair that would previously compare fine. */
function dbWithTwoDigests() {
  const dir = mkdtempSync(join(tmpdir(), 'apg-withdrawn-'));
  created.push(dir);
  mkdirSync(join(dir, '.aify-graph'), { recursive: true });
  const db = openDb(join(dir, '.aify-graph', 'graph.sqlite'));
  ensurePublicationTables(db);
  writeStructuralDigest(db, digestFor(A, []), { createdAt: '2026-09-01T00:00:00.000Z' });
  writeStructuralDigest(db, digestFor(B, [
    { from: symbolKey('alpha', 'src/a.js'), to: symbolKey('beta', 'src/b.js'), relation: 'CALLS' },
  ]), { createdAt: '2026-09-02T00:00:00.000Z' });
  return { dir, db };
}

describe('a commit-to-commit comparison is refused while source attribution is unavailable', () => {
  it('★★★ THE REAL CASE: a populated, version-compatible pair REFUSES', () => {
    // Both digests exist, same extractor, same digest version. Before the withdrawal this returned
    // a delta. The refusal is about ATTRIBUTION, not about anything missing.
    const { db } = dbWithTwoDigests();
    const res = deltaBetween(db, { fromCommit: A, toCommit: B });
    db.close();

    expect(res.available).toBe(false);
    expect(res.reason, 'the reason names why, not merely that').toMatch(/attribut/i);
    expect(res.delta, 'a refusal carries no delta').toBeNull();
  });

  it('★★★ NO MOVEMENT NUMBERS TRAVEL BESIDE THE REFUSAL', () => {
    // The failure mode this guards is a "delta with a caveat": figures a reader can act on, next to
    // a sentence saying they cannot be attributed. Whichever the reader believes, the numbers win.
    const { db } = dbWithTwoDigests();
    const res = deltaBetween(db, { fromCommit: A, toCommit: B });
    db.close();

    const serialized = JSON.stringify(res);
    expect(res.delta).toBeNull();
    expect(serialized).not.toMatch(/"symbolsAdded"|"edgesAdded"|"fanInMoved"/);
  });

  it('★★★ THE FALLBACK STILL REFUSES — a newest-pair substitution cannot rescue it', () => {
    // deltaFromPrevious falls back to the newest stored pair when HEAD has no digest. That fallback
    // is useful when the only problem is a missing row; it cannot help when NEITHER pair has
    // attribution, and it must not quietly answer a different question instead.
    const { db } = dbWithTwoDigests();
    const res = deltaFromPrevious(db, { toCommit: 'c'.repeat(40) });
    db.close();

    expect(res.available).toBe(false);
    expect(res.delta).toBeNull();
  });

  it('★★★ THE POSITIVE CONTROL: the PURE comparison algorithm still works', () => {
    // ⛔ WITHOUT THIS, "everything refuses" would satisfy every assertion above — including a change
    // that simply broke computeDelta. What was withdrawn is permission to compare DEPLOYED history,
    // not the algorithm; qualifying the algorithm is a separate question and it stays testable.
    const before = digestFor(A, []);
    const after = digestFor(B, [
      { from: symbolKey('alpha', 'src/a.js'), to: symbolKey('beta', 'src/b.js'), relation: 'CALLS' },
    ]);
    const d = computeDelta(before, after);

    expect(d.comparable).toBe(true);
    expect(d.edgesAdded).toHaveLength(1);
  });

  it('★★★ THE SECOND POSITIVE CONTROL: ordinary indexing is untouched', async () => {
    // The other way to pass a withdrawal test dishonestly is to disable something unrelated. A real
    // repository must still index and still hold its symbols.
    const repo = mkdtempSync(join(tmpdir(), 'apg-withdrawn-idx-'));
    created.push(repo);
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 't@t.t');
    git(repo, 'config', 'user.name', 'T');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'a.js'), 'export function alpha() { return 1; }\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'one');

    await ensureFresh({ repoRoot: repo });

    const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
    const row = db.get(`SELECT COUNT(*) AS n FROM nodes WHERE label = 'alpha'`);
    db.close();
    expect(row.n, 'the graph still indexes and still answers present-tense questions').toBeGreaterThan(0);
  }, 60_000);
});
