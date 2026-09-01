#!/usr/bin/env node
// Does EVERY admitted location record cover the token it claims?
//
// ★ STORED RANGES ARE 1-BASED FOR BOTH LINE AND COLUMN.
// `rangeFromLsp` adds one to the 0-based LSP wire values. LSP positions are 0-based; the stored
// `range.start.line` / `range.start.col` are NOT. Any probe indexing a document by a stored range
// must subtract one from each.
//
// ⚠ This sentence exists because the first version of this probe read stored ranges as 0-based and
// reported "0 of 2001 admitted locations cover their token". Every slice came back empty. Trusting
// it would have produced a report that the coherence guard admits 2001 incoherent locations — a
// fabricated defect in freshly written code, carrying a precise and entirely wrong number. A wrong
// zero that agrees with the story you are already telling produces no collision, so nothing
// prompts the check.
//
// Usage: node scripts/verify-token-membership.mjs [fixtureRepo] [fakeLspServer]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCppClangdProvider } from '../mcp/stdio/code-intel/providers/cpp-clangd.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const fixtureRepo = path.resolve(process.argv[2] ?? path.join(REPO, 'tests/fixtures/code-intel/cpp-fixture-repo'));
const fakeServer = path.resolve(process.argv[3] ?? path.join(REPO, 'tests/fixtures/code-intel/lsp/fake-lsp-server.mjs'));

const provider = createCppClangdProvider({
  spawn: () => ({
    command: process.execPath,
    args: [fakeServer],
    env: { ...process.env, FAKE_LSP_MANY_REFS: '1' },
  }),
});

const result = await provider.collect({
  projectRoot: fixtureRepo,
  operations: ['references', 'definitions'],
  files: ['src/foo.cpp'],
});

const records = (result.records ?? []).filter((r) => ['reference', 'definition'].includes(r.kind));
const cache = new Map();
const linesOf = (rel) => {
  if (!cache.has(rel)) cache.set(rel, fs.readFileSync(path.join(fixtureRepo, rel), 'utf8').split(/\r?\n/u));
  return cache.get(rel);
};

const coveredText = (rec) => {
  const line = linesOf(String(rec.file))[rec.range.start.line - 1]; // 1-based -> 0-based
  return String(line ?? '').slice(rec.range.start.col - 1, rec.range.end.col - 1);
};

let covering = 0;
const violations = [];
for (const rec of records) {
  const leaf = String(rec.qname ?? '').split('::').pop();
  if (coveredText(rec).includes(leaf)) covering += 1;
  else if (violations.length < 5) {
    violations.push({ file: rec.file, line: rec.range.start.line, covered: coveredText(rec), expected: leaf });
  }
}

console.log(`admitted location records : ${records.length}`);
console.log(`ranges covering token     : ${covering}`);
console.log(`violations                : ${violations.length} ${JSON.stringify(violations)}`);

// POSITIVE CONTROL. Without it, "N of N" proves only that the checker always says yes. Shifting a
// known-good range by two columns must stop it covering the token.
const sample = records[0];
if (sample) {
  const line = linesOf(String(sample.file))[sample.range.start.line - 1];
  const shifted = String(line).slice(sample.range.start.col + 1, sample.range.end.col + 1);
  const leaf = String(sample.qname ?? '').split('::').pop();
  console.log(`control (range shifted +2): ${JSON.stringify(shifted)} -> covers token? ${shifted.includes(leaf)}`);
}

const pass = records.length > 0 && covering === records.length;
console.log(pass ? 'PASS — every admitted range covers its claimed token' : 'FAIL');
process.exit(pass ? 0 : 1);
