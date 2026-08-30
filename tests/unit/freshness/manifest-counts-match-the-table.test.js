// THE INVARIANT THAT LETS TEN HOT PATHS KEEP READING THE MANIFEST.
//
// `getUnresolvedCounts(manifest)` has TEN production call sites — brief/generator, callers,
// change_plan, consequences, health, impact, onboard, packet-input, preflight, status. The review
// bar says table queries should replace the manifest consumers for counts. They deliberately do
// not, and this file is the price of that decision.
//
// The argument for keeping them: `dirtyEdgeCount` and `trustDirtyEdgeCount` are computed from
// `resolved.unresolved` — the SAME array `replaceUnresolvedRefs` writes — inside the same
// transaction, and the manifest naming that generation is written immediately after the commit. So
// under an attested graph the manifest count and the table are one population by construction, and
// putting a COUNT over 36,000 rows behind ten hot paths would buy nothing.
//
// ⛔ THE HOLE IN THAT ARGUMENT IS THAT IT IS AN ARGUMENT. "Same array, same transaction" is exactly
// the kind of claim this whole unit exists because I stopped trusting: the sidecars were also
// written from the same data, one line apart, and drifted anyway because they were promoted by a
// different event. So the equality is pinned here. If it ever breaks, this fails and the case for
// reading the manifest collapses with it — which is the outcome I want, rather than ten verbs
// quietly reporting a number the graph no longer holds.
//
// Measured on the live graph while writing this: manifest 36,184 / table 36,184, against a stale
// sidecar on the same disk holding 36,102. The 82-row gap is what drift looks like when nothing
// pins it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { readUnresolvedRefs } from '../../../mcp/stdio/storage/unresolved-refs.js';
import { countTrustRelevantDirtyEdges } from '../../../mcp/stdio/freshness/unresolved-metrics.js';
import { ATTESTATION, classifyAttestation, readGraphPublication } from '../../../mcp/stdio/storage/publication-schema.js';

const getHeadCommit = vi.fn();
const getDirtyFiles = vi.fn();
const getDirtyFileEntries = vi.fn();
const getChangedFiles = vi.fn();
const withWriteLock = vi.fn();

vi.mock('../../../mcp/stdio/freshness/git.js', () => ({
  getHeadCommit, getDirtyFileEntries, getDirtyFiles, getChangedFiles,
}));
vi.mock('../../../mcp/stdio/freshness/lock.js', () => ({ withWriteLock }));

// ⚠ MODULE-SCOPE LIFECYCLE, because TWO describes need it. Leaving beforeEach inside the first one
// gave the second an undefined repoRoot and three ENOENTs — a fixture that never existed, which is
// the failure mode where a test can only ever error, never discriminate.
let repoRoot;

beforeEach(async () => {
  vi.resetModules();
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-counts-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  for (const fn of [getHeadCommit, getDirtyFileEntries, getDirtyFiles, getChangedFiles, withWriteLock]) {
    fn.mockReset();
  }
  withWriteLock.mockImplementation(async (_r, fn) => fn());
  getDirtyFileEntries.mockResolvedValue([]);
  getDirtyFiles.mockResolvedValue([]);
  getChangedFiles.mockResolvedValue([]);
  getHeadCommit.mockResolvedValue('head-1');
});

afterEach(async () => { await rm(repoRoot, { recursive: true, force: true }); });

const rebuildFixture = async () => {
  const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
  await ensureFresh({ repoRoot, force: true });
  const manifest = JSON.parse(await readFile(join(repoRoot, '.aify-graph', 'manifest.json'), 'utf8'));
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    return { manifest, rows: readUnresolvedRefs(db) };
  } finally { db.close(); }
};

describe('the manifest counts describe the population the table holds', () => {

  it('⭐ dirtyEdgeCount equals the table row count — the uncapped number, not the sample', async () => {
    // Deliberately MORE than the 500-row manifest cap would hold, so a test that accidentally
    // compared against `dirtyEdges.length` would fail rather than agree by coincidence.
    const imports = Array.from({ length: 600 }, (_, i) =>
      `import { g${i} } from './missing${i}.js';\nexport const u${i} = g${i};`).join('\n');
    await writeFile(join(repoRoot, 'src', 'a.js'), `${imports}\n`);

    const { manifest, rows } = await rebuildFixture();
    expect(rows, 'the table must exist after a rebuild').not.toBeNull();
    expect(rows.length, 'the fixture must exceed the manifest sample cap').toBeGreaterThan(500);
    expect(manifest.dirtyEdgeCount, 'the manifest count IS the table population').toBe(rows.length);
    expect(manifest.dirtyEdges.length, 'and the manifest sample is capped, as designed').toBe(500);
  });

  it('⭐ trustDirtyEdgeCount is the trust-relevant subset OF THOSE SAME ROWS', async () => {
    // The load-bearing half. A blanket refusal test once took this number from 27,957 to zero in a
    // commit whose message claimed the denominator was unchanged; recomputing it from the table
    // here means the manifest cannot quietly hold a figure the rows do not support.
    await writeFile(join(repoRoot, 'src', 'a.js'),
      "import { gone } from './missing.js';\nexport function alpha() { return gone(); }\n");

    const { manifest, rows } = await rebuildFixture();
    expect(manifest.trustDirtyEdgeCount).toBe(countTrustRelevantDirtyEdges(rows));
  });

  it('POSITIVE CONTROL: a graph with nothing unresolved agrees at zero', async () => {
    // ⛔ WITHOUT THIS THE TWO ABOVE COULD PASS ON A POPULATION THAT IS NEVER EMPTY. Zero is the
    // case where an off-by-one or a null-vs-empty confusion hides, and it is also the state a
    // healthy repository is supposed to reach.
    await writeFile(join(repoRoot, 'src', 'a.js'), 'export function alpha() { return 1; }\n');

    const { manifest, rows } = await rebuildFixture();
    expect(rows, 'an attested graph with no unresolved refs reads [] — never null').toEqual([]);
    expect(manifest.dirtyEdgeCount).toBe(0);
    expect(manifest.trustDirtyEdgeCount).toBe(0);
  });

  it('⛔ the equality survives a SECOND rebuild that changes the population', async () => {
    // Drift is a function of time, not of a single write. The sidecars agreed on the run that wrote
    // them too; they diverged on the ones after.
    await writeFile(join(repoRoot, 'src', 'a.js'),
      "import { gone } from './missing.js';\nexport function alpha() { return gone(); }\n");
    const first = await rebuildFixture();
    expect(first.manifest.dirtyEdgeCount).toBe(first.rows.length);

    await writeFile(join(repoRoot, 'src', 'a.js'),
      "import { a } from './m1.js';\nimport { b } from './m2.js';\nexport const x = a + b;\n");
    getHeadCommit.mockResolvedValue('head-2');
    const second = await rebuildFixture();

    expect(second.manifest.dirtyEdgeCount).toBe(second.rows.length);
    expect(second.rows.length, 'the population must actually have changed, or this proves nothing')
      .not.toBe(first.rows.length);
  });
});

