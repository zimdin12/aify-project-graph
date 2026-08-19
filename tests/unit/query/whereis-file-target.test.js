// TWO VERBS, ONE NODE, OPPOSITE ANSWERS ON WHETHER IT EXISTS.
//
// ⛔ FIELD REPORT (ef-manager). graph_whereis(symbol: "engine/rendering/GpuMaterialPalette.h")
// returned "NO MATCH", while graph_packet resolved the same path fine. Both verbs, same repo,
// same node, contradicting each other about existence.
//
// ★ whereis is not wrong to decline: it answers "where is this SYMBOL defined", and a file path
// is not a symbol — it matches on `label` over declaration types, and a File node is neither.
// The defect is the ANSWER IT GIVES. "NO MATCH" states a fact about the repository; the true
// fact is about the QUESTION — the thing exists, and it is not the kind of thing this verb
// finds. A reader told "no match" concludes the file is unindexed and goes looking for a
// problem that is not there.
//
// ⇒ Recognise the shape mismatch and say so, without widening the verb's contract to resolve
// paths. Declining is right; declining while implying absence is not.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphWhereis } from '../../../mcp/stdio/query/verbs/whereis.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

async function repoWithFile() {
  const repo = await mkdtemp(join(tmpdir(), 'apg-wf-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0, schemaVersion: 4,
    extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
          VALUES ('f1','File','GpuMaterialPalette.h','engine/rendering/GpuMaterialPalette.h',1,1,'cpp',1,'{}')`);
  db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
          VALUES ('s1','Class','GpuMaterial','engine/rendering/GpuMaterialPalette.h',30,60,'cpp',1,'{}')`);
  db.close();
  return repo;
}

describe('graph_whereis given a file path', () => {
  it('★★★ does not claim the file is absent when it is indexed', async () => {
    repoRoot = await repoWithFile();
    const out = await graphWhereis({ repoRoot, symbol: 'engine/rendering/GpuMaterialPalette.h' });
    expect(out, 'the file IS in the graph; "NO MATCH" is a false statement about the repo')
      .not.toMatch(/NO MATCH/);
  }, 20_000);

  it('★★★ says it is a file and names the verb that answers path questions', async () => {
    repoRoot = await repoWithFile();
    const out = await graphWhereis({ repoRoot, symbol: 'engine/rendering/GpuMaterialPalette.h' });
    expect(out, 'the reader must learn WHY this verb declined').toMatch(/file/i);
    expect(out, 'and where to go instead').toMatch(/graph_packet|graph_pull|graph_file/);
  }, 20_000);

  it('★★★ a real symbol still resolves — the control', async () => {
    // Without this the checks above are satisfied by a verb that declines everything.
    repoRoot = await repoWithFile();
    const out = await graphWhereis({ repoRoot, symbol: 'GpuMaterial' });
    expect(out).toMatch(/GpuMaterial/);
    expect(out).not.toMatch(/looks like a file path/i);
  }, 20_000);

  it('★★ a genuinely unknown symbol still says NO MATCH', async () => {
    // The path shape must not become an excuse to stop reporting real absence.
    repoRoot = await repoWithFile();
    const out = await graphWhereis({ repoRoot, symbol: 'NoSuchSymbolAnywhere' });
    expect(out).toMatch(/NO MATCH|no match/i);
  }, 20_000);
});

// ── the file-path packet contradicted itself ─────────────────────────────────────────────
//
// ⛔ FIELD REPORT. graph_packet on a file path rendered:
//     SYMBOL: mcp/stdio/query/verbs/packet.js
//     DEFINED IN: none
//     ALSO IN — showing 1 of 1:
//     - mcp/stdio/query/verbs/packet.js
// Three statements that cannot all be sensible together: the target is called a SYMBOL, said to
// be defined nowhere, and then listed as a place it appears. ef-manager: "reads as a bug in the
// tool", and they are right — a reader cannot tell whether the packet failed or the repo is odd.
//
// ★ A file is not defined anywhere; it IS somewhere. So the label is wrong, the DEFINED IN
// question does not apply, and listing the target as a place the target appears is noise.
import { graphPacket } from '../../../mcp/stdio/query/verbs/packet.js';

describe('a file-path target describes itself as a file', () => {
  it('★★★ is labelled FILE, not SYMBOL', async () => {
    repoRoot = await repoWithFile();
    const out = await graphPacket({ repoRoot, target: 'engine/rendering/GpuMaterialPalette.h' });
    expect(out, 'a path is not a symbol and calling it one is where the confusion starts')
      .not.toMatch(/^SYMBOL: engine/m);
    expect(out).toMatch(/^FILE: engine\/rendering\/GpuMaterialPalette\.h/m);
  }, 20_000);

  it('★★★ does not ask where a file is DEFINED', async () => {
    repoRoot = await repoWithFile();
    const out = await graphPacket({ repoRoot, target: 'engine/rendering/GpuMaterialPalette.h' });
    expect(out, 'a file has no definition site; "DEFINED IN: none" invites a wrong conclusion')
      .not.toMatch(/DEFINED IN/);
  }, 20_000);

  it('★★★ does not list the target as a place the target appears', async () => {
    repoRoot = await repoWithFile();
    const out = await graphPacket({ repoRoot, target: 'engine/rendering/GpuMaterialPalette.h' });
    const alsoIn = out.split('\n').filter((l) => l.startsWith('- '));
    expect(alsoIn, 'the file listing itself is noise, and under a population it is a wrong count')
      .not.toContain('- engine/rendering/GpuMaterialPalette.h');
  }, 20_000);

  it('★★ a real symbol packet is unchanged — the control', async () => {
    repoRoot = await repoWithFile();
    const out = await graphPacket({ repoRoot, target: 'GpuMaterial' });
    expect(out).toMatch(/^SYMBOL: GpuMaterial/m);
  }, 20_000);

  it('★★★ does not put a file path in a SYMBOLS parameter', async () => {
    // Same class as the clangd line, one verb over — found while verifying the fix above
    // rather than reported. graph_explore takes symbols; a path is the wrong argument for it.
    repoRoot = await repoWithFile();
    const out = await graphPacket({ repoRoot, target: 'engine/rendering/GpuMaterialPalette.h' });
    expect(out).not.toMatch(/graph_explore\(symbols=\["engine/);
    // ⚠ THIS ASSERTION USED TO PIN `graph_file(path=`, AND THE PIN WAS ITSELF A DEFECT: that
    // verb is not in the default tools/list profile, so the "correct" behaviour it enforced was
    // to name a door most readers cannot open. A wording ratchet outlives the reason it was
    // written for; what this test is FOR is that a path never lands in a symbols parameter and
    // that the reader is not handed an unreachable or repeated suggestion.
    const nexts = out.split('\n').filter((l) => l.startsWith('NEXT:'));
    expect(new Set(nexts).size, 'a repeated NEXT line wastes the slot and reads as a tool bug')
      .toBe(nexts.length);
    expect(out, 'a path target must still be offered a verb that accepts a path')
      .toMatch(/graph_pull\(node="engine/);
  }, 20_000);

  it('★★ a symbol target still gets graph_explore — the control', async () => {
    repoRoot = await repoWithFile();
    const out = await graphPacket({ repoRoot, target: 'GpuMaterial' });
    expect(out).toMatch(/graph_explore\(symbols=\["GpuMaterial"\]/);
  }, 20_000);
});
