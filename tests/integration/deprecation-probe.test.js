// ★ MAKING A BLOCKED DECISION DECIDABLE, FOR ELEVEN LOG LINES.
//
// Eleven verbs are hidden from tools/list because a comment calls them redundant. The
// comment has sat there for months. ef-manager's diagnosis (2026-08-10): a comment is a
// note to nobody — no owner, no date, no trigger, no consequence — so writing the eleven
// down WAS the entire action taken, and then eleven accumulated.
//
// Deleting them was blocked on a limit that was correctly stated: with no telemetry,
// "nobody calls X" is unclaimable. The probe dissolves that limit rather than arguing
// past it — never fires, delete it; fires, the comment was wrong.
//
// These tests drive the real server over stdio. A source-grep version would be the
// 69th case in graph-senior-dev's audit of tests that assert text and invoke nothing.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEPRECATION_REPLACEMENTS } from '../../mcp/stdio/deprecation-probe.js';

let repo;

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'apg-depprobe-'));
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'src', 'a.js'), 'export function alpha() { return 1; }\n');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
});

afterAll(async () => {
  if (repo) { try { await rm(repo, { recursive: true, force: true }); } catch { /* windows lock */ } }
});

function runRpc(messages, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['mcp/stdio/server.js', ...args], {
      cwd: process.cwd(), env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('error', reject);
    for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);
    child.stdin.end();
    child.on('close', () => {
      resolve({
        lines: stdout.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean),
        stderr,
      });
    });
  });
}

const listMsgs = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
];

describe('the deprecation probe makes the deletion decision decidable', () => {
  it('★★ every probed verb is CALLABLE but absent from full — hidden-as-redundant, not merely long-tail', async () => {
    // ⚠ THE FIRST VERSION OF THIS TEST MEASURED THE WRONG SET, and finding out is the
    // reason it is worth having. It compared default's listing against full's and
    // asserted the difference equalled the probe map. It failed: that difference is 14
    // verbs (code_intel_hover, graph_shader, graph_tour, …) and the probe map is 11 —
    // and the two sets are DISJOINT.
    //
    // Two independent mechanisms hide verbs, and only one of them is a deletion
    // question. The DEFAULT profile hides long-tail SPECIALISTS to keep the surface
    // coherent; nobody claims those are redundant. HIDDEN_FULL_TOOL_NAMES hides verbs
    // that something in the repo calls REDUNDANT. 11 + 14 = the 25 unlisted verbs in
    // graph-senior-dev's scope-3 audit. A probe aimed at "unlisted verbs" measures both
    // and answers neither.
    //
    // The map/hidden-set correspondence is now enforced at import in
    // deprecation-probe.js — it throws at startup, which is the moment an omission is
    // created, rather than whenever someone next runs the suite. What is left for a
    // behavioural test is the property that constant cannot assert: that these names
    // really are callable and really are unlisted, on the running server.
    const { lines } = await runRpc(listMsgs, ['--toolset=full']);
    const fullListed = new Set((lines.find((l) => l.id === 2)?.result?.tools ?? []).map((t) => t.name));
    expect(fullListed.size, 'harness sanity').toBeGreaterThan(0);

    const probed = Object.keys(DEPRECATION_REPLACEMENTS);
    expect(probed.length).toBeGreaterThan(0);

    for (const name of probed) {
      expect(fullListed.has(name), `${name} is probed as hidden but IS listed under --toolset=full`).toBe(false);
    }

    // ...and still reachable, or the probe watches a door nobody can open.
    const probeCalls = await runRpc([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      ...probed.map((name, i) => ({ jsonrpc: '2.0', id: 100 + i, method: 'tools/call', params: { name, arguments: { repoRoot: repo } } })),
    ], ['--toolset=full']);

    for (let i = 0; i < probed.length; i += 1) {
      const res = probeCalls.lines.find((l) => l.id === 100 + i);
      expect(res, `${probed[i]} did not answer at all`).toBeTruthy();
      expect(res.error?.code, `${probed[i]} is probed but not callable — the map is stale`).not.toBe(-32601);
    }
  });

  it('★ calling a hidden verb leaves a DURABLE breadcrumb naming its replacement', async () => {
    // stderr alone would make "it never fired" unfalsifiable next month — the same
    // unverified-absence shape as every other defect in this codebase. The file
    // outlives the session, so a future reader checks rather than recollects.
    const { stderr } = await runRpc([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_overview', arguments: { repoRoot: repo } } },
    ], ['--toolset=full']);

    expect(stderr).toMatch(/DEPRECATION PROBE: graph_overview/);
    expect(stderr, 'the replacement must be named, or the log is a complaint not a steer').toMatch(/graph_digest/);

    const crumb = join(repo, '.aify-graph', 'deprecated-verb-calls.jsonl');
    expect(existsSync(crumb), 'the breadcrumb must survive the process').toBe(true);
    const rows = (await readFile(crumb, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    const row = rows.find((r) => r.verb === 'graph_overview');
    expect(row).toBeTruthy();
    expect(row.replacement).toMatch(/graph_digest/);
    expect(Date.parse(row.at), 'undated evidence cannot be reasoned about later').not.toBeNaN();
  });

  it('★ a LISTED verb leaves nothing — the probe must not manufacture its own evidence', async () => {
    // Without this, a probe that fires on everything would pass the case above and the
    // resulting file would prove nothing about anything.
    const probeRepo = await mkdtemp(join(tmpdir(), 'apg-depprobe-clean-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: probeRepo });
      await runRpc([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_health', arguments: { repoRoot: probeRepo } } },
      ]);
      expect(existsSync(join(probeRepo, '.aify-graph', 'deprecated-verb-calls.jsonl'))).toBe(false);
    } finally {
      try { await rm(probeRepo, { recursive: true, force: true }); } catch { /* windows lock */ }
    }
  });

  it('★ the probe does NOT change the response the caller receives', async () => {
    // A probe that alters the behaviour it measures produces compliance data. That is
    // exactly what contaminated D1′: the subject was TOLD to call graph_health first,
    // so first-call-is-health measured obedience rather than preference. An agent
    // calling a hidden verb must get precisely what it got yesterday.
    const { lines } = await runRpc([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_overview', arguments: { repoRoot: repo } } },
    ], ['--toolset=full']);

    const res = lines.find((l) => l.id === 2);
    expect(res, 'the call must still be answered').toBeTruthy();
    expect(res.error, 'the probe must not turn a working verb into an error').toBeFalsy();
    const payload = JSON.stringify(res.result ?? {});
    expect(payload, 'no deprecation text may leak into the caller-visible response')
      .not.toMatch(/DEPRECATION PROBE|deletion candidate/);
  });
});
