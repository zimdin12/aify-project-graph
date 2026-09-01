#!/usr/bin/env node
// Differential carrier for M1a step B (gates 1 and 7).
//
// Step B taught the C++ extractor to carry lexical scope into the qname. Two things had to be
// shown NOT to move: symbol SITE identity (a byte-span address, gate 7) and the entire non-C++
// canonical population (gate 1, because `lexicalScope` is opt-in and only cpp.js declares it).
//
// Both are differentials, not assertions: the script is pointed at TWO checkouts of this repo and
// the outputs are compared. Running it against one checkout proves only that it agrees with
// itself. Usage:
//
//   git worktree add --detach ../apg-preb <pre-B commit>
//   node scripts/step-b-identity-differential.mjs sites     ../apg-preb  > pre.txt
//   node scripts/step-b-identity-differential.mjs sites     .            > post.txt
//   diff pre.txt post.txt
//
// Modes: `sites` (gate 7, the frozen identity-hostile fixture) and `canonical` (gate 1, every
// tracked non-C/C++ source). The checkout supplies the CODE; the fixture and file list always
// come from this working tree, so the two runs differ in exactly one variable.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SYMBOL_TYPES = new Set(['Function', 'Method', 'Class', 'Struct', 'Test']);
const CPP_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx']);

async function loadExtractor(checkout) {
  const at = (rel) => pathToFileURL(path.join(checkout, rel)).href;
  const { extractFile } = await import(at('mcp/stdio/ingest/extractors/generic.js'));
  const { getLanguageConfig } = await import(at('mcp/stdio/ingest/languages/index.js'));
  return { extractFile, getLanguageConfig };
}

function extract({ extractFile, getLanguageConfig }, filePath) {
  const config = getLanguageConfig(filePath);
  if (!config) return null;
  const source = fs.readFileSync(path.join(REPO, filePath), 'utf8');
  return extractFile({ filePath, source, config });
}

// Gate 7: `<path>:<line>:<site id>` for every symbol in the frozen hostile fixture.
function sitePopulation(extractor) {
  const dir = path.join(REPO, 'tests/fixtures/identity-hostile/src');
  const rows = [];
  for (const file of fs.readdirSync(dir).sort()) {
    const filePath = `src/${file}`;
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    const config = extractor.getLanguageConfig(filePath);
    const result = extractor.extractFile({ filePath, source, config });
    for (const node of result.nodes ?? []) {
      if (SYMBOL_TYPES.has(node.type)) rows.push(`${filePath}:${node.start_line}:${node.id}`);
    }
  }
  return rows;
}

// Gate 1: the canonical tuple for every node and ref in every tracked non-C/C++ source.
// ⚠ Ref rows carry three REAL fields — relation, from_id, target. An earlier version of this
// script also emitted `r.from_target`, which does not exist on a ref: 0 of 65,813 rows were
// non-empty, so that column compared nothing while making the surface look wider than it was.
function canonicalPopulation(extractor) {
  const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !CPP_EXTENSIONS.has(path.extname(file).toLowerCase()));

  const rows = [];
  let filesExtracted = 0;
  for (const filePath of tracked) {
    let result = null;
    try {
      result = extract(extractor, filePath);
    } catch {
      continue; // unparseable or unsupported here is the same in both checkouts
    }
    if (!result) continue;
    filesExtracted += 1;
    for (const node of result.nodes ?? []) {
      rows.push([node.id, node.type, node.label, node.extra?.qname ?? '', node.extra?.parent_class ?? ''].join('|'));
    }
    for (const ref of result.refs ?? []) {
      rows.push(['REF', ref.relation ?? '', ref.from_id ?? '', ref.target ?? ''].join('|'));
    }
  }
  return { rows, filesExtracted };
}

const [mode, checkout] = process.argv.slice(2);
if (!['sites', 'canonical'].includes(mode) || !checkout) {
  process.stderr.write('usage: step-b-identity-differential.mjs <sites|canonical> <checkout-path>\n');
  process.exit(2);
}

const extractor = await loadExtractor(path.resolve(checkout));
if (mode === 'sites') {
  const rows = sitePopulation(extractor);
  process.stdout.write(`${rows.sort().join('\n')}\n`);
  process.stderr.write(`sites=${rows.length}\n`);
} else {
  const { rows, filesExtracted } = canonicalPopulation(extractor);
  process.stdout.write(`${rows.sort().join('\n')}\n`);
  process.stderr.write(`files=${filesExtracted} rows=${rows.length}\n`);
}
