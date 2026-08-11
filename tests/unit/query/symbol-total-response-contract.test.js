// WHERE THE COUNT ACTUALLY LIVES ON THE EXPENSIVE PATH — AND WHY THE FIELD I ADDED THERE
// WAS DEAD.
//
// graph-senior-dev-hermes deleted `symbols_total` and `symbols_truncated` from
// consequences.js and every consequences + packet test stayed GREEN, 18 of 18. I took that
// as a missing contract pin and set out to write one.
//
// ⇒ MEASURING FIRST SHOWED THERE WAS NOTHING TO PIN. The `matched` block in
// graphConsequences is only built when the symbol resolves UNIQUELY. Two or more
// definitions short-circuit to the human-readable AMBIGUOUS MATCH string long before
// `matched` exists. So on that route `symbols_total` could only ever equal
// `symbols.length` and `symbols_truncated` could only ever be false. A field that cannot
// vary cannot inform — and cannot be tested. Both were deleted rather than pinned.
//
// ★ The count IS carried where multiplicity actually occurs: the ambiguity message says
// "N concrete candidates found". THAT is the expensive path's real contract, and it is
// what this file pins.
//
// ⚠ The first version of this file was itself vacuous, and in the exact way dev warned
// about: its second case opened with `if (typeof res === 'string' || !res?.matched) return;`
// — and since this fixture always produces the string, the case returned before asserting
// anything. A bare early return is a green result that checked nothing. Every branch below
// now either asserts or fails; none exits quietly.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphConsequences } from '../../../mcp/stdio/query/verbs/consequences.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

const DEFS = 9;
let repoRoot;

async function makeRepo() {
  const repo = await mkdtemp(join(tmpdir(), 'apg-symtotal-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  // One C++ definition and eight GLSL mirrors — the echoes shape, kept under the
  // retrieval cap so this file tests the CARRIER and not the LIMIT.
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ('h', 'Class', 'GpuMaterial', 'engine/GpuMaterialPalette.h', 30, 60, 'cpp', 1, '{}')`,
  );
  for (let i = 0; i < DEFS - 1; i += 1) {
    db.run(
      `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
       VALUES ($id, 'Class', 'GpuMaterial', $f, 10, 20, 'glsl', 1, '{}')`,
      { id: `g${i}`, f: `engine/shaders/mirror_${i}.glsl` },
    );
  }
  // A symbol with exactly one definition, so the `matched` route can be exercised too.
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ('u', 'Function', 'uniqueThing', 'src/only.cpp', 1, 5, 'cpp', 1, '{}')`,
  );
  db.close();
  return repo;
}

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
  repoRoot = undefined;
});

const asText = (o) => (typeof o === 'string' ? o : JSON.stringify(o));

describe('the expensive path states its candidate count where multiplicity happens', () => {
  it('★★ the AMBIGUOUS message carries the REAL number of definitions', async () => {
    // The actual contract. Nine definitions exist; the message must say nine — not a
    // display cap, and not a vague "multiple". This is the number a reader acts on and
    // the only place the expensive path can express multiplicity at all.
    repoRoot = await makeRepo();
    const text = asText(await graphConsequences({ repoRoot, target: 'GpuMaterial' }));

    expect(text, 'harness sanity: nine definitions must take the ambiguous route')
      .toMatch(/AMBIGUOUS MATCH/);
    expect(text, 'the count must be the population').toMatch(new RegExp(`${DEFS} concrete candidates`));
  }, 30_000);

  it('★★ a UNIQUE symbol takes the matched route, and it does not claim multiplicity', async () => {
    // The sibling route, asserted rather than assumed — this is the one that produces a
    // `matched` block, and knowing that is what proved the deleted fields were dead.
    repoRoot = await makeRepo();
    const res = await graphConsequences({ repoRoot, target: 'uniqueThing' });

    expect(typeof res, 'harness sanity: a unique symbol must return the object shape').toBe('object');
    expect(res.matched?.symbols?.length, 'exactly one definition').toBe(1);
    expect(asText(res), 'one definition is not ambiguous').not.toMatch(/AMBIGUOUS MATCH/);
  }, 30_000);

  it('★★ the dead fields stay deleted — a field that cannot vary must not be re-added', async () => {
    // ⇒ A ratchet, not a preference. Re-adding `symbols_total` to this block would put
    // back a value that is trivially `symbols.length` on every reachable input, costing
    // tokens in every response and — as it did once — creating the impression that the
    // expensive path was covered when nothing could cover it.
    //
    // If multiplicity is ever made reachable HERE (an ambiguity route that returns
    // structured data instead of prose), delete this case and pin the real thing.
    repoRoot = await makeRepo();
    const res = await graphConsequences({ repoRoot, target: 'uniqueThing' });

    expect(res.matched, 'harness sanity: the matched block must exist to be checked').toBeTruthy();
    expect(Object.keys(res.matched), 'no field that can only ever be trivially true')
      .not.toContain('symbols_total');
    expect(Object.keys(res.matched)).not.toContain('symbols_truncated');
  }, 30_000);
});
