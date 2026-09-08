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
import { retainedDigest } from '../../helpers/retained-digest.js';
import { writeStructuralDigest, listDigestCommits, readStructuralDigest } from '../../../mcp/stdio/storage/structural-digest-store.js';
import { deltaBetween, deltaFromPrevious } from '../../../mcp/stdio/storage/delta-between.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';
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

// ⛔ THE FIXTURES ARE RETAINED BYTES, NOT A CALL TO THE BUILDER. `buildDigest` was retired with the
// comparison it fed; regenerating through a writer that moves alongside its reader would only prove
// the pair still agree with each other. See tests/helpers/retained-digest.js.

/** A database holding TWO version-compatible digests — a pair that would previously compare fine. */
function dbWithTwoDigests() {
  const dir = mkdtempSync(join(tmpdir(), 'apg-withdrawn-'));
  created.push(dir);
  mkdirSync(join(dir, '.aify-graph'), { recursive: true });
  const db = openDb(join(dir, '.aify-graph', 'graph.sqlite'));
  ensurePublicationTables(db);
  writeStructuralDigest(db, retainedDigest('withdrawnBefore', A), { createdAt: '2026-09-01T00:00:00.000Z' });
  writeStructuralDigest(db, retainedDigest('withdrawnAfter', B), { createdAt: '2026-09-02T00:00:00.000Z' });
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

    expect(res.delta).toBeNull();
    // The matcher is proved live first: this is a prohibition over a SERIALIZED shape, so a typo in
    // the pattern or a change to the response would make it silently unfalsifiable.
    expectAbsentWithLiveMatcher(
      /"symbolsAdded"|"edgesAdded"|"fanInMoved"/,
      { forbidden: '{"available":true,"delta":{"symbolsAdded":[{"qname":"log"}]}}',
        allowed: '{"available":false,"reason":"source attribution unavailable","delta":null}' },
      JSON.stringify(res),
      'no movement figures may travel beside a refusal',
    );
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

  it('★★★ THE LIVENESS CONTROL: the refusal is a DECISION, not an empty database', () => {
    // ⛔ WITHOUT THIS, "everything refuses" satisfies every assertion above for the wrong reason — a
    // pair that never loaded refuses just as convincingly as a pair that loaded and was declined.
    //
    // ⚠ THIS REPLACES "the PURE comparison algorithm still works", which compared two digests with
    // computeDelta. That control was right while the algorithm was kept as a separate, still-live
    // question; it went with the algorithm when the producer was retired, and asserting a retired
    // function still runs would pin a decision nobody is making any more.
    //
    // ⇒ The property that survives is the one that makes the refusal meaningful: the rows are
    // really there, really differ, and were really read. Same lesson as the absence-authority gate
    // — when a verdict becomes constant by design, the liveness moves to whatever still varies.
    const { db } = dbWithTwoDigests();
    const stored = listDigestCommits(db).map((sha) => readStructuralDigest(db, sha));
    db.close();

    expect(stored, 'both rows must be present, or the refusal is about an empty table')
      .toHaveLength(2);
    for (const d of stored) {
      expect(Object.keys(d.symbols ?? {}).length, 'a digest with no symbols cannot be compared anyway')
        .toBeGreaterThan(0);
    }
    // ⚠ THE FIELD IS `edgeKeys`, AND READING `edges` IS HOW THIS FIRST WENT WRONG. `?? {}` turned a
    // field that does not exist into zero for BOTH rows, so "they differ" failed with 1 vs 2 — my
    // own wrong-noun error, caught by the assertion it was written into.
    // Sorted, because `listDigestCommits` returns newest-first and the ORDER is not the property
    // under test — pinning it would make this fail on a change to the store's ordering.
    const edgeCounts = stored.map((d) => d.edgeKeys.length).sort();
    expect(edgeCounts, 'the two rows must actually DIFFER, or nothing was declined').toEqual([0, 1]);
  });

  it('★★★ RETAINED ROWS SURVIVE A REINDEX BYTE-FOR-BYTE — preserved, not promoted', async () => {
    // The ruling required stored rows be preserved without being promoted to authoritative history.
    // "Not promoted" is covered by the refusals above; "preserved" is this: an index running over a
    // database that already holds digests must leave them exactly as they were.
    const { dir, db } = dbWithTwoDigests();
    const before = listDigestCommits(db).map((sha) => JSON.stringify(readStructuralDigest(db, sha)));
    db.close();

    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 't@t.t');
    git(dir, 'config', 'user.name', 'T');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.js'), 'export function alpha() { return 1; }\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'one');
    await ensureFresh({ repoRoot: dir });

    const db2 = openDb(join(dir, '.aify-graph', 'graph.sqlite'));
    const after = listDigestCommits(db2).map((sha) => JSON.stringify(readStructuralDigest(db2, sha)));
    db2.close();
    expect(after, 'stored digests are untouched by an index that captures nothing').toEqual(before);
  }, 60_000);

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
    // ⛔ AND THE WITHDRAWAL'S OWN PROPERTIES ARE ASSERTED HERE, not merely believed. The reviewer's
    // point: this case proved indexing still works and said nothing about whether the capture
    // actually stopped, so a regression that quietly resumed writing history would pass it.
    const captured = listDigestCommits(db);
    db.close();
    expect(row.n, 'the graph still indexes and still answers present-tense questions').toBeGreaterThan(0);
    expect(captured, 'indexing must publish no history while the claim is withdrawn').toEqual([]);
  }, 60_000);
});
