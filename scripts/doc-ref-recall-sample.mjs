#!/usr/bin/env node
// A RECALL FLOOR, BECAUSE FOUR PRECISION GRADES AND NO RECALL IS A NAMED FAILURE MODE.
//
// ⛔ THE ROADMAP STATES IT AS A KILL CRITERION: "Phase 1 raises precision and cannot report recall
// -> THE DEFECT MOVED." That is exactly where this layer stands. Every rule has been tightened,
// two have been deleted, and each change traded recall for precision without anyone measuring what
// was traded away.
//
// ⚠ TRUE RECALL IS NOT COMPUTABLE HERE and this script does not pretend otherwise. It needs the
// count of genuine references in the corpus, which requires exhaustively hand-labelling ~7,000
// spans. dev asked for recall "disclosed as a FLOOR", and a floor is what a sample can honestly
// support:
//
//     recall_floor = admitted / (admitted + estimated_missed)
//
// where `estimated_missed` comes from grading a sample of REFUSALS and extrapolating by stratum.
//
// ⛔ STRATIFIED, AND THE WEIGHTS ARE THE WHOLE POINT. The refusal buckets differ in size by two
// orders of magnitude — `unqualified` is thousands, `shaped_ambiguous` is fifteen. Sampling 25
// from each and averaging the grades would weight a 15-span bucket equally with a 5,000-span one
// and produce a number that looks like an estimate and is arithmetic nonsense. Each stratum's
// graded rate is multiplied by ITS OWN size, and the totals are summed.
//
// ⛔ AND TWO BUCKETS ARE EXCLUDED FROM THE DENOMINATOR BY DEFINITION, NOT BY CONVENIENCE.
// `is_a_path` and `ambiguous_path` are spans the SYMBOL layer refused because they belong to the
// FILE layer — rule 1 either claimed them or refused them on its own terms. Counting them as
// symbol-layer misses would import another layer's population into this one's denominator, which
// is the denominator-inflation defect this repo has already shipped once ("0 of 266" over a
// population that mostly could not fail). They are listed with their sizes so the exclusion is
// visible rather than silent.
//
// Usage:  node scripts/doc-ref-recall-sample.mjs [--per-bucket 25] [--out docs/evidence/<name>.json]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { openDb } from '../mcp/stdio/storage/db.js';
import { detectDocRefs } from '../mcp/stdio/analysis/doc-refs.js';

const REPO = process.cwd();
const GRAPH = join(REPO, '.aify-graph', 'graph.sqlite');
const SCRATCH = join(REPO, '.aify-graph', 'recall-sample.tmp.sqlite');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PER_BUCKET = Number(arg('--per-bucket', '25'));

// Refusals that belong to the FILE layer, not this one. Named, with their sizes reported, so the
// exclusion is auditable rather than a quiet subtraction.
// ⚠ `path_not_indexed` WAS MISSING FROM THIS SET IN THE FIRST RUN, AND THAT IS A REAL ERROR.
// It holds path-shaped spans whose file is not in the graph — the same KIND of thing as
// `is_a_path` and `basename_only`, and not a missed SYMBOL reference by any reading. Leaving it in
// put 414 spans into the recall denominator that could never have produced a symbol edge, which is
// denominator inflation: the exact defect that made an earlier "0 of 266" claim worthless because
// most of the 266 were never at risk. Caught while grading, before the number was published.
const OTHER_LAYER = new Set(['is_a_path', 'ambiguous_path', 'basename_only', 'path_not_indexed']);

const commit = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const graphHash = createHash('sha256').update(readFileSync(GRAPH)).digest('hex').slice(0, 16);

copyFileSync(GRAPH, SCRATCH);
const db = openDb(SCRATCH);
const stats = await detectDocRefs(db, REPO);
const admitted = db.all("SELECT COUNT(*) c FROM edges WHERE relation = 'MENTIONS'")[0].c;
db.close();
rmSync(SCRATCH, { force: true });

