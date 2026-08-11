// A PACKET THAT RESOLVES TO A FEATURE MUST STILL SAY WHERE THE SYMBOL IS.
//
// Field report (sc-manager / sc-coder, Sand Castle, 2026-08-09) from a real
// 223-member status-object census in a 50k-line header set: graph_packet on a
// symbol returned the broad owning feature and omitted the declaring file.
// graph_whereis recovered it instantly at game/UnifiedFluidRuntime.h:378.
//
// The branches were inverted. DEFINED IN was emitted only by the symbol-pointer
// packet — the path taken when the symbol maps to NO feature, i.e. when the
// packet can say least. As soon as a feature resolved, the packet gained
// authority and lost the line saying where the thing is. Their verdict: worse
// than returning nothing, because it looks like an answer.
//
// ★★ CONVERTED FROM SOURCE-GREP 2026-08-11.
//
// The previous version sliced packet.js by BYTE OFFSET — `src.slice(i - 1600, i + 900)`
// around the string 'MATCHED VIA: symbol' — and asserted two regexes fell inside that
// window. That is the most brittle shape in this suite: add 200 characters of comment
// anywhere above the branch and the window slides off the code it meant to check, going
// green or red for reasons that have nothing to do with the defect. It also could not see
// the FILE — the one thing sc-coder actually needed and did not get.
//
// The fixture reproduces their case: a symbol that DOES resolve to a feature. The
// assertion is that the declaring file comes back with it.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphPacket } from '../../../mcp/stdio/query/verbs/packet.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;

// `anchored` decides which branch runs: with the symbol in a feature's anchors the packet
// resolves a FEATURE (the reported defect's path); without it, the symbol-pointer path.
async function makeRepo({ anchored }) {
  const repo = await mkdtemp(join(tmpdir(), 'apg-symloc-'));
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
    features: [{
      id: 'fluid-runtime',
      name: 'fluid-runtime',
      anchors: { symbols: anchored ? ['FluidRuntimeStatus'] : ['somethingElse'], files: [] },
    }],
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  // The exact location from the field report. A packet that names the feature but not
  // this line is the failure sc-coder hit.
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ('frs', 'Struct', 'FluidRuntimeStatus', 'game/UnifiedFluidRuntime.h', 378, 402, 'cpp', 1, '{}')`,
  );
  db.close();
  return repo;
}

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
  repoRoot = undefined;
});

const asText = (o) => (typeof o === 'string' ? o : JSON.stringify(o));

describe('symbol-derived packets carry the symbol location', () => {
  it('★★ a symbol that resolves to a FEATURE still reports its declaring file', async () => {
    // The defect exactly. The old test could assert a regex sits near a branch; only
    // running the verb can assert the file comes back.
    repoRoot = await makeRepo({ anchored: true });
    const text = asText(await graphPacket({ repoRoot, target: 'FluidRuntimeStatus' }));

    expect(text, 'harness sanity: the fixture must take the feature-match path').toMatch(/fluid-runtime/);
    expect(text, 'the declaring file is the thing that went missing').toMatch(/game\/UnifiedFluidRuntime\.h/);
    expect(text, 'and the line, which is what made graph_whereis the faster call').toMatch(/378/);
  }, 20_000);

  it('★ labels the location as the SYMBOL\'s, not the feature\'s', async () => {
    // Under a FEATURE header a bare "DEFINED IN" reads as the feature's files. The
    // reader asked about a symbol and must be able to tell which one they are looking at.
    repoRoot = await makeRepo({ anchored: true });
    const text = asText(await graphPacket({ repoRoot, target: 'FluidRuntimeStatus' }));

    expect(text).toMatch(/the symbol you asked for, not the feature/);
  }, 20_000);

  it('★ the no-feature path did not LOSE its location when the other gained one', async () => {
    // Guards the fix-by-moving failure mode the original named: the symbol-pointer path
    // is the one that was always right, so it must still be right.
    repoRoot = await makeRepo({ anchored: false });
    const text = asText(await graphPacket({ repoRoot, target: 'FluidRuntimeStatus' }));

    expect(text, 'harness sanity: this fixture must NOT resolve a feature').not.toMatch(/MATCHED VIA/);
    expect(text, 'the unmapped path still knows where the symbol is').toMatch(/game\/UnifiedFluidRuntime\.h/);
  }, 20_000);
});
