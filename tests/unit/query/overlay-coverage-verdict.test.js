// UNMAPPED IS NOT UNAFFECTED.
//
// Field report (sc-manager, Sand Castle, 2026-08-04). graph_consequences was run
// on the file at the centre of five slices and two nights of work. It returned
// features_touching [], contracts [], open_tasks [], co_consumer_files [],
// claim_count 0. The code layer was healthy — 12,130 nodes, freshly indexed.
// Every empty field was overlay-derived, and the overlay had no feature
// anchoring that subsystem at all.
//
// The agent worked that out by hand, and reported having previously internalised
// "the graph doesn't help here" without ever learning WHY it returned nothing.
// That is the cost: an empty curated field has the same shape whether the
// curation says "nothing here" or was never written, so a reader with no way to
// tell them apart eventually stops asking.
//
// field_provenance labelled those fields `inferred` already. That names where a
// field COMES FROM; it does not say the overlay has no entry for THIS target,
// and only the second fact explains the emptiness.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll } from 'vitest';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../');
const SERVER = join(REPO, 'mcp', 'stdio', 'server.js');

// ⛔ THIS TEST USED TO QUERY THE DEVELOPER'S OWN GRAPH, and that made the whole suite
// unreproducible from a clean checkout.
//
// It asked graph_consequences about two real files in THIS repo — one expected mapped, one
// unmapped — which depends entirely on `.aify-graph/functionality.json`. That directory is
// GITIGNORED. A fresh clone does not have it, so these cases fail for anyone but me.
//
// ★ Measured, not assumed: moving `.aify-graph/` aside and running the full suite gives
// 3 failures in 2 files. That is precisely the "missing repo-local overlays" that
// graph-senior-dev-hermes reported and could not reconcile with my numbers — and it means
// EVERY suite count I have quoted was a claim about MY MACHINE'S UNTRACKED STATE rather
// than about the committed code. Their refusal to accept those counts as exact-target
// evidence was correct, and better grounded than my reporting of them.
//
// ⇒ The fixture is now built by the test: one file anchored to a feature, one not. The
// property under test — a mapped target and an unmapped one give DIFFERENT verdicts — is
// unchanged, and it no longer depends on anything outside the repository.
let fixtureRoot;

async function makeFixture() {
  const repo = await mkdtemp(join(tmpdir(), 'apg-overlaycov-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  // One feature anchoring exactly one of the two files — so MAPPED and UNMAPPED are
  // properties of the fixture rather than of whoever happens to run the suite.
  await writeFile(join(repo, '.aify-graph', 'functionality.json'), JSON.stringify({
    features: [{ id: 'mapped-feature', name: 'mapped-feature', anchors: { symbols: [], files: ['src/mapped.cpp'] } }],
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  for (const [id, file] of [['m', 'src/mapped.cpp'], ['u', 'src/unmapped.cpp']]) {
    db.run(
      `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
       VALUES ($id, 'File', $file, $file, 1, 1, 'cpp', 1, '{}')`,
      { id, file },
    );
  }
  db.close();
  return repo;
}

function consequences(target) {
  const input = [
    JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'overlay-test', version: '1' } },
    }),
    JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'graph_consequences', arguments: { target, repo: fixtureRoot } },
    }),
  ].join('\n') + '\n';

  const out = execFileSync('node', [SERVER], { input, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  for (const line of out.split('\n')) {
    if (!line.startsWith('{')) continue;
    const msg = JSON.parse(line);
    if (msg.id === 2) return JSON.parse(msg.result.content[0].text);
  }
  throw new Error('no graph_consequences result');
}

describe('graph_consequences distinguishes an unmapped target from an unaffected one', () => {
  // ⚠ This comment used to read "no fixture needed, the test moves with the real map".
  // That was the defect stated as a virtue: moving with the real map meant depending on
  // an untracked file, so the test moved with MY map and nobody else's.
  const UNMAPPED = 'src/unmapped.cpp';
  const MAPPED = 'src/mapped.cpp';

  beforeAll(async () => { fixtureRoot = await makeFixture(); }, 60_000);
  afterAll(async () => { if (fixtureRoot) { try { await rm(fixtureRoot, { recursive: true, force: true }); } catch {} } });

  it('an UNMAPPED target says so, and says what the emptiness means', () => {
    const res = consequences(UNMAPPED);
    expect(res.features_touching, 'precondition: this target is unmapped').toEqual([]);

    const cov = res.overlay_coverage;
    expect(cov, 'the verdict exists at all').toBeTruthy();
    expect(cov.target_is_mapped).toBe(false);
    expect(cov.cause).toBe('no_feature_anchors_this_target');
    // The consequence must be stated, not left for the reader to derive — that
    // derivation is exactly what the field report had to do by hand.
    expect(cov.consequence).toMatch(/UNMAPPED, not that it is unaffected/);
    expect(cov.remedy, 'names the way out').toMatch(/graph-build-functionality/);
    // And it must report the map's size, so "0 of 8 features" is legible as a
    // coverage gap rather than a broken tool.
    expect(cov.overlay_features_total).toBeGreaterThan(0);
  });

  it('a MAPPED target says its empty lists are a curated claim, not a gap', () => {
    const res = consequences(MAPPED);
    expect(res.features_touching.length, 'precondition: this target is mapped').toBeGreaterThan(0);

    const cov = res.overlay_coverage;
    expect(cov.target_is_mapped).toBe(true);
    expect(cov.cause).toBeNull();
    // The freshness caveat still applies — a curated claim is only as good as
    // the day it was curated.
    expect(cov.consequence).toMatch(/overlay_age_days/);
  });

  it('the two cases are actually distinguishable from each other', () => {
    // The regression this guards: before the fix BOTH returned the same shape —
    // empty lists plus an `inferred` provenance label — so no assertion on a
    // single response could tell them apart. If a future change collapses them
    // again, this fails even if each case above still looks individually sane.
    const unmapped = consequences(UNMAPPED).overlay_coverage;
    const mapped = consequences(MAPPED).overlay_coverage;
    expect(unmapped.target_is_mapped).not.toBe(mapped.target_is_mapped);
    expect(unmapped.cause).not.toBe(mapped.cause);
  });
});
