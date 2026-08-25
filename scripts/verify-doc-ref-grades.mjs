#!/usr/bin/env node
// RECONCILE EVERY GRADE FILE'S HEADLINE AGAINST ITS OWN ROWS.
//
// ⛔ WHY THIS EXISTS. `docs/evidence/` now holds precision claims from two parties in two schemas,
// and every one of them carries a summary — `precision`, `correct`, `false_positives` — beside the
// rows those numbers are supposed to come from. A summary that disagrees with its rows is a
// receipt for a claim nobody made, and it reads exactly like a verified result.
//
// This repo has already shipped that defect once in a different form: counters incremented in
// parallel with the list they described, which could drift so that a grader auditing a sample
// certified a number the records did not add up to. The remedy there was to DERIVE the counts from
// the list. These files are written by hand and by other agents, so the equivalent remedy is to
// recompute and compare.
//
// ⚠ TWO SCHEMAS, ON PURPOSE, AND NEITHER IS REWRITTEN. My frozen artifact uses lowercase verdicts
// on an `admitted` array with `pins`; the field test's standalone grades use uppercase verdicts on an
// `edges` array with `graded_at_commit`. Normalising theirs by editing it would mean me altering
// another party's evidence, which defeats the point of it being another party's. So the READER
// adapts, and the adapter is here where it can be tested rather than in each consumer.
//
// Usage:  node scripts/verify-doc-ref-grades.mjs [--dir docs/evidence]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOC_REF_RULES } from '../mcp/stdio/analysis/doc-refs.js';
import { DOC_LINK_RULES } from '../mcp/stdio/analysis/doc-links.js';

// ⛔ WHICH RULES ARE STILL LIVE IS DERIVED FROM THE CODE, NEVER LISTED HERE.
//
// A grade file for a DELETED rule is a correct historical record — `doc_link:inline-basename` was
// graded 0.708 and deleted BECAUSE of that number, and its file preserves the 85 correct edges the
// deletion cost. Treating it as a live failure would mean the evidence of a good decision fails
// the gate forever, and the obvious workaround is to delete the evidence.
//
// A hand-maintained list of retired tags here would go stale the first time a rule is added.
const LIVE_RULES = new Set([...Object.keys(DOC_REF_RULES), ...Object.keys(DOC_LINK_RULES)]);

const argDir = process.argv.indexOf('--dir');
const DIR = argDir >= 0 && process.argv[argDir + 1] ? process.argv[argDir + 1] : join('docs', 'evidence');
const FLOOR = 0.95;

/** Normalise either schema to { rows: [{verdict}], claimed: {correct, fp, precision}, pin }. */
function normalise(doc) {
  const rows = doc.admitted ?? doc.edges ?? [];
  const verdict = (r) => String(r.verdict ?? '').toLowerCase();
  return {
    rows: rows.map((r) => ({
      verdict: verdict(r),
      reason: r.verdict_reason ?? r.reason ?? null,
      // ⛔ THE RULE IS CARRIED PER ROW BECAUSE THE FLOOR IS PER RULE. My first version of this
      // script reported ONE aggregate per file — and the very first file it graded holds two
      // rules, so `doc_ref:shaped` at 0.9718 and `doc_ref:qualified` at n=1 were being averaged
      // into 0.9722 and reported as a single CLEARS.
      //
      // ⚠ THAT IS THE DEFECT THIS SCRIPT EXISTS TO CATCH, BUILT INTO THE SCRIPT. dev's gate is
      // "precision floor >=0.95 PER ADMISSION RULE, not aggregate", and my own frozen-artifact
      // instructions say an aggregate "can clear 0.95 while a rule inside it sits at 0.6". I wrote
      // that sentence and then averaged anyway.
      rule: r.extractor ?? doc.rule ?? '(unknown)',
    })),
    claimed: {
      correct: doc.correct ?? null,
      fp: doc.false_positives ?? null,
      precision: doc.precision ?? null,
    },
    pin: doc.pins?.commit ?? doc.graded_at_commit ?? null,
    rule: doc.rule ?? Object.keys(
      rows.reduce((a, r) => ({ ...a, [r.extractor ?? '?']: 1 }), {}),
    ).join('+'),
  };
}

let failures = 0;
const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.error(`REFUSED: no grade files in ${DIR} — a clean run over an empty set proves nothing`);
  process.exit(1);
}

