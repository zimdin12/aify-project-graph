// ⛔ HIDING A VERB IS NOT RETIRING IT, AND NOTHING ELSE CHECKS THE DIFFERENCE.
//
// `HIDDEN_FULL_TOOL_NAMES` drops verbs from every listing, including `--toolset=full`. That is a
// SURFACE decision: the names stop being advertised. It is not a retirement decision, and callers
// written before the hiding — or hosts that permit calling an unlisted name — must still get an
// answer. A hidden verb that has quietly stopped answering is a silent breaking change, visible to
// nobody, because no listing mentions it any more.
//
// ⭐ THIS ASSERTION IS INHERITED, NOT NEW. It lived in tests/integration/deprecation-probe.test.js,
// whose subject was runtime telemetry that recorded calls to these verbs. That probe was retired on
// 2026-09-08 — an indefinitely running counter does not decide a migration for anyone, and it was
// permanent instrumentation with no decision attached. Its OTHER assertions went with it; this one
// is a property of the product, not of the probe, and it would have died as collateral.
//
// ⇒ IT NOW READS THE HIDDEN SET DIRECTLY. The old version enumerated the probe's replacement table
// — a second list that happened to mirror the hidden set, kept in step by a startup throw. Reading
// the real constant removes the mirror: the set under test is derived, so a verb hidden tomorrow is
// covered tomorrow without anyone remembering this file exists.
//
// ⛔ WHAT EACH HALF ACTUALLY CATCHES, ESTABLISHED BY MUTATION AND NOT BY ASSUMPTION — I guessed
// wrong about the first half and the mutations corrected me.
//   · "absent from full" does NOT catch a wrong SET. The listing filter reads this same constant,
//     so adding a real verb here simply hides it, which is a legitimate state and passes. It
//     catches the FILTER BEING UNWIRED: replacing server.js's `.filter(tool =>
//     !HIDDEN_FULL_TOOL_NAMES.has(tool.name))` with a pass-through fails it with "graph_lookup is
//     marked hidden but IS listed under --toolset=full".
//   · "still answers" catches a name here that the server cannot dispatch — added or renamed away.
//     A bogus entry fails with -32601.
//
// ⚠ AND THE FIRST MUTATION RUN WENT RED FOR THE WRONG REASON ENTIRELY. Before the probe was
// removed, its import-time consistency throw crashed the server, so the listing came back empty and
// BOTH mutations "failed" without ever reaching the assertion under test. The empty-listing control
// below is what caught that. Without it, two false verifications would have been recorded as proof.
//
// ⚠ AND THE ORIGINAL MEASURED THE WRONG SET FIRST, which is why the distinction is spelled out.
// It compared the DEFAULT listing against full's and asserted the difference was the probe map. It
// failed: that difference is 14 long-tail SPECIALISTS (code_intel_hover, graph_shader, graph_tour…)
// and the map held 11 verbs called REDUNDANT — two disjoint sets, two different mechanisms, and
// only one of them a deletion question. A test aimed at "unlisted verbs" measures both and answers
// neither.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HIDDEN_FULL_TOOL_NAMES } from '../../mcp/stdio/hidden-tools.js';

let repo;

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'apg-hidden-'));
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
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('error', reject);
    child.on('close', () => resolve({
      stdout,
      stderr,
      lines: stdout.trim().split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean),
    }));
    for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);
    child.stdin.end();
  });
}

describe('a hidden verb is unadvertised, not withdrawn', () => {
  it('★★ every hidden verb is ABSENT from --toolset=full and still ANSWERS', async () => {
    const hidden = [...HIDDEN_FULL_TOOL_NAMES];
    // ⛔ THE LIVENESS CONTROL COMES FIRST. An empty hidden set satisfies every loop below without
    // running one iteration, and a wrong zero here agrees with exactly what we hope to see.
    expect(hidden.length, 'nothing is hidden — the set is empty, not the assertion satisfied')
      .toBeGreaterThan(0);

    const { lines } = await runRpc([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ], ['--toolset=full']);
    const fullListed = new Set((lines.find((l) => l.id === 2)?.result?.tools ?? []).map((t) => t.name));
    // ⛔ AND THE INSTRUMENT MUST BE PROVEN TO SPEAK. A server that listed nothing would pass every
    // "is absent from full" assertion below for the wrong reason.
    expect(fullListed.size, 'the full listing came back empty — harness broken, not verbs hidden')
      .toBeGreaterThan(0);

    for (const name of hidden) {
      expect(fullListed.has(name), `${name} is marked hidden but IS listed under --toolset=full`)
        .toBe(false);
    }

    // ...and still reachable. -32601 is "method not found": the verb stopped existing while every
    // listing had already stopped mentioning it, which is how this breaks silently.
    const calls = await runRpc([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      ...hidden.map((name, i) => ({
        jsonrpc: '2.0', id: 100 + i, method: 'tools/call', params: { name, arguments: { repoRoot: repo } },
      })),
    ], ['--toolset=full']);

    for (let i = 0; i < hidden.length; i += 1) {
      const res = calls.lines.find((l) => l.id === 100 + i);
      expect(res, `${hidden[i]} did not answer at all`).toBeTruthy();
      expect(res.error?.code, `${hidden[i]} is hidden but no longer callable — a silent withdrawal`)
        .not.toBe(-32601);
    }
  }, 180_000);
});
