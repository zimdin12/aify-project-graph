import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import { codeIntelAnalyze } from '../../../mcp/stdio/query/verbs/code_intel_analyze.js';

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-analyze-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'bad.cpp'), 'int main() { return missing(); }\n');
  fs.writeFileSync(path.join(dir, 'compile_commands.json'), JSON.stringify([
    {
      directory: dir,
      command: `/usr/bin/c++ -Iinclude -o CMakeFiles/bad.o -c ${path.join(dir, 'src', 'bad.cpp')}`,
      file: path.join(dir, 'src', 'bad.cpp')
    }
  ]));
  return dir;
}

function fakeSpawn({ stdout = '', stderr = '', exitCode = 0, calls }) {
  return (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    process.nextTick(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', exitCode);
    });
    return child;
  };
}

describe('code_intel_analyze', () => {
  it('runs clang-tidy for explicit files and returns structured diagnostics', async () => {
    const repoRoot = tmpRepo();
    const calls = [];
    const result = await codeIntelAnalyze({
      repoRoot,
      mode: 'clang-tidy',
      files: ['src/bad.cpp'],
      spawn: fakeSpawn({
        calls,
        stderr: `${path.join(repoRoot, 'src', 'bad.cpp')}:1:21: error: use of undeclared identifier 'missing' [clang-diagnostic-error]\n`,
        exitCode: 1
      })
    });

    expect(result.status).toBe('ok');
    expect(result.mode).toBe('clang-tidy');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      file: 'src/bad.cpp',
      severity: 'error',
      line: 1,
      col: 21,
      provenance: 'CLANG_TIDY'
    });
    expect(result.summary.errors).toBe(1);
    expect(calls[0].command).toBe('clang-tidy');
    expect(calls[0].args).toContain('-p');
    expect(calls[0].args).toContain(repoRoot);
  });

  it('runs compile syntax checks from compile_commands.json with destructive flags removed', async () => {
    const repoRoot = tmpRepo();
    const calls = [];
    const result = await codeIntelAnalyze({
      repoRoot,
      mode: 'compile',
      files: ['src/bad.cpp'],
      spawn: fakeSpawn({
        calls,
        stderr: `${path.join(repoRoot, 'src', 'bad.cpp')}:1:21: error: use of undeclared identifier 'missing'\n`,
        exitCode: 1
      })
    });

    expect(result.status).toBe('ok');
    expect(result.mode).toBe('compile');
    expect(result.diagnostics[0]).toMatchObject({
      file: 'src/bad.cpp',
      severity: 'error',
      provenance: 'BUILD'
    });
    expect(calls[0].command).toBe('/usr/bin/c++');
    expect(calls[0].args).toContain('-fsyntax-only');
    expect(calls[0].args).not.toContain('-c');
    expect(calls[0].args).not.toContain('-o');
    expect(calls[0].args).not.toContain('CMakeFiles/bad.o');
  });

  it('allows clang-tidy fallback when a file has no exact compile DB entry', async () => {
    const repoRoot = tmpRepo();
    fs.writeFileSync(path.join(repoRoot, 'src', 'orphan.cpp'), 'int orphan() { return 0; }\n');
    const calls = [];
    const result = await codeIntelAnalyze({
      repoRoot,
      mode: 'clang-tidy',
      files: ['src/orphan.cpp'],
      spawn: fakeSpawn({ calls, exitCode: 0 })
    });

    expect(result.status).toBe('ok');
    expect(result.files[0]).toMatchObject({
      file: 'src/orphan.cpp',
      status: 'ok',
      provenance: 'CLANG_TIDY'
    });
    expect(calls[0].command).toBe('clang-tidy');
    expect(calls[0].args).toContain(path.join(repoRoot, 'src', 'orphan.cpp'));
  });

  it('is explicit-file-only and reports compile DB misses clearly', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-analyze-missing-'));
    const noFiles = await codeIntelAnalyze({ repoRoot, files: [] });
    expect(noFiles.status).toBe('error');
    expect(noFiles.errors[0].code).toBe('files_required');

    const missingDb = await codeIntelAnalyze({
      repoRoot,
      files: ['src/missing.cpp'],
      spawn: fakeSpawn({ calls: [] })
    });
    expect(missingDb.status).toBe('error');
    expect(missingDb.errors[0].code).toBe('compile_db_missing');
  });
});
