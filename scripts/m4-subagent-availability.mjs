// M4's remaining action is "improve routing" — but ONLY if routing is the right noun.
//
// Measured: 9 of 1,088 subagent transcripts (0.8%) contain a graph verb call. Two explanations
// predict that equally well and demand opposite fixes:
//   (A) AVAILABILITY — the graph tools were never offered to those subagents. Then salience work is
//       fixing the wrong thing, and the fix is making the server reachable.
//   (B) ROUTING — the tools were offered and not chosen. Then salience/routing is the right lever.
//
// DISCRIMINATOR: did the subagent call ANY `mcp__` tool? A transcript that calls other MCP tools
// proves the MCP surface was present and the graph was passed over (B). A transcript that calls no
// MCP tool at all cannot distinguish "absent" from "present and unused", and is reported as its own
// bucket rather than folded into either.
//
// CLAIM CEILING: this counts TOOL CALLS in transcripts. It does not read tool DEFINITIONS, so it
// cannot prove a tool was offered — only that one was USED. "No MCP call" is therefore UNKNOWN
// availability, never proof of absence.
//
// CONTROLS, same pass:
//   POSITIVE — Bash/Read/Grep must be non-zero across subagent transcripts, or the parser is blind.
//   NEGATIVE — a fabricated tool name must be exactly zero, or the matcher is over-broad.
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const ROOT = 'C:/Users/Administrator/.claude/projects';
const GRAPH_PREFIX = 'mcp__aify-project-graph__';
const FAKE = 'mcp__aify-project-graph__graph_nonexistent_control_zzz';
const BASELINE = ['Bash', 'Read', 'Grep'];

async function* jsonl(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) { yield* jsonl(p); continue; }
    if (entry.name.endsWith('.jsonl')) yield p;
  }
}

const stats = {
  subagentTranscripts: 0,
  withGraphCall: 0,
  withOtherMcpCall: 0,
  withAnyMcpCall: 0,
  withNoMcpCall: 0,
  baselineCalls: 0,
  fakeCalls: 0,
  otherMcpServers: new Map(),
};

for await (const file of jsonl(ROOT)) {
  let isSidechain = false;
  let graph = false; let otherMcp = false; let sawAny = false;
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    if (rec.isSidechain === true) isSidechain = true;
    const blocks = rec?.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const b of blocks) {
      if (b?.type !== 'tool_use' || typeof b.name !== 'string') continue;
      sawAny = true;
      if (BASELINE.includes(b.name)) stats.baselineCalls += 1;
      if (b.name === FAKE) stats.fakeCalls += 1;
      if (b.name.startsWith(GRAPH_PREFIX)) graph = true;
      else if (b.name.startsWith('mcp__')) {
        otherMcp = true;
        const server = b.name.split('__')[1] ?? '?';
        stats.otherMcpServers.set(server, (stats.otherMcpServers.get(server) ?? 0) + 1);
      }
    }
  }
  if (!isSidechain) continue;
  stats.subagentTranscripts += 1;
  if (graph) stats.withGraphCall += 1;
  if (otherMcp) stats.withOtherMcpCall += 1;
  if (graph || otherMcp) stats.withAnyMcpCall += 1; else stats.withNoMcpCall += 1;
  void sawAny;
}

console.log(`subagent transcripts            : ${stats.subagentTranscripts}`);
console.log(`  with a GRAPH call             : ${stats.withGraphCall}`);
console.log(`  with ANOTHER mcp__ call       : ${stats.withOtherMcpCall}   <- MCP surface WAS present`);
console.log(`  with any mcp__ call           : ${stats.withAnyMcpCall}`);
console.log(`  with NO mcp__ call at all     : ${stats.withNoMcpCall}   <- availability UNKNOWN, not proven absent`);
console.log(`\nPOSITIVE CONTROL Bash/Read/Grep : ${stats.baselineCalls} ${stats.baselineCalls > 0 ? '(parser sees tool calls)' : '⛔ BLIND'}`);
console.log(`NEGATIVE CONTROL fabricated name: ${stats.fakeCalls} ${stats.fakeCalls === 0 ? '(matcher not over-broad)' : '⛔ OVER-BROAD'}`);
const top = [...stats.otherMcpServers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
console.log(`\nother MCP servers used by subagents: ${JSON.stringify(Object.fromEntries(top))}`);
