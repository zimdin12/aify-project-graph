// Does a CONSTANT-ONLY edit move the whole-file structural fingerprint? Run from the repo root:
//   node docs/evidence/dashboard-seam-2026-09-30/constant-edit-probe.mjs
//
// ⛔ WRITTEN TO REFUTE A CLAIM OF MINE. I told dashboard-manager that "the extraction modelled at least one
// symbol" made a whole-file anchor coverage-eligible, and named coverage.js, compile-db.js and orchestrator.js
// as eligible. Their review measured on a SYNTHETIC extraction that a file with one function plus data
// constants hides a constant-only edit, and asked for the control on ACTUAL files. This is that control, on
// the exact files I named.
//
// Every case pairs a constant-only edit with a POSITIVE CONTROL in the same file (renaming a declared
// function), so an IDENTICAL result cannot be a dead instrument, and every needle's count is asserted before it
// is replaced, so a replace that matched nothing cannot read as "invisible".
import { readFileSync } from 'node:fs';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import { getLanguageConfig } from '../../../mcp/stdio/ingest/languages/index.js';
import { fileStructuralFingerprint } from '../../../mcp/stdio/ingest/fingerprint.js';

const count = (s, needle) => s.split(needle).length - 1;

// The edits are chosen to MATTER: each changes behaviour a reader of the watch page would care about.
const CASES = [
  {
    rel: 'mcp/stdio/storage/taxonomy.js',
    old: "'Symbol', 'Test', 'External',",
    new: "'Symbol', 'Test', 'External', 'ZzqBrandNewNodeType',",
    what: 'add a value to the frozen NODE_TYPES list',
  },
  {
    rel: 'mcp/stdio/code-intel/coverage.js',
    old: "const DEFAULT_TS_EXCLUDES = ['node_modules',",
    new: "const DEFAULT_TS_EXCLUDES = ['zzq_dir', 'node_modules',",
    what: 'add an entry to an exclude list',
  },
  {
    rel: 'mcp/stdio/code-intel/compile-db.js',
    old: 'const MIN_FIRST_PARTY_COVERAGE = 0.9;',
    new: 'const MIN_FIRST_PARTY_COVERAGE = 0.5;',
    what: 'lower a coverage THRESHOLD from 0.9 to 0.5',
  },
  {
    rel: 'mcp/stdio/freshness/orchestrator.js',
    old: "export const EXTRACTOR_VERSION = '0.6.0';",
    new: "export const EXTRACTOR_VERSION = '0.7.0';",
    what: 'bump EXTRACTOR_VERSION',
  },
];

let invisible = 0;
let controls = 0;
for (const c of CASES) {
  const config = getLanguageConfig(c.rel);
  const src = readFileSync(c.rel, 'utf8');
  const extracted = extractFile({ filePath: c.rel, source: src, config });
  const fp = (s) => fileStructuralFingerprint(extractFile({ filePath: c.rel, source: s, config }));
  const base = fileStructuralFingerprint(extracted);
  const symbols = extracted.nodes.filter((n) => !['File', 'Module'].includes(n.type)).length;

  if (count(src, c.old) !== 1) {
    console.log(`${c.rel}: NEEDLE COUNT ${count(src, c.old)} — PROBE BROKEN, not a result`);
    process.exitCode = 1;
    continue;
  }
  const editedFp = fp(src.replace(c.old, c.new));

  const fn = extracted.nodes.find((n) => n.type === 'Function' && count(src, `function ${n.label}(`) === 1);
  const ctrlFp = fn ? fp(src.replace(`function ${fn.label}(`, `function ${fn.label}Zzq(`)) : null;

  console.log(`=== ${c.rel}  (${symbols} modelled symbols)`);
  console.log(`  CONSTANT-ONLY  ${c.what.padEnd(44)} ${editedFp === base ? 'IDENTICAL  <== invisible' : 'moved'}`);
  if (ctrlFp === null) {
    console.log('  CONTROL        no uniquely-declared function in this file — the file has none to rename');
  } else {
    console.log(`  CONTROL        rename ${fn.label.padEnd(37)} ${ctrlFp === base ? 'IDENTICAL <== INSTRUMENT DEAD' : 'moved, instrument alive'}`);
    if (ctrlFp !== base) controls += 1;
  }
  if (editedFp === base) invisible += 1;
}
console.log('');
console.log(`constant-only edits invisible: ${invisible} of ${CASES.length}`);
console.log(`positive controls that moved:  ${controls} (taxonomy.js has no function to rename; its control is in anchor-facts-probe)`);
