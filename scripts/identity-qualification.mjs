#!/usr/bin/env node
// M0b — DOES THE IDENTITY CARRIER GROUP SYMBOLS OR SPELLINGS?
//
// M1 was going to hang per-identity caller sets off `canonicalSymbolKey`. Review's objection: it
// is a heuristic grouping key, not resolved identity, and attaching caller sets to false groups
// attaches real callers to symbols that do not exist. This measures the carrier before M1 builds
// on it. Predictions were assigned first:
// docs/evidence/identity-qualification/PREREGISTRATION.md
//
// ⛔ THERE IS NO INDEPENDENT IDENTITY ORACLE HERE, AND THIS DOES NOT PRETEND OTHERWISE.
// Grading our tree-sitter grouping with a second tree-sitter query would be one instrument read
// twice. So every finding below is SELF-EVIDENCING from the extractor's own disclosed output:
// a node that reports two distinct `overload_signatures` has, on its own account, merged two
// definitions that a compiler would keep apart. No outside adjudication is needed to read that,
// and none is claimed.
//
// ⚠ CLAIM CEILING. "On this population the carrier merged/forked these symbols." Never a rate:
// a percentage over ~20 deliberately-chosen files is a number attached to the wrong noun.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = (...p) => pathToFileURL(path.join(REPO, ...p)).href;

const { extractFile } = await import(url('mcp', 'stdio', 'ingest', 'extractors', 'generic.js'));
const { getLanguageConfig } = await import(url('mcp', 'stdio', 'ingest', 'languages', 'index.js'));

const SOURCE_EXTS = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx']);
const HEADER_EXTS = new Set(['.h', '.hh', '.hpp', '.hxx']);

// ─────────────────────────────────────────────────────────────────────────────
// The key under test, reimplemented here EXACTLY as symbol_lookup.js computes it.
//
// ⚠ It is not exported, and importing the module would drag in the whole query layer. Copying it
// creates a drift hazard, so `assertKeyMatchesSource()` reads the real file and fails loudly if
// the three branches stop matching. A silent copy is how a measurement starts describing code
// that no longer exists.
// ─────────────────────────────────────────────────────────────────────────────
function normalizeQualifiedPart(part) {
  return String(part || '').trim();
}

function canonicalSymbolKey(row) {
  const extra = row.extra ?? {};
  const qparts = String(extra.qname || '').split('.').map(normalizeQualifiedPart).filter(Boolean);
  if (qparts.length > 0) return `${row.type ?? 'Symbol'}:${qparts.join('.')}`;
  const parentClass = normalizeQualifiedPart(extra.parent_class ?? '');
  if (parentClass) return `${row.type ?? 'Symbol'}:${parentClass}.${row.label ?? ''}`;
  return `${row.type ?? 'Symbol'}:${row.label ?? ''}:${row.file_path ?? ''}`;
}

