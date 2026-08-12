#!/usr/bin/env node
// EQUIVALENCE ORACLE FOR A PURE-MOVE REFACTOR.
//
// A refactor slice claims one thing: THE OUTPUT DID NOT CHANGE. The test suite cannot
// establish that — it asserts the properties someone thought to assert, and a move can
// alter something nobody pinned. So a move needs its own instrument: capture every byte
// the generator produces BEFORE, capture again AFTER, diff.
//
// ⚠ DELIBERATELY NOT A COMMITTED SNAPSHOT TEST, and the reason is the lesson of this whole
// session. A stored golden file is a WORDING CONTRACT: it pins whatever the prose happens
// to say and goes red on every legitimate content change, so it trains its owner to
// regenerate it without reading the diff. That is how a false sentence gets defended by a
// green suite. This is a two-shot tool instead — capture, move code, compare, delete. It
// exists only for the duration of a slice and nothing outlives it.
//
//   node scripts/refactor-oracle.mjs capture <label>
//   node scripts/refactor-oracle.mjs compare <label>
//
// Exit 0 = byte-identical. Exit 1 = the move changed behaviour, with the first differing
// line shown.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(repoRoot, '.aify-graph', '.refactor-oracle');

// The four artefacts generateBrief writes. All of them, because a move that changes only
// the JSON while the markdown is stable is exactly the kind of thing a partial check misses.
const ARTEFACTS = ['brief.json', 'brief.agent.md', 'brief.onboard.md', 'brief.plan.md'];

const [, , mode, label = 'default'] = process.argv;
if (!['capture', 'compare'].includes(mode)) {
  console.error('usage: refactor-oracle.mjs capture|compare <label>');
  process.exit(2);
}

const { generateBrief } = await import(pathToFileURL(join(repoRoot, 'mcp/stdio/brief/generator.js')).href);

// Regenerate against THIS repo — the largest real fixture available, and the one whose
// brief is most likely to exercise every branch.
generateBrief({ repoRoot });

const read = (name) => {
  const p = join(repoRoot, '.aify-graph', name);
  return existsSync(p) ? readFileSync(p, 'utf8') : `<<MISSING: ${name}>>`;
};

// ⚠ Timestamps and commit hashes move on their own and would swamp a real difference.
// Normalised rather than ignored, so a change in their SHAPE still shows up.
const normalise = (s) => s
  .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<ISO>')
  .replace(/\b[0-9a-f]{7,40}\b/g, '<SHA>')
  .replace(/\r\n/g, '\n');

const snapshot = Object.fromEntries(ARTEFACTS.map((a) => [a, normalise(read(a))]));
const digest = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

if (mode === 'capture') {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${label}.json`), JSON.stringify(snapshot, null, 2));
  for (const a of ARTEFACTS) console.log(`  ${a.padEnd(18)} ${digest(snapshot[a])}  ${snapshot[a].length} chars`);
  console.log(`captured "${label}" — now move the code, then: node scripts/refactor-oracle.mjs compare ${label}`);
  process.exit(0);
}

const prevPath = join(OUT, `${label}.json`);
if (!existsSync(prevPath)) {
  console.error(`no capture named "${label}" — run capture BEFORE moving code`);
  process.exit(2);
}
const prev = JSON.parse(readFileSync(prevPath, 'utf8'));

let failed = false;
for (const a of ARTEFACTS) {
  const before = prev[a] ?? '<<ABSENT>>';
  const after = snapshot[a];
  if (before === after) {
    console.log(`  ✓ ${a.padEnd(18)} identical (${digest(after)})`);
    continue;
  }
  failed = true;
  const b = before.split('\n');
  const n = after.split('\n');
  const i = b.findIndex((line, idx) => line !== n[idx]);
  console.log(`  ✗ ${a.padEnd(18)} CHANGED — first difference at line ${i + 1}`);
  console.log(`      before: ${JSON.stringify((b[i] ?? '<eof>').slice(0, 110))}`);
  console.log(`      after:  ${JSON.stringify((n[i] ?? '<eof>').slice(0, 110))}`);
}

if (failed) {
  console.error('\n⛔ the move changed behaviour — a refactor slice must be a MOVE, not a rewrite');
  process.exit(1);
}
console.log('\n✓ byte-identical across the move');
