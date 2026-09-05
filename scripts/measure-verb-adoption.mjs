#!/usr/bin/env node
// Measure how often agents ACTUALLY invoke the graph verbs, from transcripts on disk.
//
// WHY THIS EXISTS: on 2026-08-24 the field fleet was asked from recall whether any graph verb had
// changed what they did. They answered NONE, then counted their own transcript and found 55
// invocations. Self-report was wrong by two orders of magnitude, in the direction that condemns
// the tool — the direction nobody audits. Recall is not an admissible instrument for this
// question. Transcripts are.
//
// ⛔ THE TRAP the field fleet HIT FIRST, preserved so nobody repeats it: grepping the bare string
// "graph_" returned 5170 on one session. That is the DEFERRED-TOOL CATALOGUE echoed into the
// prompt, not behaviour. A tool NAME appearing in text is not a tool CALL. This script counts
// only `type === "tool_use"` blocks and reads their `name` field.
//
// Controls run in the SAME pass as the measurement, because a control run separately vouches
// for nothing (see memory/verification-instrument-failures.md).
//   POSITIVE — Bash/Read/Grep must be non-zero, or the parser is not seeing tool calls at all.
//   NEGATIVE — a fabricated verb name must be exactly zero, or the matcher is over-broad.

import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { gradeControls, runIsPublishable } from './lib/population-controls.mjs';

const argv = process.argv.slice(2);
const ROOT = argv.find((a) => !a.startsWith('--'));
// ⭐ THE WINDOW EXISTS TO ANSWER "DID THE FIX MOVE THE NUMBER", which the all-time figure cannot:
// a rate computed over every transcript ever written is dominated by the regime before the change.
// ISO-8601, compared as a string against the transcript's own first timestamp (both are Zulu).
const SINCE = argv.find((a) => a.startsWith('--since='))?.slice('--since='.length) ?? null;
// ⛔ MY OWN INSTRUMENTATION LIVES IN ONE PROJECT DIRECTORY, AND IT IS THE ONE THIS TOOL IS BUILT IN.
// The probes I spawn to VERIFY a routing fix are subagents that call the graph because I told them
// to; counting them as field adoption measures my own prompt. This repo has already come within one
// step of reporting its own transcript as field evidence. Excluding by directory is mechanical and
// needs nobody to remember a convention at spawn time.
const EXCLUDED = argv.filter((a) => a.startsWith('--exclude-project='))
  .map((a) => a.slice('--exclude-project='.length));

// ⛔⛔ DIRECTORY IS A PROXY FOR "WAS THIS AGENT TOLD TO CALL THE GRAPH", AND THE PROXY MISSES.
//
// An outside reviewer made the distinction: the defining property is instruction, not location.
// Reading the actual first prompt of all 11 subagent sidechains that ever made a real graph call
// found the proxy wrong in BOTH directions it warned about — three of them sit in
// `C--Users-Administrator-sand-castle` and open "TOOL EVALUATION of aify-project-graph ... you may
// ONLY use mcp__aify-project-graph__* tools", so a directory rule keeps them; and none of the ones
// it drops were organic.
//
// ⇒ Classify by CONTENT. A sidechain whose opening prompt names the tool was told about it, and it
// cannot testify about whether an agent reaches for the graph unprompted.
//
// ⚠ DELIBERATELY OVER-BROAD, and that direction is the safe one: a prompt that merely mentions the
// name is also excluded. Over-exclusion can only LOWER a measured adoption rate, so it can never
// manufacture the success this measurement exists to test for.
const EXCLUDE_INSTRUCTED = argv.includes('--exclude-instructed');
// ⚠ The prefix is spelled out rather than reusing GRAPH_PREFIX: that const is declared BELOW this
// line, and referencing it here is a temporal-dead-zone crash on every run.
const INSTRUCTION_MARKERS = [
  'mcp__aify-project-graph__', 'aify-project-graph', 'graph_health', 'graph_callers',
];
if (!ROOT) {
  console.error('usage: node scripts/measure-verb-adoption.mjs <transcripts-root>'
    + ' [--since=<ISO8601>] [--exclude-project=<dir>] [--exclude-instructed]');
  process.exit(2);
}
if (SINCE && Number.isNaN(Date.parse(SINCE))) {
  console.error(`--since is not a parseable date: ${SINCE}`);
  process.exit(2);
}

