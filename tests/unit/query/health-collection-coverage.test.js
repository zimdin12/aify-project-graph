// A COLLECTION EXISTING IS NOT A COLLECTION COVERING ANYTHING.
//
// ⛔ FOUND BY RUNNING THE FIRST CODE-INTEL COLLECTION THIS REPO HAS EVER HAD. `graph_health` had
// been naming "no code-intel collection" as its top next action for the life of the repo, so I ran
// one — scoped to three files, to see whether it worked at all. It did. And then:
//
//     the response said        filesProcessed 3 · filesTotal 3      -> reads as 100%
//     the stored row said      status ok, mode null                 -> no scope recorded at all
//     graph_health then said   nextActions: []                      -> its ONLY code-intel
//                                                                       warning went silent
//
// `filesTotal` was the SCOPE's denominator, not the repo's. 3 of 3 is complete. 3 of 484 is 0.6%.
// Same defect as every other denominator this repo has shipped: a ratio over the population the
// code happened to look at rather than the population the claim is about.
//
// ⚠ AND `nextActions: []` IS DOCUMENTED AS MEANING A HEALTHY REPO — "EMPTY on a healthy repo,
// which is what makes a populated list mean something". So a 0.6% collection did not merely fail
// to warn; it actively asserted health.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { ensureCodeIntelCollectionsTable, ensureCodeIntelRecordsTable } from '../../../mcp/stdio/storage/schema.js';

let repo;
afterEach(async () => {
  if (repo) { try { await rm(repo, { recursive: true, force: true }); } catch { /* win lock */ } }
  repo = undefined;
});

