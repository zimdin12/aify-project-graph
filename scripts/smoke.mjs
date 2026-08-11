#!/usr/bin/env node
// ★ BOOT THE SERVER AND TALK TO IT. Two seconds. Run before every commit.
//
// Written 2026-08-11 after a bad day. Two self-inflicted breaks in one session, both
// invisible to a 1,696-test suite and both fatal in under a second of real use:
//
//   · `noteProbeArmed` called without being imported → ReferenceError on EVERY
//     tools/list, taking the server down for any client that connects. Seven test
//     files failed, but only after a five-minute suite run, and only because they
//     happened to spawn a server. Nothing in the unit layer could see it.
//   · a `sed -i` rewrite injected a NUL byte into a source file, caught by an
//     existing guard I had forgotten existed.
//
// The suite is not the problem — it caught both eventually. The problem is that a
// five-minute feedback loop gets skipped when you are mid-thought, and a two-second
// one does not. This is the cheapest possible answer to "does the thing still start".
//
// ⚠ IT IS NOT A TEST OF CORRECTNESS. It answers exactly three questions: does the
// process boot, does it answer the two calls every client makes on connect, and does
// it survive a real tool invocation. Anything subtler belongs in the suite.
import { spawn } from 'node:child_process';

const MESSAGES = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'graph_health', arguments: {} } },
];

const child = spawn('node', ['mcp/stdio/server.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.on('data', (c) => { stdout += c.toString(); });
child.stderr.on('data', (c) => { stderr += c.toString(); });
for (const m of MESSAGES) child.stdin.write(`${JSON.stringify(m)}\n`);
child.stdin.end();

child.on('close', (code) => {
  const fail = (msg) => {
    process.stderr.write(`\n✗ SMOKE FAILED — ${msg}\n`);
    if (stderr.trim()) process.stderr.write(`\n--- server stderr ---\n${stderr.trim()}\n`);
    process.exit(1);
  };

  // A non-zero exit is the missing-import class: the process died rather than
  // answering. This is the check that would have caught 2026-08-11's server-down bug.
  if (code !== 0) fail(`server exited with code ${code}`);

  let lines;
  try {
    lines = stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (err) {
    return fail(`server emitted unparseable stdout: ${err.message}`);
  }

  for (const id of [1, 2, 3]) {
    const res = lines.find((l) => l.id === id);
    if (!res) fail(`no response to request id=${id} (${MESSAGES[id - 1].method})`);
    if (res.error) fail(`request id=${id} (${MESSAGES[id - 1].method}) returned an error: ${res.error.message}`);
  }

  const tools = lines.find((l) => l.id === 2)?.result?.tools ?? [];
  if (tools.length === 0) fail('tools/list returned an empty tool set');

  // An unhandled rejection can be written to stderr while the process still exits 0,
  // so exit code alone is not sufficient — that is exactly how the missing import
  // presented before it took the process down.
  if (/unhandledRejection|uncaughtException|ReferenceError|TypeError:/.test(stderr)) {
    fail('server logged an unhandled error on stderr (see below) even though it exited cleanly');
  }

  process.stdout.write(`✓ smoke ok — booted, listed ${tools.length} tools, answered graph_health\n`);
});