const GRAPH_PREFIX = 'mcp__aify-project-graph__';
const POSITIVE_CONTROLS = ['Bash', 'Read', 'Grep'];
// Must never appear. If it does, the matcher is matching text rather than tool_use blocks.
const NEGATIVE_CONTROL = 'mcp__aify-project-graph__graph_nonexistent_control_zzz';

/** One project directory's tally. Sessions are the unit that matters for adoption. */
class ProjectTally {
  constructor(name) {
    this.name = name;
    this.sessions = 0;
    this.sessionsWithGraphCall = 0;
    this.graphCalls = 0;
    this.perVerb = new Map();
    this.positive = 0;
    this.negative = 0;
    this.unparseableLines = 0;
    this.unparseableDetail = [];
  }

  recordSession({ graphCalls, verbs, positive, negative, badLines, badLineDetail = [] }) {
    this.sessions += 1;
    if (graphCalls > 0) this.sessionsWithGraphCall += 1;
    this.graphCalls += graphCalls;
    this.positive += positive;
    this.negative += negative;
    this.unparseableLines += badLines;
    for (const d of badLineDetail) this.unparseableDetail.push({ project: this.name, ...d });
    for (const [verb, n] of verbs) this.perVerb.set(verb, (this.perVerb.get(verb) ?? 0) + n);
  }

  get adoptionRate() {
    return this.sessions === 0 ? null : this.sessionsWithGraphCall / this.sessions;
  }
}

/**
 * Walk one transcript, counting tool_use blocks by name.
 *
 * ⛔ `startedAt` IS THE FIRST LINE'S OWN TIMESTAMP, NOT THE FILE'S mtime. A transcript that was
 * already open when a change landed keeps being appended to, so mtime says "new" about a session
 * that started under the old regime — the population would silently include the very transcripts
 * the cutoff exists to exclude. The file records when it began; use that.
 *
 * ⚠ `isSidechain` is also read here, and it is NOT used for classification. The depth rule below
 * has been the classifier since this script was written, and swapping classifiers mid-measurement
 * would make the new number incomparable with the 9/1116 baseline. It is reported as a CROSS-CHECK:
 * if the two ever disagree, one of them is wrong and the baseline needs re-deriving before anything
 * is compared to it.
 */
async function scanSession(file) {
  const verbs = new Map();
  let graphCalls = 0;
  let positive = 0;
  let negative = 0;
  let badLines = 0;
  let lineNo = 0;
  let startedAt = null;
  let selfDeclaredSidechain = null;
  let instructed = false;
  const badLineDetail = [];

  const rl = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line) continue;
    lineNo += 1;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      badLines += 1;
      // the reviewer, reviewing 85f6559: a COUNT of skipped lines is not whole-byte coverage.
      // Without their identity you cannot prove a per-project zero, because a recovered line can
      // only ADD usage — and "APG 0" was load-bearing in the attribution claim. Retain where each
      // failure was so the zero can be defended rather than assumed.
      badLineDetail.push({ file, line: lineNo, bytes: line.length, error: String(err && err.message).slice(0, 80) });
      continue;
    }
    if (startedAt === null && typeof obj?.timestamp === 'string') startedAt = obj.timestamp;
    if (lineNo === 1) {
      const c0 = obj?.message?.content;
      const opening = Array.isArray(c0) ? (c0[0]?.text ?? '') : String(c0 ?? '');
      instructed = INSTRUCTION_MARKERS.some((m) => opening.includes(m));
    }
    if (selfDeclaredSidechain === null && typeof obj?.isSidechain === 'boolean') {
      selfDeclaredSidechain = obj.isSidechain;
    }
    const content = obj?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      // The whole point: a tool_use BLOCK, never a name appearing in prose.
      if (block?.type !== 'tool_use' || typeof block.name !== 'string') continue;
      const name = block.name;
      if (name === NEGATIVE_CONTROL) negative += 1;
      if (POSITIVE_CONTROLS.includes(name)) positive += 1;
      if (name.startsWith(GRAPH_PREFIX)) {
        graphCalls += 1;
        const short = name.slice(GRAPH_PREFIX.length);
        verbs.set(short, (verbs.get(short) ?? 0) + 1);
      }
    }
  }
  return {
    graphCalls, verbs, positive, negative, badLines, badLineDetail,
    startedAt, selfDeclaredSidechain, instructed,
  };
}

