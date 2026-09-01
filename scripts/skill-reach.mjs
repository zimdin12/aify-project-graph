// The PURPOSE statement names two halves: the graph, AND "the skills that teach an agent when to
// reach for which". Every measurement so far covers verbs. If the teaching half is never invoked,
// it is the unreachable-quality class — shipped, correct, and never read.
//
// POPULATION: every transcript under the projects root. Top-level and sidechain counted SEPARATELY,
// because a nested run is not a session anyone chose to start.
// IDENTITY RULE: a tool_use block with name === 'Skill'. The skill's own name is taken from the
//   input (`skill` or `command`), never inferred from surrounding text — a skill NAME appearing in
//   prose is not an invocation, the same trap that made a bare "graph_" grep return 5170 hits.
// CLAIM CEILING: counts INVOCATIONS. It cannot show a skill was AVAILABLE (never-invoked is
//   ambiguous between absent, unavailable and unchosen), and it says nothing about usefulness.
// CONTROLS, same pass:
//   POSITIVE — Bash/Read/Edit must be non-zero, or the parser is blind to tool calls entirely.
//   NEGATIVE — a fabricated skill name must be exactly zero, or the extractor is over-broad.
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const ROOT = 'C:/Users/Administrator/.claude/projects';
const FAKE = 'definitely-not-a-real-skill-zzz';
const BASELINE = ['Bash', 'Read', 'Edit'];
// The skills whose JOB is teaching graph reach, per the MCP server instructions.
const GRAPH_SKILLS = ['aify-project-graph', 'graph-guide', 'cpp-inner-loop'];

async function* jsonl(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { yield* jsonl(p); continue; }
    if (e.name.endsWith('.jsonl')) yield p;
  }
}

const skillCalls = new Map();
let baseline = 0; let fake = 0;
let topTranscripts = 0; let topWithSkill = 0;
let subTranscripts = 0; let subWithSkill = 0;
let topWithGraphSkill = 0;

for await (const f of jsonl(ROOT)) {
  let sidechain = false; let sawSkill = false; let sawGraphSkill = false;
  const rl = createInterface({ input: createReadStream(f, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.isSidechain === true) sidechain = true;
    const blocks = r?.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const b of blocks) {
      if (b?.type !== 'tool_use' || typeof b.name !== 'string') continue;
      if (BASELINE.includes(b.name)) baseline += 1;
      if (b.name !== 'Skill') continue;
      const raw = b.input?.skill ?? b.input?.command ?? '(unnamed)';
      const name = String(raw).replace(/^\//, '').split(/\s+/)[0];
      if (name === FAKE) fake += 1;
      skillCalls.set(name, (skillCalls.get(name) ?? 0) + 1);
      sawSkill = true;
      if (GRAPH_SKILLS.some((g) => name.includes(g))) sawGraphSkill = true;
    }
  }
  if (sidechain) { subTranscripts += 1; if (sawSkill) subWithSkill += 1; }
  else { topTranscripts += 1; if (sawSkill) topWithSkill += 1; if (sawGraphSkill) topWithGraphSkill += 1; }
}

const total = [...skillCalls.values()].reduce((a, b) => a + b, 0);
console.log(`total Skill invocations           : ${total}   distinct skills: ${skillCalls.size}`);
console.log(`top-level transcripts             : ${topTranscripts}  with a Skill call: ${topWithSkill}`);
console.log(`subagent transcripts              : ${subTranscripts}  with a Skill call: ${subWithSkill}`);
console.log(`top-level with a GRAPH-teaching skill: ${topWithGraphSkill}   (${GRAPH_SKILLS.join(', ')})`);
console.log(`\nPOSITIVE CONTROL Bash/Read/Edit   : ${baseline} ${baseline > 0 ? '(parser sees tool calls)' : 'BLIND'}`);
console.log(`NEGATIVE CONTROL fabricated skill : ${fake} ${fake === 0 ? '(extractor not over-broad)' : 'OVER-BROAD'}`);
console.log('\ntop skills invoked:');
for (const [n, c] of [...skillCalls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`  ${String(c).padStart(4)}  ${n}`);
}
