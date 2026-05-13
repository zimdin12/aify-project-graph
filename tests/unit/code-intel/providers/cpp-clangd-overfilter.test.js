// Plan #10d: when build/dep prefix filter eliminates every compile_db entry
// (CMake unity-build edge case from senior-dev's Sand Castle dogfood), emit
// a structured error with hint instead of silent status=ok with 0 records.
// Tests cover both branches: error path and --no-build-filter escape hatch.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createCppClangdProvider } from '../../../../mcp/stdio/code-intel/providers/cpp-clangd.js';

const fakeServer = path.resolve('tests/fixtures/code-intel/lsp/fake-lsp-server.mjs');
const fakeSpawn = { command: process.execPath, args: [fakeServer] };

function setupRepoWithCompileDb(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-overfilter-'));
  fs.mkdirSync(path.join(dir, 'build'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'build', 'unity'), { recursive: true });
  for (const entry of entries) {
    if (entry.file.startsWith('..')) continue;
    const abs = path.join(dir, entry.file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'void unity_placeholder(){}\n');
  }
  fs.writeFileSync(
    path.join(dir, 'compile_commands.json'),
    JSON.stringify(entries.map(e => ({
      directory: dir,
      command: `clang++ -std=c++17 -c ${e.file}`,
      file: e.file
    })))
  );
  return dir;
}

describe('cpp-clangd overfilter detection (Plan #10d)', () => {
  it('emits compile_db_all_filtered error when every entry is under build/', async () => {
    const dir = setupRepoWithCompileDb([
      { file: 'build/unity/unity_0_cxx.cxx' },
      { file: 'build/unity/unity_1_cxx.cxx' },
      { file: 'build/unity/unity_2_cxx.cxx' }
    ]);
    const p = createCppClangdProvider({ spawn: () => fakeSpawn });
    const result = await p.collect({
      language: 'cpp',
      projectRoot: dir,
      scope: 'all',
      operations: ['symbols']
    });
    expect(result.status).toBe('error');
    expect(result.errors[0].code).toBe('compile_db_all_filtered');
    expect(result.errors[0].hint).toMatch(/--no-build-filter/);
    expect(result.errors[0].hint).toMatch(/--files/);
    expect(result.session.enumeration.total).toBe(3);
    expect(result.session.enumeration.filtered_build_dep).toBe(3);
    expect(result.session.enumeration.after_filter).toBe(0);
  });

  it('skipBuildDepFilter=true rescues unity-build compile DBs', async () => {
    const dir = setupRepoWithCompileDb([
      { file: 'build/unity/unity_0_cxx.cxx' },
      { file: 'build/unity/unity_1_cxx.cxx' }
    ]);
    const p = createCppClangdProvider({ spawn: () => fakeSpawn });
    const result = await p.collect({
      language: 'cpp',
      projectRoot: dir,
      scope: 'all',
      skipBuildDepFilter: true,
      operations: ['symbols']
    });
    expect(result.status).toBe('ok');
    expect(result.session.warmedFiles).toBe(2);
    expect(result.session.enumeration.skipped_build_dep_filter).toBe(true);
    expect(result.session.enumeration.filtered_build_dep).toBe(0);
  });

  it('no error when at least one entry survives the filter', async () => {
    const dir = setupRepoWithCompileDb([
      { file: 'src/keep.cpp' },
      { file: 'build/unity/unity_0_cxx.cxx' }
    ]);
    const p = createCppClangdProvider({ spawn: () => fakeSpawn });
    const result = await p.collect({
      language: 'cpp',
      projectRoot: dir,
      scope: 'all',
      operations: ['symbols']
    });
    expect(result.status).toBe('ok');
    expect(result.session.warmedFiles).toBe(1);
    expect(result.session.enumeration.filtered_build_dep).toBe(1);
  });

  it('skipBuildDepFilter does not affect non-cpp extension filtering or out-of-repo filtering', async () => {
    const dir = setupRepoWithCompileDb([
      { file: 'build/code.cpp' }
    ]);
    // Inject a non-cpp file via compile_commands edit
    const cdb = JSON.parse(fs.readFileSync(path.join(dir, 'compile_commands.json'), 'utf8'));
    cdb.push({ directory: dir, command: 'python3 build/script.py', file: 'build/script.py' });
    fs.writeFileSync(path.join(dir, 'compile_commands.json'), JSON.stringify(cdb));

    const p = createCppClangdProvider({ spawn: () => fakeSpawn });
    const result = await p.collect({
      language: 'cpp',
      projectRoot: dir,
      scope: 'all',
      skipBuildDepFilter: true,
      operations: ['symbols']
    });
    expect(result.session.warmedFiles).toBe(1);
  });
});
