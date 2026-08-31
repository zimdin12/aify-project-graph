#!/usr/bin/env node
// M0a — SURFACE RECEIPTS, TAKEN FROM THE CARRIER AN AGENT ACTUALLY MEETS.
//
// ⛔ WHY THIS EXISTS. I published "agents reached 3 of 43 verbs" and treated 43 as the billed
// affordance. Review's census showed 43 is the CALLABLE REGISTRY; the listed surface is already
// gated. Both numbers were arithmetically fine and one was attached to the wrong noun.
//
// A census computed by importing tools/schema.js is a MODULE read. What a host bills and what an
// agent can pick come from a live `tools/list` over stdio. Those are different instruments, and
// the first cannot vouch for the second. So this speaks the real protocol to a real spawned
// server and records what came back.
//
// ⚠ WHAT THIS DOES NOT MEASURE. Bytes here are the bytes OUR SERVER EMITS. Whether a host injects
// them verbatim, re-renders them, or defers them behind a search step is the host's business and
// is NOT observable from inside this process. Every byte figure below is therefore labelled
// `serverEmittedBytes` and never "tokens billed". The host-side receipt is a separate carrier and
// is recorded by hand in the FINDING, from what that host actually showed.
//
// ⚠ TOKENS ARE NOT MEASURED AT ALL. No tokenizer runs here. Dividing bytes by four would produce
// a precise-looking number attached to a noun nothing in this file observed.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(REPO, 'mcp', 'stdio', 'server.js');
const PROFILES = ['lean', 'default', 'code-intel', 'full'];

// A path the sensitive-path gate refuses. Used to reach the registry lookup WITHOUT running a
// handler — see ToolCallProbe. Chosen because probing callability by actually invoking a verb
// would run mutating verbs (graph_index rebuilds the graph).
const REFUSED_PATH = 'C:\\Windows\\System32';
const ABSENT_NAME = 'graph_this_verb_is_not_registered_m0a';

class ServerProbe {
  constructor(profile) {
    this.profile = profile;
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = '';
    this.stderr = '';
  }

