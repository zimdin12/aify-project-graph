import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';
import { openExistingDb } from '../../../mcp/stdio/storage/db.js';
import { EXECUTION_FAMILY, CALL_FAMILY } from '../../../mcp/stdio/storage/taxonomy.js';
import { SEARCH_TYPES } from '../../../mcp/stdio/query/verbs/whereis.js';
import { answerRequest } from '../../../scripts/lib/provider-requests.mjs';
import { readLookup } from '../../../scripts/lib/provider-lookups.mjs';
import { readSubgraph } from '../../../scripts/lib/provider-subgraph.mjs';

let repoRoot;
let head;
const git = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(JSON.parse(readFileSync(new URL('../../../docs/schemas/provider-answer.v1.schema.json', import.meta.url), 'utf8')));
const ask = (call, args, root = repoRoot) => {
  const out = answerRequest({ request: { call, args }, head,
    readLookup: (kind, request) => readLookup({ call: kind, request, repoRoot: root, head }),
    readSubgraph: (request) => readSubgraph({ request, repoRoot: root, head }),
  });
  expect(validate(out), JSON.stringify(validate.errors)).toBe(true);
  return out;
};
const bytes = () => Object.fromEntries(readdirSync(join(repoRoot, '.aify-graph')).filter((f) => f !== 'graph.sqlite-shm').sort()
  .map((f) => [f, createHash('sha256').update(readFileSync(join(repoRoot, '.aify-graph', f))).digest('hex')]));

beforeAll(async () => {
  repoRoot = mkdtempSync(join(tmpdir(), 'apg-provider-lookups-'));
  mkdirSync(join(repoRoot, 'src'));
  writeFileSync(join(repoRoot, '.gitignore'), '.aify-graph/\n');
  writeFileSync(join(repoRoot, 'src/target.js'), 'export function target() { return 1; }\n');
  for (const name of ['alpha', 'bravo', 'charlie']) {
    writeFileSync(join(repoRoot, `src/${name}.js`), `import { target } from './target.js';\nexport function ${name}() { return target(); }\n`);
  }
  writeFileSync(join(repoRoot, 'src/twins.js'), 'export class Left { run() {} }\nexport class Right { run() {} }\n');
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture');
  head = git('rev-parse', 'HEAD');
  await ensureFresh({ repoRoot });
  // Seed a known compiler edge and a reference-only edge into the real extracted graph.
  const db = openExistingDb(join(repoRoot, '.aify-graph/graph.sqlite'), { readonly: false });
  try {
    db.run("UPDATE edges SET provenance = 'LSP_VERIFIED' WHERE relation = 'CALLS' AND from_id IN (SELECT id FROM nodes WHERE label = 'charlie')");
    const source = db.get("SELECT id FROM nodes WHERE label = 'alpha' AND type = 'Function'");
    const target = db.get("SELECT id FROM nodes WHERE label = 'target' AND type = 'Function'");
    db.run("INSERT INTO edges (from_id, to_id, relation, confidence, provenance) VALUES ($from, $to, 'REFERENCES', 1, 'EXTRACTED')", { from: source.id, to: target.id });
    db.run("INSERT INTO nodes (id, type, label, file_path) VALUES ('foreign-target', 'Function', 'target', 'C:/sdk/hidden.cpp')");
    db.run("INSERT INTO nodes (id, type, label, file_path) VALUES ('foreign-caller', 'Function', 'foreign', '../outside.cpp')");
    db.run("INSERT INTO edges (from_id, to_id, relation) VALUES ('foreign-caller', $target, 'CALLS')", { target: target.id });
  } finally { db.close(); }
});
afterAll(() => { if (repoRoot) rmSync(repoRoot, { recursive: true, force: true }); });

