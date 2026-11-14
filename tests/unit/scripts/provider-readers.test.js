import { beforeAll, afterAll, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { providerReaders } from '../../../scripts/lib/provider-readers.mjs';
import { answerRequest } from '../../../scripts/lib/provider-requests.mjs';

let root;
let outside;
let head;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'apg-provider-readers-'));
  outside = mkdtempSync(join(tmpdir(), 'apg-provider-outside-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/a.cpp'), 'int a() { return 1; }\n');
  writeFileSync(join(outside, 'secret.cpp'), 'int secret() {}\n');
  symlinkSync(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', 'src/a.cpp');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture');
  head = git('rev-parse', 'HEAD');
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  if (outside) rmSync(outside, { recursive: true, force: true });
});

it.each(['references', 'definitions'])('%s uses the real containment guard before invoking a backend', async (call) => {
  let invokes = 0;
  const readers = providerReaders({ repoRoot: root, head, invoke: async () => {
    invokes += 1;
    return { status: 'ok', evidence: { exhaustive: false }, definitions: [], referenceLocations: [], definitionLocations: [] };
  } });
  const ask = (file) => answerRequest({ request: { call, args: { file, line: 1, col: 1 } }, head, ...readers });
  expect(await ask('src/a.cpp')).toMatchObject({ ok: true, value: { observed: 'working_tree' } });
  expect(invokes).toBe(1);
  expect(await ask('linked/secret.cpp')).toMatchObject({ ok: false, value: { reasonCode: 'path_outside_repository' } });
  expect(invokes).toBe(1);
  expect(await ask('src/missing.cpp')).toMatchObject({ ok: false, value: { reasonCode: 'file_unavailable' } });
  expect(invokes).toBe(1);
});

it('a returned repository-relative path resolving outside is withheld before presentation', async () => {
  const readers = providerReaders({ repoRoot: root, head, invoke: async () => ({
    status: 'ok', evidence: { exhaustive: false },
    definitions: [{ file: 'src/a.cpp', range: null }, { file: 'linked/secret.cpp', range: null }],
  }) });
  const out = await answerRequest({ request: { call: 'definitions', args: { file: 'src/a.cpp', line: 1, col: 1 } }, head, ...readers });
  expect(out.ok, out.problem).toBe(true);
  expect(out.value).toMatchObject({ definitions: [{ path: 'src/a.cpp' }], matched: { definitions: 1 }, withheld: { outsideRepository: { definitions: 1 } } });
  expect(JSON.stringify(out.value)).not.toContain('secret.cpp');
});

it.each([
  ['stamp', { anchors: [{ kind: 'file', path: '../outside.cpp' }] }],
  ['resolve', { anchors: [{ kind: 'file', path: 'C:/outside.cpp' }] }],
  ['subgraph', { path: '../outside.cpp' }],
  ['subgraph', { anchor: { kind: 'symbol', path: '../outside.cpp', name: 'a' } }],
])('%s refuses unsafe graph/commit paths before any reader: %j', async (call, args) => {
  let reads = 0;
  const reader = () => { reads += 1; return { ok: true, value: {}, kind: 'watched', row: { status: 'gone', evidence: 'fixture' } }; };
  const deps = { head, resolveItem: reader, readSubgraph: reader };
  const goodArgs = call === 'subgraph' ? { path: 'src/a.cpp' } : { anchors: [{ kind: 'file', path: 'src/a.cpp' }] };
  expect(await answerRequest({ request: { call, args: goodArgs }, ...deps })).toMatchObject({ ok: true });
  expect(reads, 'CONTROL: a valid request reaches this reader').toBe(1);
  reads = 0;
  const out = await answerRequest({ request: { call, args }, ...deps });
  expect.soft(out.ok, 'unsafe paths must be refused').toBe(false);
  expect.soft(out.problem ?? '', 'the refusal must name the path constraint').toMatch(/repository-relative/u);
  expect.soft(reads, 'unsafe paths must not reach a reader').toBe(0);
});
