#!/usr/bin/env node
// Are the skills we ship ever actually INVOKED, and BY WHOM? Measured from transcripts.
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
//
// ⭐ AND IT ATTRIBUTES EACH CALL TO A PROJECT, which the first version did not. "9 calls" is a
// finding about ADOPTION only if the callers are somebody other than the people building the
// thing. Counting our own dogfooding as adoption is the same wrong-noun error that has cost this
// project more than any code defect: sound arithmetic attached to a noun nobody checked.

import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = process.argv[2];
if (!ROOT) {
  console.error('usage: node scripts/measure-skill-invocation.mjs <transcripts-root>');
  process.exit(2);
}

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..');
// The repo directory name is what `~/.claude/projects` encodes into its per-project folder names
// (`C--Docker-aify-project-graph`). Derived, not spelled, so a rename cannot silently reclassify
// every one of our own sessions as somebody else's adoption.
const SELF_MARKER = REPO.replace(/[\\/]+$/, '').split(/[\\/]/).pop();

/**
 * The skills this project ships, derived from disk by reading each SKILL.md's `name:` — which is
 * the key an invocation actually carries, and is NOT always the directory name (`skill/` ships as
 * `aify-project-graph`).
 *
 * ⛔ THIS WAS A HARDCODED LIST OF 17 NAMES. That is the same defect shape as the two hardcoded
 * compile-DB directory lists removed from this repo on the same day: a list you must remember to
 * update is a defect with a delay on it. A skill added tomorrow would have been counted as
 * SOMEBODY ELSE'S, so its adoption would read as competitors' success and its non-adoption would
 * be invisible.
 */
async function discoverShippedSkills(root) {
  const bases = [join(root, 'integrations', 'claude-code', 'skill'), join(root, 'integrations', 'claude-code', 'skills')];
  const found = new Map(); // name -> relative path it came from
  for (const base of bases) {
    let entries;
    try { entries = await readdir(base, { withFileTypes: true }); } catch { continue; }
    const dirs = entries.some((e) => e.name === 'SKILL.md') ? [base] : entries.filter((e) => e.isDirectory()).map((e) => join(base, e.name));
    for (const dir of dirs) {
      let text;
      try { text = await readFile(join(dir, 'SKILL.md'), 'utf8'); } catch { continue; }
      const m = /^name:[ \t]*(\S+)[ \t]*$/m.exec(text.slice(0, 2000));
      if (m) found.set(m[1], dir);
    }
  }
  return found;
}

const SHIPPED = await discoverShippedSkills(REPO);
// Fails closed. An empty discovery would classify every one of our skills as "other", turning a
// broken enumeration into the cheerful finding that nobody uses our skills because we ship none.
if (SHIPPED.size === 0) {
  console.error('FATAL: discovered 0 shipped skills under integrations/claude-code — refusing to report.');
  process.exit(3);
}
const OURS = new Set(SHIPPED.keys());
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
// Attribution. `self` = a session whose project directory is this repo; `elsewhere` = any other
// project on this machine. Only `elsewhere` is adoption.
const byOrigin = { self: { calls: 0, sessions: 0, skills: new Map() }, elsewhere: { calls: 0, sessions: 0, skills: new Map() } };

for (const dir of (await readdir(ROOT, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const origin = dir.includes(SELF_MARKER) ? 'self' : 'elsewhere';
  const { sessions: s, nested: n } = await collect(join(ROOT, dir));
  for (const [files, isNested] of [[s, false], [n, true]]) {
    for (const f of files) {
      if ((await stat(f)).size === 0) continue;
      if (isNested) nestedCount += 1; else sessions += 1;
      const r = await scan(f);
      merge(oursTotal, r.ours); merge(othersTotal, r.others);
      anySkillCall += r.anySkillCall; negative += r.negative; badLines += r.badLines;
      if (r.ours.size > 0) {
        if (isNested) nestedWithOurSkill += 1; else sessionsWithOurSkill += 1;
        byOrigin[origin].sessions += 1;
        merge(byOrigin[origin].skills, r.ours);
        for (const v of r.ours.values()) byOrigin[origin].calls += v;
      }
    }
  }
}

const ourCalls = [...oursTotal.values()].reduce((a, b) => a + b, 0);
const otherCalls = [...othersTotal.values()].reduce((a, b) => a + b, 0);

// POSITIVE CONTROL: some skill, ours or not, must have been invoked somewhere. A total of zero
// means the parser never saw a Skill block — which is indistinguishable from "nobody uses skills"
// and is the wrong-zero-that-agrees-with-your-prior failure this repo keeps hitting.
//
// ⭐ SECOND POSITIVE CONTROL, for the attribution specifically: the enumeration must have visited
// at least one project of EACH origin. An `elsewhere` count of zero drawn from a run that only
// ever saw our own project directory would be a fact about the walk, not about adoption.
let selfDirs = 0;
let elsewhereDirs = 0;
for (const d of (await readdir(ROOT, { withFileTypes: true })).filter((x) => x.isDirectory())) {
  if (d.name.includes(SELF_MARKER)) selfDirs += 1; else elsewhereDirs += 1;
}
const controlsPassed = anySkillCall > 0 && negative === 0 && selfDirs > 0 && elsewhereDirs > 0;

console.log(JSON.stringify({
  what: 'Skill INVOCATIONS (Skill tool_use blocks), ours vs everyone else, attributed by project.',
  controls: {
    anySkillInvocation: anySkillCall,
    negativeControl: negative,
    projectDirsSelf: selfDirs,
    projectDirsElsewhere: elsewhereDirs,
    passed: controlsPassed,
    note: controlsPassed ? null : 'CONTROLS FAILED — read nothing below as a finding.',
    unparseableLines: badLines,
  },
  population: { sessions, nestedTranscripts: nestedCount },
  ourSkills: {
    shipped: OURS.size,
    shippedDiscoveredFrom: 'integrations/claude-code/**/SKILL.md frontmatter `name:`',
    distinctInvoked: oursTotal.size,
    totalCalls: ourCalls,
    sessionsWithAny: sessionsWithOurSkill,
    nestedWithAny: nestedWithOurSkill,
    perSkill: Object.fromEntries([...oursTotal.entries()].sort((a, b) => b[1] - a[1])),
    neverInvoked: [...OURS].filter((s) => !oursTotal.has(s)).sort(),
  },
  // ⭐ THE NUMBER THAT DECIDES WHETHER ANY OF THE ABOVE IS ADOPTION.
  attribution: {
    self: { calls: byOrigin.self.calls, transcripts: byOrigin.self.sessions, perSkill: Object.fromEntries(byOrigin.self.skills) },
    elsewhere: { calls: byOrigin.elsewhere.calls, transcripts: byOrigin.elsewhere.sessions, perSkill: Object.fromEntries(byOrigin.elsewhere.skills) },
    note: 'Only `elsewhere` is adoption. `self` is this project using its own skills.',
  },
  otherSkills: { distinct: othersTotal.size, totalCalls: otherCalls },
}, null, 2));
