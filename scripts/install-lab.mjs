#!/usr/bin/env node
// M7.5 cross-runtime install lab.
//
// Scripted host validation: native-module preflight, MCP server stdio
// handshake under each toolset, doctor subcommand, serve-lsp resolution,
// and A/B demo smoke. Catches the kinds of host drift senior-dev flagged
// after reproducing the better-sqlite3 native-module flip during Plan #6
// validation.
//
// Usage: node scripts/install-lab.mjs [--json]
//
// Exit codes: 0 all checks pass; 1 one or more failures; 2 fatal harness error.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SERVER = path.resolve('mcp/stdio/server.js');
const BIN = path.resolve('bin/apg.js');

function stdioHandshake(args = []) {
  const child = spawnSync(process.execPath, [SERVER, ...args], {
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n',
    encoding: 'utf8',
    timeout: 15000
  });
  if (child.status !== 0 && child.status !== null) {
    return { ok: false, error: `server exited ${child.status}`, stderr: (child.stderr || '').slice(0, 400) };
  }
  const lines = (child.stdout || '').split(/\r?\n/u).filter(Boolean);
  const last = lines[lines.length - 1] || '{}';
  try {
    const parsed = JSON.parse(last);
    return { ok: true, tools: parsed?.result?.tools || [] };
  } catch (err) {
    return { ok: false, error: `JSON parse failed: ${err.message}`, raw: last.slice(0, 200) };
  }
}

function checkNativeModule() {
  // The MCP server preflight self-heals better-sqlite3; we trigger a load
  // via a no-op require to confirm.
  const result = spawnSync(process.execPath, ['-e', "import('better-sqlite3').then(m => { const d = new m.default(':memory:'); d.close(); process.exit(0); }).catch(e => { console.error(e.message); process.exit(1); });"], { encoding: 'utf8', timeout: 10000 });
  if (result.status === 0) return { ok: true, note: 'better-sqlite3 loads cleanly' };
  return { ok: false, error: result.stderr.trim() || `exit ${result.status}`, hint: 'run `npm rebuild better-sqlite3` (preflight should self-heal in server)' };
}

function checkBinPresence() {
  const items = [
    { name: 'bin/apg.js', path: BIN },
    { name: 'bin/aify-code-intel.js', path: path.resolve('bin/aify-code-intel.js') }
  ];
  const missing = items.filter(i => !existsSync(i.path));
  if (missing.length === 0) return { ok: true, note: 'all bin entries present' };
  return { ok: false, error: `missing: ${missing.map(m => m.name).join(', ')}` };
}

function checkPackageBinEntries() {
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const ok = pkg.bin && pkg.bin.apg && pkg.bin['aify-code-intel'];
    return ok
      ? { ok: true, note: `apg → ${pkg.bin.apg}, aify-code-intel → ${pkg.bin['aify-code-intel']}` }
      : { ok: false, error: 'package.json missing bin entries for apg and/or aify-code-intel' };
  } catch (err) { return { ok: false, error: err.message }; }
}

function runDoctor(language) {
  const result = spawnSync(process.execPath, [BIN, 'code-intel', 'doctor', language], { encoding: 'utf8', timeout: 10000 });
  return {
    ok: result.status === 0,
    output: (result.stdout || '').trim(),
    exit: result.status
  };
}

function runServeLspUnsupported() {
  // Expected exit 2 for unsupported language.
  const result = spawnSync(process.execPath, [BIN, 'code-intel', 'serve-lsp', 'noplang'], { encoding: 'utf8', timeout: 10000 });
  return {
    ok: result.status === 2,
    exit: result.status,
    stderr: (result.stderr || '').trim().slice(0, 200)
  };
}

