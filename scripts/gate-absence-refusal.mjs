// TAG GATE — DRIVE THE REAL OBJECT. Run before any release tag.
//
// Usage: node scripts/gate-absence-refusal.mjs   (exit 0 = PASS)
//
// The absenceAuthority change was proven on the pure function and in the suite. Neither of those is
// the server. This spawns the real MCP server over JSON-RPC, against this repository, and reads what
// an agent would actually be told.
//
// Transport reused from scripts/smoke.mjs rather than reinvented.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// The repository under test. Defaults to the checkout this script lives in.
const REPO = process.env.APG_GATE_REPO ?? new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = `${REPO}/docs/evidence/gate-receipts/v0.8.0-gate3-live-server.txt`;

const MESSAGES = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  // The capability an agent reads at session start, before deleting anything.
  { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_health', arguments: {} } },
  // POSITIVE CONTROL: a symbol that HAS callers. Without this, an absence below could just be a
  // broken query, and the whole receipt would prove nothing.
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'graph_callers', arguments: { symbol: 'graphCapabilities' } } },
  // The absence path itself. A symbol that RESOLVES, filtered to a directory holding none of
  // its callers -- so this is NO CALLERS, not NO MATCH.
  { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'graph_callers', arguments: { symbol: 'graphCapabilities', file: 'tests/self-review' } } },
];

const child = spawn('node', ['mcp/stdio/server.js'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.on('data', (c) => { stdout += c.toString(); });
child.stderr.on('data', (c) => { stderr += c.toString(); });
for (const m of MESSAGES) child.stdin.write(`${JSON.stringify(m)}\n`);
child.stdin.end();

const textOf = (line) => (line?.result?.content ?? []).map((c) => c.text ?? '').join('\n');

child.on('close', (code) => {
  const lines = stdout.trim().split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  const health = textOf(lines.find((l) => l.id === 2));
  const withCallers = textOf(lines.find((l) => l.id === 3));
  const absence = textOf(lines.find((l) => l.id === 4));

  const grants = /absenceAuthority["\s:]+true/i.test(health);
  const denialReason = (health.match(/"reason":\s*"([a-z_]+)"/) || [])[1] ?? null;
  const controlFired = withCallers.length > 0 && !/NO CALLERS/.test(withCallers);
  // ⛔ NO MATCH IS NOT NO CALLERS. The first means the symbol never resolved to a target; the
  // second means it resolved and has zero incoming edges. Only the second is the absence path
  // this gate is about, and the first version of this probe tested the wrong one.
  const resolved = !/NO MATCH/.test(absence);
  const absenceRefuses = resolved && /NOT exhaustive/i.test(absence);

  const report = [
    'v0.8.0 TAG GATE ITEM 3 — the REAL SERVER over JSON-RPC, not the module',
    `run at            : ${new Date().toISOString()}`,
    `server exit code  : ${code}`,
    '',
    `[RESULT]    graph_health grants absenceAuthority=true : ${grants}   (must be false)`,
    `[RESULT]    health denial reason                      : ${denialReason ?? 'none (GRANTED)'}`,
    `[CONTROL+]  graph_callers("graphCapabilities") returned callers : ${controlFired}`,
    `[CONTROL]   absence path RESOLVED the symbol (not NO MATCH) : ${resolved}`,
    `[RESULT]    graph_callers absence says NOT exhaustive : ${absenceRefuses}`,
    '',
    'The positive control is what makes the absence a measured result rather than a broken query:',
    'a verb that returned nothing for every symbol would produce the same "NOT exhaustive" line.',
    '',
    '--- graph_health (excerpt) ---',
    health.split('\n').filter((l) => /absence|authority|unattested|spine|coverage/i.test(l)).slice(0, 12).join('\n'),
    '',
    '--- graph_callers, absence path ---',
    absence.slice(0, 900),
  ].join('\n');

  writeFileSync(OUT, `${report}\n`, 'utf8');
  process.stdout.write(`${report}\n\nwritten: ${OUT}\n`);
  if (stderr.trim()) process.stdout.write(`\n--- server stderr ---\n${stderr.trim().slice(0, 600)}\n`);

  const pass = !grants && controlFired && absenceRefuses;
  process.stdout.write(pass ? '\nGATE 3: PASS\n' : '\nGATE 3: FAIL\n');
  process.exit(pass ? 0 : 1);
});
