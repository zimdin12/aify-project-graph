// A CAVEAT THAT DOES NOT SURVIVE THE WRITE IS NOT A CAVEAT.
//
// `positionGuessSkipped` and `refsTruncatedSymbols` count WHAT WAS NEVER ASKED. A symbol
// we declined to query sits in the coverage denominator and can never reach the numerator,
// so if these die at any layer, graph_health reports a rate where it should report a
// FLOOR — "not asked" silently becomes "asked, found nothing". That is the same
// false-completeness class as `terminated: true` on a clipped closure.
//
// The values pass through five layers: the provider session emits them, the collect verb
// forwards them, the importer persists them into _session, getLatestCollection reads them
// back, and graph_health turns them into the caveat. Any one boundary dropping them is
// invisible from the other four.
//
// ★★ CONVERTED FROM SOURCE-GREP 2026-08-11.
//
// The previous version had ten cases — two counters × five layers — and each one asserted
// that a NAME appears in a FILE, several via `new RegExp(`${field}: sess\\.${field}`)`.
// That is a spelling contract. It cannot see a boundary that copies the field into the
// wrong object, a write that never runs because the row insert throws, a column that
// exists but is never populated, or a value that arrives as the string "7". And it goes
// red on a rename that changes nothing.
//
// Replaced by ONE round-trip: put known numbers in at the provider boundary, take them out
// at the far end. Five greps become one journey, and the journey is what the counters are
// for.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { importV02Collection } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import { getLatestCollection } from '../../../mcp/stdio/code-intel/query.js';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

// Distinct primes, so a value arriving in the wrong field is a visible mismatch rather
// than a coincidence. 0 and 1 would not distinguish a swap.
const SKIPPED = 7;
const TRUNCATED = 3;

let repoRoot;

async function makeRepo() {
  const repo = await mkdtemp(join(tmpdir(), 'apg-skipctr-'));
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

// The shape a real collect produces. Every NOT NULL column the importer touches is filled,
// so a failure here is about the counters and not about the fixture.
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
  session: { mode: 'full', indexReady: true, refsFoundSymbols: 10, refsNotFoundSymbols: 4, ...session },
  records: [{
    symbolId: 's1', qname: 'Foo::bar', file: 'src/a.cpp', line: 1,
    operation: 'references', kind: 'references', language: 'cpp',
    resultState: 'not_found', raw: {},
  }],
});

const roundTrip = (session) => {
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const stats = importV02Collection(envelopeWith(session), db);
    expect(stats.recordsImported, 'harness sanity: the import must have written').toBe(1);
    return getLatestCollection(db);
  } finally {
    db.close();
  }
};

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
  repoRoot = undefined;
});

describe('skip counters survive every layer', () => {
  it('★★ the numbers put in at the provider boundary come back out of storage', async () => {
    // The whole chain in one assertion pair. Import writes through the collection row and
    // the _session blob; getLatestCollection reads back from the database, not from the
    // envelope still in memory — so a boundary that drops a field cannot hide here.
    repoRoot = await makeRepo();
    const latest = roundTrip({ positionGuessSkipped: SKIPPED, refsTruncatedSymbols: TRUNCATED });

    expect(latest, 'harness sanity: a collection must be readable back').toBeTruthy();
    expect(latest.positionGuessSkipped, 'what was never asked, after the write').toBe(SKIPPED);
    expect(latest.refsTruncatedSymbols, 'what was cut short, after the write').toBe(TRUNCATED);
  }, 30_000);

  it('★★ they survive as NUMBERS, not as whatever SQLite felt like returning', async () => {
    // A counter that comes back as "7" still renders in a message and still compares
    // wrongly against 0 — `"0" > 0` is false, so a stringified zero-skip and a stringified
    // seven-skip would take the same branch in health's `skipped > 0` test.
    repoRoot = await makeRepo();
    const latest = roundTrip({ positionGuessSkipped: SKIPPED, refsTruncatedSymbols: TRUNCATED });

    expect(typeof latest.positionGuessSkipped).toBe('number');
    expect(typeof latest.refsTruncatedSymbols).toBe('number');
  }, 30_000);

  it('★★ ZERO is preserved and is not collapsed into "unknown"', async () => {
    // The distinction the caveat depends on. `0` means we asked everything and skipped
    // nothing — a rate is honest. `null` means we do not know whether anything was
    // skipped — it is not. A `??` chain written one link too eager turns the first into
    // the second, and every assertion above still passes.
    repoRoot = await makeRepo();
    const latest = roundTrip({ positionGuessSkipped: 0, refsTruncatedSymbols: 0 });

    expect(latest.positionGuessSkipped, 'nothing skipped is a FACT, not an absence').toBe(0);
    expect(latest.refsTruncatedSymbols).toBe(0);
  }, 30_000);

  it('★★ the counters reach graph_health and turn the coverage rate into a FLOOR', async () => {
    // The fifth layer and the reason the other four matter. `coverageIsFloor` is the
    // structured form of "do not read the gap as no callers" — skipped symbols are absent
    // from the numerator but present in the denominator, so the percentage is a lower
    // bound. The old file asserted the SENTENCE existed in health.js; this asserts the
    // verdict is reached for a repo where symbols were actually skipped.
    repoRoot = await makeRepo();
    roundTrip({ positionGuessSkipped: SKIPPED, refsTruncatedSymbols: TRUNCATED });

    const raw = await graphHealth({ repoRoot });
    const h = typeof raw === 'string' ? JSON.parse(raw) : raw;

    expect(h.codeIntel?.positionGuessSkipped, 'the counter must arrive at the health layer').toBe(SKIPPED);
    expect(h.codeIntel?.refsTruncatedSymbols).toBe(TRUNCATED);
    expect(h.codeIntel?.coverageIsFloor, 'a rate computed over unasked symbols is a floor').toBe(true);
    expect(h.codeIntel?.coverageFloorCause).toBe('not_asked_or_capped');
  }, 30_000);

  it('★★ and stays SILENT when nothing was skipped', async () => {
    // A caveat that is always present is noise, and noise on the trust surface is what
    // makes real banners ignorable. This is also what stops the case above passing for a
    // health verb that simply always says FLOOR.
    repoRoot = await makeRepo();
    roundTrip({ positionGuessSkipped: 0, refsTruncatedSymbols: 0 });

    const raw = await graphHealth({ repoRoot });
    const h = typeof raw === 'string' ? JSON.parse(raw) : raw;

    expect(h.codeIntel?.positionGuessSkipped, 'harness sanity: a measured zero, not an absence').toBe(0);
    expect(h.codeIntel?.coverageIsFloor, 'nothing was skipped — the rate is a rate').toBeFalsy();
  }, 30_000);

  it('★ a session that never reported them reads back as null, not as zero', async () => {
    // The other half of the same distinction, and the one that makes it falsifiable:
    // if the layer coerced missing to 0 the case above would pass for the wrong reason.
    repoRoot = await makeRepo();
    const latest = roundTrip({});

    expect(latest.positionGuessSkipped, 'unknown must stay unknown').toBeNull();
    expect(latest.refsTruncatedSymbols).toBeNull();
  }, 30_000);
});
