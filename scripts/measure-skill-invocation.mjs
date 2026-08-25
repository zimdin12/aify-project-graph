#!/usr/bin/env node
// Are the skills we ship ever actually INVOKED? Measured from transcripts, not assumed.
//
// WHY THIS EXISTS. Two independent measurements on 2026-08-25 said agents do not reach for these
// tools even when they can: subagent sidechains invoked a graph verb in 7 of 1,049 transcripts
// (0.7%), and in a controlled A/B three of five agents TOLD to use the tools never called one.
// The corrected strategy after that was: skills are the lever for the population that is not
// reaching the verbs.
//
// ⛔ THAT STRATEGY ASSUMES THE SKILLS THEMSELVES ARE REACHED, AND THAT WAS NEVER CHECKED. The
// doc layer had genuinely good precision and ZERO consumers for weeks because it sat behind a
// parameter nobody knew existed — quality work on something unreachable. Betting the adoption
// plan on skills without measuring skill invocation would be that defect one layer up.
//
// ⇒ Check reachability BEFORE quality. This counts `Skill` tool_use blocks and reads the skill
// name argument, the same structural method as the verb counter — never a text grep, because a
// skill NAME appearing in prose (or in a skills catalogue echoed into the prompt) is not an
// invocation.

import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const ROOT = process.argv[2];
if (!ROOT) {
  console.error('usage: node scripts/measure-skill-invocation.mjs <transcripts-root>');
  process.exit(2);
}

// Skills this project ships. Anything else invoked is counted separately as the positive control:
// if NO skill of any kind was ever invoked, the parser is broken rather than the skills unused.
const OURS = new Set([
  'aify-project-graph', 'blast-radius', 'cpp-inner-loop', 'find-the-doc', 'graph-anchor-drift',
  'graph-build-all', 'graph-build-briefs', 'graph-build-functionality', 'graph-build-intelligence',
  'graph-build-tasks', 'graph-dashboard', 'graph-feature-edit', 'graph-guide', 'graph-pull-context',
  'graph-task-edit', 'graph-walk-bugs', 'safe-to-delete',
]);
// Must never appear. Guards against a matcher that counts any string it sees.
const NEGATIVE_CONTROL = 'zzz-not-a-real-skill-control';

async function scan(file) {
  const ours = new Map();
  const others = new Map();
  let anySkillCall = 0;
  let negative = 0;
  let badLines = 0;

  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { badLines += 1; continue; }
    const content = obj?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      // A Skill INVOCATION is a tool_use block named `Skill`; its `skill` input names which one.
      if (block?.type !== 'tool_use' || block.name !== 'Skill') continue;
      anySkillCall += 1;
      const name = typeof block.input?.skill === 'string' ? block.input.skill : '(unnamed)';
      if (name === NEGATIVE_CONTROL) negative += 1;
      const bucket = OURS.has(name) ? ours : others;
      bucket.set(name, (bucket.get(name) ?? 0) + 1);
    }
  }
  return { ours, others, anySkillCall, negative, badLines };
}

async function collect(projectDir) {
  const sessions = [];
  const nested = [];
  const walk = async (dir, isRoot) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full, false);
      else if (e.name.endsWith('.jsonl')) (isRoot ? sessions : nested).push(full);
    }
  };
  await walk(projectDir, true);
  return { sessions, nested };
}

const merge = (into, from) => { for (const [k, v] of from) into.set(k, (into.get(k) ?? 0) + v); };

const oursTotal = new Map();
const othersTotal = new Map();
let anySkillCall = 0;
let negative = 0;
let badLines = 0;
let sessions = 0;
let sessionsWithOurSkill = 0;
let nestedCount = 0;
let nestedWithOurSkill = 0;

for (const dir of (await readdir(ROOT, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const { sessions: s, nested: n } = await collect(join(ROOT, dir));
  for (const f of s) {
    if ((await stat(f)).size === 0) continue;
    sessions += 1;
    const r = await scan(f);
    merge(oursTotal, r.ours); merge(othersTotal, r.others);
    anySkillCall += r.anySkillCall; negative += r.negative; badLines += r.badLines;
    if (r.ours.size > 0) sessionsWithOurSkill += 1;
  }
  for (const f of n) {
    if ((await stat(f)).size === 0) continue;
    nestedCount += 1;
    const r = await scan(f);
    merge(oursTotal, r.ours); merge(othersTotal, r.others);
    anySkillCall += r.anySkillCall; negative += r.negative; badLines += r.badLines;
    if (r.ours.size > 0) nestedWithOurSkill += 1;
  }
}

const ourCalls = [...oursTotal.values()].reduce((a, b) => a + b, 0);
const otherCalls = [...othersTotal.values()].reduce((a, b) => a + b, 0);

// POSITIVE CONTROL: some skill, ours or not, must have been invoked somewhere. A total of zero
// means the parser never saw a Skill block — which is indistinguishable from "nobody uses skills"
// and is the wrong-zero-that-agrees-with-your-prior failure this repo keeps hitting.
const controlsPassed = anySkillCall > 0 && negative === 0;

console.log(JSON.stringify({
  what: 'Skill INVOCATIONS (Skill tool_use blocks), ours vs everyone else, across all transcripts.',
  controls: {
    anySkillInvocation: anySkillCall,
    negativeControl: negative,
    passed: controlsPassed,
    note: controlsPassed ? null : 'CONTROLS FAILED — read nothing below as a finding.',
    unparseableLines: badLines,
  },
  population: { sessions, nestedTranscripts: nestedCount },
  ourSkills: {
    shipped: OURS.size,
    distinctInvoked: oursTotal.size,
    totalCalls: ourCalls,
    sessionsWithAny: sessionsWithOurSkill,
    nestedWithAny: nestedWithOurSkill,
    perSkill: Object.fromEntries([...oursTotal.entries()].sort((a, b) => b[1] - a[1])),
    neverInvoked: [...OURS].filter((s) => !oursTotal.has(s)).sort(),
  },
  otherSkills: { distinct: othersTotal.size, totalCalls: otherCalls },
}, null, 2));

process.exit(controlsPassed ? 0 : 1);
