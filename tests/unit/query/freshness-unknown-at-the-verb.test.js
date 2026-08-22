// ⛔ THE CONSUMER IS WHERE THE DEFECT LIVED, SO THE CONSUMER IS WHERE IT IS PINNED.
//
// WorktreeState's own tests prove the type is honest. They cannot prove the verbs stopped
// laundering it — and laundering at the consumer is the entire finding: `getHeadCommit` was
// ALREADY returning null correctly, and four callers turned that null into a claim.
//
// ⛔ THE INDUCTION IS REAL, NOT MOCKED. Each case builds a temp repo with a graph, then DELETES
// `.git`. Every git query the verb makes then fails for the reason it fails in the field, through
// the real code path, with nothing stubbed. A mock would only prove I can predict my own fix.
//
// ⛔⛔ AND EVERY CASE IS A PAIR. The same repo is asked the same question twice — once healthy,
// once with git removed — because an assertion that only runs on the broken world is satisfied by
// a verb that is broken in both. The healthy half is also the over-correction guard: these lines
// print on every read in the product, so "no new noise on the happy path" is a requirement.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphSearch } from '../../../mcp/stdio/query/verbs/search.js';
import { graphStatus } from '../../../mcp/stdio/query/verbs/status.js';
import { inspectReadFreshness, staleNotFoundCaveat } from '../../../mcp/stdio/query/verbs/read_freshness.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

