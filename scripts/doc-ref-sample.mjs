#!/usr/bin/env node
// FREEZE THE DOC-REF POPULATION SO A PRECISION CLAIM IS REPLAYABLE INSTEAD OF RETOLD.
//
// ⛔ THE PROBLEM THIS SOLVES. Rule 3's precision has been graded twice at full population —
// 0.972 on aify-project-graph, 0.971 on echoes_of_the_fallen — by two people, one of whom did not
// write the rule. That is strong on coverage and WEAK ON REPRODUCIBILITY: neither number is
// replayable by a third party without redoing the grading by hand, and neither is attached to a
// graph state, so nobody can tell later whether a changed number means the rule changed or the
// corpus did.
//
// dev's acceptance gate asks for a FROZEN stratified sample with negative controls, precision
// floor >=0.95 PER ADMISSION RULE, and independent reproduction. This emits the frozen half.
//
// ⚠ WHAT A FROZEN ARTIFACT MUST CARRY, or it is a list of edges pretending to be evidence:
//
//   · the GRAPH HASH and commit, so "the same population" is checkable rather than asserted
//   · the SOURCE LINE TEXT of every edge, so a grader judges the sentence the author wrote
//     rather than the resolution the extractor chose — grading from the edge is grading the
//     answer key
//   · the RULE that admitted each edge, because the floor is per-rule and an aggregate can clear
//     0.95 while a rule inside it sits at 0.6
//   · NEGATIVE CONTROLS — spans the rules REFUSED — because a precision measurement over
//     admitted edges alone cannot distinguish a precise rule from one that admits almost nothing
//
// ⛔ AND IT DOES NOT CARRY VERDICTS. Grading is a separate act by a separate party; a file that
// arrives with its own answers filled in invites confirmation rather than judgement.
//
// Usage:  node scripts/doc-ref-sample.mjs [--out docs/evidence/<name>.json]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { openDb } from '../mcp/stdio/storage/db.js';
import { detectDocRefs, DOC_REF_RULES } from '../mcp/stdio/analysis/doc-refs.js';

const REPO = process.cwd();
const GRAPH = join(REPO, '.aify-graph', 'graph.sqlite');

// ⛔ RUN AGAINST A COPY. detectDocRefs DELETES every MENTIONS edge it owns before rebuilding, so
// pointing this at the live graph to measure it would destroy the thing being measured. ef-manager
// hit exactly this and copied first; the hazard belongs in the tool, not in the operator's memory.
const SCRATCH = join(REPO, '.aify-graph', 'doc-ref-sample.tmp.sqlite');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const commit = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

// ⛔ THE ARTIFACT MUST NOT COUNT ITSELF, AND IT DID.
//
// First run recorded `dirty_files: 1`, second recorded `2` — because writing the artifact makes
// the artifact a dirty file. Two runs against an identical graph and an identical commit produced
// different bytes, so "frozen" would have been a filename rather than a property, and a third
// party diffing two replays would have seen a spurious change.
//
// This is the apparatus being visible to the instrument under test, in miniature: the act of
// recording the state altered the state being recorded. Excluding the output path is the whole
// fix, but the reason is worth keeping — anything a probe writes into the space it measures comes
// back as signal.
const OUT_MARKER = 'docs/evidence/';
const dirty = execFileSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' })
  .split('\n').filter(Boolean)
  .filter((l) => !l.slice(3).replace(/\\/g, '/').startsWith(OUT_MARKER))
  .length;
const graphHash = createHash('sha256').update(readFileSync(GRAPH)).digest('hex').slice(0, 16);

copyFileSync(GRAPH, SCRATCH);
const db = openDb(SCRATCH);
const stats = await detectDocRefs(db, REPO);

const lineCache = new Map();
function sourceLine(file, line) {
  if (!lineCache.has(file)) {
    try { lineCache.set(file, readFileSync(join(REPO, file), 'utf8').split(/\r?\n/)); } catch { lineCache.set(file, null); }
  }
  const lines = lineCache.get(file);
  return lines ? (lines[line - 1] ?? null) : null;
}

