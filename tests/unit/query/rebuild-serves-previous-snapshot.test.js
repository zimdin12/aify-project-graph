// A REBUILD RUNNING ELSEWHERE IS NOT A REASON TO REFUSE A COMPLETE ANSWER — EXCEPT ON A FIRST INDEX.
//
// `read_freshness` used to defer every verb for the whole rebuild. That was correct while a rebuild
// published in pieces: a reader could land on an emptied table and render zero callers. Since the
// rebuild became one transaction (a36b770) a concurrent reader holds the complete PREVIOUS graph, so
// the refusal now costs a turn and buys nothing.
//
// The one case that must still refuse is a FIRST index, where there is no previous graph and the
// snapshot a reader would get is empty. Answering "no callers" out of an empty graph is the false
// absence the whole arc exists to prevent, so that case fails closed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bumpGraphGeneration } from '../../../mcp/stdio/storage/publication-schema.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { inspectReadFreshness, isFreshnessBlockerText } from '../../../mcp/stdio/query/verbs/read_freshness.js';
import { SCHEMA_VERSION } from '../../../mcp/stdio/storage/schema.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

let repo; let graphDir;

const writeManifest = (status, extra = {}) => writeFileSync(
  join(graphDir, 'manifest.json'),
  // generation 1 by default so the manifest agrees with the seeded database; a test that wants a
  // torn publication passes its own.
  JSON.stringify({ status, schemaVersion: SCHEMA_VERSION, commit: 'a'.repeat(40), generation: 1, ...extra }),
);
// ⚠ SEEDS AN ATTESTED GRAPH. Serving the previous snapshot during a rebuild rests on that snapshot
// being COMPLETE, which is a property of graphs this code published — so the permission is now
// conditional on a publication record, and a fixture that omits one is testing the refusal instead.
// `attested: false` produces the legacy shape deliberately, for the tests that want it.
const seedFiles = (n, { attested = true } = {}) => {
  const db = openDb(join(graphDir, 'graph.sqlite'));
  for (let i = 0; i < n; i += 1) {
    db.run(`INSERT INTO nodes (id, type, label, file_path) VALUES ($id, 'File', $id, $id)`,
      { id: `f${i}.js` });
  }
  if (attested) bumpGraphGeneration(db);
  db.close();
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'apg-fresh-'));
  graphDir = join(repo, '.aify-graph');
  mkdirSync(graphDir, { recursive: true });
});
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

describe('a rebuild in progress', () => {
  it('serves the previous snapshot, with a warning, when one exists', async () => {
    // Catches: reverting to a blanket refusal, which costs every concurrent reader a whole turn for
    // an answer the database can already give completely.
    seedFiles(3);
    writeManifest('indexing');
    const f = await inspectReadFreshness({ repoRoot: repo, verbName: 'graph_callers' });
    expect(f.blocker, 'a complete previous graph must not be refused').toBeNull();
    expect(f.warnings.join(' '), 'the reader must be told a rebuild is running')
      .toMatch(/rebuild is in progress/i);
    expect(f.warnings.join(' '), 'and that the answer predates it').toMatch(/previous snapshot/i);
  });

  it('still refuses when there is no previous graph to serve', async () => {
    // Catches: the first-index case answering out of an EMPTY graph — a false absence, which is the
    // defect this entire arc was about.
    writeManifest('indexing');
    seedFiles(0);
    const f = await inspectReadFreshness({ repoRoot: repo, verbName: 'graph_callers' });
    expect(f.blocker, 'a first index has no snapshot to serve and must refuse').toBeTruthy();
    expect(f.blocker).toMatch(/GRAPH REBUILD INCOMPLETE/);
  });

  it('fails closed when the indexed-file count cannot be taken at all', async () => {
    // Catches: treating an unknown count as "a snapshot exists". `alreadyIndexedFiles` is null when
    // the database could not be read, and null must not pass a > 0 test.
    writeManifest('indexing');
    writeFileSync(join(graphDir, 'graph.sqlite'), 'not a database');
    const f = await inspectReadFreshness({ repoRoot: repo, verbName: 'graph_callers' });
    expect(f.blocker, 'an unreadable graph is not a servable snapshot').toBeTruthy();
  });

  it('POSITIVE CONTROL: a settled graph is served with no rebuild warning', async () => {
    // Without this, every assertion above could pass on a function that never warns at all.
    seedFiles(3);
    writeManifest('ok');
    const f = await inspectReadFreshness({ repoRoot: repo, verbName: 'graph_callers' });
    expect(f.blocker).toBeNull();
    // The repo's own guard is right to reject a bare not.toMatch here: a silent matcher proves
    // nothing unless it has been shown it can fire, and that it does not fire on neighbouring text.
    expectAbsentWithLiveMatcher(
      /rebuild is in progress/i,
      {
        forbidden: 'a rebuild is in progress; this answer comes from the completed previous snapshot',
        allowed: 'graph snapshot is stale (2 commits behind HEAD) — run graph_index() to refresh',
      },
      f.warnings.join(' '),
      'a settled graph must not claim a rebuild is running',
    );
  });
});

