// ⛔ A UNIT TEST DOES NOT PROVE THE PIPELINE RUNS IT.
//
// Three gates in this project went green while never executing the code they guarded: a refactor
// guard whose route never reached the moved island, a cycle gate keyed on quote style, a ledger
// test asserting `typeof auditFile === 'function'`. `tests/unit/ingest/doc-links.test.js` calls
// `detectDocLinks` directly, so it would stay green if the orchestrator never called it, or
// called it before the File nodes existed, or dropped its output.
//
// So this file indexes a real repository through `ensureFresh` and asks the database.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-doclink-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await mkdir(join(repoRoot, 'docs'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repoRoot });
});

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
});

const commitAll = () => {
  execFileSync('git', ['add', '-A'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-qm', 'x'], { cwd: repoRoot });
};

const openGraph = () => openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
const readManifest = async () =>
  JSON.parse(await readFile(join(repoRoot, '.aify-graph', 'manifest.json'), 'utf8'));

describe('doc→file links survive a real index', () => {
  it('★★★ a design doc that links to a source file gets a LINKS_TO edge with its line', async () => {
    // This is sc-manager's question in its smallest form: a document exists, it points at code,
    // and two months later nobody remembers it exists. The edge is what makes it findable from
    // the code side — and the LINE is what lets the answer be checked rather than trusted.
    await writeFile(join(repoRoot, 'src', 'terrain.js'), 'export function generateTerrain() { return 1; }\n');
    await writeFile(join(repoRoot, 'docs', 'design.md'),
      '# Terrain design\n\nThe generator lives in [terrain.js](../src/terrain.js).\n');
    commitAll();

    await ensureFresh({ repoRoot });

    const db = openGraph();
    const rows = db.all(
      `SELECT d.file_path AS doc, f.file_path AS target, e.source_line, e.extractor, e.confidence
         FROM edges e
         JOIN nodes d ON d.id = e.from_id
         JOIN nodes f ON f.id = e.to_id
        WHERE e.relation = 'LINKS_TO'`);
    db.close();

    expect(rows.length, 'the pipeline produced no doc links at all').toBe(1);
    expect(rows[0].doc).toBe('docs/design.md');
    expect(rows[0].target).toBe('src/terrain.js');
    expect(rows[0].source_line, 'a span the reader can return to').toBe(3);
    expect(rows[0].extractor).toBe('doc_link:markdown');
  }, 60_000);

  it('★★★ the manifest separates a real miss from a deliberate link out of the repo', async () => {
    // ⚠ ONE COUNTER COVERING BOTH CAN ONLY BE READ AS THE WRONG ONE. A link to the web is not a
    // coverage gap and never becomes one; a repo-shaped path that failed to resolve is, and is
    // the number that should drive work. Folded together, real misses hide inside expected noise
    // — the same shape as a cap reported as a total.
    await writeFile(join(repoRoot, 'src', 'terrain.js'), 'export function generateTerrain() { return 1; }\n');
    await writeFile(join(repoRoot, 'docs', 'design.md'),
      '# Design\n\nSee [spec](https://example.com/spec.html) and [gone](src/deleted-last-week.js).\n');
    commitAll();

    await ensureFresh({ repoRoot });

    const { docLinks } = await readManifest();
    expect(docLinks, 'the index must attest what the doc layer did').toBeTruthy();
    expect(docLinks.external, 'the URL is deliberate, not a gap').toBe(1);
    expect(docLinks.noSuchPath, 'the dead repo path IS a gap').toBe(1);
    expect(docLinks.added).toBe(0);
    expect(docLinks.failed, 'the extractor must not have silently thrown').toBeUndefined();
  }, 60_000);

  it('★★★ a design doc that links to ANOTHER DOC resolves end to end', async () => {
    // ⭐ THE CASE THE FEATURE EXISTS FOR, and the one the first implementation could not do at
    // all. Steven: "graph would point that this decision came from that doc and that decision
    // built this feature." Documents are `Document` nodes and never `File` nodes, so an index
    // over `type = 'File'` produced zero doc→doc edges on the real repo while the unit suite was
    // green — the fixture had invented File nodes for .md paths and production never does.
    // This test runs the real indexer, so it cannot be satisfied by a friendlier fixture.
    await writeFile(join(repoRoot, 'docs', 'architecture.md'), '# Architecture\n\nThe ground truth.\n');
    await writeFile(join(repoRoot, 'docs', 'design.md'),
      '# Design\n\nThis follows from [the architecture](./architecture.md).\n');
    commitAll();

    await ensureFresh({ repoRoot });

    const db = openGraph();
    const rows = db.all(
      `SELECT a.file_path AS src, b.file_path AS dst, e.source_line AS line
         FROM edges e JOIN nodes a ON a.id = e.from_id JOIN nodes b ON b.id = e.to_id
        WHERE e.relation = 'LINKS_TO'`);
    db.close();
    expect(rows).toEqual([{ src: 'docs/design.md', dst: 'docs/architecture.md', line: 3 }]);
  }, 60_000);

  it('★★★ the full miss ledger reaches disk, and the manifest carries a CAPPED sample beside an UNCAPPED count', async () => {
    // ⛔ ef-manager could not grade the miss buckets because only counts were published. A count
    // nobody can open is unfalsifiable from outside: 707 `noSuchPath` could be 707 genuine stale
    // references or 707 mis-bucketed prose tokens and the figure reads the same.
    //
    // ⚠ AND THE LEDGER MUST NOT ENTER THE MANIFEST. Every verb reads the manifest on every call;
    // ~1,200 records would make all of them pay for a diagnostic almost none of them want. The
    // sample is capped and the TOTAL is not, so the cap can never make the loss look smaller than
    // it is — the same contract `dirtyEdges`/`dirtyEdgeCount` already carries.
    await writeFile(join(repoRoot, 'src', 'terrain.js'), 'export function generateTerrain() { return 1; }\n');
    await writeFile(join(repoRoot, 'docs', 'design.md'),
      '# Design\n\nSee [gone](src/deleted-last-week.js) and run `npm run build`.\n');
    commitAll();

    await ensureFresh({ repoRoot });

    const { docLinks } = await readManifest();
    expect(docLinks.missCount, 'the uncapped total').toBeGreaterThan(0);
    expect(docLinks.missSample.length).toBeLessThanOrEqual(25);
    expect(docLinks.missLedger).toBe('.aify-graph/doc-link-misses.json');

    const sidecar = JSON.parse(await readFile(join(repoRoot, '.aify-graph', 'doc-link-misses.json'), 'utf8'));
    expect(sidecar.total, 'the sidecar total agrees with the manifest count').toBe(docLinks.missCount);
    expect(sidecar.misses.length).toBe(sidecar.total);

    const dead = sidecar.misses.find((m) => m.written === 'src/deleted-last-week.js');
    expect(dead, 'the span the author actually wrote').toBeTruthy();
    expect(dead.bucket).toBe('no_such_path');
    expect(dead.line, 'openable at that line in that document').toBe(3);
    expect(dead.doc).toBe('docs/design.md');
  }, 60_000);

  it('★★★ the manifest states the CORPUS the sweep saw and what it declined', async () => {
    // ⭐ THE NUMBER THAT MADE THE 52.7% MEASURABLE FROM INSIDE. ef-manager found the Document hole
    // with `git ls-files` because the sweep published nothing; a defect only detectable from
    // outside the system is a defect that waits for someone to go looking.
    //
    // `SKILL.md` here is the real shape: it fails all three clauses of isDocument — not a readme,
    // not one of the 12 allowlisted names, not under a directory containing "doc". This test does
    // not change that rule. It asserts that declining is now COUNTED rather than silent.
    await mkdir(join(repoRoot, 'skills'), { recursive: true });
    await writeFile(join(repoRoot, 'skills', 'SKILL.md'), '# a skill nobody can find\n');
    await writeFile(join(repoRoot, 'docs', 'design.md'), '# design\n');
    commitAll();

    await ensureFresh({ repoRoot });

    const { sweepCounts } = await readManifest();
    expect(sweepCounts, 'the index must state its own corpus').toBeTruthy();
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(sum(sweepCounts.admitted) + sum(sweepCounts.declined),
      'every candidate has exactly one outcome, or a category is unrecorded')
      .toBe(sweepCounts.seen);
    expect(sweepCounts.declined.text_not_admitted_as_document,
      'SKILL.md reached isDocument() and was refused — this was its only chance to become a node')
      .toBeGreaterThan(0);
  }, 60_000);

  it('★★★ a bare filename in prose still produces nothing after a full index', async () => {
    // The end-to-end version of the rule that matters most. The legacy extractor would have
    // emitted an edge for every one of these words; the whole point of the rebuild is that an
    // unmarked token, however exactly it matches, is not a reference.
    await writeFile(join(repoRoot, 'src', 'terrain.js'), 'export function generateTerrain() { return 1; }\n');
    await writeFile(join(repoRoot, 'docs', 'notes.md'),
      'We should read terrain.js and count the files before we index the repo.\n');
    commitAll();

    await ensureFresh({ repoRoot });

    const db = openGraph();
    const n = db.all("SELECT 1 FROM edges WHERE relation = 'LINKS_TO'").length;
    db.close();
    expect(n).toBe(0);
  }, 60_000);
});
