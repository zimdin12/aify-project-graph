import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // REAL-SERVER TESTS MUST NOT RACE EACH OTHER.
    //
    // tests/integration/code-intel/* each spawn a real language server (clangd,
    // tsserver, pyright). Run concurrently they compete for CPU, and a cross-TU
    // reference query can be issued before the server has finished parsing its
    // warmup files — so a legitimately-absent caller fails the assertion. It
    // reproduced twice under full-suite load and passed every time in isolation.
    //
    // Two earlier fixes were the wrong shape: waiting on INDEX readiness (the index
    // being ready is not the same as this file being parsed), then waiting on the
    // per-file parse signal. The second was right on its own terms and made the
    // product more honest — batchWarmup no longer sleeps a fixed duration — but no
    // wait can conjure CPU that four concurrent language servers are already using.
    //
    // The remaining cause is contention, so the fix is scheduling, not another
    // timeout. A flaky test is worse than a slow one: it teaches the reader to
    // re-run rather than to look, which is exactly how a real regression gets waved
    // through.
    fileParallelism: false,
  },
});
