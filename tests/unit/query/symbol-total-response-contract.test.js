// WHERE THE COUNT ACTUALLY LIVES ON THE EXPENSIVE PATH.
//
// ⛔ THIS FILE PREVIOUSLY RATCHETED THE TWO FIELDS *ABSENT*, AND THAT RATCHET WAS DEFENDING
// A FALSE GENERALIZATION. Its stated basis was: "the `matched` block is only built when the
// symbol resolves UNIQUELY, so `symbols_total` could only ever equal `symbols.length`."
//
// ★ THE WORD THAT WAS WRONG IS "UNIQUELY". `buildAmbiguousMatchMessage` returns null when
// the rows collapse to ≤1 CANONICAL KEY (symbol_lookup.js:131-152) — not ≤1 ROW. Nine rows
// sharing one canonical key clear BOTH ambiguity guards, reach `matched`, and are sliced to
// 3 by pickPrimarySymbol. Canonical uniqueness is not row uniqueness.
//
// graph-senior-dev-hermes refuted it by EXECUTION on tree 2fcb7537: 9 `Class` rows, one
// label, one file → object result, `symbols.length` 3, population 9, `referenced_in` 6, no
// ambiguity string. The restored fields read 9 / true on that input.
//
// ⚠ WHY THE OLD RATCHET COULD NOT HAVE CAUGHT IT: it asserted absence using only the
// one-row `uniqueThing` fixture. A singleton arm cannot establish an invariant across the
// canonical-collapse arm — it proves the trivial case and generalises silently. THAT is the
// lesson worth keeping: a ratchet is only as wide as the inputs it is exercised on, and an
// absence assertion on one arm reads as a guarantee on all of them.
//
// ⇒ The three controls below exist because ONE fixture cannot carry this contract:
//   1 row / one key        -> matched, total 1, truncated false
//   9 rows / one key       -> matched, total 9, truncated TRUE   (the refuting case)
//   60 rows / one key      -> NO matched block; refuses via AMBIGUOUS BY TRUNCATION
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