function assertKeyMatchesSource() {
  const src = fs.readFileSync(path.join(REPO, 'mcp', 'stdio', 'query', 'verbs', 'symbol_lookup.js'), 'utf8');
  const required = [
    'return `${row.type ?? \'Symbol\'}:${qparts.join(\'.\')}`',
    'return `${row.type ?? \'Symbol\'}:${parentClass}.${row.label ?? \'\'}`',
    'return `${row.type ?? \'Symbol\'}:${row.label ?? \'\'}:${row.file_path ?? \'\'}`',
  ];
  const missing = required.filter((line) => !src.includes(line));
  if (missing.length) {
    throw new Error(`canonicalSymbolKey has drifted from this copy; ${missing.length} branch(es) no longer match:\n${missing.join('\n')}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extraction
// ─────────────────────────────────────────────────────────────────────────────
function listSources(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.aify-graph') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SOURCE_EXTS.has(path.extname(entry.name).toLowerCase())) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

function extractCorpus(root) {
  const nodes = [];
  for (const file of listSources(root)) {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const config = getLanguageConfig(rel);
    if (!config) continue;
    let result;
    try {
      result = extractFile({ filePath: rel, source: fs.readFileSync(file, 'utf8'), config });
    } catch (err) {
      nodes.push({ __extractionError: true, file: rel, message: String(err.message) });
      continue;
    }
    for (const node of result?.nodes ?? []) nodes.push(node);
  }
  return nodes;
}

const SYMBOL_TYPES = new Set(['Function', 'Method', 'Class', 'Struct', 'Test']);
const isSymbol = (n) => !n.__extractionError && SYMBOL_TYPES.has(n.type);

// ─────────────────────────────────────────────────────────────────────────────
// The three findings, each self-evidencing from the extractor's own output
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MERGE, within one file. A node whose own `overload_signatures` holds 2+ distinct signatures has
 * collapsed 2+ definitions a compiler keeps apart. The node reports this itself; no oracle needed.
 */
function findMergedOverloads(nodes) {
  return nodes.filter(isSymbol)
    .filter((n) => (n.extra?.overload_signatures?.length ?? 0) > 1)
    .map((n) => ({
      key: canonicalSymbolKey(n),
      label: n.label,
      file: n.file_path,
      definitionsCollapsed: n.extra.overload_signatures.length,
      signatures: n.extra.overload_signatures,
      lines: n.extra.overload_lines ?? [n.start_line],
      disclosedBy: 'extra.overload_signatures',
    }));
}

/**
 * MERGE, across files. Two nodes with DIFFERENT signatures sharing one canonical key. The
 * ambiguity refusal treats one key as one symbol, so these would be rendered as a single identity
 * carrying both definitions' callers.
 *
 * ⚠ A header declaration and its implementation legitimately share a key and are ONE symbol. They
 * are separated here by signature: identical signatures are a decl/def pair (correct), differing
 * signatures are overloads (a merge). A missing signature is neither and is counted apart.
 */
function findCrossFileKeyCollisions(nodes) {
  const byKey = new Map();
  for (const n of nodes.filter(isSymbol)) {
    const key = canonicalSymbolKey(n);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(n);
  }
  const collisions = [];
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    const files = new Set(group.map((n) => n.file_path));
    if (files.size < 2) continue;
    const signatures = new Set(group.map((n) => n.extra?.signature ?? '').filter(Boolean));
    collisions.push({
      key,
      label: group[0].label,
      members: group.map((n) => ({ file: n.file_path, line: n.start_line, signature: n.extra?.signature ?? '' })),
      distinctSignatures: signatures.size,
      classification: signatures.size > 1 ? 'MERGE_distinct_signatures'
        : signatures.size === 1 ? 'decl_def_pair_or_identical'
          : 'unsignatured',
    });
  }
  return collisions;
}

/**
 * FORK. One spelling under 2+ canonical keys, at least one in a header and one in an
 * implementation file — the shape a declaration/definition split produces when `qname` embeds a
 * per-file module label instead of a scope.
 *
 * ⚠ CANDIDATE, NOT PROVEN. Two `static` functions in two files legitimately share a spelling and
 * ARE two symbols. Nothing in the emitted data distinguishes them, and that indistinguishability
 * is itself the finding — reported as such rather than resolved by guessing.
 */
function findForkCandidates(nodes) {
  const byLabel = new Map();
  for (const n of nodes.filter(isSymbol)) {
    if (!byLabel.has(n.label)) byLabel.set(n.label, []);
    byLabel.get(n.label).push(n);
  }
  const forks = [];
  for (const [label, group] of byLabel) {
    const keys = new Set(group.map(canonicalSymbolKey));
    if (keys.size < 2) continue;
    const inHeader = group.some((n) => HEADER_EXTS.has(path.extname(n.file_path).toLowerCase()));
    const inImpl = group.some((n) => !HEADER_EXTS.has(path.extname(n.file_path).toLowerCase()));
    if (!(inHeader && inImpl)) continue;
    forks.push({
      label,
      keys: [...keys],
      sites: group.map((n) => ({ file: n.file_path, line: n.start_line, key: canonicalSymbolKey(n) })),
      linkageModelled: group.some((n) => n.extra?.linkage != null),
    });
  }
  return forks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Controls
// ─────────────────────────────────────────────────────────────────────────────
function runControls(nodes) {
  const symbols = nodes.filter(isSymbol);
  const byKey = new Map();
  for (const n of symbols) byKey.set(canonicalSymbolKey(n), (byKey.get(canonicalSymbolKey(n)) ?? 0) + 1);

  // POSITIVE: at least one symbol must be unique — one node, one key, no collision. If nothing
  // groups cleanly, grouping is broken for a reason unrelated to any shape and no verdict holds.
  const uniqueKeys = [...byKey.values()].filter((c) => c === 1).length;

  // NEGATIVE: a spelling that appears nowhere must produce zero groups. A counter that cannot
  // return zero cannot return a count.
  const absent = symbols.filter((n) => n.label === 'this_symbol_does_not_exist_m0b').length;

  // INSTRUMENT LIVENESS: extraction must have produced symbols at all. A corpus that silently
  // extracted nothing would report zero merges and read exactly like a clean bill of health.
  return {
    symbolsExtracted: symbols.length,
    distinctKeys: byKey.size,
    positive_someKeyIsUnique: uniqueKeys > 0,
    uniqueKeyCount: uniqueKeys,
    negative_absentSpellingIsZero: absent === 0,
    liveness_extractionProducedSymbols: symbols.length > 0,
    extractionErrors: nodes.filter((n) => n.__extractionError),
  };
}

function analyse(label, root) {
  const nodes = extractCorpus(root);
  return {
    arm: label,
    root,
    filesScanned: listSources(root).length,
    controls: runControls(nodes),
    mergedOverloadsWithinFile: findMergedOverloads(nodes),
    crossFileKeyCollisions: findCrossFileKeyCollisions(nodes),
    forkCandidates: findForkCandidates(nodes),
  };
}

function summarise(r) {
  const c = r.controls;
  const merges = r.crossFileKeyCollisions.filter((x) => x.classification === 'MERGE_distinct_signatures');
  process.stdout.write(`\n=== ${r.arm} === ${r.root}\n`);
  process.stdout.write(`files=${r.filesScanned} symbols=${c.symbolsExtracted} distinctKeys=${c.distinctKeys}\n`);
  process.stdout.write(`controls: liveness=${c.liveness_extractionProducedSymbols ? 'PASS' : 'FAIL'} `
    + `positive=${c.positive_someKeyIsUnique ? 'PASS' : 'FAIL'} (${c.uniqueKeyCount} unique) `
    + `negative=${c.negative_absentSpellingIsZero ? 'PASS' : 'FAIL'} `
    + `extractionErrors=${c.extractionErrors.length}\n`);
  process.stdout.write(`MERGED overload sets within one file : ${r.mergedOverloadsWithinFile.length}\n`);
  process.stdout.write(`cross-file key collisions            : ${r.crossFileKeyCollisions.length}`
    + ` (distinct-signature MERGES: ${merges.length})\n`);
  process.stdout.write(`fork candidates (header + impl)      : ${r.forkCandidates.length}`
    + ` (linkage modelled anywhere: ${r.forkCandidates.some((f) => f.linkageModelled)})\n`);
  for (const m of r.mergedOverloadsWithinFile.slice(0, 5)) {
    process.stdout.write(`  MERGE ${m.file}: ${m.label} — ${m.definitionsCollapsed} definitions at lines ${m.lines.join(',')}\n`);
  }
  for (const m of merges.slice(0, 5)) {
    process.stdout.write(`  XFILE ${m.key} — ${m.distinctSignatures} signatures across ${m.members.length} sites\n`);
  }
}

async function main() {
  assertKeyMatchesSource();
  const roots = process.argv.slice(2);
  if (roots.length === 0) {
    process.stderr.write('usage: identity-qualification.mjs <armName=root> [...]\n');
    process.exit(2);
  }
  const results = roots.map((spec) => {
    const [arm, root] = spec.includes('=') ? spec.split('=') : ['arm', spec];
    return analyse(arm, root);
  });
  for (const r of results) summarise(r);
  const dir = path.join(REPO, 'docs', 'evidence', 'identity-qualification');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'RESULTS.json'), `${JSON.stringify({ takenAt: new Date().toISOString(), results }, null, 2)}\n`, 'utf8');
}

await main();
