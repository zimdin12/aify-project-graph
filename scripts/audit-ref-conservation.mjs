#!/usr/bin/env node
// CONSERVATION OF REFS — does every reference the extractor emitted end up SOMEWHERE?
//
// Written after the 2026-09-25 zero-caller audit found a silent loss: `graphPacket` had 0 incoming
// CALLS edges and no `unresolved_refs` row either, while extraction emitted 3 CALLS refs for it.
// Not refused, not deferred: dropped, with nothing recording that anything was dropped.
// docs/evidence/zero-caller-audit-2026-09-25/FINDING.md has the case.
//
// THE INVARIANT: extraction emits a ref; the ingest path must record it as an EDGE (resolved) or as
// an `unresolved_refs` row (refused, with a reason). A ref that is neither has been lost silently.
//
// ⭐ WHY THIS AND NOT AN INCREMENTAL-VS-REBUILD DIFF. The obvious probe is to diff an incremental
// graph against a forced rebuild at the same commit. That treats the rebuild as ground truth, and
// nothing has established that it is: if both builds lose the same ref, the diff is empty and reads
// as clean — a wrong zero inside the instrument hunting wrong zeros. Extraction output is UPSTREAM
// of both builds, so it needs no oracle that has not itself been checked.
//
// ⚠ PRE-REGISTERED LIMITS, written before the first run produced a number:
//   1. It compares the CURRENT extractor against the CURRENT graph. A ref the extractor never
//      emitted is invisible: a short extraction and a conserved graph look identical from here. It
//      can say "nothing was dropped after extraction", never "nothing is missing".
//   2. It cannot distinguish a file the pipeline never processed from a file whose every ref was
//      lost. Both show zero recorded keys. Those files are reported SEPARATELY, never folded into
//      the loss count, because folding them in lets a population error masquerade as a defect.
//
// KEY: (source_file, relation, target-name). Extraction can emit several refs for one target in one
// file and the ingest path collapses them, so the check is EXISTENCE per key, not count equality —
// the conservative direction. See the edge-dedup note at the recorded-key build for why no line.
//
// POPULATION: the indexer's own enumeration — walk from the repo root applying
// `loadEffectiveIgnoredDirs` / `pathContainsIgnoredDir`, keep what `getLanguageConfig` accepts.
// ⛔ NOT `SELECT DISTINCT file_path FROM nodes`. The first version of this script used that and
// measured 65% conservation, because nodes exist for files the pipeline never extracts refs from
// (node_modules/typescript/lib/typescript.d.ts alone contributed 3,359 phantom losses). The
// population error looked exactly like a catastrophic defect.
//
// CONTROLS, in the same run:
//   FRESHNESS  the graph's indexed commit must equal HEAD, or the comparison spans two trees.
//   POSITIVE   keys emitted AND recorded must be the large majority, or the join key is wrong and
//              every "loss" is an artifact of the key.
//   NEGATIVE   a fabricated key at an impossible line must be reported MISSING. A probe that cannot
//              return ABSENT cannot return PRESENT.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = (...p) => pathToFileURL(path.join(REPO, ...p)).href;
const { extractFile } = await import(url('mcp', 'stdio', 'ingest', 'extractors', 'generic.js'));
const { getLanguageConfig } = await import(url('mcp', 'stdio', 'ingest', 'languages', 'index.js'));
const { loadEffectiveIgnoredDirs, pathContainsIgnoredDir, isIgnoredDirName } =
  await import(url('mcp', 'stdio', 'ingest', 'ignored-dirs.js'));

const IMPOSSIBLE_TARGET = 'zzqNotARealSymbolHere';
const keyOf = (file, relation, target) => `${file}\u0000${relation}\u0000${target}`;

// The name a ref points AT. Extraction gives either a symbolic `target` or an already-resolved
// `to_id` with its `to_label`; the graph's own label is the only form comparable to both.
function refTargetName(ref) {
  if (ref.target) return String(ref.target);
  if (ref.to_label) return String(ref.to_label);
  if (ref.to_id) return String(ref.to_id);
  return '';
}

function languageConfigFor(file) {
  try {
    return getLanguageConfig(file) ?? null;
  } catch {
    return null;
  }
}

function listCandidates(ignoredDirs, dir = REPO, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(REPO, abs).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (isIgnoredDirName(entry.name, ignoredDirs) || pathContainsIgnoredDir(rel, ignoredDirs)) continue;
      listCandidates(ignoredDirs, abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (pathContainsIgnoredDir(rel, ignoredDirs)) continue;
    if (!languageConfigFor(rel)) continue;
    out.push(rel);
  }
  return out;
}

const db = new Database(path.join(REPO, '.aify-graph', 'graph.sqlite'), { readonly: true });
const manifest = JSON.parse(fs.readFileSync(path.join(REPO, '.aify-graph', 'manifest.json'), 'utf8'));
const indexed = String(manifest.commit ?? '');
let head = '';
try {
  head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
} catch {
  head = '';
}
const sameTree = Boolean(indexed) && Boolean(head) && indexed.slice(0, 10) === head.slice(0, 10);
console.log(`FRESHNESS: graph indexed at ${indexed.slice(0, 10)}, HEAD ${head.slice(0, 10)} -> ${sameTree ? 'SAME TREE' : 'DIFFERENT — the comparison spans two trees'}`);
console.log(`MANIFEST: generation ${manifest.generation}, extractor ${manifest.extractorVersion}, nodes ${manifest.nodes}, edges ${manifest.edges}`);

