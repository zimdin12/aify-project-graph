// Before/after token measurement for compact output mode.
import { graphImpact } from '../mcp/stdio/query/verbs/impact.js';
import { graphCallers } from '../mcp/stdio/query/verbs/callers.js';
import { graphPath } from '../mcp/stdio/query/verbs/path.js';

const repo = '/mnt/c/Docker/aify-project-graph';
const cases = [
  ['impact',  () => graphImpact({ repoRoot: repo, symbol: 'ensureFresh', depth: 2 })],
  ['callers', () => graphCallers({ repoRoot: repo, symbol: 'ensureFresh' })],
  ['path',    () => graphPath({ repoRoot: repo, symbol: 'graphPath' })],
];

const mode = process.env.AIFY_GRAPH_OUTPUT || 'verbose';
for (const [name, fn] of cases) {
  const r = await fn();
  console.log(`${name.padEnd(8)} ${mode.padEnd(8)} bytes=${String(r.length).padStart(5)} tok=~${Math.ceil(r.length/4)}`);
}