async function repo() {
  const r = await mkdtemp(join(tmpdir(), 'apg-unk-'));
  await mkdir(join(r, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', r, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', r, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(r, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 1, edges: 0, schemaVersion: 4,
    extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(r, '.aify-graph', 'graph.sqlite'));
  db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
          VALUES ('a','Function','somethingElse','src/a.js',1,2,'javascript',1,'{}')`);
  db.close();
  return r;
}

// The induction. Everything else about the repo — graph, manifest, indexed commit — survives.
async function blindGit(r) {
  await rm(join(r, '.git'), { recursive: true, force: true, maxRetries: 5 });
}

const ABSENT = 'ZZZ_no_such_symbol_98765';

describe('C6 — graph_search may not RULE OUT staleness it never measured', () => {
  it('★★★⛔ THE WORST INSTANCE: "Ruled out: the index is fresh" from a query that never ran', async () => {
    // ⛔⛔ THIS IS THE ONE MY DESIGN WOULD HAVE SHIPPED PAST. I reasoned that making `stale`
    // tri-state was safe because `null` is falsy, so every `if (stale)` consumer keeps its
    // behaviour. True for three consumers. Here the test was `!freshnessState.stale` — and
    // `!null` is `true`, so falsy-preservation PRESERVED THE DEFECT at the only site that turns
    // the value into a positive claim about the index.
    //
    // ⚠ And this is the claim that matters most: it runs inside the NO-RESULTS explanation, where
    // a reader is deciding whether "not found" means "not there". Exonerating the index on a
    // check that did not happen is the absence-claim defect class, in the verb built to prevent it.
    repoRoot = await repo();

    const healthy = await graphSearch({ repoRoot, query: ABSENT });
    expect(healthy, 'POSITIVE CONTROL: when git IS readable the claim is earned and must survive')
      .toMatch(/Ruled out:[^\n]*the index is fresh/);

    await blindGit(repoRoot);
    const blind = await graphSearch({ repoRoot, query: ABSENT });
    // ⛔ A BARE `.not.toMatch()` HERE WOULD BE THE DEFECT UNDER TEST, ONE LEVEL UP. It passes both
    // when the claim is gone and when the regex could never have matched anything — absence
    // asserted by an instrument nobody proved could fire. The repo has a guard that refuses new
    // bare negatives and it caught this file on the first full run.
    expectAbsentWithLiveMatcher(
      /Ruled out:[^\n]*the index is fresh/,
      {
        forbidden: 'Ruled out: the index is fresh.',
        allowed: 'Ruled out: nothing; the index staleness is unknown.',
      },
      blind,
      'an unknown may not be laundered into a ruled-out',
    );
  }, 20_000);

  it('★★★ and the reader is TOLD, rather than merely not lied to', async () => {
    // Dropping the claim silently would leave the reader with an unexplained absence. The
    // disclosure is what converts "we stopped asserting" into "you cannot conclude freshness".
    repoRoot = await repo();
    await blindGit(repoRoot);
    const blind = await graphSearch({ repoRoot, query: ABSENT });
    expect(blind).toMatch(/could not read HEAD|staleness could NOT be determined/i);
  }, 20_000);
});

describe('C1/C2 at the shared warning channel every read verb prints through', () => {
  it('★★★⛔ a failed git query DISCLOSES instead of going quiet', async () => {
    repoRoot = await repo();

    const healthy = await inspectReadFreshness({ repoRoot, verbName: 'graph_test' });
    // ⛔ C3, THE OVER-CORRECTION GUARD — and the assertion I would most regret omitting. Every
    // read verb prints this list. A caveat on the ordinary path is permanent noise on every
    // answer in the product and trains readers to skip the block that carries the real warning.
    expect(healthy.warnings.filter((w) => /could not read/i.test(w)),
      'the healthy path gains NOTHING').toEqual([]);
    expect(healthy.stale, 'and staleness is MEASURED false, not assumed').toBe(false);

    await blindGit(repoRoot);
    const blind = await inspectReadFreshness({ repoRoot, verbName: 'graph_test' });
    expect(blind.stale, 'unknown is null — not the false it used to be').toBeNull();
    const disclosures = blind.warnings.filter((w) => /could not read/i.test(w));
    expect(disclosures.length, 'both halves of the git observation failed').toBe(2);
    expect(disclosures.join('\n'), 'and each says what its silence does NOT mean')
      .toMatch(/not evidence the tree is clean/);
  }, 20_000);
});

describe('the stale not-found caveat distinguishes three states, not two', () => {
  it('★★★⛔ unknown gets its OWN caveat — it is neither "stale" nor silence', () => {
    // The old guard was `if (!freshness || !freshness.stale) return ''`. `!null` is true, so an
    // undetermined staleness fell straight through to the fresh-and-quiet branch and handed the
    // reader a bare "not found" backed by a check that never happened.
    expect(staleNotFoundCaveat({ stale: null }), 'must not be silent')
      .toMatch(/could NOT be determined/);
    expectAbsentWithLiveMatcher(
      /\d+ commits? behind HEAD/,
      { forbidden: 'index is 3 commits behind HEAD', allowed: 'staleness could NOT be determined' },
      staleNotFoundCaveat({ stale: null }),
      'and must not claim the index is behind — that is a measurement it does not have',
    );

    // NEGATIVE CONTROLS: the other two states are unchanged. Without these, the assertion above
    // is satisfied by a function that emits the unknown caveat unconditionally.
    expect(staleNotFoundCaveat({ stale: false }), 'a MEASURED fresh index stays quiet').toBe('');
    expect(staleNotFoundCaveat({ stale: true, commitsBehind: 3 }), 'and a stale one still says so')
      .toMatch(/3 commits behind HEAD/);
    expect(staleNotFoundCaveat(null), 'no freshness object at all is still ""').toBe('');
  });
});

describe('graph_status does not publish an unobserved tree as a clean one', () => {
  it('★★★⛔ dirtyFiles:[] and currentHead:null used to be the whole answer', async () => {
    repoRoot = await repo();

    const healthy = await graphStatus({ repoRoot });
    expect(healthy.worktreeObservationFailed,
      'absent on the happy path — the response is byte-identical to before').toBeUndefined();
    expect(healthy.currentHead).toMatch(/^[0-9a-f]{40}$/u);

    await blindGit(repoRoot);
    const blind = await graphStatus({ repoRoot });
    expect(blind.dirtyFiles, 'the list stays empty — downstream arithmetic must stay total').toEqual([]);
    expect(Array.isArray(blind.worktreeObservationFailed),
      'but it is no longer PRESENTED as a measurement').toBe(true);
    expect(blind.worktreeObservationFailed.join('\n')).toMatch(/not evidence the tree is clean/);
  }, 20_000);
});