// `defs` overrides the definition count so the retrieval cap (50) can be crossed;
// `sameIdentity` makes every row group to ONE canonical identity, which is how a capped
// page can collapse and look unique while unseen rows remain.
async function makeRepo({ defs = DEFS, sameIdentity = false } = {}) {
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
  for (let i = 0; i < defs - 1; i += 1) {
    db.run(
      `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
       VALUES ($id, 'Class', 'GpuMaterial', $f, 10, 20, 'glsl', 1, '{}')`,
      // sameIdentity: every row shares one file, so canonical grouping collapses the whole
      // retrieved page to a single identity while unfetched rows still exist.
      { id: `g${i}`, f: sameIdentity ? 'engine/GpuMaterialPalette.h' : `engine/shaders/mirror_${i}.glsl` },
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
  it('★★ ABOVE THE RETRIEVAL CAP it states uncertainty, not the cap', async () => {
    // ⛔ dev's withheld population: 60 definitions produced
    // "AMBIGUOUS MATCH … 50 concrete candidates found". `rows` is the LIMIT-50 page, so
    // the grouping counted identities among the first fifty and reported it as the
    // population — the cap-as-total defect reproduced ON THE PATH I MOVED THE CONTRACT
    // ONTO after deleting the dead fields. Third instance of one class.
    //
    // ★ The repair is NOT a corrected number. Grouping is only possible over what was
    // retrieved, so inventing a group count for rows nobody grouped would be the same lie
    // pointing the other way. What is true is the uncertainty: at least G identities among
    // 50 of 60 rows, population not established.
    repoRoot = await makeRepo({ defs: 60 });
    const text = asText(await graphConsequences({ repoRoot, target: 'GpuMaterial' }));

    expect(text, 'the true row population must appear').toMatch(/of 60 matching rows/);
    expect(text, 'and the count must be qualified, never presented as a total')
      .toMatch(/AT LEAST \d+ concrete candidates/);
    expect(text, 'the reader must be told the population is unknown')
      .toMatch(/NOT established/);
    expect(text, 'the retrieval limit must never surface as the finding')
      .not.toMatch(/\b50 concrete candidates found/);
  }, 30_000);

  it('★★ a page that COLLAPSES to one identity is not proof of uniqueness', async () => {
    // dev's sharper point. buildAmbiguousMatchMessage returns null when the retrieved rows
    // resolve to a single identity, and everything downstream then treats the symbol as
    // unambiguous. With retrieval CAPPED that is a statement about the 50 rows we looked
    // at, not the 10 we never fetched — absence of contrary evidence read as evidence of
    // absence, on the path that answers "what breaks if I change this".
    repoRoot = await makeRepo({ defs: 60, sameIdentity: true });
    const text = asText(await graphConsequences({ repoRoot, target: 'GpuMaterial' }));

    expect(text, 'a collapsed but truncated page must refuse to claim uniqueness')
      .toMatch(/AMBIGUOUS BY TRUNCATION/);
    expect(text).toMatch(/uniqueness is NOT established/);
  }, 30_000);

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
    // `matched` block. ⚠ This comment used to end "…and knowing that is what proved the
    // deleted fields were dead". It proved no such thing: reaching `matched` on a ONE-ROW
    // input says nothing about reaching it on a NINE-ROW one-canonical-key input, which is
    // exactly the generalisation that made the old ratchet wrong. See CONTROL 2.
    repoRoot = await makeRepo();
    const res = await graphConsequences({ repoRoot, target: 'uniqueThing' });

    expect(typeof res, 'harness sanity: a unique symbol must return the object shape').toBe('object');
    expect(res.matched?.symbols?.length, 'exactly one definition').toBe(1);
    expect(asText(res), 'one definition is not ambiguous').not.toMatch(/AMBIGUOUS MATCH/);
  }, 30_000);

  it('★★ CONTROL 1 of 3 — one row, one key: the fields are present and report no truncation', async () => {
    // The singleton arm. This is the ONLY arm the deleted ratchet ever exercised, and on its
    // own it is consistent with both the true contract and the false one — which is exactly
    // why it could not defend anything.
    repoRoot = await makeRepo();
    const res = await graphConsequences({ repoRoot, target: 'uniqueThing' });

    expect(res.matched, 'harness sanity: the matched block must exist to be checked').toBeTruthy();
    expect(res.matched.symbols.length, 'harness sanity: exactly one definition').toBe(1);
    // HAND-WRITTEN, not read back from the response: 1 row means total 1, nothing hidden.
    expect(res.matched.symbols_total, 'population is carried even when it equals the sample').toBe(1);
    expect(res.matched.symbols_truncated, 'nothing was omitted on a one-row input').toBe(false);
  }, 30_000);

  it('★★ CONTROL 2 of 3 — NINE rows collapsing to ONE canonical key still reach `matched`, and must disclose 9', async () => {
    // ⇒ THE REFUTING CASE, replayed from graph-senior-dev-hermes's executed counterexample.
    // Nine rows, one label, one file: canonical grouping sees a single identity, both
    // ambiguity guards pass, and pickPrimarySymbol slices the sample to 3. If the deleted
    // fields were restored wrongly — or deleted again — this is the arm that fails.
    repoRoot = await makeRepo({ defs: 9, sameIdentity: true });
    const res = await graphConsequences({ repoRoot, target: 'GpuMaterial' });

    expect(typeof res, 'canonical collapse must reach the STRUCTURED route, not a string').toBe('object');
    expect(res.matched, 'the matched block must exist on the collapse arm').toBeTruthy();
    // Hand-written numbers. 9 rows in, 3 shown, so the population must read 9 and the
    // sample must declare itself incomplete. `3` here is pickPrimarySymbol's cap, asserted
    // deliberately: if that cap changes, this test should be re-read, not silently adapt.
    expect(res.matched.symbols.length, 'sample is capped at 3 by pickPrimarySymbol').toBe(3);
    expect(res.matched.symbols_total, 'the POPULATION, not the sample — this is the whole contract').toBe(9);
    expect(res.matched.symbols_truncated, '3 of 9 shown must report as truncated').toBe(true);
    // And the sample must not masquerade as the population.
    expect(res.matched.symbols_total, 'a sample reported as a total is the defect these fields exist for')
      .not.toBe(res.matched.symbols.length);
  }, 30_000);

  it('★★ CONTROL 3 of 3 — above the retrieval cap, one key must REFUSE rather than sample', async () => {
    // The boundary between "disclose the population" and "you cannot know the population".
    // Past the 50-row retrieval cap the total itself is unestablished, so the correct
    // behaviour is refusal — NOT a structured block carrying a confident number.
    repoRoot = await makeRepo({ defs: 60, sameIdentity: true });
    const res = await graphConsequences({ repoRoot, target: 'GpuMaterial' });

    expect(typeof res, 'above the cap the verb must return the refusal string').toBe('string');
    expect(res).toMatch(/AMBIGUOUS BY TRUNCATION/);
    expect(res).toMatch(/uniqueness is NOT established/);
  }, 30_000);
});
