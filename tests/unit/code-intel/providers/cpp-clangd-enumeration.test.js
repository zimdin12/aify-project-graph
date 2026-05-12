// Plan #10: scope=all must enumerate from compile_commands.json, not fall
// back to the toy fixture. Caught by senior-dev's Sand Castle real-repo
// dogfood (2026-05-12): collect --scope all returned 0 records because the
// provider ignored scope and used hardcoded ['src/foo.cpp', 'src/bar.cpp'].
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createCppClangdProvider } from '../../../../mcp/stdio/code-intel/providers/cpp-clangd.js';

const fakeServer = path.resolve('tests/fixtures/code-intel/lsp/fake-lsp-server.mjs');
const fakeSpawn = { command: process.execPath, args: [fakeServer] };

function setupRepoWithCompileDb(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-cppenum-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (const entry of entries) {
    if (entry.file.startsWith('..')) continue; // out-of-repo, no on-disk file
    const abs = path.join(dir, entry.file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'void placeholder(){}\n');
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

describe('cpp-clangd provider: scope=all enumeration', () => {
  it('scope=all reads files from compile_commands.json', async () => {
    const dir = setupRepoWithCompileDb([
      { file: 'src/alpha.cpp' },
      { file: 'src/beta.cpp' },
      { file: 'src/gamma.cpp' }
    ]);
    const p = createCppClangdProvider({ spawn: () => fakeSpawn });
    const result = await p.collect({
      language: 'cpp',
      projectRoot: dir,
      scope: 'all',
      operations: ['symbols']
    });
    expect(result.status).toBe('ok');
    expect(result.session.warmedFiles).toBe(3);
  });

  it('scope=all filters out out-of-repo entries instead of throwing', async () => {
    const dir = setupRepoWithCompileDb([
      { file: 'src/in_repo.cpp' }
    ]);
    // Add an out-of-repo entry directly via compile_commands edit
    const cdb = JSON.parse(fs.readFileSync(path.join(dir, 'compile_commands.json'), 'utf8'));
    cdb.push({ directory: '/elsewhere', command: 'clang++ -c /elsewhere/foo.cpp', file: '/elsewhere/foo.cpp' });
    cdb.push({ directory: '/usr/include', command: 'clang++ -c /usr/include/stdio.h', file: '/usr/include/stdio.h' });
    fs.writeFileSync(path.join(dir, 'compile_commands.json'), JSON.stringify(cdb));

    const p = createCppClangdProvider({ spawn: () => fakeSpawn });
    const result = await p.collect({
      language: 'cpp',
      projectRoot: dir,
      scope: 'all',
      operations: ['symbols']
    });
    expect(result.status).toBe('ok');
    // Only the in-repo file should be warmed; the absolute out-of-repo entries are filtered.
    expect(result.session.warmedFiles).toBe(1);
  });

  it('scope=all filters non-C++ extensions like Python files', async () => {
    const dir = setupRepoWithCompileDb([
      { file: 'src/code.cpp' },
      { file: 'src/script.py' },
      { file: 'src/header.h' }
    ]);
    const p = createCppClangdProvider({ spawn: () => fakeSpawn });
    const result = await p.collect({
      language: 'cpp',
      projectRoot: dir,
      scope: 'all',
      operations: ['symbols']
    });
    expect(result.session.warmedFiles).toBe(2); // cpp + h, not py
  });

  it('scope=all dedupes repeated entries', async () => {
    const dir = setupRepoWithCompileDb([
      { file: 'src/a.cpp' },
      { file: 'src/a.cpp' },
      { file: 'src/b.cpp' }
    ]);
    const p = createCppClangdProvider({ spawn: () => fakeSpawn });
    const result = await p.collect({
      language: 'cpp',
      projectRoot: dir,
      scope: 'all',
      operations: ['symbols']
    });
    expect(result.session.warmedFiles).toBe(2);
  });

  it('explicit files[] wins over scope=all', async () => {
    const dir = setupRepoWithCompileDb([
      { file: 'src/in_db.cpp' }
    ]);
    fs.writeFileSync(path.join(dir, 'src', 'override.cpp'), 'void foo(){}\n');
    const p = createCppClangdProvider({ spawn: () => fakeSpawn });
    const result = await p.collect({
      language: 'cpp',
      projectRoot: dir,
      scope: 'all',
      files: ['src/override.cpp'],
      operations: ['symbols']
    });
    expect(result.session.warmedFiles).toBe(1);
  });
});
