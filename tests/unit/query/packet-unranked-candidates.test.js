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
});
