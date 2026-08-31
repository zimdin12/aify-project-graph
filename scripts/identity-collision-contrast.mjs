#!/usr/bin/env node
// M0b — DID THE PARSER MISS THOSE SYMBOLS, OR DID IDENTITY DROP THEM?
//
// The grader reports `beta::Widget` and `beta::Widget::render()` as ABSENT_FROM_GRAPH and
// deliberately names no mechanism, because never-extracted and extracted-then-dropped look
// identical from there. The distinction decides which layer gets repaired: a parser gap is a
// query problem, an identity collision is an ID problem. Guessing would have sent the fix to the
// wrong layer.
//
// The contrast: rename ONLY the second class, changing nothing else. If the symbols appear, the
// parser always saw them and identity discarded them.
//
// ⚠ THE MUTATION IS APPLIED IN MEMORY AND ASSERTED. A rename that silently failed to apply would
// produce "no change" and read exactly like "the parser cannot see them" — the same wrong answer,
// arrived at by a broken instrument instead of a real one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = (...p) => pathToFileURL(path.join(REPO, ...p)).href;
const { extractFile } = await import(url('mcp', 'stdio', 'ingest', 'extractors', 'generic.js'));
const { getLanguageConfig } = await import(url('mcp', 'stdio', 'ingest', 'languages', 'index.js'));

const SYMBOL_TYPES = new Set(['Function', 'Method', 'Class', 'Struct', 'Test']);
const FILES = ['src/shapes.h', 'src/shapes.cpp', 'src/other.cpp'];

/** Replace the Nth occurrence (0-based) of `needle`, and prove the replacement landed. */
function replaceNth(text, needle, replacement, n) {
  let idx = -1;
  for (let i = 0; i <= n; i += 1) {
    idx = text.indexOf(needle, idx + 1);
    if (idx < 0) throw new Error(`mutation could not be applied: occurrence ${n} of "${needle}" not found`);
  }
  const out = text.slice(0, idx) + replacement + text.slice(idx + needle.length);
  if (out === text) throw new Error('mutation produced identical text — it did not apply');
  return out;
}

function symbolsFor(sources) {
  const out = [];
  for (const [rel, source] of Object.entries(sources)) {
    const result = extractFile({ filePath: rel, source, config: getLanguageConfig(rel) });
    for (const n of result?.nodes ?? []) if (SYMBOL_TYPES.has(n.type)) out.push({ site: `${rel}:${n.start_line}`, qname: n.extra?.qname, type: n.type });
  }
  return out;
}

const root = process.argv[2];
if (!root) { process.stderr.write('usage: identity-collision-contrast.mjs <fixture-root>\n'); process.exit(2); }

const baseline = Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]));

// The second `class Widget {` is beta's; the second `void Widget::render() {}` is beta's definition.
const mutated = { ...baseline };
mutated['src/shapes.h'] = replaceNth(baseline['src/shapes.h'], 'class Widget {', 'class Gadget {', 1);
mutated['src/shapes.cpp'] = replaceNth(baseline['src/shapes.cpp'], 'void Widget::render() {}', 'void Gadget::render() {}', 1);

// MUTATION-APPLIED ASSERTIONS, before any conclusion is drawn from the result.
if (!mutated['src/shapes.h'].includes('class Gadget {')) throw new Error('header mutation did not apply');
if (!mutated['src/shapes.cpp'].includes('Gadget::render')) throw new Error('impl mutation did not apply');
if (!mutated['src/shapes.h'].includes('class Widget {')) throw new Error('the FIRST Widget was renamed too — the contrast would be measuring the wrong thing');

const before = symbolsFor(baseline);
const after = symbolsFor(mutated);
const appeared = after.filter((a) => !before.some((b) => b.site === a.site));

process.stdout.write(`baseline symbol nodes : ${before.length}\n`);
process.stdout.write(`mutant symbol nodes   : ${after.length}\n`);
process.stdout.write(`sites that APPEARED only after the rename (${appeared.length}):\n`);
for (const a of appeared) process.stdout.write(`  ${a.type.padEnd(8)} ${a.site}  qname=${a.qname}\n`);

const verdict = appeared.length > 0
  ? 'IDENTITY COLLISION — the parser saw these symbols in both runs; the identity key discarded them in the baseline'
  : 'NO CHANGE — renaming did not surface them, so this contrast does not support an identity-collision explanation';
process.stdout.write(`\nVERDICT: ${verdict}\n`);

fs.writeFileSync(
  path.join(REPO, 'docs', 'evidence', 'identity-qualification', 'COLLISION-CONTRAST.json'),
  `${JSON.stringify({ takenAt: new Date().toISOString(), root, baselineCount: before.length, mutantCount: after.length, appeared, verdict }, null, 2)}\n`,
  'utf8',
);
