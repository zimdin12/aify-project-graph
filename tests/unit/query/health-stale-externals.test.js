import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

// ⛔ GARBAGE A FULL REBUILD CLEARS, AND NOTHING SAID SO.
//
// External nodes carry labels that are not plausible symbol names — `entries()]`, `replace(/g,`,
// `join(dirOf(docPath),`. A guard refuses to create them, but INCREMENTAL reindexing does not remove
// the ones already present.
//
// ⛔⛔ THIS FILE CARRIED A FALSE EXPLANATION LONGER THAN THE CODE DID, AND THAT IS THE POINT. It said
// "an older extractor materialised" them. That cause was asserted, never tested, withdrawn from the
// shipped message in 852e2e4 — and left standing HERE. When I later swept for the claims a fix had
// falsified, I grepped source and docs and never opened the tests, so the dead explanation survived
// in an executable authority carrier while the code around it had moved on twice. A reviewer found
// it, not me.
//
// ⭐ THE CAUSE IS NOW ESTABLISHED: refs RE-BIND to these nodes. resolveRefs gates creation but not
// binding, and buildResolvers queries `nodes` with no type restriction, so every re-index refreshes
// their edges and the orphan sweep never collects them. The gate that acted on this was REVERTED
// after review (it refused edges on a label pattern that also rejects `operator()` and `save!`), so
// the residue is self-perpetuating by choice until one admission policy covers creation AND binding.
//
// ⭐ MEASURED WITH THE GUARD HELD CONSTANT ON BOTH SIDES, so the comparison isolates exactly one
// variable — full rebuild versus incrementally maintained:
//
//     live  (incremental)   1,104 External nodes   334 fragment-labelled
//     fresh (full rebuild)    769 External nodes     0 fragment-labelled
//     present only in live: 338, of which 334 are fragments
//
// Every OTHER node type was reproduced exactly: 0 residue across 4,525 nodes. So this is not
// general staleness — it is confined to External, it is 98.8% garbage, and one forced index clears
// it.
//
// ⚠ COUNTED BY LABEL SHAPE, NOT BY REBUILDING. Whether a node is reproducible cannot be known
// without running a full index, which health must never do. The shape is a cheap proxy for the part
// that is actually harmful, and the predicate is IMPORTED from the resolver rather than restated.


describe('graph_health reports External nodes whose labels are not plausible names', () => {
  let repoRoot;

  const seed = async (labels) => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    try {
      // A code node too, so the census branch that carries this verdict actually runs.
      db.run('INSERT INTO nodes (id, type, label, file_path, language) VALUES (?, ?, ?, ?, ?)',
        ['fn:real', 'Function', 'realFunction', 'src/a.js', 'javascript']);
      labels.forEach((l, i) => {
        db.run('INSERT INTO nodes (id, type, label, file_path, language) VALUES (?, ?, ?, ?, ?)',
          [`ext:${i}`, 'External', l, '', 'javascript']);
      });
    } finally { db.close(); }
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc1234', indexedAt: new Date().toISOString(), nodes: labels.length + 1, edges: 0,
      schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
      dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    }));
  };

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-stale-ext-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  });
  afterEach(async () => {
    if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* ignore */ } }
  });

  it('⛔ it speaks, and counts fragments rather than all External nodes', async () => {
    // A fail-silent path cannot be verified by observing it, so this asserts the line is PRESENT —
    // and pins the number, because "some Externals exist" is not the finding.
    await seed(['readFileSync', 'createGraph', 'entries()]', 'map((t)', 'q(db,']);
    const { summary } = await graphHealth({ repoRoot });

    expect(summary).toMatch(/stale-externals:/);
    expect(summary, 'three of the five labels are fragments').toMatch(/stale-externals: 3 External/);
    expect(summary, 'and it must name the remedy').toMatch(/graph_index\(force=true\)/);
  });

  it('⛔ IT NAMES NO CAUSE IN THE MESSAGE — the two guesses failed; the real one was found later', async () => {
    // ⛔ THE FIRST VERSION OF THIS MESSAGE SHIPPED "left by an older extractor". That was asserted,
    // never substantiated, and withdrawn. The replacement hypothesis failed too: incremental runs
    // carry forward 818 implausible targets, but 814 are IMPORTS (which never materialise as
    // External nodes) and are module specifiers like `node:fs/promises`, not fragments — only 4 are
    // CALLS, which cannot account for 334.
    //
    // ⇒ A mechanism that WOULD explain a number is not thereby the mechanism. This pins the
    // message to what is measured, so a plausible-sounding cause cannot drift back in.
    await seed(['readFileSync', 'entries()]', 'map((t)']);
    const { summary } = await graphHealth({ repoRoot });

    expect(summary, 'the measured facts must remain').toMatch(/stale-externals: 2 External/);
    // ⚠ THE WHOLE PHRASE. Asserting only /full rebuild/ let a mutant gutting the claim survive,
    // because those two words remain in the preceding template line even when the fact does not.
    expect(summary, 'the verified comparison that justifies the remedy')
      .toMatch(/full rebuild of this same commit produces none/i);
    expectAbsentWithLiveMatcher(
      /older extractor|because|caused by/i,
      {
        forbidden: 'left by an older extractor',
        allowed: 'A full rebuild of this same commit produces none.',
      },
      summary,
      'the verdict must not assert a cause nobody has established',
    );
  });

  it('⭐ NEGATIVE CONTROL: a graph of clean External names says nothing', async () => {
    // Without this the assertion above is satisfied by a verdict that always fires.
    await seed(['readFileSync', 'createGraph', 'Map', 'App\\Http\\Controllers\\Foo', 'Foo.bar']);
    const { summary } = await graphHealth({ repoRoot });
    expectAbsentWithLiveMatcher(
      /stale-externals:/,
      {
        forbidden: 'stale-externals: 3 External nodes carry parse-fragment labels',
        allowed: 'POPULATION: 2 node types — Function 1 · External 5',
      },
      summary,
      'a graph with no fragment labels must not be accused of holding residue',
    );
  });

  it('⭐ IT DISCRIMINATES: qualified and scoped names are not fragments', async () => {
    // The rule must not treat a namespaced class or a member reference as garbage — that would
    // condemn most of a PHP or C++ graph.
    await seed(['App\\Http\\Controllers\\OrderController', 'Foo::bar', 'Foo.bar', '@scoped', 'entries()]']);
    const { summary } = await graphHealth({ repoRoot });
    expect(summary, 'exactly one of the five is a fragment').toMatch(/stale-externals: 1 External/);
  });
});