const recorded = new Set();
const recordedFiles = new Set();
// ⛔ THE KEY CANNOT CARRY A LINE. `edges` is deduplicated on (from_id, to_id, relation): measured
// on this graph, 36,635 rows and 36,635 distinct triples, with a maximum of ONE distinct
// source_line per triple. A symbol called from twenty lines of one file keeps one row and one line,
// so a line-level key reports nineteen phantom losses. The second version of this script did
// exactly that and measured 68.59% conservation.
const edgeRows = db.prepare(
  'SELECT e.source_file AS source_file, e.relation AS relation, n.label AS label'
  + ' FROM edges e JOIN nodes n ON n.id = e.to_id',
).all();
for (const row of edgeRows) {
  recorded.add(keyOf(row.source_file, row.relation, row.label));
  recordedFiles.add(row.source_file);
}
const fromEdges = recorded.size;
for (const row of db.prepare('SELECT source_file, relation, target, to_id FROM unresolved_refs').all()) {
  recorded.add(keyOf(row.source_file, row.relation, row.target ?? row.to_id ?? ''));
  recordedFiles.add(row.source_file);
}
console.log(`RECORDED: ${fromEdges} keys from edges, ${recorded.size} including unresolved_refs, across ${recordedFiles.size} source files`);

const ignoredDirs = loadEffectiveIgnoredDirs(REPO);
const candidates = listCandidates(ignoredDirs);
console.log(`POPULATION: ${candidates.length} files the indexer's own enumeration would extract`);

let extracted = 0;
let unreadable = 0;
let emitted = 0;
let present = 0;
const missing = [];
const unprocessed = [];
const seen = new Set();

for (const file of candidates) {
  let source;
  try {
    source = fs.readFileSync(path.join(REPO, file), 'utf8').replace(/\r\n/g, '\n');
  } catch {
    unreadable += 1;
    continue;
  }
  let refs;
  try {
    refs = extractFile({ filePath: file, source, config: languageConfigFor(file) }).refs ?? [];
  } catch (err) {
    unreadable += 1;
    console.log(`  EXTRACTION FAILED ${file}: ${err.message}`);
    continue;
  }
  extracted += 1;
  if (refs.length > 0 && !recordedFiles.has(file)) {
    unprocessed.push({ file, refs: refs.length });
    continue;
  }
  for (const ref of refs) {
    const key = keyOf(ref.source_file, ref.relation, refTargetName(ref));
    if (seen.has(key)) continue;
    seen.add(key);
    emitted += 1;
    if (recorded.has(key)) present += 1;
    else {
      missing.push({
        file: ref.source_file,
        line: ref.source_line,
        relation: ref.relation,
        target: ref.target ?? ref.to_id ?? '',
      });
    }
  }
}

const negativeKey = keyOf(candidates[0] ?? 'nonexistent.js', 'CALLS', IMPOSSIBLE_TARGET);
const negativeVerdict = recorded.has(negativeKey)
  ? 'PRESENT — the instrument cannot report absence, every result below is void'
  : 'MISSING, as it must be';
console.log(`\nNEGATIVE CONTROL: fabricated target ${IMPOSSIBLE_TARGET} -> ${negativeVerdict}`);
console.log(`POSITIVE CONTROL: ${present} of ${emitted} emitted keys are recorded (${emitted ? ((present / emitted) * 100).toFixed(2) : '0'}%)`);
console.log(`FILES: ${extracted} extracted, ${unreadable} unreadable or failed`);
console.log(`⚠ NOT COUNTED AS LOSS — ${unprocessed.length} file(s) emit refs but have NO recorded key at all (never processed, or wholly lost; this instrument cannot tell which)`);
for (const u of unprocessed.slice(0, 20)) console.log(`    ${u.file}  ${u.refs} refs emitted`);

console.log(`\nRESULT: ${missing.length} emitted ref keys, in files the pipeline demonstrably processed, are in NEITHER edges NOR unresolved_refs.`);
const byRelation = new Map();
const byFile = new Map();
for (const m of missing) {
  byRelation.set(m.relation, (byRelation.get(m.relation) ?? 0) + 1);
  byFile.set(m.file, (byFile.get(m.file) ?? 0) + 1);
}
if (missing.length) {
  console.log('\nBY RELATION:');
  for (const [rel, n] of [...byRelation].sort((a, b) => b[1] - a[1])) console.log(`  ${String(rel).padEnd(14)} ${n}`);
  console.log('\nTOP FILES:');
  for (const [file, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(5)}  ${file}`);
  // Per relation, not overall: one noisy relation would otherwise fill the list and hide a small
  // one. A relation with a handful of losses is the interesting case — it is the shape a real drop
  // has, while a relation losing thousands is usually the key failing to describe that relation.
  console.log('\nLOST REFS, UP TO 40 PER RELATION:');
  for (const [rel] of [...byRelation].sort((a, b) => a[1] - b[1])) {
    const rows = missing.filter((m) => m.relation === rel);
    console.log(`\n  ${rel} — ${rows.length} lost${rows.length > 40 ? ', first 40' : ''}:`);
    for (const m of rows.slice(0, 40)) console.log(`    ${m.file}:${m.line} -> ${m.target}`);
  }
}
