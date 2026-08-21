// ⛔ `layers_searched` IS A COVERAGE CLAIM, AND AN UNREADABLE LAYER USED TO SATISFY IT.
//
// graph_find returns `layers_searched` in its STRUCTURED result — a field an agent acts on, not
// prose a human eyeballs. A layer whose source file could not be read still appeared there with
// empty hits, so the consumer was told the layer WAS searched and held nothing when nothing had
// been read at all. That is the false-exhaustive shape.
//
// ⚠ Not exotic: these files are generated inside `.aify-graph`, so a crash or a full disk mid-write
// produces exactly these bytes.
//
// ⛔⛔ AND THE FEATURES LAYER WAS THE WORSE HALF. `loadFunctionality` has ALWAYS returned a typed
// result carrying an `error` field on a parse failure — the honesty was produced correctly and then
// DISCARDED at the call site, which read only `.features`. An honest producer whose consumer
// ignores it buys nothing.
//
// Contract: docs/2026-08-21-prereg-find-layers-searched.md, written before the code.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphFind } from '../../../mcp/stdio/query/verbs/find.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

const VALID_TASKS = JSON.stringify({ tasks: [{ id: 't1', title: 'quicksilver rollout', status: 'open' }] });
const VALID_OVERLAY = JSON.stringify({
  version: '0.2',
  features: [{ id: 'f1', name: 'quicksilver', anchors: { files: ['src/a.js'] } }],
});

