// AN UNRANKED LIST THAT LOOKS RANKED SENDS THE READER TO THE WRONG ONE.
//
// The symbol-pointer packet lists candidates in arrival order. A reader sees a list with
// a first item and assumes the first item is the best match — on echoes, that was a GLSL
// shader mirror while the C++ declaration sat further down. So the list must say that its
// order carries no signal, and point at the verb that does rank.
//
// ★★ CONVERTED FROM SOURCE-GREP 2026-08-11.
//
// Mutation had already shown 3 of 4 cases were real, but all four asserted TEMPLATE TEXT
// (`showing ${SHOWN} of ${symHits.length}`, `symHits.length > 1`) — they pin the
// expression that builds the message, not the message. Rename a local or reflow the
// template and they go red having found nothing, which is exactly what happened to three
// other tests in this repo the same day.
//
// The properties are observable in the output, so they are asserted there.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphPacket } from '../../../mcp/stdio/query/verbs/packet.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;

async function makeRepo(defCount) {
  const repo = await mkdtemp(join(tmpdir(), 'apg-unranked-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  // A minimal overlay: without one the packet short-circuits with OVERLAY NOT BUILT and
  // never reaches the symbol-pointer path at all. The feature is deliberately unrelated
  // to the target, so the candidate list is still the thing under test.
  await writeFile(join(repo, '.aify-graph', 'functionality.json'), JSON.stringify({
    features: [{ id: 'unrelated', name: 'unrelated', anchors: { symbols: ['somethingElse'], files: [] } }],
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  for (let i = 0; i < defCount; i += 1) {
    db.run(
      `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
       VALUES ($id, 'Class', 'GpuMaterial', $file, 10, 20, 'glsl', 1, '{}')`,
      { id: `n${i}`, file: `engine/shaders/mirror_${i}.glsl` },
    );
  }
  db.close();
  return repo;
}

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
  repoRoot = undefined;
});

const asText = (o) => (typeof o === 'string' ? o : JSON.stringify(o));

describe('the symbol-pointer packet is honest about its candidate list', () => {
  it('★★ announces UNRANKED and names the verb that does rank', async () => {
    repoRoot = await makeRepo(9);
    const text = asText(await graphPacket({ repoRoot, target: 'GpuMaterial' }));

    expect(text, 'harness sanity: many definitions must produce a candidate list').toMatch(/GpuMaterial/);
    expect(text).toMatch(/UNRANKED/);
    expect(text, 'the reason matters — a first item reads as a best match').toMatch(/order is arrival, not relevance/);
    expect(text, 'a warning with no next move leaves the reader stuck').toMatch(/graph_whereis\(symbol=/);
  }, 20_000);

  it('★★ any count it prints is the REAL count, never a cap', async () => {
    // The property, stated so it holds on whichever branch renders. Nine definitions
    // exist; every integer the packet prints about them must be nine, or must be
    // accompanied by an explicit n-of-m disclosure. A bare "(3 matches)" is a cap
    // reported as a total — the defect ef-manager found in symbol_lookup's candidate
    // list, and the reason `matched.symbols_total` now exists upstream.
    repoRoot = await makeRepo(9);
    const text = asText(await graphPacket({ repoRoot, target: 'GpuMaterial' }));

    const bare = text.match(/UNRANKED \((\d+) matches\)/);
    if (bare) {
      expect(Number(bare[1]), 'a bare match count must be the true total, not a cap').toBe(9);
    } else {
      const nOfM = text.match(/showing (\d+) of (\d+)/i);
      expect(nOfM, 'if not the true total, it must disclose n of m').toBeTruthy();
      expect(Number(nOfM[2]), 'the m must be the true total').toBe(9);
    }
  }, 20_000);

  it('★ warns even when NOTHING was truncated but the match is still ambiguous', async () => {
    // The case the old file named and could not exercise. Two definitions fit inside any
    // cap, so nothing is omitted — but the order still carries no signal, and a reader
    // picking the first is still guessing.
    repoRoot = await makeRepo(2);
    const text = asText(await graphPacket({ repoRoot, target: 'GpuMaterial' }));

    expect(text, 'ambiguity without truncation must still warn').toMatch(/UNRANKED/);
    expect(text, 'and must not claim a truncation that did not happen').not.toMatch(/showing \d+ of \d+/i);
  }, 20_000);

  // ★★ ADDED 2026-08-12 after ef-manager tested the fix on real echoes and found it did
  // not reach their case. `GpuMaterial` MAPS TO A FEATURE, so the packet takes the
  // MATCHED VIA branch — which has its own independent `.slice(0, 3)` that my first fix
  // never touched. Sixteen definitions, three shown, no count and no marker.
  //
  // Their ground truth: `git grep 'struct GpuMaterial'` → 16, being 1 C++ header and 15
  // GLSL shaders on a shared std430 stride. The 13 the cap hid are the exact mirrors an
  // ABI change must touch. ⇒ The count is not metadata here; the count IS the finding.
  describe('the FEATURE-matched branch caps too, and it was the silent one', () => {
    const mirrored = async () => {
      const repo = await mkdtemp(join(tmpdir(), 'apg-mirror-'));
      await mkdir(join(repo, '.aify-graph'), { recursive: true });
      execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
      execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
      const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
        commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
        schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
        dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
      }));
      // ANCHORED, so a feature resolves and the MATCHED VIA branch runs. This is the only
      // difference from the fixture above, and it is the whole reason the defect survived.
      await writeFile(join(repo, '.aify-graph', 'functionality.json'), JSON.stringify({
        features: [{ id: 'material-palette', name: 'material-palette', anchors: { symbols: ['GpuMaterial'], files: [] } }],
      }));
      const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
      db.run(
        `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
         VALUES ('h', 'Class', 'GpuMaterial', 'engine/rendering/GpuMaterialPalette.h', 30, 60, 'cpp', 1, '{}')`,
      );
      for (let i = 0; i < 15; i += 1) {
        db.run(
          `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
           VALUES ($id, 'Class', 'GpuMaterial', $file, 27, 40, 'glsl', 1, '{}')`,
          { id: `g${i}`, file: `engine/rendering/shaders/mirror_${i}.comp.glsl` },
        );
      }
      db.close();
      return repo;
    };

    it('★★ states 16, not a silent 3', async () => {
      repoRoot = await mirrored();
      const text = asText(await graphPacket({ repoRoot, target: 'GpuMaterial' }));

      expect(text, 'harness sanity: this fixture must take the feature branch').toMatch(/MATCHED VIA/);
      expect(text, 'a sampled list must say it is sampled').toMatch(/showing 3 of 16/);
    }, 20_000);

    it('★★ breaks the total down by language, because the spread IS the hazard', async () => {
      repoRoot = await mirrored();
      const text = asText(await graphPacket({ repoRoot, target: 'GpuMaterial' }));

      // Two lines that communicate the ABI hazard completely and do not depend on the cap.
      expect(text).toMatch(/ALL 16 BY LANGUAGE/);
      expect(text).toMatch(/glsl 15/);
      expect(text).toMatch(/cpp 1/);
    }, 20_000);

    it('★★ names the cross-language duplicate as a FINDING, as consequences already does', async () => {
      // Two verbs, one repo, one symbol, opposite treatment was the real defect.
      repoRoot = await mirrored();
      const text = asText(await graphPacket({ repoRoot, target: 'GpuMaterial' }));

      expect(text).toMatch(/CROSS-LANGUAGE DUPLICATE/);
      expect(text, 'and points at the verb that lists them all').toMatch(/graph_whereis\(symbol="GpuMaterial"\)/);
    }, 20_000);

    it('★ says none of that when the symbol is defined once', async () => {
      // A marker that always fires is not a marker. Guards the case above from passing
      // for a packet that unconditionally cries duplicate.
      const repo = await mkdtemp(join(tmpdir(), 'apg-single-'));
      await mkdir(join(repo, '.aify-graph'), { recursive: true });
      execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
      execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
      const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
        commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
        schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
        dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
      }));
      await writeFile(join(repo, '.aify-graph', 'functionality.json'), JSON.stringify({
        features: [{ id: 'material-palette', name: 'material-palette', anchors: { symbols: ['GpuMaterial'], files: [] } }],
      }));
      const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
      db.run(
        `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
         VALUES ('h', 'Class', 'GpuMaterial', 'engine/rendering/GpuMaterialPalette.h', 30, 60, 'cpp', 1, '{}')`,
      );
      db.close();
      repoRoot = repo;
      const text = asText(await graphPacket({ repoRoot, target: 'GpuMaterial' }));

      expect(text, 'nothing was sampled').not.toMatch(/showing \d+ of/);
      expect(text, 'and one definition is not a cross-language mirror').not.toMatch(/CROSS-LANGUAGE DUPLICATE/);
    }, 20_000);
  });

  // ★★ ADDED 2026-08-12 from graph-senior-dev-hermes's review, and it is the sharpest
  // finding of the round: the number I introduced TO FIX a cap-as-total defect was ITSELF
  // a cap reported as a total. `resolveSymbol` ends every query with LIMIT 50, so
  // `nodes.length` maxes out at 50 — their probe inserted 60 definitions and the packet
  // answered "showing 3 of 50".
  //
  // ⇒ Same class, one level upstream, introduced by the fix for the class. Sixty is over
  // the retrieval cap on purpose; a 9-node fixture cannot see this and mine did not.
  describe('the TOTAL is the population, not the retrieval limit', () => {
    it('★★ reports 60, not the LIMIT 50 that fetched the rows', async () => {
      const repo = await mkdtemp(join(tmpdir(), 'apg-over50-'));
      await mkdir(join(repo, '.aify-graph'), { recursive: true });
      execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
      execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
      const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
        commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
        schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
        dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
      }));
      await writeFile(join(repo, '.aify-graph', 'functionality.json'), JSON.stringify({
        features: [{ id: 'material-palette', name: 'material-palette', anchors: { symbols: ['GpuMaterial'], files: [] } }],
      }));
      const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
      for (let i = 0; i < 60; i += 1) {
        db.run(
          `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
           VALUES ($id, 'Class', 'GpuMaterial', $file, 10, 20, 'glsl', 1, '{}')`,
          { id: `n${i}`, file: `engine/shaders/mirror_${i}.glsl` },
        );
      }
      db.close();
      repoRoot = repo;
      const text = asText(await graphPacket({ repoRoot, target: 'GpuMaterial' }));

      expect(text, 'the population, counted — not the page that was fetched').toMatch(/showing 3 of 60/);
      expect(text, 'the retrieval limit must never surface as the total').not.toMatch(/of 50\b/);
    }, 30_000);
  });
});