  open() {
    this.child = spawn(process.execPath, [SERVER, `--toolset=${this.profile}`], {
      cwd: REPO,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, APG_MCP_TOOLS: '' },
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.#onData(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    return this;
  }

  #onData(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const waiter = this.pending.get(msg.id);
      if (waiter) { this.pending.delete(msg.id); waiter(msg); }
    }
  }

  request(method, params, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout on ${method} (profile=${this.profile})`));
      }, timeoutMs);
      this.pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  close() {
    if (this.child) this.child.stdin.end();
    this.child = null;
  }
}

/**
 * Three-way registry classification for one tool name, WITHOUT running its handler.
 *
 * The server checks the name against the full registry and answers -32601 for an unknown one.
 * Only after that does it apply the sensitive-path gate, which answers -32602. So a call whose
 * argument names a refused path separates the two states and stops before any handler.
 *
 * Returns 'registered' | 'absent' | 'inconclusive'.
 */
function classifyCallResponse(msg) {
  const code = msg?.error?.code;
  const text = String(msg?.error?.message ?? '');
  if (code === -32601 && /unknown tool/i.test(text)) return 'absent';
  if (code === -32602 && /sensitive path/i.test(text)) return 'registered';
  return 'inconclusive';
}

async function probeCallable(probe, name) {
  const msg = await probe.request('tools/call', { name, arguments: { repo: REFUSED_PATH } });
  return { name, state: classifyCallResponse(msg), code: msg?.error?.code ?? null, message: msg?.error?.message ?? null };
}

function headSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return 'unavailable';
  }
}

const bytes = (value) => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value ?? ''), 'utf8');

async function receiptFor(profile) {
  const probe = new ServerProbe(profile).open();
  try {
    const init = await probe.request('initialize', {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'm0a-receipts', version: '1' },
    });
    const list = await probe.request('tools/list', {});
    const tools = list?.result?.tools ?? [];
    const instructions = init?.result?.instructions ?? '';

    const perTool = tools.map((t) => ({
      name: t.name,
      descriptionBytes: bytes(t.description ?? ''),
      inputSchemaBytes: bytes(t.inputSchema ?? {}),
      totalBytes: bytes(t),
    })).sort((a, b) => b.totalBytes - a.totalBytes);

    // Controls, in the same pass as the measurement they vouch for.
    const controlAbsent = await probeCallable(probe, ABSENT_NAME);
    const listedNames = tools.map((t) => t.name);
    const controlListed = listedNames.length ? await probeCallable(probe, listedNames[0]) : null;

    return {
      profile,
      listedCount: tools.length,
      listedNames,
      serverEmittedBytes: {
        toolsListResult: bytes(list?.result ?? {}),
        instructions: bytes(instructions),
        toolsListPlusInstructions: bytes(list?.result ?? {}) + bytes(instructions),
      },
      schemaShareOfToolsList: tools.length
        ? Number((perTool.reduce((s, t) => s + t.inputSchemaBytes, 0) / bytes(list?.result ?? {})).toFixed(4))
        : null,
      perTool,
      controls: {
        // NEGATIVE CONTROL: the probe must be able to say ABSENT. If a fabricated name comes
        // back 'registered', every 'registered' verdict in this run is void.
        absentNameIsAbsent: controlAbsent.state === 'absent',
        absentNameRaw: controlAbsent,
        // POSITIVE CONTROL: a name we just saw in this very listing must come back registered.
        // Without it the classifier could be answering 'absent' for everything.
        listedNameIsRegistered: controlListed ? controlListed.state === 'registered' : null,
        listedNameRaw: controlListed,
      },
      stderr: probe.stderr.slice(0, 2000),
    };
  } finally {
    probe.close();
  }
}

/**
 * Registry denominator, taken from the carrier rather than the module: every name that the LIVE
 * server admits under tools/call while listing only a subset. The module registry is read too,
 * but only to enumerate candidate names — every membership verdict comes from the server.
 */
async function registryReceipt(candidateNames) {
  const probe = new ServerProbe('default').open();
  try {
    await probe.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'm0a', version: '1' } });
    const results = [];
    for (const name of candidateNames) results.push(await probeCallable(probe, name));
    const control = await probeCallable(probe, ABSENT_NAME);
    return {
      probedUnderProfile: 'default',
      registered: results.filter((r) => r.state === 'registered').map((r) => r.name),
      absent: results.filter((r) => r.state === 'absent').map((r) => r.name),
      inconclusive: results.filter((r) => r.state === 'inconclusive'),
      controlAbsentNameIsAbsent: control.state === 'absent',
      controlRaw: control,
    };
  } finally {
    probe.close();
  }
}

async function main() {
  const { TOOLS } = await import(path.join(REPO, 'mcp', 'stdio', 'tools', 'schema.js').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
  const moduleNames = TOOLS.map((t) => t.name);

  const receipts = [];
  for (const profile of PROFILES) receipts.push(await receiptFor(profile));
  const registry = await registryReceipt(moduleNames);

  // DIFFERENTIAL CONTROL. If every profile returned the same listing, the --toolset argument is
  // inert and each per-profile figure is really one figure reported four times.
  const signatures = new Set(receipts.map((r) => r.listedNames.slice().sort().join(',')));
  const listedUnion = new Set(receipts.flatMap((r) => r.listedNames));
  const unlistedEverywhere = registry.registered.filter((n) => !listedUnion.has(n));

  const out = {
    takenAt: new Date().toISOString(),
    repoHead: headSha(),
    node: process.version,
    platform: process.platform,
    profiles: receipts,
    registry: {
      moduleDeclaredCount: moduleNames.length,
      carrierRegisteredCount: registry.registered.length,
      carrierAbsent: registry.absent,
      inconclusive: registry.inconclusive,
      controlAbsentNameIsAbsent: registry.controlAbsentNameIsAbsent,
    },
    unlistedUnderEveryProfile: unlistedEverywhere,
    controls: {
      profilesDifferFromEachOther: signatures.size === PROFILES.length,
      distinctListings: signatures.size,
    },
  };

  const dir = path.join(REPO, 'docs', 'evidence', 'surface-receipts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'RECEIPTS.json'), `${JSON.stringify(out, null, 2)}\n`, 'utf8');

  for (const r of receipts) {
    const ok = r.controls.absentNameIsAbsent && r.controls.listedNameIsRegistered;
    process.stdout.write(`${r.profile.padEnd(11)} listed=${String(r.listedCount).padStart(2)} `
      + `toolsListBytes=${String(r.serverEmittedBytes.toolsListResult).padStart(6)} `
      + `instructionsBytes=${String(r.serverEmittedBytes.instructions).padStart(6)} `
      + `schemaShare=${r.schemaShareOfToolsList} controls=${ok ? 'PASS' : 'FAIL'}\n`);
  }
  process.stdout.write(`registry: module=${moduleNames.length} carrierRegistered=${registry.registered.length} `
    + `absent=${registry.absent.length} inconclusive=${registry.inconclusive.length} `
    + `negControl=${registry.controlAbsentNameIsAbsent ? 'PASS' : 'FAIL'}\n`);
  process.stdout.write(`unlisted under EVERY profile: ${unlistedEverywhere.length} -> ${unlistedEverywhere.join(', ')}\n`);
  process.stdout.write(`differential control (4 distinct listings): ${out.controls.profilesDifferFromEachOther ? 'PASS' : 'FAIL'} (${signatures.size})\n`);
}

main().catch((err) => { process.stderr.write(`${err.stack}\n`); process.exit(1); });
