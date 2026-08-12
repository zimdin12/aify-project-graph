// A FAKE PRODUCER CANNOT PIN THE REAL ONE.
//
// skip-counters-provider-boundary.test.js registers a FAKE provider that fabricates the
// session object, then asserts the counters come out of the collect verb. That proves
// FORWARDING and nothing else. graph-senior-dev-hermes made the point by mutating the real
// producer instead of the fake one: after all real measurements, immediately before
// cpp-clangd's returned envelope, set both counters to ZERO while leaving every increment
// site untouched. Across the boundary test, the downstream round-trip test, and the
// existing provider test: 14/14 GREEN, `node --check` green.
//
// ⇒ Values I put in are values I get back. That is a statement about my fixture, not about
// the code that is supposed to produce them. The whole five-layer journey was resting on a
// producer nobody had provoked.
//
// ★ This is the same class as every other finding today, in its last remaining hiding
// place: the PART is verified and the SOURCE is assumed. Shutdown written but not wired;
// counters emitted but not persisted; a registry drained but the handle not released.
//
// So this drives the REAL cpp-clangd provider through its injectable `spawn` seam, with a
// fake LSP told to return a NAMED symbol whose identifier does not appear in the source —
// the exact condition `positionGuessSkipped` counts — and requires the provider's own
// session to report it.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createCppClangdProvider } from '../../../mcp/stdio/code-intel/providers/cpp-clangd.js';

const fixtureRepo = path.resolve('tests/fixtures/code-intel/cpp-fixture-repo');
const fakeServer = path.resolve('tests/fixtures/code-intel/lsp/fake-lsp-server.mjs');

// The REAL provider. Only the language-server process is substituted — every counter, every
// increment site and the envelope assembly are production code.
function realProviderWith(env) {
  return createCppClangdProvider({
    spawn: () => ({ command: process.execPath, args: [fakeServer], env: { ...process.env, ...env } }),
  });
}

async function collect(env, operations = ['symbols']) {
  const provider = realProviderWith(env);
  return provider.collect({
    projectRoot: fixtureRepo,
    files: ['src/main.cpp'],
    operations,
    budgetMs: 20_000,
  });
}

describe('the REAL cpp-clangd provider produces the skip counters', () => {
  it('★★ an unplaceable identifier is COUNTED by the producer, not by a fixture', async () => {
    // dev's mutant zeroes these right before the envelope. Nothing downstream can tell the
    // difference — only asking the producer itself can.
    const env = await collect({ FAKE_LSP_UNPLACEABLE: '1' });

    const sess = env?.session ?? {};
    expect(env, 'harness sanity: the real provider must return an envelope').toBeTruthy();
    expect(sess.positionGuessSkipped, 'the producer must report what it could not place')
      .toBeGreaterThan(0);
  }, 60_000);

  it('★★ a symbol OVER the reference cap is counted by the producer', async () => {
    // ⛔ THE SECOND COUNTER WAS PINNED ONLY BY A GREP THAT A COMMENT SATISFIED.
    //
    // dev mutated the real increment at cpp-clangd.js:615 to `+= 0` and left
    // `// refsTruncatedSymbols += 1` as a source-shaped canary. Twenty tests stayed green,
    // because NOTHING in the suite had ever produced a symbol with more than 2000
    // references — the fake boundary supplied the value, and the source-contract test was
    // satisfied by the comment.
    //
    // ⇒ Provider production is TWO rows, not one. Unplaceable-symbol skip was covered;
    // over-cap truncation was not, and "the producer emits counters" was a claim about
    // whichever counter I happened to provoke.
    const env = await collect({ FAKE_LSP_MANY_REFS: '1' }, ['references']);

    const sess = env?.session ?? {};
    expect(env, 'harness sanity: the real provider must return an envelope').toBeTruthy();
    expect(sess.refsTruncatedSymbols, 'a symbol over the per-symbol cap must be counted')
      .toBeGreaterThan(0);
  }, 60_000);

  it('★★ and reports ZERO truncations when every symbol is under the cap', async () => {
    // The discriminating half: without it, a provider that always reported a positive
    // number would satisfy the case above.
    const env = await collect({}, ['references']);

    const sess = env?.session ?? {};
    expect(env, 'harness sanity: the real provider must return an envelope').toBeTruthy();
    expect(sess.refsTruncatedSymbols, 'nothing was truncated, and that is a measured fact')
      .toBe(0);
  }, 60_000);

  it('★★ and reports ZERO when every identifier IS placeable — not null, not absent', async () => {
    // The discriminating half. Without it the case above is satisfied by a provider that
    // always reports a positive number, and the 0-vs-null distinction the counter exists
    // for would be untested at the source.
    const env = await collect({});

    const sess = env?.session ?? {};
    expect(env, 'harness sanity: the real provider must return an envelope').toBeTruthy();
    expect(sess.positionGuessSkipped, 'a measured zero is a FACT, not an absence').toBe(0);
  }, 60_000);
});
