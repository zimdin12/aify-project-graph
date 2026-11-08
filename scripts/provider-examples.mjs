// Regenerate docs/schemas/examples/provider-answers.v1.json through the REAL provider path (#1).
//
// Wired exactly as serve-provider-requests.mjs wires a claimed request: the real instruments reading the commit, the
// real subgraph reader on this repository's index, and answerRequest. Only the queue is left out. Run it from the
// repository root after an index build; the examples name the commit they were read at.
// Usage: node scripts/provider-examples.mjs
import { writeFileSync } from 'node:fs';
import { resolveAnchor } from './lib/anchor-resolver.mjs';
import { makeInstruments, headOf } from './lib/provider-runtime.mjs';
import { answerRequest } from './lib/provider-requests.mjs';
import { readSubgraph } from './lib/provider-subgraph.mjs';

const OUT = 'docs/schemas/examples/provider-answers.v1.json';
const repoRoot = process.cwd();
const head = headOf(repoRoot);
const instruments = makeInstruments(repoRoot, { at: head });
const ask = (call, args) => answerRequest({
  request: { call, args },
  resolveItem: (item) => resolveAnchor({ repoRoot, item, deps: instruments }),
  readSubgraph: (parsed) => readSubgraph({ repoRoot, request: parsed, head }),
  head,
});

const anchors = [
  { path: 'scripts/lib/anchor-resolver.mjs', name: 'resolveAnchor', kind: 'symbol' },
  { path: 'scripts/lib/provider-requests.mjs', kind: 'file' },
  { path: 'scripts/no-such-file.mjs', kind: 'file' },
];
const answers = {
  stamp: ask('stamp', { anchors }),
  resolve: ask('resolve', { anchors }),
  subgraph: ask('subgraph', { anchor: anchors[0], depth: 1, limit: 5 }),
  refusal: ask('signals', {}),
};
if (!answers.subgraph.ok) throw new Error(`subgraph example refused: ${answers.subgraph.problem}`);
writeFileSync(OUT, `${JSON.stringify({ generator: 'node scripts/provider-examples.mjs', head, answers }, null, 2)}\n`);
console.log(`wrote ${OUT} at ${head}`);
