import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { codeIntelAnalyze } from '../../../mcp/stdio/query/verbs/code_intel_analyze.js';

// DEFECT 5, found in the field on sand_castle 2026-08-25: code_intel_analyze carried its OWN
// compile-DB discovery — a four-entry hardcoded list (root, build/, build-linux/,
// cmake-build-debug/). sand_castle's two DBs live in build-clangd-native/ and build-win-clangd/,
// so analyze reported compile_db_missing while two databases sat in the repo. It also ignored
// APG_COMPILE_DB and the normalized DB that `doctor` itself had written.

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-analyze-db-'));
  fs.mkdirSync(path.join(dir, 'sim'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sim', 'real.cpp'), 'void relax(){}\n');
  return dir;
}

function writeDb(repo, dirName, { compiler = 'clang-cl.exe', directory = null } = {}) {
  const dbDir = path.join(repo, dirName);
  fs.mkdirSync(dbDir, { recursive: true });
  const file = path.join(repo, 'sim', 'real.cpp').replace(/\\/g, '/');
  fs.writeFileSync(path.join(dbDir, 'compile_commands.json'), JSON.stringify([
    { directory: directory ?? repo, file, command: `${compiler} -c ${file}` },
  ]));
  return dbDir;
}

// A compiler that runs, says nothing, and exits 0 — so the test exercises DISCOVERY, not clang.
function fakeSpawn() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setImmediate(() => child.emit('close', 0));
  return child;
}

describe('code_intel_analyze compile-DB discovery', () => {
  let repo;
  const savedPin = process.env.APG_COMPILE_DB;
  beforeEach(() => { repo = makeRepo(); delete process.env.APG_COMPILE_DB; });
  afterEach(() => {
    if (savedPin === undefined) delete process.env.APG_COMPILE_DB;
    else process.env.APG_COMPILE_DB = savedPin;
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch {}
  });

  it('finds a DB in build-clangd-native — not on the old four-entry list', async () => {
    // THE BUG: this returned compile_db_missing with the database sitting right there.
    writeDb(repo, 'build-clangd-native');
    const res = await codeIntelAnalyze({
      repoRoot: repo, mode: 'compile', files: ['sim/real.cpp'], spawn: fakeSpawn,
    });
    expect(res.status).not.toBe('error');
  });

  it('honours APG_COMPILE_DB, our own documented escape hatch, which analyze ignored', async () => {
    const dbDir = writeDb(repo, 'some-unusual-name');
    process.env.APG_COMPILE_DB = dbDir;
    const res = await codeIntelAnalyze({
      repoRoot: repo, mode: 'compile', files: ['sim/real.cpp'], spawn: fakeSpawn,
    });
    expect(res.status).not.toBe('error');
  });

  it('⭐ a real source and a fabricated one no longer return identical output', async () => {
    // THE CONSEQUENCE THAT MATTERED MOST. Under compile_db_missing both returned byte-identical
    // errors, so the verb could not distinguish PRESENT from ABSENT and carried zero information.
    writeDb(repo, 'build-clangd-native');
    const real = await codeIntelAnalyze({
      repoRoot: repo, mode: 'compile', files: ['sim/real.cpp'], spawn: fakeSpawn,
    });
    const fabricated = await codeIntelAnalyze({
      repoRoot: repo, mode: 'compile', files: ['sim/ZzzNotARealSource.cpp'], spawn: fakeSpawn,
    });
    expect(JSON.stringify(real.files)).not.toBe(JSON.stringify(fabricated.files));
    expect(fabricated.files[0].reason).toBe('compile_entry_missing');
    expect(real.files[0].status).toBe('ok');
  });

  it('still reports compile_db_missing when there genuinely is no DB — the negative control', async () => {
    const res = await codeIntelAnalyze({
      repoRoot: repo, mode: 'compile', files: ['sim/real.cpp'], spawn: fakeSpawn,
    });
    expect(res.status).toBe('error');
    expect(res.errors[0].code).toBe('compile_db_missing');
  });

  it('surfaces toolchain_mismatch with the result instead of a clean-looking analyze', async () => {
    // A DB clangd cannot compile yields quiet diagnostics that mean nothing. Quiet must not read
    // as OK — this is the green null this repo keeps re-finding.
    writeDb(repo, 'build-msvc', { compiler: 'cl.exe' });
    const res = await codeIntelAnalyze({
      repoRoot: repo, mode: 'compile', files: ['sim/real.cpp'], spawn: fakeSpawn,
    });
    expect(res.compileDbWarnings?.some((d) => d.code === 'toolchain_mismatch')).toBe(true);
  });
});
