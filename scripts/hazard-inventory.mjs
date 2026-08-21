#!/usr/bin/env node
// CANDIDATE HAZARDS — A REPORT. NOT A GATE, NOT A VERDICT, NOT A FIX.
//
// ⛔ THE EXIT CODE REFLECTS INSTRUMENT HEALTH, NEVER THE NUMBER OF FINDINGS. The moment a findings
// count decides an exit status, this becomes a gate; a gate that fires on candidates gets muted;
// and a muted detector is worse than an absent one because it looks like coverage. So: exit 0 with
// two hundred candidates, exit 1 if a file would not parse.
//
// ⚠ EVERY MATCH IS A SHAPE, NOT A DEFECT. Most `.every()` calls are correct because their
// population cannot be empty, and most `catch { return 0 }` are correct because zero is the true
// answer. Reporting the count as a defect total would be the same false-population error the tool
// exists to catch.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  vacuousQuantifiers, failOpenCatches, selfReportingLiterals, readKeys, NOT_IMPLEMENTED,
} from './lib/hazard-detectors.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOTS = ['mcp', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.aify-graph', 'reference', 'dist', 'build']);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(mjs|js)$/.test(name)) yield p;
  }
}

const files = SCAN_ROOTS.flatMap((r) => [...walk(join(REPO, r))]);

// ⛔ A FILE THAT WILL NOT PARSE IS AN UNKNOWN, NOT A CLEAN ONE. It is counted and named, and it is
// what makes the exit code non-zero — because a silent skip is how a scan reports a reassuring zero
// over files it never read.
const unparsed = [];
const sources = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  try { vacuousQuantifiers(src, f); sources.set(f, src); }
  catch (e) { unparsed.push({ file: relative(REPO, f), reason: String(e.message).slice(0, 120) }); }
}

// Category 6 needs a corpus-wide view: a key is "self-reporting" only if nothing anywhere READS it.
const readEverywhere = new Set();
for (const [f, src] of sources) { for (const k of readKeys(src, f)) readEverywhere.add(k); }

/**
 * ⛔ DISABLED ON EVIDENCE, NOT ON TASTE — and the evidence is reproduced on every run.
 *
 * The referee's category 6 (self-reporting literal fields) is computable and the detector works: it
 * finds `stillBlocksNewRuns: true`. But run over this corpus it returns ~300 candidates, and a
 * sample of them is `windowsHide: true`, `recursive: true`, `withFileTypes: true` — Node API
 * options that ARE consumed, by Node, not by our code. The "nothing reads this key" heuristic
 * cannot see that reader.
 *
 * ⇒ I wrote, one screen above, that a high-noise detector gets muted and a muted detector is worse
 * than an absent one because it looks like coverage. Shipping this at 300 would have been exactly
 * that, in the tool built to stop it. Disabled, with its live count printed so the decision stays
 * falsifiable rather than becoming folklore.
 *
 * ⚠ AND THE HONEST LESSON: the one real instance of this class was found by RUNNING A CONTROL —
 * reverting the predicate and watching only one test go red — not by any scanner. Strengthening
 * controls beats adding a detector here.
 */
const suppressed = [];
const findings = [];
for (const [f, src] of sources) {
  const rel = relative(REPO, f).replace(/\\/g, '/');
  for (const h of vacuousQuantifiers(src, f)) findings.push({ file: rel, ...h });
  for (const h of failOpenCatches(src, f)) findings.push({ file: rel, ...h });
  // ⛔ CATEGORY 6 IS MEASURED AND DISABLED — see MEASURED_AND_DISABLED. Kept computable so the
  // number below can be reproduced, but not reported as a candidate.
  for (const h of selfReportingLiterals(src, f)) {
    if (!readEverywhere.has(h.key)) suppressed.push({ file: rel, ...h });
  }
}

const byCategory = {};
for (const f of findings) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;

const report = {
  generatedFor: 'adjudication by a human — every entry is a candidate, none is a verdict',
  scanned: { roots: SCAN_ROOTS, files: sources.size, unparsed: unparsed.length },
  measuredAndDisabled: { 'self-reporting-literal': suppressed.length },
  byCategory,
  notImplemented: NOT_IMPLEMENTED,
  findings,
};

const outIdx = process.argv.indexOf('--out');
if (outIdx !== -1 && process.argv[outIdx + 1]) {
  writeFileSync(process.argv[outIdx + 1], `${JSON.stringify(report, null, 2)}\n`);
}

console.log('CANDIDATE HAZARD INVENTORY — candidates for adjudication, not defects\n');
console.log(`  scanned   ${sources.size} file(s) under ${SCAN_ROOTS.join(', ')}`);
if (unparsed.length) {
  console.log(`  ⛔ UNPARSED ${unparsed.length} — these were NOT scanned, so their zero means nothing:`);
  for (const u of unparsed) console.log(`       ${u.file} — ${u.reason}`);
}
console.log('');
for (const [cat, n] of Object.entries(byCategory)) console.log(`  ${String(n).padStart(4)}  ${cat}`);
console.log('');

const show = process.argv.includes('--detail');
if (show) {
  for (const f of findings) {
    console.log(`  ${f.file}:${f.line}  [${f.category}]`);
    console.log(`      ${f.text}`);
    console.log(`      ? ${f.question}\n`);
  }
} else {
  console.log('  (pass --detail for each candidate and the question to ask of it)\n');
}

console.log(`  MEASURED AND DISABLED: self-reporting literal fields — ${suppressed.length} candidates.`);
console.log('    Sampled as windowsHide/recursive/withFileTypes: Node API options that ARE consumed,');
console.log('    by Node, which the "nothing reads this key" heuristic cannot see. Reporting 300');
console.log('    candidates would be the muted-detector failure this tool exists to prevent. The');
console.log('    one real instance of this class was found by running a control, not by a scanner.\n');

console.log('  NOT IMPLEMENTED, deliberately — a tool silent about its blind spots reads as coverage:');
for (const n of NOT_IMPLEMENTED) console.log(`    · ${n.category}\n        ${n.why}\n`);

console.log('⚠ THIS IS NOT A DEFECT COUNT. Most matches are correct code whose population cannot be');
console.log('  empty, or whose zero is the true answer. The value is the QUESTION each one asks.');

// ⛔ Findings never move the exit code. Only a broken instrument does.
process.exit(unparsed.length > 0 ? 1 : 0);
