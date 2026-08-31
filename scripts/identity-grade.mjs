#!/usr/bin/env node
// M0b arm 1 — GRADE THE CARRIER AGAINST FROZEN GROUND TRUTH.
//
// Arm 1 is the only arm with an oracle: a hostile C++ fixture whose 16 distinct symbols were
// established by reading the C++ (fully-qualified name, parameter signature, linkage) BEFORE the
// extractor ran. Arms 2 and 3 can only report representation facts; this one can say a merge or a
// fork is WRONG, because something other than the extractor established what right looks like.
//
// The mapping is by SITE, never by name: a ground-truth symbol claims the node whose
// `file:startLine` matches one of its declared sites. Matching on names would grade the extractor's
// naming with the extractor's naming.
//
// Verdicts per ground-truth symbol:
//   MATCHED             exactly one node, and no other symbol shares its canonical key
//   FORKED              2+ nodes with 2+ distinct canonical keys — one symbol split in two
//   MERGED              shares a canonical key with a DIFFERENT ground-truth symbol
//   ABSORBED_DISCLOSED  no node of its own, but a surviving node's `overload_lines` names one of
//                       its declaration lines — the merge happened AND the data records it
//   ABSENT_FROM_GRAPH   no node, and nothing in the emitted data records that it existed
//
// ⚠ ABSENT_FROM_GRAPH DELIBERATELY NAMES NO MECHANISM. Never-extracted and extracted-then-dropped
// look identical from here, and an earlier draft of this file called both "MISSING", which reads
// as a parser gap and would have sent the fix to the wrong layer. Which one it is has to be
// established by contrast (rename the colliding symbol and re-extract), not by this grader.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = (...p) => pathToFileURL(path.join(REPO, ...p)).href;
const { extractFile } = await import(url('mcp', 'stdio', 'ingest', 'extractors', 'generic.js'));
const { getLanguageConfig } = await import(url('mcp', 'stdio', 'ingest', 'languages', 'index.js'));

const SOURCE_EXTS = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx']);
const SYMBOL_TYPES = new Set(['Function', 'Method', 'Class', 'Struct', 'Test']);

function canonicalSymbolKey(row) {
  const extra = row.extra ?? {};
  const qparts = String(extra.qname || '').split('.').map((s) => String(s || '').trim()).filter(Boolean);
  if (qparts.length > 0) return `${row.type ?? 'Symbol'}:${qparts.join('.')}`;
  const parentClass = String(extra.parent_class ?? '').trim();
  if (parentClass) return `${row.type ?? 'Symbol'}:${parentClass}.${row.label ?? ''}`;
  return `${row.type ?? 'Symbol'}:${row.label ?? ''}:${row.file_path ?? ''}`;
}

function listSources(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === '.aify-graph') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (SOURCE_EXTS.has(path.extname(e.name).toLowerCase())) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

function extractNodes(root) {
  const nodes = [];
  for (const file of listSources(root)) {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const config = getLanguageConfig(rel);
    if (!config) continue;
    const result = extractFile({ filePath: rel, source: fs.readFileSync(file, 'utf8'), config });
    for (const n of result?.nodes ?? []) if (SYMBOL_TYPES.has(n.type)) nodes.push(n);
  }
  return nodes;
}

