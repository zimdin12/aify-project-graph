// EDGE LIFECYCLE: A DELETED DOCUMENT MUST TAKE ITS EDGES WITH IT.
//
// ⭐ dev named this as the Phase 5 requirement and it is the one that does not announce itself:
//
//   "Every derived cross-layer relation needs a producer, population, admission rule, provenance,
//    freshness trigger, DELETION TRIGGER and consumer policy. Without that ledger, file rename /
//    doc deletion / overlay drift leaves TRUTHFUL-AT-CREATION edges stale, and the foundation
//    becomes wrong again without any extractor defect."
//
// ⚠ THE DOC LAYER NOW HAS FOUR ADMISSION RULES AND ONE DELETION MECHANISM: each extractor clears
// its own tag before rebuilding. That is a correct design AND an untested one — it is a property
// that happens to hold, and a property nobody watches is one commit away from being a property
// that used to hold.
//
// ⛔ AND THE DATABASE DOES NOT ENFORCE IT. `PRAGMA foreign_keys` is 0, so an edge whose endpoint is
// deleted is not rejected — it is silently kept. The graph currently has ZERO orphaned edges in
// either direction, and that cleanliness comes entirely from the extractors doing a full
// delete-and-rebuild. Nothing structural holds it.
//
// This tests the END TO END path — real index, real deletion, real re-index — because the unit
// behaviour ("the extractor clears its tag") is not the claim. The claim is that a document
// leaving the repository leaves nothing behind.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-doclife-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await mkdir(join(repoRoot, 'docs'), { recursive: true });
  execFileSync('git', ['-C', repoRoot, 'init', '-q'], { stdio: 'ignore' });
});

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

const commitAll = () => {
  execFileSync('git', ['-C', repoRoot, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoRoot, '-c', 'user.email=t@t', '-c', 'user.name=t',
    'commit', '-qm', 'x'], { stdio: 'ignore' });
};

function docEdges() {
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    return db.all(
      `SELECT e.relation, e.extractor, e.source_file FROM edges e
        WHERE e.relation IN ('LINKS_TO', 'MENTIONS')`);
  } finally { db.close(); }
}

function orphans() {
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    return {
      // BOTH directions. An edge can be orphaned at either end, and a check on one end reports a
      // clean graph while the other end dangles.
      from: db.all(`SELECT COUNT(*) c FROM edges e LEFT JOIN nodes n ON n.id = e.from_id
                     WHERE n.id IS NULL`)[0].c,
      to: db.all(`SELECT COUNT(*) c FROM edges e LEFT JOIN nodes n ON n.id = e.to_id
                   WHERE n.id IS NULL`)[0].c,
    };
  } finally { db.close(); }
}

describe('a document leaving the repo takes its edges with it', () => {
  it('★★★ deleting a document removes its edges, and orphans NOTHING', async () => {
    await writeFile(join(repoRoot, 'src', 'terrain.js'),
      'export function generateTerrain() { return 1; }\n');
    await writeFile(join(repoRoot, 'docs', 'design.md'),
      '# Design\n\nThe entry point is [terrain](src/terrain.js) and `generateTerrain()` builds it.\n');
    commitAll();
    await ensureFresh({ repoRoot });

    // POSITIVE CONTROL FIRST. If the document produced no edges, the deletion assertion below is
    // vacuous — "the edges are gone" is trivially true of edges that never existed, and that is
    // the shape this repo has shipped more than once tonight.
    const before = docEdges();
    expect(before.length, 'the document must produce edges, or the deletion proves nothing')
      .toBeGreaterThan(0);
    expect(before.every((e) => e.source_file === 'docs/design.md')).toBe(true);

    await rm(join(repoRoot, 'docs', 'design.md'));
    commitAll();
    await ensureFresh({ repoRoot });

    const after = docEdges();
    expect(after, 'a deleted document must leave no edge behind it').toEqual([]);
    expect(orphans(), 'and no edge may reference a node that no longer exists')
      .toEqual({ from: 0, to: 0 });
  }, 120_000);

  it('★★★ deleting the TARGET of a doc edge orphans nothing either', async () => {
    // The other direction, and the one nothing else covers. A document survives; the FILE it
    // points at is deleted. `PRAGMA foreign_keys` is 0, so the database will not reject an edge
    // whose endpoint vanished — the only thing preventing an orphan is that the extractor rebuilds
    // from scratch and the target no longer resolves.
    await writeFile(join(repoRoot, 'src', 'terrain.js'),
      'export function generateTerrain() { return 1; }\n');
    await writeFile(join(repoRoot, 'docs', 'design.md'),
      '# Design\n\nSee [terrain](src/terrain.js).\n');
    commitAll();
    await ensureFresh({ repoRoot });
    expect(docEdges().length, 'control: the link resolved while the target existed')
      .toBeGreaterThan(0);

    await rm(join(repoRoot, 'src', 'terrain.js'));
    commitAll();
    await ensureFresh({ repoRoot });

    expect(orphans(), 'a deleted target must not leave a dangling edge')
      .toEqual({ from: 0, to: 0 });
    // The document still exists and still contains the text — so the SPAN is still there and the
    // layer must simply decline to resolve it, rather than keeping an edge to a ghost.
    expect(docEdges().filter((e) => e.relation === 'LINKS_TO'),
      'the span survives; the edge must not').toEqual([]);
  }, 120_000);

  it('★★★ RENAMING a document moves its edges rather than duplicating them', async () => {
    // dev named rename alongside deletion. A rename is a delete plus an add, and the failure mode
    // is that the OLD path's edges survive beside the new ones — both truthful at creation, one of
    // them now describing a file that does not exist.
    await writeFile(join(repoRoot, 'src', 'terrain.js'),
      'export function generateTerrain() { return 1; }\n');
    await writeFile(join(repoRoot, 'docs', 'design.md'),
      '# Design\n\nSee [terrain](src/terrain.js).\n');
    commitAll();
    await ensureFresh({ repoRoot });
    expect(docEdges().length, 'control').toBeGreaterThan(0);

    await writeFile(join(repoRoot, 'docs', 'architecture.md'),
      '# Design\n\nSee [terrain](src/terrain.js).\n');
    await rm(join(repoRoot, 'docs', 'design.md'));
    commitAll();
    await ensureFresh({ repoRoot });

    const after = docEdges();
    expect(after.length, 'the same one fact, from the new path only').toBeGreaterThan(0);
    expect(after.every((e) => e.source_file === 'docs/architecture.md'),
      'no edge may still be attributed to the old path').toBe(true);
    expect(orphans()).toEqual({ from: 0, to: 0 });
  }, 120_000);
});
