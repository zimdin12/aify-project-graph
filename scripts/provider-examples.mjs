// Regenerate every provider-call example through the real dispatcher/readers, including the live backend.
// Usage: node scripts/provider-examples.mjs, from an indexed checkout. Never builds or refreshes that index.
import { readFileSync, writeFileSync } from 'node:fs';
import { answerRequest, PROVIDER_CALLS } from './lib/provider-requests.mjs';
import { providerReaders } from './lib/provider-readers.mjs';
import { headOf } from './lib/provider-runtime.mjs';
import { shutdownAllSessions } from '../mcp/stdio/code-intel/live.js';

const OUT = 'docs/schemas/examples/provider-answers.v1.json';
const repoRoot = process.cwd();
const head = headOf(repoRoot);
const readers = providerReaders({ repoRoot, head });
const symbol = { path: 'scripts/lib/anchor-resolver.mjs', name: 'resolveAnchor', kind: 'symbol' };
const anchors = [symbol, { path: 'scripts/lib/provider-requests.mjs', kind: 'file' }, { path: 'scripts/no-such-file.mjs', kind: 'file' }];
const source = readFileSync(symbol.path, 'utf8').split('\n');
const line = source.findIndex((s) => s.startsWith(`export function ${symbol.name}(`));
if (line < 0) throw new Error('the example target declaration is missing');
const position = { file: symbol.path, line: line + 1, col: source[line].indexOf(symbol.name) + 1, limit: 5 };
const args = {
  stamp: { anchors }, resolve: { anchors }, subgraph: { anchor: symbol, depth: 1, limit: 5 },
  find: { symbol: symbol.name, file: symbol.path, limit: 5 }, callers: { anchor: symbol, limit: 5 },
  references: position, definitions: position,
};
const answers = {};
try {
  for (const call of PROVIDER_CALLS) {
    answers[call] = await answerRequest({ request: { call, args: args[call] }, ...readers, head });
    if (!answers[call].ok) throw new Error(`${call} example refused: ${answers[call].problem}`);
  }
  answers.refusal = await answerRequest({ request: { call: 'signals', args: {} }, ...readers, head });
} finally {
  await shutdownAllSessions();
}
writeFileSync(OUT, `${JSON.stringify({ generator: 'node scripts/provider-examples.mjs', head, answers }, null, 2)}\n`);
console.log(`wrote ${OUT} at ${head}`);