function checkToolsetExposure() {
  const profiles = ['lean', 'code-intel', 'full'];
  const out = {};
  for (const p of profiles) {
    const args = p === 'full' ? [] : [`--toolset=${p}`];
    const r = stdioHandshake(args);
    if (!r.ok) { out[p] = { ok: false, error: r.error }; continue; }
    const names = r.tools.map(t => t.name);
    out[p] = { ok: true, count: names.length };

    if (p === 'lean') {
      out[p].expected_present = ['graph_packet', 'graph_consequences', 'graph_pull', 'graph_change_plan', 'graph_health'].every(n => names.includes(n));
    }
    if (p === 'code-intel') {
      out[p].expected_present = ['code_intel_diagnostics', 'code_intel_references', 'code_intel_definitions', 'code_intel_hover', 'code_intel_symbols', 'graph_packet'].every(n => names.includes(n));
      out[p].expected_absent = !names.includes('graph_search') && !names.includes('graph_report');
    }
    if (p === 'full') {
      out[p].expected_present = names.includes('graph_packet') && names.includes('code_intel_diagnostics');
    }
  }
  const allPass = Object.values(out).every(v => v.ok && v.expected_present !== false && v.expected_absent !== false);
  return { ok: allPass, profiles: out };
}

function checkABDemo() {
  // Re-run the bounded-vs-collect demo to confirm scripts still execute.
  const result = spawnSync(process.execPath, [path.resolve('scripts/demo-bounded-vs-collect-ab.mjs'), '--json'], { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) return { ok: false, error: `demo exit ${result.status}`, stderr: (result.stderr || '').slice(0, 200) };
  try {
    const parsed = JSON.parse(result.stdout);
    return { ok: !!parsed.allPass, allPass: !!parsed.allPass, deltaMs: parsed.delta?.ms_saved, deltaBytes: parsed.delta?.bytes_saved };
  } catch (err) { return { ok: false, error: `demo JSON parse: ${err.message}` }; }
}

function checkVerifyDemo() {
  const result = spawnSync(process.execPath, [path.resolve('scripts/demo-verify-ab.mjs'), '--json'], { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) return { ok: false, error: `demo exit ${result.status}`, stderr: (result.stderr || '').slice(0, 200) };
  try {
    const parsed = JSON.parse(result.stdout);
    return { ok: !!parsed.allPass, allPass: !!parsed.allPass };
  } catch (err) { return { ok: false, error: `demo JSON parse: ${err.message}` }; }
}

const checks = {
  'native-module-preflight': checkNativeModule,
  'bin-entries-on-disk': checkBinPresence,
  'package-json-bin-mapping': checkPackageBinEntries,
  'toolset-exposure (lean / code-intel / full)': checkToolsetExposure,
  'apg code-intel doctor cpp': () => runDoctor('cpp'),
  'apg code-intel serve-lsp <unsupported>': runServeLspUnsupported,
  'demo-bounded-vs-collect-ab.mjs': checkABDemo,
  'demo-verify-ab.mjs': checkVerifyDemo
};

const jsonMode = process.argv.includes('--json');
const report = { checks: {}, allPass: true };

for (const [name, fn] of Object.entries(checks)) {
  try {
    const r = fn();
    report.checks[name] = r;
    if (!r.ok) report.allPass = false;
  } catch (err) {
    report.checks[name] = { ok: false, error: err.message };
    report.allPass = false;
  }
}

if (jsonMode) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
  process.stdout.write('\n=== M7.5 Install Lab ===\n\n');
  for (const [name, r] of Object.entries(report.checks)) {
    const status = r.ok ? 'PASS' : 'FAIL';
    process.stdout.write(`[${status}] ${name}\n`);
    if (!r.ok) process.stdout.write(`  detail: ${r.error || JSON.stringify(r).slice(0, 200)}\n`);
    else if (r.note) process.stdout.write(`  ${r.note}\n`);
  }
  process.stdout.write(`\nResult: ${report.allPass ? 'ALL PASS' : 'FAILURES PRESENT'}\n`);
}

process.exit(report.allPass ? 0 : 1);
