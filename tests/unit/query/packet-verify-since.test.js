import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { openDb, openExistingDb } from '../../../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import { buildVerifyPacket } from '../../../mcp/stdio/query/verbs/packet-verify.js';

function setupGitRepoWithFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-vfy-since-'));
  // Init a real git repo so `git diff` resolves.
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'tester'], { cwd: dir });
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'foo.cpp'), 'int foo(){return 1;}\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
  // Second commit modifies bar.cpp (so `since=HEAD~1` returns it).
  fs.writeFileSync(path.join(dir, 'src', 'bar.cpp'), 'int bar(){return 2;}\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'add bar'], { cwd: dir });

  // Now add the .aify-graph + import a fixture so evidence is available.
  const graphDir = path.join(dir, '.aify-graph');
  mkdirSync(graphDir, { recursive: true });
  const dbPath = path.join(graphDir, 'graph.sqlite');
  const db = openDb(dbPath); db.close();
  const tmp = path.join(os.tmpdir(), `apg-vfy-since-fix-${Date.now()}.json`);
  fs.writeFileSync(tmp, fs.readFileSync('tests/fixtures/code-intel/v02/cpp-bar-diagnostic-collection.json', 'utf8'));
  const db2 = openExistingDb(dbPath, { readonly: false });
  importCodeIntel(tmp, db2);
  db2.close();
  return dir;
}

describe('verify mode: since derivation', () => {
  it('derives files from since when files[] is empty', () => {
    const dir = setupGitRepoWithFixture();
    const packet = buildVerifyPacket({ repoRoot: dir, since: 'HEAD~1' });
    expect(packet.files).toContain('src/bar.cpp');
    expect(packet.filesDerivedFromSince).toBe(true);
    // Diagnostic from the fixture is on src/bar.cpp, which matches the derived file.
    expect(packet.diagnostics.length).toBe(1);
    expect(packet.rendered).toMatch(/src\/bar\.cpp/);
  });

  it('prefers explicit files[] over since when both are given', () => {
    const dir = setupGitRepoWithFixture();
    const packet = buildVerifyPacket({ repoRoot: dir, since: 'HEAD~1', files: ['src/foo.cpp'] });
    expect(packet.files).toEqual(['src/foo.cpp']);
    expect(packet.filesDerivedFromSince).toBe(false);
  });

  it('returns empty files when since points at an invalid ref', () => {
    const dir = setupGitRepoWithFixture();
    const packet = buildVerifyPacket({ repoRoot: dir, since: 'nope-no-such-ref' });
    expect(packet.files).toEqual([]);
    // Still emits a valid packet (no crash).
    expect(packet.rendered).toMatch(/MODE: verify/);
  });
});
