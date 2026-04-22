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

const ctx = await startVitest(mode, filters, {
  run: mode !== 'watch',
  watch: mode === 'watch',
  config: false,
  pool: 'threads',
  include: ['tests/**/*.test.js'],
  testTimeout: 30000,
  hookTimeout: 30000,
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
