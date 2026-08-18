// A TYPO MUST NOT BE REPORTED AS "OVERLAY NOT BUILT".
//
// ⛔ FIELD REPORT (ef-manager, f556625). On a repo with no overlay:
//     graph_packet({target: "renderPacket"})                    ← typo for renderPacketLines
//     graph_packet({target: "ZZZ_definitely_not_a_symbol_12345"})
// returned BYTE-IDENTICAL output: "OVERLAY NOT BUILT … run /graph-build-functionality".
// Control: the correctly spelled symbol returns a full packet on the same repo, so the overlay
// was never the obstacle.
//
// ★ packet.js had exactly the right message — "target X not found as feature, task, or symbol
// mapping to a feature" — and it was UNREACHABLE, because overlayRouted included `!parsed.kind`
// and a bare unresolved symbol has no kind. The comment above it said "bare symbol targets that
// genuinely resolve never reach here", which is true; the ones that DON'T resolve reach here,
// and they are the entire population the error was written for.
//
// ⚠ AND THE FIX IS NOT "SAY NOT FOUND INSTEAD". A bare target with no overlay is genuinely
// ambiguous: it may be a misspelled symbol, or a feature id whose overlay was never built. The
// tool cannot distinguish them, so it must not assert either — asserting a cause it has not
// determined is the same defect wearing different words. It names both.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphPacket } from '../../../mcp/stdio/query/verbs/packet.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

async function noOverlayRepo() {
  const repo = await mkdtemp(join(tmpdir(), 'apg-nf-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0, schemaVersion: 4,
    extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  // NO functionality.json — this is every repo before onboarding.
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
          VALUES ('n1','Function','renderPacketLines','src/render.js',10,20,'js',1,'{}')`);
  db.close();
  return repo;
}

const asText = (o) => (typeof o === 'string' ? o : JSON.stringify(o));

describe('an unresolvable target on an overlay-less repo', () => {
  it('★★★ says the target was not found — the unreachable error is reachable', async () => {
    repoRoot = await noOverlayRepo();
    const text = asText(await graphPacket({ repoRoot, target: 'renderPacket' }));
    expect(text, 'the reader mistyped a symbol; that is what they must be told')
      .toMatch(/not found/i);
    expect(text).toMatch(/renderPacket/);
  }, 20_000);

  it('★★★ ALSO names the overlay possibility, because it cannot tell them apart', async () => {
    // A bare token with no overlay may be a misspelled symbol OR a feature id. Asserting one
    // is what produced the original defect; the honest output names both.
    repoRoot = await noOverlayRepo();
    const text = asText(await graphPacket({ repoRoot, target: 'ZZZ_definitely_not_a_symbol_12345' }));
    expect(text, 'must not assert a cause it has not determined').toMatch(/not found/i);
    expect(text, 'and must still offer the overlay route').toMatch(/functionality|overlay/i);
  }, 20_000);

  it('★★ the correctly spelled symbol still returns a packet — the control', async () => {
    // ef-manager's control. Without this the tests above pass on a tool that fails everything.
    repoRoot = await noOverlayRepo();
    const text = asText(await graphPacket({ repoRoot, target: 'renderPacketLines' }));
    expect(text, 'a resolving symbol must not hit the not-found path').not.toMatch(/not found/i);
    expect(text).toMatch(/renderPacketLines/);
  }, 20_000);

  it('★★ an EXPLICIT feature: target with no overlay still says overlay not built', async () => {
    // The case the original branch was written for, which must not regress.
    repoRoot = await noOverlayRepo();
    const text = asText(await graphPacket({ repoRoot, target: 'feature:anything' }));
    expect(text).toMatch(/OVERLAY NOT BUILT/i);
  }, 20_000);
});

// ── the compiler-backed recommendation is CONDITIONAL, both ways ─────────────────────────
//
// ef-manager confirmed in the field that `NEXT: code_intel_hierarchy(...)` was emitted
// unconditionally: for JavaScript symbols, for FILE PATHS in a parameter named `symbol`, and on
// repos with no code-intel collection at all. Advice not conditioned on whether it applies costs
// the reader a call to discover it was never for them.
//
// ⚠ Both arms, because "never offer it" would be the same mistake pointed the other way — it is
// the right next verb when there IS a collection and the target IS symbol-shaped.
describe('the compiler-backed NEXT line is conditional', () => {
  it('★★★ absent when no code-intel collection exists', async () => {
    repoRoot = await noOverlayRepo();
    const text = asText(await graphPacket({ repoRoot, target: 'renderPacketLines' }));
    expect(text).not.toMatch(/code_intel_hierarchy/);
  }, 20_000);

  it('★★★ PRESENT when a collection exists and the target is symbol-shaped', async () => {
    repoRoot = await noOverlayRepo();
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.run(`INSERT INTO code_intel_collections
            (collection_id, provider, provider_version, project_root, language, status, collected_at)
            VALUES ('c1','clangd','19','.','cpp','ok','2026-08-19T00:00:00Z')`);
    db.close();
    const text = asText(await graphPacket({ repoRoot, target: 'renderPacketLines' }));
    expect(text, 'with a collection present the verb can actually answer')
      .toMatch(/code_intel_hierarchy\(symbol="renderPacketLines"/);
  }, 20_000);

  it('★★★ absent for a FILE PATH target even when a collection exists', async () => {
    // A path in a parameter named `symbol` is nonsense regardless of what is collected.
    repoRoot = await noOverlayRepo();
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.run(`INSERT INTO code_intel_collections
            (collection_id, provider, provider_version, project_root, language, status, collected_at)
            VALUES ('c1','clangd','19','.','cpp','ok','2026-08-19T00:00:00Z')`);
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('f1','File','render.js','src/render.js',1,1,'js',1,'{}')`);
    db.close();
    const text = asText(await graphPacket({ repoRoot, target: 'src/render.js' }));
    expect(text).not.toMatch(/code_intel_hierarchy/);
  }, 20_000);
});
