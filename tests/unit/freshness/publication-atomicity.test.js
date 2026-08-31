// ONE COMMIT PUBLISHES THE GRAPH AND EVERYTHING THAT DESCRIBES IT.
//
// ⛔ THE DEFECT THIS CLOSES. A rebuild used to promote its state in three separate events: COMMIT the
// database, WRITE the sidecars best-effort, WRITE the manifest `ok`. A failure between any two left
// an artifact describing a graph that did not exist. Reviewer executed both halves:
//
//   - dirty-edge sidecar forced to fail -> manifest read `status: ok` at a NEW commit while the full
//     ref set was unavailable, and readDirtyEdgesSidecar returns [] for a corrupt file (only ENOENT
//     gives null) -> the next incremental run silently dropped every unresolved ref.
//   - structural-fp -> a VALID OLD sidecar restored, and the next run trusted it for cosmetic
//     classification: cosmeticSkipped:1, processedFiles:[], source shapeA, DB shapeB.
//
// Generation-binding those files would DETECT the mismatch after the fact. Writing them inside the
// same BEGIN IMMEDIATE makes it unconstructible: they roll back with the graph, and there is no
// separate promotion event for a failure to land between.
//
// ⭐ WHAT MAKES THIS TEST NON-VACUOUS. Rollback assertions are the easiest kind to fake — a test
// that never wrote anything in the first place "proves" the old state survived. So every rollback
// case here runs against a graph seeded by a REAL first rebuild, asserts the OLD values are still
// present BY VALUE rather than merely non-empty, and is paired with a positive control in the same
// describe proving the commit path still reaches the new values.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { readUnresolvedRefs } from '../../../mcp/stdio/storage/unresolved-refs.js';
import { readGraphGeneration } from '../../../mcp/stdio/storage/publication-schema.js';

const getHeadCommit = vi.fn();
const getDirtyFiles = vi.fn();
const getDirtyFileEntries = vi.fn();
const getChangedFiles = vi.fn();
const withWriteLock = vi.fn();

vi.mock('../../../mcp/stdio/freshness/git.js', () => ({
  getHeadCommit, getDirtyFileEntries, getDirtyFiles, getChangedFiles,
}));
vi.mock('../../../mcp/stdio/freshness/lock.js', () => ({ withWriteLock }));

// The generation bump is the LAST write before COMMIT, so making it throw exercises the window
// where the graph is fully built and nothing has been published yet — the exact moment the old
// three-event ordering could leave an artifact ahead of the database.
const bumpSpy = vi.fn();
vi.mock('../../../mcp/stdio/storage/publication-schema.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, bumpGraphGeneration: (db) => (bumpSpy.getMockImplementation()
    ? bumpSpy(db)
    : real.bumpGraphGeneration(db)) };
});

// Failure AT the commit, which is a different window from failure before it. The rollback tests
// above induce a throw while the transaction is still open; this induces one at the moment of
// publication, which is the only window in which a manifest written too early becomes visible.
const commitSpy = vi.fn();
vi.mock('../../../mcp/stdio/storage/rebuild-transaction.js', async (importOriginal) => {
  const real = await importOriginal();
  class SpyingRebuildTransaction extends real.RebuildTransaction {
    commit() {
      if (commitSpy.getMockImplementation()) return commitSpy();
      return super.commit();
    }
  }
  return { ...real, RebuildTransaction: SpyingRebuildTransaction };
});

const GRAPH = (repoRoot) => join(repoRoot, '.aify-graph', 'graph.sqlite');
const MANIFEST = (repoRoot) => join(repoRoot, '.aify-graph', 'manifest.json');

function readPublished(repoRoot) {
  const db = openDb(GRAPH(repoRoot));
  try {
    return {
      generation: readGraphGeneration(db),
      refs: readUnresolvedRefs(db),
      functions: db.all("SELECT label FROM nodes WHERE type = 'Function'").map((r) => r.label).sort(),
    };
  } finally { db.close(); }
}

