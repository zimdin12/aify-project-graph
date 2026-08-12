// THE FIRST TWO LAYERS OF A FIVE-LAYER CLAIM WERE NEVER EXERCISED.
//
// skip-counters-survive-the-write.test.js says it puts values in "at the provider
// boundary" and replaces five greps with one journey. graph-senior-dev-hermes checked:
// it hand-builds the session object and calls importV02Collection DIRECTLY, importing
// neither the provider nor the collect verb. They removed the real provider emissions
// (cpp-clangd.js) AND the collect forwarding (collect_code_intel.js) and it stayed 6/6
// GREEN.
//
// ⇒ The importer→storage→query→health half is genuinely behavioural. The provider→collect
// half was carried by a fabricated envelope, and a fabricated downstream envelope can only
// ever claim the SUFFIX of the journey it actually executes. That is dev's boundary-journey
// template, and this file is the missing prefix.
//
// ★ It invokes the EARLIEST public entrypoint — graphCollectCodeIntel — with a fake
// provider registered in the real registry. So the assertion covers: provider session →
// collect verb summary. Nothing is hand-assembled downstream of the provider.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { registerProvider } from '../../../mcp/stdio/code-intel/providers/index.js';
import { graphCollectCodeIntel } from '../../../mcp/stdio/query/verbs/collect_code_intel.js';

// Distinct primes so a value arriving in the wrong field is a visible mismatch.
const SKIPPED = 7;
const TRUNCATED = 3;

let repoRoot;

// A provider that does nothing except report the two counters. Its whole job is to be the
// SOURCE of the values, so that what comes out of the verb has demonstrably travelled.
// ⚠ It must claim the `cpp-clangd` SLOT, not a new name. runner.js resolves the provider
// through a hardcoded PROVIDER_BY_LANGUAGE map, so an unknown language returns
// `language_unsupported` and the verb never runs — my first attempt registered
// `fake-lang` and got exactly that. ensureBuiltinProviders() only registers a builtin when
// the slot is EMPTY, so registering here first wins without patching anything.
const PROVIDER_SLOT = 'cpp-clangd';
const LANGUAGE = 'cpp';

function fakeProvider(session) {
  return () => ({
    name: PROVIDER_SLOT,
    version: 'fake 1.0',
    async collect() {
      // ⚠ PRODUCTION-SHAPED, not merely plausible. The first version omitted
      // `collectionId` and `projectRoot`, so the import hit
      // `NOT NULL constraint failed: code_intel_collections.project_root` and the verb
      // returned status:"error" / importFailed:true — and the test string-matched the
      // counters INSIDE that failed response and passed. Values appearing in an error
      // envelope do not prove the journey completed. Same liveness class as the
      // exact-anchor case, one layer up, in the test written to close a liveness gap.
      return {
        schemaVersion: '0.2',
        collectionId: `ci-test-${session.positionGuessSkipped ?? 'na'}-${session.refsTruncatedSymbols ?? 'na'}`,
        status: 'ok',
        provider: PROVIDER_SLOT,
        providerVersion: 'fake 1.0 (test double)',
        projectRoot: repoRoot,
        language: LANGUAGE,
        repoCommit: 'abc1234',
        createdAt: new Date().toISOString(),
        operations: { requested: ['references'] },
        records: [],
        session,
      };
    },
  });
}

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-provboundary-'));
  await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repoRoot, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoRoot, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
});

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
  repoRoot = undefined;
});

const asObj = (r) => (typeof r === 'string' ? JSON.parse(r) : r);

// Runs the real verb against the fake provider and returns whatever it reports.
async function collectWith(session) {
  registerProvider(PROVIDER_SLOT, fakeProvider(session));
  const res = asObj(await graphCollectCodeIntel({
    repoRoot, language: LANGUAGE, scope: 'all', operations: ['references'],
  }));

  // ★★ SAME-CALL LIVENESS, and it is the reason this helper exists rather than each case
  // calling the verb directly. Without these two lines every assertion below is satisfied
  // by an ERROR response that happens to echo the counters back — which is exactly what
  // was happening.
  expect(res.status, `LIVENESS: the collection must have completed, got: ${JSON.stringify(res.errors ?? res.status)}`)
    .toBe('ok');
  expect(res.importFailed, 'LIVENESS: the import must not have failed').toBeFalsy();

  // ⚠ IDENTITY, from dev's addendum: the fake originally claimed provider `pyright` while
  // occupying the `cpp-clangd` slot and three cases stayed green. The slot, the envelope's
  // own claim, and the public response must agree, or the test is describing a provider
  // that never ran.
  expect(res.provider, 'the reported provider must be the slot that was registered')
    .toBe(PROVIDER_SLOT);
  return res;
}

describe('the counters travel from the PROVIDER through the collect verb', () => {
  it('★★ what the provider session reports is what the verb reports', async () => {
    // The prefix of the journey the sibling file claimed but never ran. If the collect
    // verb stops forwarding these — dev's exact mutation — this goes red, and nothing
    // downstream of the importer is involved in saying so.
    const res = await collectWith({
      mode: 'full', indexReady: true,
      positionGuessSkipped: SKIPPED, refsTruncatedSymbols: TRUNCATED,
    });

    const text = JSON.stringify(res);
    expect(text, 'harness sanity: the fake provider must have been used').toMatch(/test double/);
    expect(text, 'the skip count must survive the provider→verb boundary')
      .toMatch(new RegExp(`"positionGuessSkipped":\\s*${SKIPPED}`));
    expect(text, 'and so must the truncation count')
      .toMatch(new RegExp(`"refsTruncatedSymbols":\\s*${TRUNCATED}`));
  }, 30_000);

  it('★★ ZERO is forwarded as zero, not dropped into "unknown"', async () => {
    // The distinction the whole counter exists for: 0 means we asked everything, null
    // means we do not know whether anything was skipped. A `??` chain one link too eager
    // turns the first into the second and every other assertion still passes.
    const res = await collectWith({
      mode: 'full', indexReady: true,
      positionGuessSkipped: 0, refsTruncatedSymbols: 0,
    });

    const text = JSON.stringify(res);
    expect(text, 'a measured zero is a FACT, not an absence').toMatch(/"positionGuessSkipped":\s*0/);
    expect(text).toMatch(/"refsTruncatedSymbols":\s*0/);
  }, 30_000);

  it('★ a provider that reports nothing yields null, never a fabricated zero', async () => {
    // The other half, and what makes the case above falsifiable: if the verb coerced
    // missing to 0, "zero is preserved" would pass for entirely the wrong reason.
    const res = await collectWith({ mode: 'full', indexReady: true });

    const text = JSON.stringify(res);
    expect(text, 'unknown must stay unknown').toMatch(/"positionGuessSkipped":\s*null/);
    expect(text).toMatch(/"refsTruncatedSymbols":\s*null/);
  }, 30_000);
});
