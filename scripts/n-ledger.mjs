#!/usr/bin/env node
// RECORD n, THE GATE CONDITION, WHERE IT CAN CONTRADICT ME.
//
// Usage: node scripts/n-ledger.mjs [--dry-run]
//        APG_TRANSCRIPTS_ROOT overrides the transcripts location (default: ~/.claude/projects).
//
// ⛔ WHAT THIS CLOSES, 2026-09-05. The adoption measurement may not be read until n = 100. That n
// was being carried in prose across cycles, with no record of the command, the filters, or the
// instrument that produced it. It said 16 for two cycles; the instrument says 5, and 16 is not
// reproducible under any filter combination, cutoff, or mtime-versus-timestamp reading. A wrong
// entry in my own notes is an instrument failure like any other, and it fails toward looking busy.
//
// ⭐ SO THE READING GETS AN ARTIFACT, NOT A MEMORY. Each run appends one row carrying n, the
// controls that ran in the same pass, the exclusion counts, and the SHA of the instrument that
// produced it — so a count that changes because the INSTRUMENT changed is visible as exactly that.
//
// ⭐ AND IT PRINTS ONLY THE n SIDE. The outcome (how many transcripts made a graph call) is gated
// until n = 100, and the underlying counter prints it in the same JSON. Nothing here reads that
// field, so this command is safe to run every cycle, which is the whole point of having it.
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADOPTION_WINDOW, counterArgsFor, classifyReading } from './lib/adoption-window.mjs';
import { HEADER, formatRow, lastRecordedN } from './lib/n-ledger-rows.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const COUNTER = join(REPO, 'scripts', 'measure-verb-adoption.mjs');
const LEDGER = join(REPO, 'docs', 'evidence', 'm5-scale', 'N-LEDGER.tsv');

/** Where this machine keeps Claude Code transcripts. Varies by environment, so it is configuration. */
function transcriptsRoot() {
  return process.env.APG_TRANSCRIPTS_ROOT ?? join(homedir(), '.claude', 'projects');
}

/** Run the counter and keep ONLY the fields that describe the population. Never the outcome. */
function measureN(root) {
  const raw = execFileSync(process.execPath, [COUNTER, ...counterArgsFor(root)], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
  });
  const report = JSON.parse(raw);
  const controls = report.controls.subagentSidechains;
  return {
    n: report.subagentSidechains.transcripts,
    population: controls.population,
    controlPositive: controls.positive.count,
    controlNegative: controls.negative.count,
    vouches: controls.vouches,
    excludedOlder: report.window.excludedAsOlder,
    excludedUndated: report.window.excludedAsUndated,
    excludedInstructed: report.excludedAsInstructed,
    classifierDisagreements: report.window.classifierCrossCheckDisagreements,
  };
}

/** The content hash of the instrument, so an instrument change never hides inside a count change. */
function instrumentSha() {
  return execFileSync('git', ['hash-object', COUNTER], { cwd: REPO, encoding: 'utf8' }).trim().slice(0, 12);
}

const dryRun = process.argv.includes('--dry-run');
const reading = measureN(transcriptsRoot());
const previous = existsSync(LEDGER) ? lastRecordedN(readFileSync(LEDGER, 'utf8')) : null;
const verdict = classifyReading(previous, reading.n);

const row = {
  readAtIso: new Date().toISOString(),
  n: reading.n,
  gateN: ADOPTION_WINDOW.gateN,
  movement: verdict.movement,
  verdictAllowed: verdict.verdictAllowed,
  controlPositive: reading.controlPositive,
  controlNegative: reading.controlNegative,
  population: reading.population,
  excludedOlder: reading.excludedOlder,
  excludedUndated: reading.excludedUndated,
  excludedInstructed: reading.excludedInstructed,
  classifierDisagreements: reading.classifierDisagreements,
  instrumentSha: instrumentSha(),
};

if (!dryRun) {
  if (!existsSync(LEDGER)) appendFileSync(LEDGER, HEADER, 'utf8');
  appendFileSync(LEDGER, formatRow(row), 'utf8');
}

console.log(`n = ${row.n} of ${row.gateN}   (${row.movement}${previous === null ? '' : `, was ${previous}`})`);
console.log(`  [CONTROL+] Bash/Read/Grep in the measured population : ${row.controlPositive}`
  + ` ${reading.vouches ? 'PASS' : 'DOES NOT VOUCH'}`);
console.log(`  [CONTROL-] fabricated verb name                      : ${row.controlNegative}`);
console.log(`  excluded older / undated / instructed                : `
  + `${row.excludedOlder} / ${row.excludedUndated} / ${row.excludedInstructed}`);
console.log(`  instrument                                           : ${row.instrumentSha}`);
console.log(row.verdictAllowed
  ? '  ⇒ GATE REACHED. The outcome may now be read, once.'
  : `  ⇒ no verdict. ${verdict.movement === 'shrank'
    ? 'AND n WENT DOWN, which is impossible under a fixed cutoff — the series is void until explained.'
    : 'Do not read the outcome.'}`);

// ⛔ A DROP IS NOT A SMALLER NUMBER, IT IS A BROKEN SERIES. Exit non-zero so a cycle that runs this
// unattended cannot record the drop and move on.
process.exit(verdict.movement === 'shrank' ? 1 : 0);