describe('the graph and everything describing it are published by ONE commit', () => {
  let repoRoot;

  beforeEach(async () => {
    vi.resetModules();
    bumpSpy.mockReset();
    commitSpy.mockReset();
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-publication-'));
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    for (const fn of [getHeadCommit, getDirtyFileEntries, getDirtyFiles, getChangedFiles, withWriteLock]) {
      fn.mockReset();
    }
    withWriteLock.mockImplementation(async (_r, fn) => fn());
    getDirtyFileEntries.mockResolvedValue([]);
    getDirtyFiles.mockResolvedValue([]);
    getChangedFiles.mockResolvedValue([]);
  });

  afterEach(async () => { await rm(repoRoot, { recursive: true, force: true }); });

  const seed = async () => {
    // ⚠ A REPO-SHAPED IMPORT THAT CANNOT RESOLVE, not a call to an unknown name. My first fixture
    // was `return missing_one()`, which produces an EXTERNAL node — a deliberate link out of the
    // repo, explicitly NOT a gap — and therefore ZERO unresolved refs. The rollback assertions
    // would then have run over an empty table and passed while proving nothing, which is the exact
    // shape of vacuous rollback test this file's header warns about. `unresolved` means a path
    // shaped like this repository that we failed to resolve; only that fills the table.
    await writeFile(join(repoRoot, 'src', 'a.js'),
      "import { gone } from './missing.js';\nexport function alpha() { return gone(); }\n");
    getHeadCommit.mockResolvedValue('head-1');
    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    await ensureFresh({ repoRoot });
    return readPublished(repoRoot);
  };

  it('POSITIVE CONTROL: a successful rebuild publishes refs, fingerprints and a generation', async () => {
    const first = await seed();
    expect(first.generation, 'a committed graph is generation 1, never legacy null').toBe(1);
    expect(first.refs, 'the table exists, so this is [] or rows — never null').not.toBeNull();
    expect(first.refs.length, 'the fixture must actually produce an unresolved ref').toBeGreaterThan(0);
    expect(first.functions).toContain('alpha');

    const manifest = JSON.parse(await readFile(MANIFEST(repoRoot), 'utf8'));
    expect(manifest.generation, 'the manifest names the generation that committed').toBe(1);
    expect(manifest.status).toBe('ok');
  });

  it('a second rebuild advances the generation and replaces the refs', async () => {
    await seed();
    await writeFile(join(repoRoot, 'src', 'a.js'),
      "import { other } from './absent.js';\nexport function beta() { return other(); }\n");
    getHeadCommit.mockResolvedValue('head-2');
    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    await ensureFresh({ repoRoot, force: true });

    const after = readPublished(repoRoot);
    expect(after.generation).toBe(2);
    expect(after.functions).toContain('beta');
    expect(after.refs.map((r) => r.target)).toContain('src/absent.js');
    const manifest = JSON.parse(await readFile(MANIFEST(repoRoot), 'utf8'));
    expect(manifest.generation).toBe(2);
  });

  it('⛔ ROLLBACK: a failure before COMMIT leaves the OLD refs, generation AND graph intact', async () => {
    const before = await seed();
    expect(before.refs.map((r) => r.target)).toContain('src/missing.js');

    // Rewrite the source so a SUCCESSFUL rebuild would visibly change all three.
    await writeFile(join(repoRoot, 'src', 'a.js'),
      "import { other } from './absent.js';\nexport function beta() { return other(); }\n");
    getHeadCommit.mockResolvedValue('head-2');
    bumpSpy.mockImplementation(() => { throw new Error('induced failure before commit'); });

    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    await expect(ensureFresh({ repoRoot, force: true })).rejects.toThrow(/induced failure/);

    // ⭐ BY VALUE, NOT BY NON-EMPTINESS. "still has rows" would pass even if the rollback had
    // written the NEW rows, which is the failure this is actually guarding against.
    const after = readPublished(repoRoot);
    expect(after.generation, 'the generation must not advance on a rolled-back rebuild').toBe(before.generation);
    expect(after.refs.map((r) => r.target)).toContain('src/missing.js');
    expect(after.refs.map((r) => r.target)).not.toContain('src/absent.js');
    expect(after.functions).toContain('alpha');
    expect(after.functions).not.toContain('beta');
  });

  it('⛔ ROLLBACK: the manifest is not advanced past a rebuild that never committed', async () => {
    await seed();
    await writeFile(join(repoRoot, 'src', 'a.js'),
      "import { other } from './absent.js';\nexport function beta() { return other(); }\n");
    getHeadCommit.mockResolvedValue('head-2');
    bumpSpy.mockImplementation(() => { throw new Error('induced failure before commit'); });

    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    await expect(ensureFresh({ repoRoot, force: true })).rejects.toThrow();

    // The manifest is written AFTER the commit, so a rebuild that never committed must not have
    // moved it. This is the artifact-ahead-of-the-database case, stated as an assertion.
    const manifest = JSON.parse(await readFile(MANIFEST(repoRoot), 'utf8'));
    expect(manifest.commit, 'the manifest names a graph that never committed').toBe('head-1');
    expect(manifest.generation).toBe(1);
  });

  // ⛔ FOUND BY A SURVIVING MUTANT. Deleting `|| carrySource.tier === 'force-full'` from the
  // fullRebuild expression changed nothing that any test could see, so the escalation existed only
  // in the source. That is the same shape as the unreadable-file gap in the bridge: the code was
  // right for a reason nothing checked.
  //
  // The discriminator is a file the graph has never seen, with NO changed files reported. An
  // incremental run takes the noop path and never sees it; a full rebuild walks the repository and
  // picks it up. So the new function's presence IS the rebuild mode, observed rather than asserted.
  describe('an unreadable legacy authority escalates to a full rebuild', () => {
    const makeLegacy = async (sidecarBytes) => {
      await seed();
      const db = openDb(GRAPH(repoRoot));
      try { db.exec('DROP TABLE unresolved_refs'); } finally { db.close(); }
      await writeFile(join(repoRoot, '.aify-graph', 'dirty-edges.full.json'), sidecarBytes);
      // A file the graph has never indexed, and git reports nothing changed.
      await writeFile(join(repoRoot, 'src', 'newcomer.js'), 'export function newcomer() { return 7; }\n');
      getHeadCommit.mockResolvedValue('head-1');
      const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
      await ensureFresh({ repoRoot });
      return readPublished(repoRoot);
    };

    it('⛔ a CORRUPT legacy sidecar forces the full rebuild rather than a quiet 500-row fallback', async () => {
      const after = await makeLegacy('{"count": 3, "dirtyEdges": [{"target": "a"},');
      expect(after.functions, 'a full rebuild walks the whole repository and finds the new file')
        .toContain('newcomer');
      expect(after.generation, 'the rebuild committed, so the table is authoritative again').toBe(2);
    });

    it('⛔ a count/rows MISMATCH forces it too — a truncated write parses as valid JSON', async () => {
      const after = await makeLegacy(JSON.stringify({ count: 35906, dirtyEdges: [{ target: 'a' }] }));
      expect(after.functions).toContain('newcomer');
    });

    it('⛔ an INDEXED graph with no surviving ref authority anywhere forces the rebuild', async () => {
      // ⭐ FOUND BY A SURVIVING MUTANT, AND IT IS THE FOURTH TIME IN THIS UNIT. The bridge's own
      // tests cover graphIndexed thoroughly; nothing covered the ORCHESTRATOR passing it, so
      // changing that argument to false changed nothing any test could see.
      //
      // The state itself: a legacy install predating dirtyEdgeCount has an indexed graph, a real
      // unresolved population, and no record of it — no table, no sidecar, no manifest count.
      // Treating that as an authoritative zero is false absence reached by running out of places to
      // look. It must rebuild from source instead.
      await seed();
      const db = openDb(GRAPH(repoRoot));
      try { db.exec('DROP TABLE unresolved_refs'); } finally { db.close(); }
      // No sidecar is written, and the manifest loses the count that would otherwise witness it.
      const manifestPath = MANIFEST(repoRoot);
      const m = JSON.parse(await readFile(manifestPath, 'utf8'));
      delete m.dirtyEdgeCount;
      delete m.dirtyEdges;
      await writeFile(manifestPath, JSON.stringify(m));

      await writeFile(join(repoRoot, 'src', 'newcomer.js'), 'export function newcomer() { return 7; }\n');
      getHeadCommit.mockResolvedValue('head-1');
      const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
      await ensureFresh({ repoRoot });

      const after = readPublished(repoRoot);
      expect(after.functions, 'a full rebuild walks the repository and finds the new file')
        .toContain('newcomer');
    });

    it('⛔ a CORRUPT unresolved table still rebuilds — the repair must not need the thing it repairs', async () => {
      // ⭐ A REGRESSION I INTRODUCED AND CAUGHT ONLY BY PROBING A REAL GRAPH. readUnresolvedRefs was
      // changed to THROW when the table exists but cannot be read, so corruption stops
      // masquerading as a legacy graph. Its docstring says a caller wanting to survive that must
      // catch it deliberately — and this caller did not, so the throw escaped ensureFresh and
      // EVERY rebuild failed, including force:true. A graph that can never self-heal is worse than
      // the defect the throw fixed, and the rebuild IS the repair: the table is deleted and
      // rewritten outright.
      await seed();
      const db = openDb(GRAPH(repoRoot));
      try {
        db.run("UPDATE unresolved_refs SET import_map_json = '{not valid json' "
          + 'WHERE id = (SELECT MIN(id) FROM unresolved_refs)');
      } finally { db.close(); }

      await writeFile(join(repoRoot, 'src', 'newcomer.js'), 'export function newcomer() { return 7; }\n');
      getHeadCommit.mockResolvedValue('head-1');
      const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
      // The assertion is that this RESOLVES. Before the deliberate catch it rejected.
      await ensureFresh({ repoRoot });

      const after = readPublished(repoRoot);
      expect(after.refs, 'the rebuild replaced the table, so it reads cleanly again').not.toBeNull();
      expect(after.functions, 'and it rebuilt from source rather than carrying anything forward')
        .toContain('newcomer');
    });

    it('POSITIVE CONTROL: a VALID legacy sidecar does NOT force a rebuild', async () => {
      // Without this the escalation could be permanently on and the two denials above would prove
      // nothing — a gate whose closed state never lifts is off, not fail-closed.
      const after = await makeLegacy(JSON.stringify({
        count: 1, writtenAt: 'x', dirtyEdges: [{ relation: 'IMPORTS', source_file: 'src/a.js', target: 'src/missing.js' }],
      }));
      expect(after.functions, 'the incremental noop path must not have walked the repository')
        .not.toContain('newcomer');
    });
  });

  it('⛔ a failure AT the commit leaves no manifest describing the graph it would have published', async () => {
    // ⭐ THE ORDERING TEST. Everything else here fails BEFORE the commit, where the manifest write
    // is unreachable either way — so none of it could tell a correct ordering from the original
    // three-event one. A mutant that moved writeManifest above rebuildTxn.commit() survived the
    // whole file until this existed, which is exactly the defect the unit was built to remove:
    // an artifact published ahead of the database.
    const before = await seed();
    await writeFile(join(repoRoot, 'src', 'a.js'),
      "import { other } from './absent.js';\nexport function beta() { return other(); }\n");
    getHeadCommit.mockResolvedValue('head-2');
    commitSpy.mockImplementation(() => { throw new Error('induced failure AT commit'); });

    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    await expect(ensureFresh({ repoRoot, force: true })).rejects.toThrow(/induced failure AT commit/);

    const manifest = JSON.parse(await readFile(MANIFEST(repoRoot), 'utf8'));
    expect(manifest.commit, 'a manifest naming head-2 would describe a graph that never committed')
      .toBe('head-1');
    expect(manifest.generation).toBe(before.generation);
  });

  it('the manifest generation and the database generation agree after a successful rebuild', async () => {
    await seed();
    const manifest = JSON.parse(await readFile(MANIFEST(repoRoot), 'utf8'));
    // ⭐ THE WHOLE UNIT COLLAPSES TO THIS ONE COMPARISON. Three file formats needing their own
    // generation contract became one integer against one integer.
    expect(manifest.generation).toBe(readPublished(repoRoot).generation);
  });
});