// TWO POPULATIONS, NEVER MERGED. A transcript sitting directly in a project directory is a
// top-level SESSION — the unit the published 64.6%-never-invoke figure is about. Everything
// nested below it is a SUBAGENT sidechain: real invocations, but not a session an agent chose
// to start. Counting them together would answer neither question, and the noun on a number is
// the thing I have got wrong most often here.
// A .jsonl sitting DIRECTLY in the project directory is a session; anything deeper is nested.
// Written flat rather than as a clever recursion because the clever version returned zero on
// every count and only the positive control caught it.
async function collect(projectDir) {
  const sessions = [];
  const nested = [];
  const walk = async (dir, isProjectRoot) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, false);
      else if (entry.name.endsWith('.jsonl')) (isProjectRoot ? sessions : nested).push(full);
    }
  };
  await walk(projectDir, true);
  return { sessions, nested };
}

const dirs = (await readdir(ROOT, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const tallies = [];
const nestedTally = new ProjectTally('(subagent sidechains, all projects)');
// ⚠ EXCLUSIONS ARE COUNTED, NOT SILENT. A filter that drops transcripts without saying how many
// makes a small post-cutoff n look like a small population rather than a narrow window.
const windowStats = {
  excludedOlder: 0, noTimestamp: 0, classifierDisagreements: 0, excludedProjects: [], excludedInstructed: 0,
};
for (const dir of dirs) {
  if (EXCLUDED.includes(dir)) { windowStats.excludedProjects.push(dir); continue; }
  const full = join(ROOT, dir);
  const { sessions, nested } = await collect(full);
  if (sessions.length === 0 && nested.length === 0) continue;
  const tally = new ProjectTally(dir);
  const admit = (scan, expectedSidechain) => {
    // ⛔ A TRANSCRIPT WITH NO TIMESTAMP IS UNKNOWN, NOT RECENT. Admitting it would let an
    // unparseable file join whichever window flatters the result.
    if (SINCE) {
      if (!scan.startedAt) { windowStats.noTimestamp += 1; return false; }
      if (scan.startedAt < SINCE) { windowStats.excludedOlder += 1; return false; }
    }
    if (EXCLUDE_INSTRUCTED && scan.instructed) { windowStats.excludedInstructed += 1; return false; }
    if (scan.selfDeclaredSidechain !== null && scan.selfDeclaredSidechain !== expectedSidechain) {
      windowStats.classifierDisagreements += 1;
    }
    return true;
  };
  for (const path of sessions) {
    const { size } = await stat(path);
    if (size === 0) continue;
    const scan = await scanSession(path);
    if (admit(scan, false)) tally.recordSession(scan);
  }
  for (const path of nested) {
    const { size } = await stat(path);
    if (size === 0) continue;
    const scan = await scanSession(path);
    if (admit(scan, true)) nestedTally.recordSession(scan);
  }
  tallies.push(tally);
  process.stderr.write(`  ${dir}: ${tally.sessions} sessions (${tally.graphCalls} calls), ${nested.length} nested\n`);
}

const totals = tallies.reduce(
  (acc, t) => ({
    sessions: acc.sessions + t.sessions,
    withCall: acc.withCall + t.sessionsWithGraphCall,
    calls: acc.calls + t.graphCalls,
    positive: acc.positive + t.positive,
    negative: acc.negative + t.negative,
    bad: acc.bad + t.unparseableLines,
  }),
  { sessions: 0, withCall: 0, calls: 0, positive: 0, negative: 0, bad: 0 },
);

const allVerbs = new Map();
for (const t of tallies) for (const [v, n] of t.perVerb) allVerbs.set(v, (allVerbs.get(v) ?? 0) + n);

const gradedPopulations = [
  gradeControls({ population: totals.sessions, positive: totals.positive, negative: totals.negative }),
  gradeControls({
    population: nestedTally.sessions, positive: nestedTally.positive, negative: nestedTally.negative,
  }),
];
const publishable = runIsPublishable(gradedPopulations);

console.log(JSON.stringify({
  what: 'MEASURED graph-verb invocations across every Claude Code transcript on this machine.',
  carrier: { root: ROOT, projectDirs: tallies.length },
  // ⛔ THE WINDOW IS PART OF THE CARRIER. A rate without the interval it was taken over is the
  // error this repo already recorded — "0 of 27" published from a rebuild window.
  window: SINCE
    ? {
      since: SINCE,
      basis: "the transcript's OWN first timestamp, not the file mtime",
      excludedAsOlder: windowStats.excludedOlder,
      excludedAsUndated: windowStats.noTimestamp,
      classifierCrossCheckDisagreements: windowStats.classifierDisagreements,
    }
    : { since: null, note: 'ALL TIME — dominated by whatever regime held for most of the corpus' },
  excludedProjects: windowStats.excludedProjects,
  excludedAsInstructed: EXCLUDE_INSTRUCTED ? windowStats.excludedInstructed : null,
  // ⛔ ONE SET OF CONTROLS PER POPULATION, BECAUSE A CONTROL VOUCHES ONLY FOR WHAT IT COUNTED.
  // Until 2026-09-05 this reported a single positive control summed over the TOP-LEVEL tallies
  // while the preregistered adoption measurement reads its n from the NESTED population. In the
  // measurement window that published "positive control: 0, FAILS" over a nested population
  // holding 255 Bash/Read/Grep calls, and the preregistration wrote the failure down as correct.
  controls: {
    names: { positive: POSITIVE_CONTROLS, negative: NEGATIVE_CONTROL },
    topLevelSessions: gradeControls({
      population: totals.sessions, positive: totals.positive, negative: totals.negative,
    }),
    subagentSidechains: gradeControls({
      population: nestedTally.sessions, positive: nestedTally.positive, negative: nestedTally.negative,
    }),
    publishable,
    ranInSamePass: true,
    unparseableLines: totals.bad,
    unparseableDetail: [...tallies, nestedTally].flatMap((t) => t.unparseableDetail),
  },
  topLevelSessions: {
    noun: 'A transcript an agent session actually ran. Comparable to the published "% of sessions that never invoke a query tool".',
    sessions: totals.sessions,
    sessionsWithAtLeastOneGraphCall: totals.withCall,
    sessionsWithZeroGraphCalls: totals.sessions - totals.withCall,
    adoptionRateSessions: totals.sessions ? totals.withCall / totals.sessions : null,
    graphCalls: totals.calls,
  },
  subagentSidechains: {
    noun: 'Nested transcripts spawned BY a session. Real invocations, but not sessions anyone chose to start. NOT comparable to the published figure.',
    transcripts: nestedTally.sessions,
    withAtLeastOneGraphCall: nestedTally.sessionsWithGraphCall,
    graphCalls: nestedTally.graphCalls,
    topVerbs: Object.fromEntries([...nestedTally.perVerb.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)),
  },
  perVerb: Object.fromEntries([...allVerbs.entries()].sort((a, b) => b[1] - a[1])),
  perProject: tallies.map((t) => ({
    project: t.name,
    sessions: t.sessions,
    sessionsWithGraphCall: t.sessionsWithGraphCall,
    adoptionRate: t.adoptionRate,
    graphCalls: t.graphCalls,
    topVerbs: Object.fromEntries([...t.perVerb.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)),
  })),
}, null, 2));

// Report-only. A measurement script must not gate anything on its own RESULT — the exit code
// reflects only whether the instrument demonstrated it works, never what it found.
process.exit(publishable.ok ? 0 : 1);