/** A repo with a graph, one lsp-verified edge, and a collection row we control. */
async function repoWithCollection(coverage) {
  repo = await mkdtemp(join(tmpdir(), 'apg-cov-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t',
    'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 2, edges: 1, schemaVersion: 4,
    extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  ensureCodeIntelCollectionsTable(db);
  const node = (id, file) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ($id,'Function',$id,$f,1,1,'typescript',1,'{}')`, { id, f: file });
  node('a', 'src/a.ts'); node('b', 'src/b.ts');
  // ⛔ THE FIXTURE NOW BUILDS THE POPULATION IT CLAIMS, AND THAT IS THE FIX RATHER THAN THE COST.
  //
  // It used to insert TWO file nodes and store `files_eligible: 484`. Health read the stored number
  // and agreed, so the test passed against a graph that contradicted its own denominator. Once
  // health began MEASURING eligibility instead of trusting the row, the live answer was 2 — correct
  // about the graph, and fatal to a fixture asserting 484.
  //
  // ⇒ A fixture that states a number the artifact does not contain can only ever test that the
  // number was echoed back. Building the files makes the ratio real.
  if (coverage.eligible != null) {
    for (let i = 0; i < coverage.eligible - 2; i += 1) node(`e${i}`, `src/gen/e${i}.ts`);
  }
  // Records are what `coveredFileCount` counts — the numerator is now measured across every live
  // collection rather than taken from the latest one's `files_processed`.
  ensureCodeIntelRecordsTable(db);
  for (let i = 0; i < (coverage.processed ?? 0); i += 1) {
    const f = i === 0 ? 'src/a.ts' : i === 1 ? 'src/b.ts' : `src/gen/e${i - 2}.ts`;
    db.run(
      `INSERT INTO code_intel_records (collection_id,kind,language,symbol_id,qname,file,raw)
       VALUES ('c1','references','typescript',$s,$q,$f,'{}')`,
      { s: `s${i}`, q: `q${i}`, f },
    );
  }
  // ⚠ An lsp-verified edge, so the "no [lsp✓] edges" branch cannot be what fires. Without this
  // the test would pass against a completely different condition.
  db.run(
    `INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
     VALUES ('a','b','CALLS','src/a.ts',1,1,'LSP_VERIFIED','ts-langserver')`);
  db.run(
    `INSERT INTO code_intel_collections
       (collection_id, provider, provider_version, project_root, language, status,
        collected_at, index_ready, files_processed, files_in_scope, files_eligible)
     VALUES ('c1','ts-langserver','0.1.0',$root,'typescript','ok',$at,1,$p,$s,$e)`,
    {
      root: repo, at: new Date().toISOString(),
      p: coverage.processed, s: coverage.inScope, e: coverage.eligible,
    });
  db.close();
  return repo;
}

const codeIntelAction = (h) => (h.nextActions ?? [])
  .find((a) => /code-intel collection/.test(a.why ?? ''));

describe('health reports what a collection COVERS, not that one exists', () => {
  it('★★★ a SCOPED collection warns, naming both real numbers', async () => {
    await repoWithCollection({ processed: 3, inScope: 3, eligible: 484 });
    const h = await graphHealth({ repoRoot: repo });

    expect(h.codeIntel.available, 'the collection is present').toBe(true);
    expect(h.codeIntel.coverage.complete, '3 of 484 is not complete').toBe(false);

    const action = codeIntelAction(h);
    expect(action, 'a partial collection must not produce an empty nextActions').toBeTruthy();
    expect(action.why, 'names what it covered').toContain('3 of 484');
  }, 30_000);

  it('★★★ UNKNOWN coverage warns too — three states, not two', async () => {
    // ⛔ A collection stored before these columns existed reports null. Null is NOT evidence of
    // coverage, and treating it as complete is the seventh two-state collapse this repo has found
    // — every one of which failed in the reassuring direction.
    await repoWithCollection({ processed: null, inScope: null, eligible: null });
    const h = await graphHealth({ repoRoot: repo });

    expect(h.codeIntel.coverage.complete, 'cannot answer').toBeNull();
    const action = codeIntelAction(h);
    expect(action, 'unknown coverage is not clean coverage').toBeTruthy();
    expect(action.why).toContain('UNKNOWN');
  }, 30_000);

  it('★★★ a COMPLETE collection is silent — or the warning is permanent and worthless', async () => {
    // ⛔ THE CONTROL, AND WITHOUT IT THE OTHER TWO ARE SATISFIED BY A VERB THAT ALWAYS WARNS.
    // A warning that fires on every repo is discarded exactly as completely as one that never
    // fires, and this file exists because the second failure mode had already happened.
    await repoWithCollection({ processed: 484, inScope: 484, eligible: 484 });
    const h = await graphHealth({ repoRoot: repo });

    expect(h.codeIntel.coverage.complete).toBe(true);
    expect(codeIntelAction(h), 'full coverage has nothing to say').toBeUndefined();
  }, 30_000);

  it('★★★ files_in_scope is stored SEPARATELY from the eligible population', async () => {
    // The naming is the fix. `filesTotal` meant "the scope's total" and read as "the repo's
    // total", so 3 of 3 looked like completeness. Keeping both, under names that cannot be
    // confused, is what makes the ratio checkable rather than assertable.
    await repoWithCollection({ processed: 3, inScope: 3, eligible: 484 });
    const h = await graphHealth({ repoRoot: repo });
    // ⚠ THE NAME CARRIES THE POPULATION. `filesInScope` sat beside a repo-wide `filesEligible`
    // with nothing saying it belonged to the latest collection, so the obvious ratio was 553/3.
    expect(h.codeIntel.coverage.filesInScopeLatestCollection, 'what THAT run set out to do').toBe(3);
    expect(h.codeIntel.coverage.filesInScope, 'the unqualified name is gone, not merely deprecated')
      .toBeUndefined();
    expect(h.codeIntel.coverage.filesEligible, 'what the claim is about').toBe(484);
    // ⚠ And it says WHERE each half came from. A denominator measured now and one frozen at
    // collection time answer different questions, and a reader cannot tell them apart from the
    // number alone — the stored row on this repo read 593 while the live count said 557.
    expect(h.codeIntel.coverage.filesEligibleSource).toBe('measured_now');
    expect(h.codeIntel.coverage.filesProcessedSource).toBe('all_live_collections');
    expect(h.codeIntel.coverage.filesProcessedLatestCollection, 'the per-collection fact survives')
      .toBe(3);
    expect(h.codeIntel.coverage.filesInScopeLatestCollection)
      .not.toBe(h.codeIntel.coverage.filesEligible);
    // ⛔ EVERY POPULATION FIELD IN THIS BLOCK NAMES ITS POPULATION — derived, so a field added
    // later without one turns this red rather than quietly joining three populations under one
    // set of names. `filesInScope` was exactly that: the latest collection's scope sitting beside
    // a repo-wide `filesEligible`, so the obvious ratio a reader computes is 553/3.
    const cov = h.codeIntel.coverage;
    const populationFields = Object.keys(cov)
      .filter((k) => /^files/.test(k))
      // A `*Source` key IS the annotation, not a population needing one.
      .filter((k) => !/Source$/.test(k));
    const unnamed = populationFields.filter((k) => !(
      /LatestCollection$/.test(k) || /AtCollection$/.test(k) || `${k}Source` in cov
    ));
    expect(unnamed,
      'each of these must end in LatestCollection/AtCollection or carry a companion *Source key')
      .toEqual([]);
    // ⚠ POSITIVE CONTROL: the rule is only meaningful if it inspects a non-empty set, and an
    // empty `populationFields` would satisfy the assertion above for the wrong reason.
    expect(populationFields.length, 'the check actually looked at fields').toBeGreaterThan(2);
  }, 30_000);
});