const admitted = db.all(
  `SELECT e.source_file, e.source_line, e.extractor, e.confidence,
          t.label AS target_label, t.type AS target_type, t.file_path AS target_file
     FROM edges e JOIN nodes t ON t.id = e.to_id
    WHERE e.relation = 'MENTIONS'
    ORDER BY e.source_file, e.source_line, t.label`,
).map((e) => ({
  ...e,
  source_text: sourceLine(e.source_file, e.source_line),
  // The span invariant, computed here so a grader sees it beside the claim rather than having to
  // trust that someone checked it. A `false` is a defect regardless of whether the target is right.
  label_on_cited_line: (sourceLine(e.source_file, e.source_line) ?? '').includes(e.target_label),
  verdict: null,        // filled in by a grader, never by this script
}));

// ⚠ NEGATIVE CONTROLS. Precision over admitted edges alone cannot tell a precise rule from one
// that admits almost nothing — a rule emitting a single correct edge scores 1.000. These are spans
// the rules SAW AND REFUSED, sampled per bucket, so a grader can ask the other question: is
// anything in here something the layer should have caught?
const REFUSAL_SAMPLE_PER_BUCKET = 12;
const byBucket = new Map();
for (const m of stats.misses) {
  if (!byBucket.has(m.bucket)) byBucket.set(m.bucket, []);
  byBucket.get(m.bucket).push(m);
}
const refused = [...byBucket.entries()].map(([bucket, all]) => ({
  bucket,
  total: all.length,
  // Deterministic stride rather than a random sample: the same graph must produce the same file,
  // or "frozen" is a word rather than a property. No Math.random anywhere in this script.
  sample: all
    .filter((_, i) => i % Math.max(1, Math.ceil(all.length / REFUSAL_SAMPLE_PER_BUCKET)) === 0)
    .slice(0, REFUSAL_SAMPLE_PER_BUCKET)
    .map((m) => ({ ...m, source_text: sourceLine(m.document, m.line), verdict: null })),
}));

const byRule = {};
for (const e of admitted) byRule[e.extractor] = (byRule[e.extractor] ?? 0) + 1;

const artifact = {
  what: 'Frozen doc-ref population for per-rule precision grading. Verdicts are NOT filled in.',
  how_to_grade: [
    'For each entry in `admitted`, read `source_text` — the sentence the author actually wrote —',
    'and decide whether it refers to `target_label` at `target_file`. Set verdict to "correct" or',
    '"false_positive". Grade the PROSE, not the resolution: reading the target first is grading',
    'the answer key. Precision is computed PER `extractor`, because dev set the floor per rule and',
    'an aggregate can clear 0.95 while a rule inside it sits at 0.6.',
    'For each entry in `refused`, decide whether the layer SHOULD have admitted it. That is the',
    'recall question, and it is the one a precision number cannot answer.',
  ],
  pins: {
    commit,
    dirty_files: dirty,
    graph_sha256_16: graphHash,
    repo: REPO.replace(/\\/g, '/').split('/').pop(),
    rules: DOC_REF_RULES,
  },
  totals: {
    documents: stats.documents,
    documents_with_refs: stats.documentsWithRefs,
    admitted: admitted.length,
    admitted_by_rule: byRule,
    refused_total: stats.misses.length,
    span_invariant_violations: admitted.filter((e) => !e.label_on_cited_line).length,
  },
  admitted,
  refused,
};

const out = arg('--out', join('docs', 'evidence', `doc-refs-${commit.slice(0, 8)}.json`));
mkdirSync(dirname(join(REPO, out)), { recursive: true });
writeFileSync(join(REPO, out), `${JSON.stringify(artifact, null, 2)}\n`);
db.close();
rmSync(SCRATCH, { force: true });

console.log(`frozen: ${out}`);
console.log(`  commit ${commit.slice(0, 8)}${dirty ? ` (+${dirty} dirty)` : ''} · graph ${graphHash}`);
console.log(`  admitted ${admitted.length} (${Object.entries(byRule).map(([k, v]) => `${k}=${v}`).join(' ')})`);
console.log(`  refused ${stats.misses.length} across ${refused.length} buckets, ${refused.reduce((a, b) => a + b.sample.length, 0)} sampled`);
console.log(`  span-invariant violations: ${artifact.totals.span_invariant_violations}`);
if (admitted.length === 0) {
  console.error('REFUSED: no admitted edges — a frozen empty population proves nothing');
  process.exit(1);
}