/** A repo whose graph is fresh, so freshness never blocks the verb under test. */
async function repo({ tasks, overlay }) {
  const r = await mkdtemp(join(tmpdir(), 'apg-layers-'));
  await mkdir(join(r, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', r, '-c', 'user.email=t@t', '-c', 'user.name=t',
    'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', r, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(r, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 1, edges: 0, schemaVersion: 4,
    extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(r, '.aify-graph', 'graph.sqlite'));
  db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
          VALUES ('n1','Function','quicksilver','src/a.js',1,1,'javascript',1,'{}')`);
  db.close();
  if (tasks !== undefined) await writeFile(join(r, '.aify-graph', 'tasks.json'), tasks);
  if (overlay !== undefined) await writeFile(join(r, '.aify-graph', 'functionality.json'), overlay);
  return r;
}

const find = async () => JSON.parse(await graphFind({ repoRoot, query: 'quicksilver', limit: 5 }));
const unavailableLayers = (r) => (r.layers_unavailable ?? []).map((u) => u.layer);

// ─────────────────────────────────────────────────────────────────────────────
// C1 — the inductions are proven to reach the paths they claim to exercise.
// ─────────────────────────────────────────────────────────────────────────────
describe('C1 — both inductions are proven, and they are DIFFERENT paths', () => {
  it('★★★⛔ C1a: the corrupt bytes really throw', () => {
    // ⛔ A control whose induction cannot reach the code path passes VACUOUSLY. Asserted as its own
    // fact before any result is read.
    expect(() => JSON.parse('{"tasks": [')).toThrow();
  });

  it('★★★⛔ C1b: the malformed-shape bytes do NOT throw — a SEPARATE route to the same []', () => {
    // ⛔ THE ROUTE A CONTROL AIMED AT THE CATCH WOULD MISS. `{}` parses cleanly and reached the old
    // `|| []` fallback without touching the catch, so "the catch is fixed" would have been true and
    // the layer would still have lied. Three failures, three routes, one honest-looking answer.
    expect(() => JSON.parse('{}')).not.toThrow();
    expect(JSON.parse('{}').tasks, 'and it yields undefined, which the old code turned into []').toBeUndefined();
  });
});

describe('C2/C3 — the tasks layer', () => {
  it('★★★⛔ C2: CORRUPT tasks.json removes `tasks` from layers_searched', async () => {
    repoRoot = await repo({ tasks: '{"tasks": [' });
    const r = await find();
    expect(r.layers_searched, 'a layer that could not be read was not searched').not.toContain('tasks');
    expect(unavailableLayers(r), 'and its absence is DISCLOSED, not silent').toContain('tasks');
    expect(r.layers_unavailable[0].reason).toMatch(/unparseable/);
  }, 20_000);

  it('★★★⛔ C2b: MALFORMED tasks.json (parses, no tasks array) is also unclaimed', async () => {
    // The route through the `|| []` fallback rather than the catch.
    repoRoot = await repo({ tasks: '{}' });
    const r = await find();
    expect(r.layers_searched).not.toContain('tasks');
    expect(r.layers_unavailable[0].reason).toMatch(/malformed/);
  }, 20_000);

  it('★★★ C3 POSITIVE CONTROL: a VALID tasks.json keeps the layer claimed', async () => {
    // ⛔ Without this, C2 is satisfied by never claiming the tasks layer at all — which passes the
    // control that motivated the change while deleting the feature. This is the assertion I would
    // most easily have skipped, and the same one that mattered on safeDirtyCount.
    repoRoot = await repo({ tasks: VALID_TASKS });
    const r = await find();
    expect(r.layers_searched).toContain('tasks');
    expect(r.layers_unavailable, 'a clean run carries no noise').toBeUndefined();
  }, 20_000);

  it('★★★ C4: an ABSENT tasks.json is honestly zero, NOT unreadable', async () => {
    // ⚠ Absent and corrupt must not collapse. A repo with no tasks overlay genuinely has no tasks;
    // saying "could not read" there would fix one lie by telling another.
    repoRoot = await repo({});
    const r = await find();
    expect(r.layers_searched, 'nothing to read is not the same as failed to read').toContain('tasks');
    expect(r.layers_unavailable).toBeUndefined();
  }, 20_000);
});

describe('C6/C7 — the features layer, whose honesty was being discarded', () => {
  it('★★★⛔ C6: CORRUPT functionality.json removes `features` from layers_searched', async () => {
    // The loader always reported this correctly. The call site read only `.features` and threw the
    // error away, so the coverage claim survived a failure the code already knew about.
    repoRoot = await repo({ overlay: '{"features": [' });
    const r = await find();
    expect(r.layers_searched).not.toContain('features');
    expect(unavailableLayers(r)).toContain('features');
  }, 20_000);

  it('★★★ C7 POSITIVE CONTROL: a VALID functionality.json keeps the layer claimed', async () => {
    repoRoot = await repo({ overlay: VALID_OVERLAY });
    const r = await find();
    expect(r.layers_searched).toContain('features');
    expect(r.layers_unavailable).toBeUndefined();
  }, 20_000);
});

describe('C5/C8 — the failure is contained', () => {
  it('★★★⛔ C8: the layers fail INDEPENDENTLY', async () => {
    // ⛔ The cheap implementation is one guard around both loads, which would unclaim BOTH layers
    // when one file is bad — a fix that degrades the verb more than the defect did.
    repoRoot = await repo({ tasks: '{"tasks": [', overlay: VALID_OVERLAY });
    const r = await find();
    expect(r.layers_searched, 'the healthy sibling is untouched').toContain('features');
    expect(r.layers_searched).not.toContain('tasks');
    expect(unavailableLayers(r), 'exactly one layer is unavailable').toEqual(['tasks']);
  }, 20_000);

  it('★★★ C5: code and docs are unaffected by a corrupt overlay', async () => {
    // A fix that protects one layer by degrading the verb is worse than the defect.
    repoRoot = await repo({ tasks: '{"tasks": [', overlay: '{"features": [' });
    const r = await find();
    expect(r.layers_searched).toEqual(expect.arrayContaining(['code', 'docs']));
    expect(unavailableLayers(r).sort()).toEqual(['features', 'tasks']);
    expect(r.hits.code, 'the code layer still answers').toBeDefined();
  }, 20_000);
});
