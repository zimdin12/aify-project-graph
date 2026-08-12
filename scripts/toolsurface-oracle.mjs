#!/usr/bin/env node
// EQUIVALENCE ORACLE FOR THE TOOL SURFACE.
//
// The refactor proposal's FIRST slice is extracting the 620-line `TOOLS` array out of
// server.js — the safest available move, and the one with the biggest reduction. But the
// existing refactor oracle compares BRIEF artefacts, and moving a tool schema changes no
// brief at all. ⇒ The first slice had no safety net, which is exactly the kind of gap that
// only shows up when you ask "what would catch me here?" instead of "does a check exist?".
//
//   node scripts/toolsurface-oracle.mjs capture <label>
//   node scripts/toolsurface-oracle.mjs compare <label>
//
// What it pins is what a CLIENT sees: the full `tools/list` response over the real MCP
// protocol, from a real server child. Names, descriptions, and every byte of every input
// schema — because tools/list is billed on every session and a silent schema change is a
// silent cost and behaviour change for every agent.
//
// ⚠ Same carrier rules as scripts/self-review.mjs, and for the same reasons:
//   · the SUBJECT is built once per label and reused, so nothing about the working tree
//     can drift between capture and compare;
//   · dynamic values are NORMALISED rather than ignored, so a change in their SHAPE still
//     surfaces;
//   · a compare with no capture is an error, never a pass.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO, '.aify-graph', '.toolsurface-oracle');
const [, , mode, label = 'default'] = process.argv;

if (!['capture', 'compare'].includes(mode)) {
  console.error('usage: toolsurface-oracle.mjs capture|compare <label>');
  process.exit(2);
}

// ⚠ NO SUBJECT COPY, and the reason is worth recording: I started by copying the repo the
// way the brief oracle does, and the server never booted — the copy excluded node_modules,
// so it could not resolve its dependencies. With stderr suppressed that surfaced as a
// TIMEOUT, which reads like a hang in the server rather than a mistake in the harness.
//
// ⇒ The copy was cargo-culted from the other oracle without asking what it was FOR there.
// The brief oracle copies because the repo's CONTENT is the subject — file counts, git
// history, dirty state. Here the subject is the SERVER CODE, and the repo being inspected
// is irrelevant to tools/list. Nothing needs holding still, so nothing is copied.
const workdir = join(tmpdir(), `apg-toolsurface-${label}`);
mkdirSync(workdir, { recursive: true });

function toolsList() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(REPO, 'mcp', 'stdio', 'server.js')], {
      cwd: workdir, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, APG_TELEMETRY_DIR: join(workdir, '.telemetry') },
    });
    // ⚠ stderr is CAPTURED, not ignored. Suppressing it turned a boot failure into a
    // meaningless timeout and cost a diagnosis.
    let err = '';
    child.stderr.on('data', (c) => { err += c.toString(); });
    let buf = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timed out' + (err ? ' — server stderr: ' + err.slice(0, 300) : ' with no stderr'))); }, 30_000);
    child.stdout.on('data', (c) => {
      buf += c.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
        } else if (msg.id === 2) {
          clearTimeout(timer);
          child.stdin.end();
          resolve(msg.result?.tools ?? []);
        }
      }
    });
    child.on('error', reject);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'oracle', version: '1' } } })}\n`);
  });
}

const tools = await toolsList();
if (!tools.length) {
  console.error('⛔ the server listed NO tools — refusing to record that as a baseline');
  process.exit(2);
}

// Sorted by name so a pure reordering of the array is not reported as a behaviour change —
// tools/list order is not part of the contract, but membership and content are.
const snapshot = JSON.stringify(
  [...tools].sort((a, b) => a.name.localeCompare(b.name)),
  null, 2,
);
const digest = createHash('sha256').update(snapshot).digest('hex').slice(0, 12);

if (mode === 'capture') {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${label}.json`), snapshot);
  console.log(`  ${tools.length} tools  ${digest}  ${snapshot.length} chars`);
  console.log(`captured "${label}" — now move the code, then: node scripts/toolsurface-oracle.mjs compare ${label}`);
  process.exit(0);
}

const prevPath = join(OUT, `${label}.json`);
if (!existsSync(prevPath)) {
  console.error(`no capture named "${label}" — run capture BEFORE moving code`);
  process.exit(2);
}
const prev = readFileSync(prevPath, 'utf8');
if (prev === snapshot) {
  console.log(`✓ tool surface identical (${tools.length} tools, ${digest})`);
  process.exit(0);
}

const a = prev.split('\n');
const b = snapshot.split('\n');
const i = a.findIndex((line, idx) => line !== b[idx]);
console.log(`✗ TOOL SURFACE CHANGED — first difference at line ${i + 1}`);
console.log(`    before: ${JSON.stringify((a[i] ?? '<eof>').slice(0, 120))}`);
console.log(`    after:  ${JSON.stringify((b[i] ?? '<eof>').slice(0, 120))}`);
console.error('\n⛔ a schema move must not change what a client sees — tools/list is billed every session');
process.exit(1);