const lineCache = new Map();
function sourceLine(file, line) {
  if (!lineCache.has(file)) {
    try { lineCache.set(file, readFileSync(join(REPO, file), 'utf8').split(/\r?\n/)); } catch { lineCache.set(file, null); }
  }
  const lines = lineCache.get(file);
  return lines ? (lines[line - 1] ?? null) : null;
}

const byBucket = new Map();
for (const m of stats.misses) {
  if (!byBucket.has(m.bucket)) byBucket.set(m.bucket, []);
  byBucket.get(m.bucket).push(m);
}

const strata = [...byBucket.entries()].sort((a, b) => b[1].length - a[1].length).map(([bucket, all]) => {
  // Deterministic stride, never random: the same graph must produce the same sample, or a second
  // grader is grading a different population and the two numbers cannot be compared.
  const stride = Math.max(1, Math.floor(all.length / PER_BUCKET));
  const sample = all.filter((_, i) => i % stride === 0).slice(0, PER_BUCKET);
  return {
    bucket,
    population: all.length,
    counts_toward_recall: !OTHER_LAYER.has(bucket),
    sample_size: sample.length,
    sample: sample.map((m) => ({
      document: m.document,
      line: m.line,
      written: m.written,
      source_text: sourceLine(m.document, m.line),
      // "Is this a genuine reference to a symbol in THIS repository that the layer should have
      // admitted?"  yes | no
      is_a_missed_reference: null,
      reason: null,
    })),
  };
});

const recallDenominator = strata.filter((s) => s.counts_toward_recall)
  .reduce((a, s) => a + s.population, 0);

const artifact = {
  what: 'Stratified sample of REFUSED spans, for a recall FLOOR. Verdicts are NOT filled in.',
  how_to_grade: [
    'For each sample entry set `is_a_missed_reference` to true or false: does `source_text` contain',
    'a genuine reference to a symbol in THIS repository that the doc-ref layer should have admitted?',
    'A generic filename, a shell command, a placeholder like `foo()`, an external library and a',
    'sentence that merely uses a word are all FALSE. Give a `reason` for every TRUE — an unexplained',
    'miss cannot be acted on.',
    '',
    'THE ARITHMETIC, so nobody averages the strata:',
    '  per stratum   missed_estimate = population * (true_count / sample_size)',
    '  overall       estimated_missed = SUM(missed_estimate) over strata where counts_toward_recall',
    '  recall_floor  = admitted / (admitted + estimated_missed)',
    '',
    'It is a FLOOR, not a rate: it counts only misses this layer SAW and refused. A reference no',
    'rule produced a candidate span for is invisible to this sample and is not in the denominator.',
  ],
  pins: { commit, graph_sha256_16: graphHash, per_bucket: PER_BUCKET },
  totals: {
    admitted,
    refused_total: stats.misses.length,
    refused_counting_toward_recall: recallDenominator,
    refused_excluded_as_other_layer: stats.misses.length - recallDenominator,
    excluded_buckets: [...OTHER_LAYER],
  },
  strata,
};

const out = arg('--out', join('docs', 'evidence', `doc-ref-recall-${commit.slice(0, 8)}.json`));
mkdirSync(dirname(join(REPO, out)), { recursive: true });
writeFileSync(join(REPO, out), `${JSON.stringify(artifact, null, 2)}\n`);

console.log(`recall sample: ${out}`);
console.log(`  commit ${commit.slice(0, 8)} · graph ${graphHash} · admitted ${admitted}`);
console.log(`  refused ${stats.misses.length}, of which ${recallDenominator} count toward recall`);
for (const s of strata) {
  console.log(`    ${s.counts_toward_recall ? ' ' : '~'} ${s.bucket.padEnd(20)} population ${String(s.population).padStart(5)} · sampled ${s.sample_size}`);
}
console.log('  ~ = other layer, excluded from the recall denominator by definition');
if (strata.every((s) => s.sample_size === 0)) {
  console.error('REFUSED: every stratum sampled zero — nothing to grade');
  process.exit(1);
}
