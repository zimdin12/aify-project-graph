// `npm test` MUST BE CONFIGURED BY vitest.config.js. IT WAS NOT, FOR TWO SETTINGS THAT
// DECIDE WHETHER THE SUITE PASSES.
//
// ⛔ scripts/run-vitest.mjs passed `config: false` and `pool: 'threads'` to startVitest, so
// vitest.config.js was never loaded by the project's own test command. The config pins
// `pool: 'forks'` (relative-reporoot.test.js calls process.chdir(), which throws in the
// `threads` pool) and `fileParallelism: false` (real clangd/tsserver/pyright tests lose CPU
// races when run concurrently). Both pins were authored INTO THE CONFIG while the runner
// was already discarding it.
//
// ★ Measured 2026-08-18 on one unchanged tree: `node node_modules/vitest/vitest.mjs run`
// gave 243 files / 1800 passed / 0 failed. `node scripts/run-vitest.mjs` — the npm test
// script — gave 4 failed. The documented command was the one that lied, and its failures
// read as three flaky tests rather than as a config that was never loaded.
//
// ⇒ The previous fix for this was A COMMENT IN THE CONFIG saying the requirement "travels
// with the repo rather than with my installed version". It did not travel as far as the
// repo's own test script. A rule is not a remedy, so this asserts on the LIVE resolved
// config of the run it is executing inside — whichever runner started it.
//
// ★★ Why the testTimeout arm is not filler: `config: false` does NOT change the pool on
// this vitest (its default is already `forks`), so a pool assertion alone cannot see that
// defect — the mutation was run and it stayed green. What `config: false` does change is
// every OTHER pinned value. testTimeout 120000 vs vitest's default 5000 is therefore the
// arm that proves the file was loaded at all. Verified by mutation, not by reasoning:
// re-adding `config: false` yields testTimeout=5000, hookTimeout=10000.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const resolved = globalThis.__vitest_worker__?.config;

describe('the running suite is configured by vitest.config.js', () => {
  it('★★ the resolved config is actually readable (liveness)', () => {
    // Every assertion below reads `resolved`. If vitest stops exposing it, they would all
    // silently compare `undefined` against nothing and pass — a green result from a check
    // that saw no configuration at all. This is the arm that turns that into a red.
    expect(resolved, 'cannot read the running config — the arms below prove nothing').toBeTruthy();
    expect(typeof resolved.pool, 'resolved config has no pool field').toBe('string');
  });

  it('★★★ pool is forks — process.chdir() throws in the threads pool', () => {
    // tests/unit/freshness/relative-reporoot.test.js calls process.chdir() to prove a
    // relative repoRoot resolves like an absolute one. Under `threads` it dies with
    // "process.chdir() is not supported in workers", which reads as a broken test.
    expect(resolved.pool).toBe('forks');
  });

  it('★★★ vitest.config.js was loaded at all — not bypassed with config:false', () => {
    // The sentinel: these values exist ONLY in vitest.config.js. Vitest's defaults are
    // 5000/10000. If a runner passes `config: false` the whole file is discarded —
    // including fileParallelism, which has no worker-visible field of its own.
    expect(resolved.testTimeout, 'testTimeout is not the configured 120000 — was vitest.config.js loaded?').toBe(120000);
    expect(resolved.hookTimeout, 'hookTimeout is not the configured 120000 — was vitest.config.js loaded?').toBe(120000);
  });

  it('★★★ the config still carries the pool pin', () => {
    // The arm above proves the file was loaded, and this proves the loaded file still says what it must. A runner
    // correctly deferring to a config that had lost the pin would otherwise be the same failure with the blame moved.
    const configSrc = readFileSync(join(import.meta.dirname, '..', '..', 'vitest.config.js'), 'utf8');
    expect(configSrc, 'pool: forks — process.chdir() throws in the threads pool')
      .toMatch(/pool\s*:\s*['"]forks['"]/);
  });

  it('★★★ the shared-host worker budget is explicitly bounded at eight (#10)', async () => {
    const config = (await import('../../vitest.config.js')).default;
    const workers = config.test.maxWorkers;
    expect(Number.isInteger(workers), 'an unset budget lets Vitest take all but one available CPU').toBe(true);
    expect(workers).toBeGreaterThanOrEqual(1);
    expect(workers).toBeLessThanOrEqual(8);
  });

  it('★★★ real language-server files run in a serial tier that starts after the parallel tier finishes (#10)', async () => {
    // Workers cannot see the other project's settings, so this reads the config object. Concurrent clangd / tsserver
    // / pyright starve each other of CPU and a correct cross-file query fails; the lsp tier must be one fork, one
    // file at a time, in a later group than everything else, and the parallel tier must carry the guard that
    // refuses a server.
    const config = (await import('../../vitest.config.js')).default;
    const project = (name) => config.test.projects.find((p) => p.test?.name === name)?.test;
    const unit = project('unit'); const lsp = project('lsp');
    expect(lsp?.poolOptions?.forks?.singleFork, 'the lsp tier runs in a single fork').toBe(true);
    expect(lsp.sequence.groupOrder, 'the lsp tier runs after the unit tier').toBeGreaterThan(unit.sequence.groupOrder);
    expect(unit.setupFiles.some((f) => f.includes('unit-tier.setup')), 'the unit tier refuses a language server').toBe(true);
    expect(lsp.include.length, 'the lsp tier is not empty').toBeGreaterThan(0);
    expect(unit.exclude, 'every lsp-tier file is kept out of the unit tier').toEqual(expect.arrayContaining(lsp.include));
  });

  it('★★ both tiers record product-source reads for the ratchet, the lsp tier included (#10)', async () => {
    // A worker can only observe its own tier; the lsp tier's wiring is visible here and nowhere else.
    const config = (await import('../../vitest.config.js')).default;
    for (const name of ['unit', 'lsp']) {
      const tier = config.test.projects.find((p) => p.test?.name === name).test;
      expect(tier.setupFiles.some((f) => f.includes('source-text-reads.setup')), name).toBe(true);
    }
  });
});