describe('graph lookups through the maintained provider dispatcher', () => {
  it('find returns exact indexed declarations, not substring matches or repository absence', () => {
    const found = ask('find', { symbol: 'target' });
    expect(found.ok, found.problem).toBe(true);
    expect(found.value).toMatchObject({ formatVersion: 1, indexCommit: head, head, stale: false, truncated: false, matched: 1 });
    expect(found.value.definitions).toHaveLength(1);
    expect(found.value.definitions[0]).toMatchObject({ name: 'target', path: 'src/target.js', kind: 'Function', lineRange: [1, 1] });
    expect(found.value.searchedTypes).toEqual(SEARCH_TYPES);
    expect(found.value.withheld).toEqual({ outsideRepository: 1 });
    expect(JSON.stringify(found)).not.toContain('hidden.cpp');
    const invalid = structuredClone(found); invalid.value.matched = -1;
    expect(validate(invalid), 'CONTROL: the schema rejects invalid population counts').toBe(false);
    const miss = ask('find', { symbol: 'targ' });
    expect(miss).toMatchObject({ ok: true, value: { definitions: [], matched: 0, truncated: false } });
    expect(miss.provenance.exhaustive).toBe(false);
  });

  it('find counts past a deterministic cut and filters by an exact path', () => {
    const full = ask('find', { symbol: 'run', limit: 1000 });
    expect(full.ok, full.problem).toBe(true);
    expect(full.value.definitions).toHaveLength(2);
    const cut = ask('find', { symbol: 'run', limit: 1 });
    expect(cut.value).toMatchObject({ matched: 2, truncated: true });
    expect(cut.value.definitions).toEqual(full.value.definitions.slice(0, 1));
    expect(ask('find', { symbol: 'run', limit: 1 })).toEqual(cut);
    expect(ask('find', { symbol: 'run', file: 'src/twins.js' }).value.matched).toBe(2);
    expect(ask('find', { symbol: 'run', file: 'src/twins.js-no' }).value.matched).toBe(0);
  });

  it('callers searches execution edges only, ranks compiler evidence first and labels declaration locations', () => {
    const full = ask('callers', { symbol: 'target' });
    expect(full.ok, full.problem).toBe(true);
    expect(full.value).toMatchObject({ matched: 3, truncated: false, locationKind: 'caller_declaration' });
    expect(full.value.callers.map((c) => c.from.name).sort()).toEqual(['alpha', 'bravo', 'charlie']);
    expect(full.value.callers[0]).toMatchObject({ from: { name: 'charlie', lineRange: [2, 2] }, type: 'CALLS', resolution: 'compiler', provenance: 'LSP_VERIFIED' });
    expect(full.value.callers.every((c) => c.to.name === 'target')).toBe(true);
    expect(full.value.withheld).toEqual({ outsideRepository: { targets: 1, callers: 1 } });
    for (const forbidden of ['../outside.cpp', 'C:/sdk/hidden.cpp']) {
      expectAbsentWithLiveMatcher(/outside\.cpp|hidden\.cpp/u, { forbidden, allowed: 'src/target.js' }, JSON.stringify(full), 'outside locations are withheld');
    }
    const invalid = structuredClone(full); delete invalid.value.callers[0].resolution;
    expect(validate(invalid), 'CONTROL: caller evidence is required by the schema').toBe(false);
    expect(full.value.searchedRelations).toEqual(EXECUTION_FAMILY);
    expect(full.value.unsearchedRelations).toEqual(CALL_FAMILY.filter((r) => !EXECUTION_FAMILY.includes(r)));
    const cut = ask('callers', { symbol: 'target', limit: 1 });
    expect(cut.value).toMatchObject({ matched: 3, truncated: true });
    expect(cut.value.callers).toEqual(full.value.callers.slice(0, 1));
    expect(ask('callers', { symbol: 'alpha' })).toMatchObject({ ok: true, value: { matched: 0, callers: [], truncated: false } });
  });

  it('callers refuses ambiguity with candidates and accepts a qualified anchor', () => {
    const ambiguous = ask('callers', { symbol: 'run' });
    expect(ambiguous).toMatchObject({ ok: false, value: { reasonCode: 'ambiguous_anchor' } });
    expect(ambiguous.value.candidates).toHaveLength(2);
    expect(ambiguous.problem).toContain('run');
    const cut = ask('callers', { symbol: 'run', limit: 1 });
    expect(cut).toMatchObject({ ok: false, value: { reasonCode: 'ambiguous_anchor', matched: 2, truncated: true } });
    expect(cut.value.candidates).toHaveLength(1);
    const anchor = ambiguous.value.candidates[0].anchor;
    expect(anchor.name).toMatch(/(Left|Right)\.run$/u);
    expect(ask('callers', { anchor })).toMatchObject({ ok: true, value: { callers: [], matched: 0 } });
    expect(ask('callers', { symbol: 'absent' })).toMatchObject({ ok: false, value: { reasonCode: 'not_in_index' } });
  });

  it.each(['find', 'callers'])('%s discloses stale snapshots and refuses unattested ones without changing bytes', (call) => {
    const before = bytes();
    const oldHead = head;
    head = 'new-head';
    try {
      expect(ask(call, { symbol: 'target' }).value).toMatchObject({ indexCommit: oldHead, head, stale: true, staleBecause: ['index_behind_head'] });
      expect(bytes()).toEqual(before);
      expect(existsSync(join(repoRoot, '.aify-graph/code-intel'))).toBe(false);
      const manifestPath = join(repoRoot, '.aify-graph/manifest.json');
      const manifest = readFileSync(manifestPath, 'utf8');
      try {
        writeFileSync(manifestPath, JSON.stringify({ ...JSON.parse(manifest), generation: 999999 }));
        expect(ask(call, { symbol: 'target' })).toMatchObject({ ok: false, value: { reasonCode: 'index_not_attested' } });
      } finally { writeFileSync(manifestPath, manifest); }
      expect(ask(call, { symbol: 'target' }).ok).toBe(true);
    } finally { head = oldHead; }
  });

  it.each(['find', 'callers', 'subgraph'])('%s returns no_index and creates nothing', (call) => {
    const empty = mkdtempSync(join(tmpdir(), 'apg-provider-no-index-'));
    try {
      const args = call === 'subgraph' ? { path: 'src/a.js' } : { symbol: 'target' };
      const out = ask(call, args, empty);
      expect(out).toMatchObject({ ok: false, value: { formatVersion: 1, reasonCode: 'no_index', enable: [expect.any(String), expect.any(String)] } });
      expect(readdirSync(empty)).toEqual([]);
    } finally { rmSync(empty, { recursive: true, force: true }); }
  });

  it.each([
    ['find', { symbol: '' }], ['find', { symbol: 'target', limit: 0 }],
    ['find', { symbol: 'target', file: '../escape.js' }],
    ['callers', { symbol: 'target', depth: 2 }], ['callers', { anchor: { kind: 'file', path: 'src/a.js' } }],
    ['callers', { symbol: 'target', limit: 1001 }],
  ])('%s rejects unsupported or unsafe args before reading the index: %j', (call, args) => {
    let reads = 0;
    const out = answerRequest({ request: { call, args }, repoRoot, head, readLookup: () => { reads += 1; } });
    expect(out).toMatchObject({ ok: false, value: { reasonCode: 'invalid_request' } });
    expect(reads).toBe(0);
  });
});
