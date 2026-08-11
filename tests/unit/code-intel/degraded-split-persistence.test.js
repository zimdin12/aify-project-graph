// "NOT FOUND" MEANT TWO DIFFERENT THINGS AND ONLY ONE OF THEM IS EVIDENCE.
//
// A reference lookup that returns nothing because clangd had no index entry for the
// symbol (DEGRADED) and one that returns nothing because the symbol genuinely has no
// callers (a CLEAN absence) were counted together. Only the second is evidence of "no
// callers"; reading the first that way is how a deletion gets approved for a symbol that
// is called from a translation unit clangd never indexed.
//
// The cause therefore has to reach real columns rather than living inside the raw blob,
// and the split has to survive onto the collection row — because graph_health reads the
// STORED collection, and a distinction that does not survive the write cannot qualify
// anything.
//
// ★★ CONVERTED FROM SOURCE-GREP 2026-08-11 — the LAST of the eighteen source-contract
// files. The suite-composition ratchet now holds at zero.
//
// The previous version asserted eleven regexes across four files: DDL text in schema.js,
// column lists in the importer's INSERT, property spellings in query.js, and sentences in
// health.js. Between them they could confirm that a migration statement is WRITTEN — never
// that it ran, that the column it adds is populated, or that a value survives the trip.
// A migration guarded by a version check that never fires satisfies every one of them.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { importV02Collection } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import { getLatestCollection } from '../../../mcp/stdio/code-intel/query.js';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

const DEGRADED = 5;
const CLEAN = 2;

let repoRoot;

async function makeRepo() {
  const repo = await mkdtemp(join(tmpdir(), 'apg-degsplit-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  return repo;
}

const envelopeWith = (session) => ({
  schemaVersion: '0.2',
  collectionId: 'c1',
  status: 'ok',
  provider: 'cpp-clangd',
  providerVersion: 'clangd 18.1.3',
  projectRoot: repoRoot,
  language: 'cpp',
  repoCommit: 'abc1234',
  createdAt: new Date().toISOString(),
  operations: { requested: ['references'] },
  session: { mode: 'full', indexReady: true, refsFoundSymbols: 10, refsNotFoundSymbols: DEGRADED + CLEAN, ...session },
  records: [
    // One of each, so the per-record columns have both values to distinguish.
    {
      symbolId: 'sd', qname: 'Foo::degraded', file: 'src/a.cpp', line: 1,
      operation: 'references', kind: 'references', language: 'cpp',
      resultState: 'not_found', cause: 'no_index_entry', degraded: true, raw: {},
    },
    {
      symbolId: 'sc', qname: 'Foo::clean', file: 'src/b.cpp', line: 2,
      operation: 'references', kind: 'references', language: 'cpp',
      resultState: 'not_found', cause: 'no_references', degraded: false, raw: {},
    },
  ],
});

const importInto = (session) => {
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const stats = importV02Collection(envelopeWith(session), db);
    expect(stats.recordsImported, 'harness sanity: both records must be written').toBe(2);
    return {
      latest: getLatestCollection(db),
      // Read the COLUMNS directly. The point of the migration is that cause and degraded
      // are queryable without unpacking the raw blob, so the test queries them that way.
      records: db.all('SELECT qname, cause, degraded FROM code_intel_records ORDER BY qname'),
    };
  } finally {
    db.close();
  }
};

const healthOf = async () => {
  const raw = await graphHealth({ repoRoot });
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
};

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
  repoRoot = undefined;
});

describe('the cause reaches real columns, not just the raw blob', () => {
  it('★★ cause and degraded are QUERYABLE per record after the write', async () => {
    // The migration, asserted by using what it adds. `ALTER TABLE ... ADD COLUMN cause`
    // being present in schema.js says nothing about whether it ran — a migration behind a
    // version check that never fires satisfies the old regex exactly.
    repoRoot = await makeRepo();
    const { records } = importInto({});

    const byName = Object.fromEntries(records.map((r) => [r.qname, r]));
    expect(byName['Foo::clean']?.cause, 'a clean absence names its own cause').toBe('no_references');
    expect(byName['Foo::degraded']?.cause).toBe('no_index_entry');
    expect(Boolean(byName['Foo::degraded']?.degraded), 'and is marked degraded').toBe(true);
    expect(Boolean(byName['Foo::clean']?.degraded), 'while the clean one is not').toBe(false);
  }, 30_000);

  it('★★ the split survives onto the collection row and reads back', async () => {
    // health reads the STORED collection, so this is the boundary that decides whether the
    // distinction can qualify anything at all.
    repoRoot = await makeRepo();
    const { latest } = importInto({ refsDegradedSymbols: DEGRADED, refsCleanNotFoundSymbols: CLEAN });

    expect(latest.refsDegraded, 'not evidence of absence').toBe(DEGRADED);
    expect(latest.refsCleanNotFound, 'the only ones that ARE evidence').toBe(CLEAN);
  }, 30_000);

  it('★ a zero clean count is preserved rather than read as unmeasured', async () => {
    // ZERO clean absences is the strongest form of the warning — every "not found" was
    // degraded, so NONE of them is evidence. Collapsing it to null loses exactly that.
    repoRoot = await makeRepo();
    const { latest } = importInto({ refsDegradedSymbols: 7, refsCleanNotFoundSymbols: 0 });

    expect(latest.refsCleanNotFound).toBe(0);
  }, 30_000);
});

describe('graph_health states the honest headline', () => {
  it('★★ warns that degraded results are NOT evidence of no callers', async () => {
    repoRoot = await makeRepo();
    importInto({ refsDegradedSymbols: DEGRADED, refsCleanNotFoundSymbols: CLEAN });
    const h = await healthOf();
    const text = JSON.stringify(h);

    expect(h.codeIntel?.refsDegraded, 'the counters must reach the health projection').toBe(DEGRADED);
    expect(h.codeIntel?.refsCleanNotFound).toBe(CLEAN);
    expect(h.codeIntel?.refsNotFound, 'the ccfe69c contradiction check reads these two')
      .toBe(DEGRADED + CLEAN);
    expect(text, 'the reader must be told what a degraded result is not')
      .toMatch(/are NOT evidence of no callers/);
    expect(text).toMatch(/are DEGRADED/);
  }, 30_000);

  it('★★ says ZERO are clean absences when none of them are', async () => {
    // The sharpest case, and the one a source-grep for the phrase could never place: the
    // wording changes with the DATA, so the phrase being in health.js proves nothing about
    // when it is used.
    repoRoot = await makeRepo();
    importInto({ refsDegradedSymbols: 7, refsCleanNotFoundSymbols: 0 });

    expect(JSON.stringify(await healthOf())).toMatch(/ZERO are clean absences/);
  }, 30_000);

  it('★★ and does NOT say that when some absences are clean', async () => {
    // Without this the case above is satisfied by a health verb that always says ZERO.
    repoRoot = await makeRepo();
    importInto({ refsDegradedSymbols: DEGRADED, refsCleanNotFoundSymbols: CLEAN });
    const text = JSON.stringify(await healthOf());

    expect(text).not.toMatch(/ZERO are clean absences/);
    expect(text, 'it reports the real number instead').toMatch(new RegExp(`only ${CLEAN} are clean absences`));
  }, 30_000);
});
