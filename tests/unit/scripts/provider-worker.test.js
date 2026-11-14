import { beforeAll, afterAll, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { PassThrough, Writable } from 'node:stream';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';

const cli = fileURLToPath(new URL('../../../bin/apg.js', import.meta.url));
const roots = [];
let indexed;
let empty;
beforeAll(async () => {
  for (const symbol of ['alpha', 'beta']) {
    const root = mkdtempSync(join(tmpdir(), 'apg-worker-'));
    roots.push(root);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/a.js'), `export function ${symbol}() { return 1; }\n`);
    writeFileSync(join(root, 'private.js'), 'export function outsideGrant() { return 1; }\n');
    writeFileSync(join(root, '.gitignore'), '.aify-graph/\n');
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q'); git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture');
  }
  [indexed, empty] = roots;
  await ensureFresh({ repoRoot: indexed });
});
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

it('the real CLI echoes ids, uses each repoRoot instead of cwd, and keeps serving after refusals', () => {
  const requests = [
    { id: 'find-index', call: 'find', args: { symbol: 'alpha' }, repoRoot: indexed },
    { id: 'find-missing', call: 'find', args: { symbol: 'beta' }, repoRoot: empty },
    { id: 'first-root', call: 'resolve', args: { anchors: [{ kind: 'symbol', path: 'src/a.js', name: 'alpha' }] }, repoRoot: indexed },
    { id: 'second-root', call: 'resolve', args: { anchors: [{ kind: 'symbol', path: 'src/a.js', name: 'alpha' }] }, repoRoot: empty },
    { id: 'unsafe', call: 'definitions', args: { file: '../escape.cpp', line: 1, col: 1 }, repoRoot: empty },
    { id: 'unknown', call: 'unknown', args: {}, repoRoot: indexed },
    { id: 'last', call: 'stamp', args: { anchors: [{ kind: 'file', path: 'src/a.js' }] }, repoRoot: empty },
  ];
  const child = spawnSync(process.execPath, [cli, 'provide'], { cwd: empty, input: `${requests.map(JSON.stringify).join('\n')}\n`, encoding: 'utf8', timeout: 30000 });
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  const answers = child.stdout.trim().split('\n').map(JSON.parse);
  expect(answers.map((a) => a.id)).toEqual(requests.map((r) => r.id));
  expect(answers[0]).toMatchObject({ ok: true, value: { matched: 1, definitions: [{ name: 'alpha' }] } });
  expect(answers[1]).toMatchObject({ ok: false, value: { reasonCode: 'no_index', enable: [expect.any(String), expect.any(String)] } });
  expect(answers[2]).toMatchObject({ ok: true, value: { results: [{ status: 'found' }] } });
  expect(answers[3]).toMatchObject({ ok: true, value: { results: [{ status: 'gone' }] } });
  expect(answers[4]).toMatchObject({ ok: false, value: { reasonCode: 'path_outside_repository' } });
  expect(answers[5].ok).toBe(false);
  expect(answers[6].ok).toBe(true);
});

it.each(['relative', 'subfolder'])('refuses a %s repoRoot rather than reading files outside the claimed root', (kind) => {
  const request = { id: 'bad-root', call: 'resolve', args: { anchors: [{ kind: 'symbol', path: 'private.js', name: 'outsideGrant' }] },
    repoRoot: kind === 'relative' ? '.' : join(indexed, 'src') };
  const child = spawnSync(process.execPath, [cli, 'provide'], { cwd: indexed, input: `${JSON.stringify(request)}\n`, encoding: 'utf8', timeout: 30000 });
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  const out = JSON.parse(child.stdout);
  expect(out).toMatchObject({ id: 'bad-root', ok: false, value: { reasonCode: kind === 'relative' ? 'invalid_request' : 'repository_root_required' } });
});

it('the importable loop is serial, reports malformed input in band and closes its owned resources', async () => {
  const { runProvide } = await import('../../../scripts/lib/provider-worker.mjs');
  const input = new PassThrough();
  let output = '';
  const stream = new Writable({ write(chunk, _encoding, done) { output += chunk; done(); } });
  const trace = [];
  let active = 0;
  let maxActive = 0;
  let closed = 0;
  const run = runProvide([], { input, output: stream, errorOutput: stream,
    answer: async (request) => {
      trace.push(`start:${request.id}`); active += 1; maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1; trace.push(`end:${request.id}`);
      if (request.id === 'throws') throw new Error('fixture request failure');
      return { ok: true, value: { formatVersion: 1, fixture: request.id }, provenance: { providerCommit: 'fixture', exhaustive: false, provenance: 'fixture' } };
    },
    close: async () => { closed += 1; },
  });
  const request = (id) => JSON.stringify({ id, call: 'find', args: { symbol: 'alpha' }, repoRoot: indexed });
  input.end(`${request('one')}\nnot-json\n${request('throws')}\n${request('two')}`);
  expect(await run).toBe(0);
  const answers = output.trim().split('\n').map(JSON.parse);
  expect(answers.map((a) => a.id)).toEqual(['one', null, 'throws', 'two']);
  expect(answers[1]).toMatchObject({ ok: false, value: { reasonCode: 'invalid_request' } });
  expect(answers[2]).toMatchObject({ ok: false, value: { reasonCode: 'provider_failed' } });
  expect(answers[3].ok).toBe(true);
  expect(trace).toEqual(['start:one', 'end:one', 'start:throws', 'end:throws', 'start:two', 'end:two']);
  expect(maxActive).toBe(1);
  expect(closed).toBe(1);
});
