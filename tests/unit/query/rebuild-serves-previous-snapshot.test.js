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
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { inspectReadFreshness } from '../../../mcp/stdio/query/verbs/read_freshness.js';
import { SCHEMA_VERSION } from '../../../mcp/stdio/storage/schema.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

let repo; let graphDir;

const writeManifest = (status, extra = {}) => writeFileSync(
  join(graphDir, 'manifest.json'),
  JSON.stringify({ status, schemaVersion: SCHEMA_VERSION, commit: 'a'.repeat(40), ...extra }),
);
const seedFiles = (n) => {
  const db = openDb(join(graphDir, 'graph.sqlite'));
  for (let i = 0; i < n; i += 1) {
    db.run(`INSERT INTO nodes (id, type, label, file_path) VALUES ($id, 'File', $id, $id)`,
      { id: `f${i}.js` });
  }
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