for (const f of files) {
  let doc;
  try { doc = JSON.parse(readFileSync(join(DIR, f), 'utf8')); } catch (err) {
    console.log(`⛔ ${f}: unparseable — ${err.message}`);
    failures++;
    continue;
  }
  const { rows, claimed, pin, rule } = normalise(doc);
  const correct = rows.filter((r) => r.verdict === 'correct').length;
  const fp = rows.filter((r) => r.verdict === 'false_positive').length;
  const ungraded = rows.length - correct - fp;
  const graded = correct + fp;
  const precision = graded ? correct / graded : null;

  // Per-rule, which is what the gate is actually stated against.
  const perRule = new Map();
  for (const r of rows) {
    if (r.verdict !== 'correct' && r.verdict !== 'false_positive') continue;
    const e = perRule.get(r.rule) ?? { correct: 0, fp: 0 };
    if (r.verdict === 'correct') e.correct++; else e.fp++;
    perRule.set(r.rule, e);
  }

  const problems = [];
  // A file with no verdicts at all is the FROZEN population, which is a valid artifact — it is
  // supposed to arrive with nulls. Say so rather than calling it a failure.
  const isFrozen = graded === 0;
  if (!isFrozen) {
    if (claimed.correct !== null && claimed.correct !== correct) problems.push(`claimed correct ${claimed.correct} vs rows ${correct}`);
    if (claimed.fp !== null && claimed.fp !== fp) problems.push(`claimed fp ${claimed.fp} vs rows ${fp}`);
    if (claimed.precision !== null && Math.abs(claimed.precision - precision) > 0.0005) {
      problems.push(`claimed precision ${claimed.precision} vs rows ${precision.toFixed(4)}`);
    }
    // ⚠ A verdict without a reason is an assertion, not a grade. Only enforced on FPs: a
    // "correct" needs no explanation, a rejection does.
    const bare = rows.filter((r) => r.verdict === 'false_positive' && !r.reason).length;
    if (bare > 0) problems.push(`${bare} false positive(s) with no stated mechanism`);
  }
  if (!pin) problems.push('no commit pin — the population is not replayable');

  const verdict = isFrozen ? 'FROZEN (no verdicts, by design)'
    : `${precision.toFixed(4)} ${precision >= FLOOR ? 'CLEARS' : 'BELOW FLOOR'}`;
  console.log(`${problems.length ? '⛔' : '✓ '} ${f}`);
  console.log(`     rule ${rule} · rows ${rows.length} · correct ${correct} · fp ${fp} · ungraded ${ungraded}`);
  console.log(`     pin ${pin ? pin.slice(0, 8) : '(none)'} · aggregate ${verdict}`);
  // ⭐ THE LINE THAT MATTERS. An aggregate can clear while a rule inside it fails, and a file
  // holding two rules is exactly where that hides.
  for (const [ruleName, e2] of [...perRule.entries()].sort()) {
    const n = e2.correct + e2.fp;
    const p = e2.correct / n;
    const flag = p >= FLOOR ? 'CLEARS' : 'BELOW FLOOR';
    const caveat = n < 10 ? `  ⚠ n=${n}, too small to be a floor` : '';
    console.log(`       ${ruleName.padEnd(26)} ${e2.correct}/${n} = ${p.toFixed(4)} ${flag}${caveat}`);
    // ⛔ "DOES NOT RECONCILE" AND "GRADED BELOW THE FLOOR" ARE DIFFERENT ANSWERS, AND MY FIRST
    // VERSION COLLAPSED THEM INTO ONE EXIT CODE. A file whose summary disagrees with its rows is
    // BROKEN. A file that faithfully records a rule scoring 0.708 is CORRECT — it is the record of
    // why that rule was deleted. Same exit code for both is the two-state collapse this repo has
    // now found six times, here in the instrument built to check the others.
    if (p < FLOOR) {
      if (LIVE_RULES.has(ruleName)) {
        problems.push(`rule ${ruleName} is LIVE and BELOW the floor at ${p.toFixed(4)}`);
      } else {
        console.log(`       ${' '.repeat(26)} (rule no longer exists — this file is the record of its deletion)`);
      }
    }
  }
  for (const p of problems) console.log(`     ⛔ ${p}`);
  if (problems.length) failures++;
}

console.log('');
console.log(failures === 0
  ? `all ${files.length} grade file(s) reconcile against their own rows`
  : `${failures} of ${files.length} grade file(s) do NOT reconcile`);
process.exit(failures === 0 ? 0 : 1);
