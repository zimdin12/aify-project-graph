// Plan #5b: EVIDENCE block injection into non-verify modes.
// Senior-dev gates: only through packet-evidence renderer; respect existing
// token budget (tail-clamp); non-regression across all modes; A/B against
// known symbol-fallback shape.
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { graphPacket } from '../../../mcp/stdio/query/verbs/packet.js';
import { openDb, openExistingDb } from '../../../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../../../mcp/stdio/ingest/code-intel/importer.js';

function git(repo, ...args) {
  execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
}

async function freshRepoWithFeature(fixtureName) {
  const repo = await mkdtemp(join(tmpdir(), 'apg-evinj-'));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  git(repo, 'commit', '--allow-empty', '-m', 'init');
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  await writeFile(
    join(repo, '.aify-graph', 'functionality.json'),
    JSON.stringify({ version: '0.1', features: [{ id: 'feat-x', name: 'Feature X', summary: 'demo', anchors: { files: ['src/foo.cpp'] }, dependents: { features: [], tests: [], contracts: [] } }] })
  );
  await writeFile(join(repo, '.aify-graph', 'tasks.json'), JSON.stringify({ tasks: [] }));
  await writeFile(
    join(repo, '.aify-graph', 'brief.json'),
    JSON.stringify({ graph_indexed_at: new Date().toISOString(), graph_commit: 'abc', repo: { unresolved_edges: 50 }, features: { valid: [] } })
  );
  await writeFile(
    join(repo, '.aify-graph', 'manifest.json'),
    JSON.stringify({ commit: 'abc', indexedAt: new Date().toISOString(), schemaVersion: 4 })
  );
  // Initialize the graph SQLite so collection import can land.
  const dbPath = join(repo, '.aify-graph', 'graph.sqlite');
  const db = openDb(dbPath); db.close();
  if (fixtureName) {
    const tmp = join(tmpdir(), `apg-evinj-fix-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(tmp, fs.readFileSync(`tests/fixtures/code-intel/v02/${fixtureName}`, 'utf8'));
    const db2 = openExistingDb(dbPath, { readonly: false });
    importCodeIntel(tmp, db2);
    db2.close();
  }
  return repo;
}

const NON_VERIFY_MODES = ['orient', 'plan', 'debug', 'review', 'audit'];

describe('EVIDENCE injection into non-verify modes', () => {
  for (const mode of NON_VERIFY_MODES) {
    it(`${mode}: appends EVIDENCE line when code-intel collection is present`, async () => {
      const dir = await freshRepoWithFeature('cpp-basic-collection.json');
      const out = await graphPacket({ repoRoot: dir, target: 'feature:feat-x', mode });
      expect(typeof out).toBe('string');
      expect(out).toMatch(/EVIDENCE:/);
      expect(out).toMatch(/cpp-clangd/);
    });

    it(`${mode}: appends explicit unavailable line when no collection exists`, async () => {
      const dir = await freshRepoWithFeature();
      const out = await graphPacket({ repoRoot: dir, target: 'feature:feat-x', mode });
      expect(out).toMatch(/code_intel unavailable/);
    });
  }

  it('verify mode bypasses non-verify injection (no double-EVIDENCE)', async () => {
    const dir = await freshRepoWithFeature('cpp-basic-collection.json');
    const out = await graphPacket({ repoRoot: dir, mode: 'verify', files: ['src/bar.cpp'] });
    const matches = out.match(/EVIDENCE:/g) || [];
    expect(matches.length).toBeLessThanOrEqual(1);
    expect(out).toMatch(/MODE: verify/);
  });

  it('budget clamp drops EVIDENCE tail when budget is very small', async () => {
    const dir = await freshRepoWithFeature('cpp-basic-collection.json');
    const out = await graphPacket({ repoRoot: dir, target: 'feature:feat-x', mode: 'plan', budget: 30 });
    expect(out.length).toBeLessThan(900);
  });

  it('A/B: with-code-intel vs baseline — provider name surfaces, length stays controlled', async () => {
    const baselineDir = await freshRepoWithFeature();
    const ciDir = await freshRepoWithFeature('cpp-basic-collection.json');
    const baseline = await graphPacket({ repoRoot: baselineDir, target: 'feature:feat-x', mode: 'plan' });
    const withCi = await graphPacket({ repoRoot: ciDir, target: 'feature:feat-x', mode: 'plan' });
    expect(withCi).toMatch(/cpp-clangd/);
    expect(baseline).toMatch(/code_intel unavailable/);
    // Token guard from senior-dev: budget non-regression. CI variant should
    // not explode token count vs baseline.
    expect(withCi.length).toBeLessThan(baseline.length + 400);
  });
});
