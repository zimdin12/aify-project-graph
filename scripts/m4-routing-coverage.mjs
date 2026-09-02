// WHICH LISTED VERBS ARE NAMED IN THE ROUTING TEXT — and which route themselves instead?
//
//   node scripts/m4-routing-coverage.mjs
//
// ⛔ THIS REPORTS, IT DOES NOT JUDGE. There is no crisp identity rule for "this description routes
// an agent", so this deliberately stops at facts a reader can check: is the name in the instructions,
// how long is the description, and what are its first words. Turning that into a pass/fail detector
// would need a rule I cannot state without false positives, and a detector without a preregistered
// identity rule is exactly what this project forbids.
//
// ⚠ IT EXISTS BECAUSE THE OBVIOUS READING OF ITS OWN HEADLINE NUMBER IS WRONG. "4 verbs never named
// in the routing text" invites "4 verbs an agent gets no guidance on" — a slide from a textual claim
// to a semantic one. Three of those four route themselves in their own tools/list description. The
// DESCRIPTION column below exists so that mistake is hard to repeat.
//
// Both sides come from the LIVE protocol, not a module read: the artifact the operation uses is the
// artifact that must be measured.
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function rpc(messages) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['mcp/stdio/server.js'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', reject);
    for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);
    child.stdin.end();
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`server exit ${code}: ${err.slice(0, 400)}`));
      resolve(out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
    });
  });
}

const lines = await rpc([
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
]);
const byId = new Map(lines.map((l) => [l.id, l]));
const instructions = byId.get(1)?.result?.instructions ?? '';
const tools = byId.get(2)?.result?.tools ?? [];

// Word-boundary aware so a prefix cannot match a longer name.
const names = (name) => new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(instructions);
const bytesOf = (t) => Buffer.byteLength(JSON.stringify(t), 'utf8');

const rows = tools.map((t) => ({
  verb: t.name,
  inInstructions: names(t.name),
  descChars: (t.description ?? '').length,
  schemaBytes: bytesOf(t),
  opens: (t.description ?? '').slice(0, 58).replace(/\s+/g, ' '),
})).sort((a, b) => Number(a.inInstructions) - Number(b.inInstructions) || a.verb.localeCompare(b.verb));

const total = rows.reduce((s, r) => s + r.schemaBytes, 0);
const unnamed = rows.filter((r) => !r.inInstructions);
const unnamedBytes = unnamed.reduce((s, r) => s + r.schemaBytes, 0);

console.log(`ROUTING COVERAGE — default profile, live protocol`);
console.log(`instructions ${Buffer.byteLength(instructions, 'utf8')} bytes · tools/list ${tools.length} verbs, ${total} bytes\n`);
console.log('named  verb                     desc  schema  description opens with');
for (const r of rows) {
  console.log(`${r.inInstructions ? '  yes' : '  NO '}  ${r.verb.padEnd(24)} ${String(r.descChars).padStart(4)}  ${String(r.schemaBytes).padStart(6)}  ${r.opens}`);
}
console.log(`\nnot named in instructions: ${unnamed.length} verb(s), ${unnamedBytes} bytes (${(100 * unnamedBytes / total).toFixed(1)}% of the listing)`);
console.log('⚠ NOT NAMED ≠ UNROUTED. Read the description column before drawing any conclusion.');

// ── CONTROLS, same pass ──────────────────────────────────────────────────────────────────────
console.log('\nCONTROLS');
console.log(`  instructions non-empty ................ ${instructions.length > 0}`);
console.log(`  listing non-empty ..................... ${tools.length > 0} (${tools.length})`);
console.log(`  POSITIVE: matcher finds graph_health ... ${names('graph_health')}`);
console.log(`  NEGATIVE: matcher rejects a fake name .. ${!names('graph_not_a_real_verb')}`);
console.log(`  BOUNDARY: a prefix cannot match ........ ${!/(?<![A-Za-z0-9_])graph_call(?![A-Za-z0-9_])/.test('graph_callers')}`);
console.log(`  the split is real, not all-or-nothing .. ${unnamed.length > 0 && unnamed.length < rows.length}`);
