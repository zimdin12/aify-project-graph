// Keep `npm test` consistent with MCP startup: if this checkout was last used
// from another platform (Windows vs WSL), the preflight rebuilds better-sqlite3
// once before Vitest boots.
import '../mcp/stdio/preflight-native.js';
import { startVitest } from 'vitest/node';

const args = process.argv.slice(2);
const watchIndex = args.indexOf('--watch');
const mode = watchIndex >= 0 ? 'watch' : 'test';
const filters = watchIndex >= 0
  ? args.slice(0, watchIndex).concat(args.slice(watchIndex + 1))
  : args;

// ⛔ THIS RUNNER USED TO PASS `config: false` AND `pool: 'threads'`, WHICH DISCARDED
// vitest.config.js ENTIRELY — the file `npm test` is supposed to be configured by.
//
// vitest.config.js pins two settings and explains at length why each is load-bearing:
// `pool: 'forks'` (relative-reporoot.test.js calls process.chdir(), which THROWS in the
// `threads` pool) and `fileParallelism: false` (real clangd/tsserver/pyright tests lose
// races for CPU when run concurrently). Both were written INTO THE CONFIG while this
// runner was already ignoring it, so `npm test` ran threads-parallel and failed 4 tests
// that pass under `node node_modules/vitest/vitest.mjs`. Same tree, two runners, two
// answers — and the documented command was the one that lied.
//
// ★ The config's own comment claims the requirement "travels with the repo rather than
// with my installed version". It did not travel as far as the repo's own test script.
// That is the recurring shape here: the fix reached one emitter, not the one people use.
//
// ⇒ Nothing about the suite is configured here now. include / timeouts / pool /
// fileParallelism have exactly one home. Guarded by tests/unit/test-runner-config.test.js.
const ctx = await startVitest(mode, filters, {
  run: mode !== 'watch',
  watch: mode === 'watch',
});

if (!ctx) {
  process.exit(1);
}

if (mode === 'watch') {
  await new Promise(() => {});
}

const failed = ctx.state.getCountOfFailedTests?.() ?? 0;
const errors = ctx.state.getCountOfErrors?.() ?? 0;

await ctx.close();

process.exit(failed || errors ? 1 : 0);