// ⛔ A MATCHING GENERATION IS NOT EVIDENCE THAT THE COPIED COUNTS ARE RIGHT.
//
// Reviewer's third obligation, and the sharpest of the five. The manifest holds a DENORMALISED copy
// of two aggregates the database owns. It is tempting to reason: the generations agree, therefore
// the manifest describes this graph, therefore its counts are this graph's counts. The first step
// is sound and the last does not follow — the generation attests WHICH graph, not WHAT was copied
// out of it. A hand-edited manifest, a partial write, or a future refactor that computes the
// manifest number from a different array all produce agreeing generations and disagreeing counts.
//
// So the integrity check compares the NUMBERS, from both substrates, and does not accept the
// generation as a proxy for them.
describe('the copied counts are checked against the committed aggregates, not trusted', () => {
  it('⛔ a manifest count mutated UNDER a matching generation is detected', async () => {
    await writeFile(join(repoRoot, 'src', 'a.js'),
      "import { gone } from './missing.js';\nexport function alpha() { return gone(); }\n");
    const { manifest, rows } = await rebuildFixture();

    // Falsify the copy while leaving the generation exactly as published — the state where
    // "generations agree" is true and the counts are still wrong.
    const manifestPath = join(repoRoot, '.aify-graph', 'manifest.json');
    const tampered = { ...manifest, dirtyEdgeCount: manifest.dirtyEdgeCount + 7 };
    await writeFile(manifestPath, JSON.stringify(tampered));

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      const publication = readGraphPublication(db);
      // The generation still matches. That is the trap.
      expect(classifyAttestation({
        dbGeneration: publication.generation,
        manifestGeneration: tampered.generation,
      }), 'the generation agrees, which is exactly why it cannot be the check').toBe(ATTESTATION.ATTESTED);

      // And the numbers do not.
      expect(publication.counts.unresolved, 'the committed aggregate is unchanged').toBe(rows.length);
      expect(tampered.dirtyEdgeCount, 'the copy has drifted from it').not.toBe(publication.counts.unresolved);
    } finally { db.close(); }
  });

  it('POSITIVE CONTROL: an untampered manifest agrees with the committed aggregate', async () => {
    // ⛔ Without this the assertion above would pass against a comparison that always reports
    // disagreement — a check that can only ever say "wrong" is not a check.
    await writeFile(join(repoRoot, 'src', 'a.js'),
      "import { gone } from './missing.js';\nexport function alpha() { return gone(); }\n");
    const { manifest, rows } = await rebuildFixture();

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      const publication = readGraphPublication(db);
      expect(publication.counts.unresolved).toBe(manifest.dirtyEdgeCount);
      expect(publication.counts.trustUnresolved).toBe(manifest.trustDirtyEdgeCount);
      expect(publication.counts.unresolved, 'and both describe the rows actually present').toBe(rows.length);
    } finally { db.close(); }
  });

  it('⭐ all three substrates agree after a rebuild: rows, DB aggregate, manifest copy', async () => {
    // Obligations 1 and 2 in one assertion, over a population big enough that the manifest sample
    // cap cannot coincidentally equal the total.
    const imports = Array.from({ length: 600 }, (_, i) =>
      `import { g${i} } from './missing${i}.js';\nexport const u${i} = g${i};`).join('\n');
    await writeFile(join(repoRoot, 'src', 'a.js'), `${imports}\n`);
    const { manifest, rows } = await rebuildFixture();

    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      const { counts } = readGraphPublication(db);
      expect([rows.length, counts.unresolved, manifest.dirtyEdgeCount])
        .toEqual([rows.length, rows.length, rows.length]);
      expect(counts.trustUnresolved).toBe(manifest.trustDirtyEdgeCount);
    } finally { db.close(); }
  });
});