// ⛔ SERVING THE PREVIOUS SNAPSHOT RESTS ON IT BEING COMPLETE — WHICH ONLY THIS CODE GUARANTEES.
//
// The permission above is justified by "a rebuild commits exactly once, so a concurrent reader
// holds the complete previous graph". That is a property of graphs THIS code published. A graph
// with no publication record was last written by the three-event ordering — commit, then sidecars,
// then manifest — and may itself be a torn state from a run that died between two of them. Nothing
// on disk can tell us, which is what legacy_unattested means.
//
// ⚠ THE REFUSAL IS TEMPORARY AND THE PERMISSION IS THE DEFAULT. Outside a rebuild, legacy graphs are
// still served — refusing always would make the tool unusable on every graph that exists today.
// Here the cost is one deferred read and the remedy is guaranteed to produce an attested graph.
describe('a rebuild over a graph we cannot attest', () => {
  it('POSITIVE CONTROL: an ATTESTED graph mid-rebuild is still served', () => {
    // ⛔ THE DENIALS BELOW ARE WORTHLESS WITHOUT THIS. A gate that closed for every rebuild would be
    // the old blanket refusal wearing a new reason, and every refusal test would still pass.
    seedFiles(3);
    writeManifest('indexing');
    return inspectReadFreshness({ repoRoot: repo, verbName: 'graph_callers' }).then((f) => {
      expect(f.blocker, 'an attested previous snapshot must still be served').toBeNull();
    });
  });

  it('⛔ a LEGACY graph mid-rebuild is refused, under its own banner', async () => {
    seedFiles(3, { attested: false });
    writeManifest('indexing', { generation: undefined });
    const f = await inspectReadFreshness({ repoRoot: repo, verbName: 'graph_callers' });
    expect(f.blocker, 'a snapshot we cannot confirm complete must not be served').toBeTruthy();
    expect(f.blocker).toMatch(/GRAPH UNATTESTED DURING REBUILD/);
    expect(f.blocker, 'and it says which state, not merely that something is wrong')
      .toMatch(/no publication record/);
  });

  it('⛔ a TORN publication mid-rebuild is refused, and not described as merely old', async () => {
    // The database committed a generation the manifest never named. Telling this reader their graph
    // is "old" would be wrong and would hide a genuine torn publication.
    seedFiles(3);
    writeManifest('indexing', { generation: 99 });
    const f = await inspectReadFreshness({ repoRoot: repo, verbName: 'graph_callers' });
    expect(f.blocker).toMatch(/DIFFERENT generations/);
    expectAbsentWithLiveMatcher(
      /no publication record/,
      { forbidden: 'this graph has no publication record', allowed: 'name DIFFERENT generations' },
      f.blocker,
      'a torn publication must not be reported as a legacy graph',
    );
  });

  it('⛔ the refusal is recognisable to isFreshnessBlockerText — a refusal must not read as data', () => {
    // graph_packet filed an unparsed refusal as a FINDING once and printed "STATUS: known to graph"
    // for a symbol that did not exist. A new blocker without its banner reopens that exact hole.
    seedFiles(3, { attested: false });
    writeManifest('indexing', { generation: undefined });
    return inspectReadFreshness({ repoRoot: repo, verbName: 'graph_callers' }).then((f) => {
      expect(isFreshnessBlockerText(f.blocker)).toBe(true);
    });
  });
});