function grade(root) {
  const truth = JSON.parse(fs.readFileSync(path.join(root, 'ground-truth.json'), 'utf8'));
  const nodes = extractNodes(root);
  const bySite = new Map();
  for (const n of nodes) bySite.set(`${n.file_path}:${n.start_line}`, n);

  const claims = new Map();          // node -> ground-truth symbols whose site it sits on
  const rows = [];
  for (const sym of truth.distinctSymbols) {
    const hits = sym.sites.map((s) => bySite.get(s)).filter(Boolean);
    const unique = [...new Set(hits)];
    for (const n of unique) claims.set(n, [...(claims.get(n) ?? []), sym.id]);
    rows.push({ id: sym.id, shape: sym.shape ?? '', sites: sym.sites, nodes: unique });
  }

  // Which canonical key does each ground-truth symbol land on?
  const keysOf = new Map(rows.map((r) => [r.id, [...new Set(r.nodes.map(canonicalSymbolKey))]]));
  const symbolsPerKey = new Map();
  for (const [id, keys] of keysOf) {
    for (const k of keys) symbolsPerKey.set(k, [...(symbolsPerKey.get(k) ?? []), id]);
  }

  const graded = rows.map((r) => {
    const keys = keysOf.get(r.id);
    const sharedWith = keys.flatMap((k) => (symbolsPerKey.get(k) ?? []).filter((o) => o !== r.id));
    // Absorption is only claimed with POSITIVE evidence: a surviving node's own `overload_lines`
    // names one of this symbol's declaration lines. Without that the honest verdict is
    // ABSENT_FROM_GRAPH — no representation, and nothing in the emitted data records that the
    // symbol existed. Whether it was never extracted or extracted-then-dropped is NOT decidable
    // from this instrument, and the mechanism is established separately by rename contrast.
    const absorbedBy = nodes.filter((n) => (n.extra?.overload_lines ?? [])
      .some((line) => r.sites.includes(`${n.file_path}:${line}`)));
    let verdict;
    if (r.nodes.length === 0) verdict = absorbedBy.length ? 'ABSORBED_DISCLOSED' : 'ABSENT_FROM_GRAPH';
    else if (sharedWith.length > 0) verdict = 'MERGED';
    else if (keys.length > 1) verdict = 'FORKED';
    else verdict = 'MATCHED';
    return {
      id: r.id, shape: r.shape, verdict, keys, sharedWith: [...new Set(sharedWith)],
      nodeSites: r.nodes.map((n) => `${n.file_path}:${n.start_line}`),
      absorbedBy: absorbedBy.map((n) => `${n.file_path}:${n.start_line}`),
    };
  });

  const tally = graded.reduce((acc, g) => { acc[g.verdict] = (acc[g.verdict] ?? 0) + 1; return acc; }, {});
  const undisclosed = graded.filter((g) => g.verdict === 'ABSENT_FROM_GRAPH');

  return {
    root,
    groundTruthSymbols: truth.distinctSymbols.length,
    nodesExtracted: nodes.length,
    distinctCanonicalKeys: new Set(nodes.map(canonicalSymbolKey)).size,
    tally,
    absentFromGraph: undisclosed.map((g) => g.id),
    linkageModelled: nodes.some((n) => n.extra?.linkage != null),
    graded,
    controls: {
      // LIVENESS: extraction must have produced something. Zero nodes would grade every symbol
      // MISSING and read like a catastrophic — but uninformative — failure.
      liveness_nodesExtracted: nodes.length > 0,
      // POSITIVE: at least one symbol must come back MATCHED, or the grader condemns everything
      // and its verdicts carry no information.
      positive_someSymbolMatched: graded.some((g) => g.verdict === 'MATCHED'),
      // NEGATIVE: a fabricated ground-truth site must grade MISSING. A grader that cannot return
      // MISSING cannot return MATCHED.
      negative_fabricatedSiteIsMissing: !bySite.has('src/does_not_exist.cpp:9999'),
    },
  };
}

const root = process.argv[2];
if (!root) { process.stderr.write('usage: identity-grade.mjs <fixture-root-with-ground-truth.json>\n'); process.exit(2); }
const result = grade(root);

process.stdout.write(`root=${result.root}\n`);
process.stdout.write(`groundTruthSymbols=${result.groundTruthSymbols} nodesExtracted=${result.nodesExtracted} distinctKeys=${result.distinctCanonicalKeys}\n`);
process.stdout.write(`controls: liveness=${result.controls.liveness_nodesExtracted ? 'PASS' : 'FAIL'} `
  + `positive=${result.controls.positive_someSymbolMatched ? 'PASS' : 'FAIL'} `
  + `negative=${result.controls.negative_fabricatedSiteIsMissing ? 'PASS' : 'FAIL'}\n`);
process.stdout.write(`tally: ${JSON.stringify(result.tally)}\n`);
process.stdout.write(`linkage modelled anywhere: ${result.linkageModelled}\n`);
process.stdout.write(`ABSENT FROM GRAPH, nothing records them (${result.absentFromGraph.length}): ${result.absentFromGraph.join(' | ') || '(none)'}\n\n`);
for (const g of result.graded) {
  process.stdout.write(`${g.verdict.padEnd(9)} ${g.id}\n`);
  if (g.sharedWith.length) process.stdout.write(`          shares a key with: ${g.sharedWith.join(', ')} (disclosed=${g.disclosed})\n`);
  if (g.verdict === 'FORKED') process.stdout.write(`          keys: ${g.keys.join('  ||  ')}\n`);
}

const dir = path.join(REPO, 'docs', 'evidence', 'identity-qualification');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'ARM1-GRADED.json'), `${JSON.stringify({ takenAt: new Date().toISOString(), ...result }, null, 2)}\n`, 'utf8');
