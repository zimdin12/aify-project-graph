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

const ROOT = process.argv[2];
if (!ROOT) {
  console.error('usage: node scripts/measure-verb-adoption.mjs <transcripts-root>');
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

/** Walk one transcript, counting tool_use blocks by name. */
async function scanSession(file) {
  const verbs = new Map();
  let graphCalls = 0;
  let positive = 0;
  let negative = 0;
  let badLines = 0;
  let lineNo = 0;
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
  return { graphCalls, verbs, positive, negative, badLines, badLineDetail };
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
for (const dir of dirs) {
  const full = join(ROOT, dir);
  const { sessions, nested } = await collect(full);
  if (sessions.length === 0 && nested.length === 0) continue;
  const tally = new ProjectTally(dir);
  for (const path of sessions) {
    const { size } = await stat(path);
    if (size === 0) continue;
    tally.recordSession(await scanSession(path));
  }
  for (const path of nested) {
    const { size } = await stat(path);
    if (size === 0) continue;
    nestedTally.recordSession(await scanSession(path));
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

console.log(JSON.stringify({
  what: 'MEASURED graph-verb invocations across every Claude Code transcript on this machine.',
  carrier: { root: ROOT, projectDirs: tallies.length },
  controls: {
    positive: { names: POSITIVE_CONTROLS, count: totals.positive, passed: totals.positive > 0 },
    negative: { name: NEGATIVE_CONTROL, count: totals.negative, passed: totals.negative === 0 },
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

// Report-only. A measurement script must not gate anything on its own result.
process.exit(totals.positive > 0 && totals.negative === 0 ? 0 : 1);
