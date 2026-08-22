#!/usr/bin/env node
// ESTABLISH A HOST'S usageSemantics FROM A TRANSCRIPT, OR REFUSE AND SAY WHY.
//
// ⛔ THE PROBLEM THIS CLOSES HALF OF. `reconcileTurnUsage` refuses on any non-decreasing
// multi-turn series, because cumulative and per-turn readings both fit and the reading is a
// property of the HOST rather than of the numbers. That refusal is correct and it blocks the
// efficacy re-run. The roadmap's remedy — "establish usageSemantics per harness against a
// provider-reported total on a frozen transcript" — needs somebody to know how.
//
// ⭐ THERE IS A STRONGER DISCRIMINATOR THAN A PROVIDER TOTAL, AND IT NEEDS NO SECOND SOURCE.
// A cumulative counter cannot decrease. So ONE decrease anywhere in the series is a proof by
// contradiction that the host reports PER-TURN. No reconciliation, no window-matching, no
// question about which total the provider meant.
//
// The discriminator was validated on a real Claude Code session transcript, 23,562 rows carrying
// `message.usage`:
//
//     output series decreases at  6130 of 23561 steps   -> per_turn, refutes cumulative
//     input series  decreases at    32 of 23561 steps   -> per_turn, refutes cumulative
//
// ⛔ BUT READ HOW THAT WAS MEASURED, BECAUSE IT IS NOT WHAT THIS TOOL DOES. Those numbers come
// from parsing `message.usage` directly. `collectTurnUsage` — the collector the A/B runner uses
// and the one below — reads `turn.completed` events and returns **ZERO usage turns** on that same
// Claude Code file. Two different parses of two different formats.
//
// ⇒ So the DISCRIMINATOR is validated and the HOST is not. The 6,130 decreases prove that a
// monotonicity violation is real and detectable in practice; they establish nothing about any
// host this harness drives. Stating it the other way round — "validated on Claude Code" — would
// be a contract certified by an instrument that cannot read the subject, which is the failure
// this file's own comment above warns about.
//
// ⚠ AND IT DOES NOT GENERALISE ACROSS HOSTS ANYWAY. The A/B harness in this repo drives CODEX
// (`runCodexCell` is its only agent adapter). A contract proven on one host is worth nothing on
// another. Run this against a codex transcript to establish codex.
//
// ⚠ SECOND-ORDER FINDING, recorded because it bounds what this tool can do today: the collector is
// codex-shaped only. If a Claude Code harness is ever added, `collectTurnUsage` will report zero
// turns for it rather than failing — a coverage-shaped silence, which is why it carries a
// `coverage` field and why this tool prints it.
//
// ⚠ AND A NON-DECREASING SERIES PROVES NOTHING EITHER WAY. It is consistent with both readings,
// which is the whole reason the reconciler refuses. This tool says CANNOT_ESTABLISH rather than
// picking, because a short run is exactly where a per-turn series looks cumulative by luck.
//
//   node scripts/establish-usage-semantics.mjs <transcript.jsonl> [--field output|input]
//
// Exit 0 = established (and the verdict is printed). Exit 2 = cannot establish from this file.
// Exit 1 = the file could not be read or carried no usage at all.
import { readFileSync } from 'node:fs';
import { collectTurnUsage } from './lib/turn-usage.mjs';

const path = process.argv[2];
const fieldArg = process.argv.indexOf('--field');
const FIELD = fieldArg !== -1 ? process.argv[fieldArg + 1] : 'output';

if (!path) {
  console.error('usage: node scripts/establish-usage-semantics.mjs <transcript.jsonl> [--field output|input]');
  process.exit(1);
}

let lines;
try {
  lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
} catch (e) {
  console.error(`cannot read ${path}: ${e.message}`);
  process.exit(1);
}

// ⛔ THE SAME COLLECTOR THE RUNNER USES, not a second reading of the same file. A calibration that
// parses the transcript its own way can establish a contract for a series the runner never sees —
// which is the apparatus-disagrees-with-production defect, in the tool that certifies production.
const { usages, coverage } = collectTurnUsage(lines);
const series = usages.map((u) => (FIELD === 'input'
  ? (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  : (u.output_tokens ?? 0)));

console.log(`transcript      ${path}`);
console.log(`field           ${FIELD}`);
console.log(`usage turns     ${series.length}`);
if (coverage) {
  console.log(`coverage        ${JSON.stringify(coverage)}`);
}

if (series.length === 0) {
  console.log('\nVERDICT: NO USAGE — this transcript carries no turn usage at all, so it can');
  console.log('establish nothing. That is a fact about the file, not about the host.');
  process.exit(1);
}

if (series.length < 2) {
  console.log('\nVERDICT: CANNOT_ESTABLISH — one turn. A single value is consistent with every');
  console.log('reading; semantics is a property of how values RELATE across turns.');
  process.exit(2);
}

const drops = [];
for (let i = 1; i < series.length; i += 1) {
  if (series[i] < series[i - 1]) drops.push({ at: i, from: series[i - 1], to: series[i] });
}

if (drops.length > 0) {
  const d = drops[0];
  console.log(`decreases       ${drops.length} of ${series.length - 1} steps`);
  console.log(`first at        turn ${d.at}: ${d.from} -> ${d.to}`);
  console.log('');
  console.log('VERDICT: per_turn — ESTABLISHED.');
  console.log('  A cumulative counter cannot decrease. One decrease refutes the cumulative');
  console.log('  reading outright, so this is a proof rather than a preponderance.');
  console.log('');
  console.log('  Pass { semantics: "per_turn" } to reconcileTurnUsage for THIS HOST ONLY.');
  process.exit(0);
}

// ⚠ Non-decreasing. Deliberately does NOT fall back to "probably cumulative": a per-turn series
// grows naturally as context grows, which is precisely how [100,200,300] gets misread as 300.
console.log(`decreases       0 of ${series.length - 1} steps`);
console.log(`series          ${series.slice(0, 12).join(', ')}${series.length > 12 ? ' …' : ''}`);
console.log('');
console.log('VERDICT: CANNOT_ESTABLISH from this transcript.');
console.log('  The series never decreases, so both readings fit: a cumulative counter rises, and');
console.log('  a per-turn series ALSO rises as context grows. Values alone cannot separate them.');
console.log('');
console.log('  Two ways forward, in order of strength:');
console.log('   1. A LONGER transcript, ideally one spanning a compaction — a per-turn series');
console.log('      drops sharply when context is reset, and a cumulative one cannot.');
console.log('   2. A provider-reported total for the same session. If it equals the SUM the host');
console.log('      is per-turn; if it equals the LAST value the host is cumulative.');
console.log('      ⚠ Weaker, because it depends on the provider total covering exactly this');
console.log('      window, and a mismatch is then ambiguous between the two.');
process.exit(2);
