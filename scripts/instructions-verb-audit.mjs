#!/usr/bin/env node
// M0a — DOES THE ALWAYS-PAID TEXT ADVERTISE VERBS THAT EXIST?
//
// The `instructions` payload is 13,880 bytes and is emitted on EVERY session under EVERY profile
// — it does not shrink with the toolset. It names verbs by hand. A name in there that the
// registry does not hold is bytes spent every session pointing an agent at nothing, and the agent
// pays again when it searches for the name and finds none.
//
// ⚠ IDENTITY RULE. A "mention" is a `graph_*` or `code_intel_*` token in the instructions text.
// Case-sensitive, whole token. Prose about "the graph" is not a mention. Names inside a sentence
// that explicitly says a verb MAY NOT BE CALLABLE are still mentions — the byte cost is paid
// either way, and the audit reports the caveat separately rather than excusing the name.
//
// ⚠ CLAIM CEILING. "This token appears in the instructions and no tool of that name is registered
// at the carrier." Never "the instructions are wrong about X" without reading the sentence.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = (...p) => pathToFileURL(path.join(REPO, ...p)).href;

const VERB_TOKEN = /\b(?:graph|code_intel)_[a-z_]+\b/g;

// Tokens that look like verbs but are not tool names. Listed explicitly so a reader can check the
// exclusion rather than wonder why a name vanished.
const NOT_VERBS = new Set(['graph_health_check', 'code_intel_collect']);

const { TOOLS } = await import(url('mcp', 'stdio', 'tools', 'schema.js'));
const { SERVER_INSTRUCTIONS } = await import(url('mcp', 'stdio', 'server-instructions.js'));

const registered = new Set(TOOLS.map((t) => t.name));
const mentioned = new Set(
  [...String(SERVER_INSTRUCTIONS).matchAll(VERB_TOKEN)].map((m) => m[0]).filter((n) => !NOT_VERBS.has(n)),
);

const advertisedButAbsent = [...mentioned].filter((n) => !registered.has(n)).sort();
const registeredNeverMentioned = [...registered].filter((n) => !mentioned.has(n)).sort();

// CONTROLS, same pass.
// POSITIVE: a verb every reader knows is both registered and named in the instructions.
const positive = registered.has('graph_health') && mentioned.has('graph_health');
// NEGATIVE: a fabricated token must NOT be reported as mentioned, or the matcher matches anything.
const negative = !mentioned.has('graph_not_a_real_verb_control');

process.stdout.write(`instructionsBytes=${Buffer.byteLength(SERVER_INSTRUCTIONS, 'utf8')}\n`);
process.stdout.write(`registered=${registered.size} mentionedTokens=${mentioned.size}\n`);
process.stdout.write(`POSITIVE CONTROL (graph_health registered AND mentioned): ${positive ? 'PASS' : 'FAIL'}\n`);
process.stdout.write(`NEGATIVE CONTROL (fabricated token not mentioned): ${negative ? 'PASS' : 'FAIL'}\n`);
process.stdout.write(`\nADVERTISED BUT NOT REGISTERED (${advertisedButAbsent.length}):\n`);
for (const n of advertisedButAbsent) {
  const line = String(SERVER_INSTRUCTIONS).split('\n').find((l) => l.includes(n)) ?? '';
  process.stdout.write(`  ${n}\n      ctx: ${line.trim().slice(0, 140)}\n`);
}
process.stdout.write(`\nREGISTERED BUT NEVER MENTIONED (${registeredNeverMentioned.length}):\n  ${registeredNeverMentioned.join(', ')}\n`);
