import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wslToHost, prepareCompileDb, enumerateFirstParty, detectForeignToolchain } from '../../../mcp/stdio/code-intel/compile-db.js';

const isWin = process.platform === 'win32';

describe('wslToHost', () => {
  it('translates /mnt/<drive>/... to <DRIVE>:/... on win32', () => {
    if (!isWin) return; // host-pathing is a no-op off win32
    expect(wslToHost('/mnt/c/Users/x')).toBe('C:/Users/x');
    expect(wslToHost('/mnt/d/a/b/c.cpp')).toBe('D:/a/b/c.cpp');
    expect(wslToHost('/mnt/c')).toBe('C:/');
  });

  it('leaves already-host Windows paths alone', () => {
    expect(wslToHost('C:/Users/x')).toBe('C:/Users/x');
    expect(wslToHost('C:\\Users\\x')).toBe('C:\\Users\\x');
  });

  it('leaves ordinary posix paths alone (not under /mnt)', () => {
    expect(wslToHost('/usr/include/foo.h')).toBe('/usr/include/foo.h');
    expect(wslToHost('src/foo.cpp')).toBe('src/foo.cpp');
  });

  it('handles empty/non-string defensively', () => {
    expect(wslToHost('')).toBe('');
    expect(wslToHost(undefined)).toBe(undefined);
  });
});

// Build a synthetic compile DB using paths the host can resolve, so
// first-party counting works on both win32 (C:/ paths via wslToHost) and posix
// (real /mnt-style absolute paths preserved as-is).
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-compiledb-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'foo.cpp'), 'void foo(){}\n');
  fs.writeFileSync(path.join(dir, 'src', 'bar.cpp'), 'void bar(){}\n');
  return dir;
}

// Produce a `file` value that, after wslToHost on the current platform,
// resolves under `dir`. On win32 we feed a WSL path so normalization is
// exercised; off win32 we feed the host path directly.
function wslish(dir, rel) {
  const abs = path.join(dir, rel).replace(/\\/g, '/');
  if (isWin) {
    // C:/Users/x → /mnt/c/Users/x
    const m = /^([A-Za-z]):(\/.*)$/.exec(abs);
    if (m) return `/mnt/${m[1].toLowerCase()}${m[2]}`;
  }
  return abs;
}

describe('prepareCompileDb', () => {
  let repo;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch {} });

  function writeDb(rel, entries) {
    const p = path.join(repo, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(entries, null, 2));
  }

  it('discovers, normalizes WSL paths, flags unity, filters deps, writes normalized DB', () => {
    const dirWsl = wslish(repo, 'build');
    writeDb('build/compile_commands.json', [
      // first-party
      { directory: dirWsl, file: wslish(repo, 'src/foo.cpp'),
        command: `clang++ -I${wslish(repo, 'src')} -c ${wslish(repo, 'src/foo.cpp')}` },
      { directory: dirWsl, file: wslish(repo, 'src/bar.cpp'),
        arguments: ['clang++', '-isystem', wslish(repo, 'src'), '-c', wslish(repo, 'src/bar.cpp')] },
      // unity aggregate — should be flagged, not counted as first-party
      { directory: dirWsl, file: wslish(repo, 'build/CMakeFiles/Unity/unity_0_cxx.cxx') },
      // dep — should be filtered from first-party count
      { directory: dirWsl, file: wslish(repo, '_deps/fmt/format.cc') }
    ]);

    const r = prepareCompileDb({ projectRoot: repo });
    expect(r.found).toBe(true);
    expect(r.entryCount).toBe(4);
    expect(r.firstPartyCount).toBe(2);
    expect(r.unity).toBe(true);
    expect(r.diagnostics.some(d => d.code === 'unity_build')).toBe(true);

    // Normalized DB written under .aify-graph/code-intel.
    expect(fs.existsSync(r.normalizedPath)).toBe(true);
    const norm = JSON.parse(fs.readFileSync(r.normalizedPath, 'utf8'));
    expect(norm.length).toBe(4);
    if (isWin) {
      // file + directory + -I/-isystem args + command path translated to C:/
      expect(norm[0].file).toMatch(/^[A-Za-z]:\//);
      expect(norm[0].command).not.toMatch(/\/mnt\//);
      expect(norm[1].arguments.join(' ')).not.toMatch(/\/mnt\//);
    }
  });

  it('picks the richest DB across probe dirs', () => {
    const dbDir = path.join(repo, 'src');
    // build-debug has 1 first-party; build has 2 → build wins.
    writeDb('build-debug/compile_commands.json', [
      { directory: wslish(repo, 'build-debug'), file: wslish(repo, 'src/foo.cpp') }
    ]);
    writeDb('build/compile_commands.json', [
      { directory: wslish(repo, 'build'), file: wslish(repo, 'src/foo.cpp') },
      { directory: wslish(repo, 'build'), file: wslish(repo, 'src/bar.cpp') }
    ]);
    void dbDir;
    const r = prepareCompileDb({ projectRoot: repo });
    expect(r.found).toBe(true);
    expect(r.firstPartyCount).toBe(2);
    expect(r.sourcePath).toMatch(/build[\\/]compile_commands\.json$/);
  });

  it('returns found:false with compile_db_missing when no DB exists', () => {
    const r = prepareCompileDb({ projectRoot: repo });
    expect(r.found).toBe(false);
    expect(r.diagnostics[0].code).toBe('compile_db_missing');
  });

  it('enumerateFirstParty excludes unity + deps and lists in-repo sources', () => {
    const dirWsl = wslish(repo, 'build');
    // Unity aggregate placed OUTSIDE a dep prefix (under src/) so it's
    // classified as unity rather than build-dep filtered.
    writeDb('build/compile_commands.json', [
      { directory: dirWsl, file: wslish(repo, 'src/foo.cpp') },
      { directory: dirWsl, file: wslish(repo, 'src/bar.cpp') },
      { directory: dirWsl, file: wslish(repo, 'src/Unity/unity_0_cxx.cxx') },
      { directory: dirWsl, file: wslish(repo, '_deps/fmt/format.cc') }
    ]);
    const r = prepareCompileDb({ projectRoot: repo });
    const e = enumerateFirstParty(r.normalizedPath, repo, { maxFiles: 50 });
    expect(e.files.sort()).toEqual(['src/bar.cpp', 'src/foo.cpp']);
    expect(e.stats.unity).toBe(1);
    expect(e.stats.filtered_build_dep).toBe(1);
  });
});

// ── P0-3: foreign (Linux/WSL) toolchain detection + flag stripping ──────────
// These are win32-gated pure-function tests. detectForeignToolchain is a no-op
// off win32 (the Linux paths ARE the host paths there) so the detection asserts
// only run on win32; the strip assertions run via prepareCompileDb on both.
describe('detectForeignToolchain (pure)', () => {
  it('flags a POSIX compiler driver as foreign on win32', () => {
    if (!isWin) return;
    const r = detectForeignToolchain([
      { directory: '/mnt/c/r/build', file: '/mnt/c/r/a.cpp', command: '/usr/bin/c++ -c /mnt/c/r/a.cpp' }
    ]);
    expect(r.foreign).toBe(true);
    expect(r.reasons).toContain('posix_compiler');
    expect(r.reasons).toContain('posix_directory');
  });

  it('flags -isysroot / --sysroot / --gcc-toolchain / -isystem /usr', () => {
    if (!isWin) return;
    const r = detectForeignToolchain([
      { directory: 'C:/r/build', file: 'C:/r/a.cpp',
        arguments: ['clang++', '-isysroot', '/Library/sdk', '--gcc-toolchain=/usr', '-isystem', '/usr/include', '-c', 'C:/r/a.cpp'] }
    ]);
    expect(r.foreign).toBe(true);
    expect(r.reasons).toEqual(expect.arrayContaining(['isysroot', 'gcc_toolchain', 'isystem_system']));
  });

  it('does NOT flag a pure native Windows DB on win32', () => {
    if (!isWin) return;
    const r = detectForeignToolchain([
      { directory: 'C:/r/build', file: 'C:/r/a.cpp',
        arguments: ['clang++', '-IC:/r/src', '-DFOO', '-std=c++20', '-c', 'C:/r/a.cpp'] }
    ]);
    expect(r.foreign).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it('is a no-op off win32 (Linux paths are host paths there)', () => {
    if (isWin) return;
    const r = detectForeignToolchain([
      { directory: '/home/u/build', file: '/home/u/a.cpp', command: '/usr/bin/c++ -isystem /usr/include -c /home/u/a.cpp' }
    ]);
    expect(r.foreign).toBe(false);
  });

  it('returns false for non-array / empty input', () => {
    expect(detectForeignToolchain(null).foreign).toBe(false);
    expect(detectForeignToolchain([]).foreign).toBe(false);
  });
});

describe('prepareCompileDb — foreign-toolchain strip (win32)', () => {
  let repo;
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-foreign-'));
    fs.mkdirSync(path.join(repo, 'engine'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'engine', 'a.cpp'), 'void a(){}\n');
  });
  afterEach(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch {} });

  function writeDb(rel, entries) {
    const p = path.join(repo, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(entries, null, 2));
  }

  it('strips Linux-only toolchain flags but keeps project -I/-D/-std (win32)', () => {
    if (!isWin) return;
    const dirWsl = wslish(repo, 'build');
    const fileWsl = wslish(repo, 'engine/a.cpp');
    // Command form with a POSIX compiler + Linux system include + sysroot.
    const cmd = `/usr/bin/c++ -DFOO -I${wslish(repo, 'engine')} -isysroot /opt/sdk ` +
      `-isystem /usr/include -isystem ${wslish(repo, 'engine')} -std=gnu++20 -c ${fileWsl}`;
    writeDb('build/compile_commands.json', [
      { directory: dirWsl, file: fileWsl, command: cmd, output: 'a.o' }
    ]);

    const r = prepareCompileDb({ projectRoot: repo });
    expect(r.found).toBe(true);
    expect(r.foreignToolchain).toBe(true);
    expect(r.strippedFlags).toBeGreaterThanOrEqual(2); // -isysroot value + -isystem /usr/include
    const foreignDiag = r.diagnostics.find(d => d.code === 'foreign_toolchain');
    expect(foreignDiag).toBeTruthy();
    // Honesty fix (Sand Castle finding 1): the message must NOT claim references
    // are safe on a foreign DB — they're truncated, even same-file.
    expect(foreignDiag.message).not.toMatch(/stay usable/i);
    expect(foreignDiag.message).toMatch(/TRUNCATED/);
    expect(foreignDiag.message).toMatch(/APG_CLANGD_WSL/);

    const norm = JSON.parse(fs.readFileSync(r.normalizedPath, 'utf8'));
    const c = norm[0].command;
    // Linux-only anchors gone.
    expect(c).not.toMatch(/-isysroot/);
    expect(c).not.toMatch(/-isystem\s+\/usr\/include/);
    // Project flags preserved (host-normalized).
    expect(c).toMatch(/-DFOO/);
    expect(c).toMatch(/-std=gnu\+\+20/);
    expect(c).toMatch(/-I[A-Za-z]:\/.*engine/);
    expect(c).toMatch(/-isystem [A-Za-z]:\/.*engine/); // project -isystem kept
  });

  it('strips Linux-only flags in arguments[] form (win32)', () => {
    if (!isWin) return;
    const dirWsl = wslish(repo, 'build');
    const fileWsl = wslish(repo, 'engine/a.cpp');
    writeDb('build/compile_commands.json', [
      { directory: dirWsl, file: fileWsl,
        arguments: ['/usr/bin/c++', '-DBAR', '--sysroot=/opt/sysroot', '--gcc-toolchain=/usr',
          '-isystem', '/usr/lib/gcc', '-I' + wslish(repo, 'engine'), '-c', fileWsl] }
    ]);
    const r = prepareCompileDb({ projectRoot: repo });
    expect(r.foreignToolchain).toBe(true);
    expect(r.strippedFlags).toBeGreaterThanOrEqual(3);
    const norm = JSON.parse(fs.readFileSync(r.normalizedPath, 'utf8'));
    const args = norm[0].arguments;
    expect(args.some(a => /--sysroot=/.test(a))).toBe(false);
    expect(args.some(a => /--gcc-toolchain=/.test(a))).toBe(false);
    expect(args.includes('/usr/lib/gcc')).toBe(false);
    expect(args.includes('-DBAR')).toBe(true);
    expect(args.some(a => /^-I[A-Za-z]:\//.test(a))).toBe(true); // project -I kept
  });

  it('does NOT set foreignToolchain for a native Windows DB', () => {
    // Synthesize a fully native DB (no POSIX paths). On win32 wslish returns the
    // already-host path; off win32 the same DB is trivially "native" too.
    const dirHost = path.join(repo, 'build').replace(/\\/g, '/');
    const fileHost = path.join(repo, 'engine', 'a.cpp').replace(/\\/g, '/');
    writeDb('build/compile_commands.json', [
      { directory: dirHost, file: fileHost,
        arguments: ['clang++', '-DFOO', '-I' + path.join(repo, 'engine').replace(/\\/g, '/'), '-std=c++20', '-c', fileHost] }
    ]);
    const r = prepareCompileDb({ projectRoot: repo });
    expect(r.found).toBe(true);
    expect(!!r.foreignToolchain).toBe(false);
    expect((r.strippedFlags || 0)).toBe(0);
    expect(r.diagnostics.some(d => d.code === 'foreign_toolchain')).toBe(false);
  });
});

// Sand Castle probe bug: with both a WSL build/ and a native build-win-clangd/,
// APG picked build/ by entry count → truncated caller sets. Fix: native wins.
describe('prepareCompileDb — native DB preferred + APG_COMPILE_DB pin', () => {
  let repo;
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-prefer-'));
    fs.mkdirSync(path.join(repo, 'engine'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'engine', 'a.cpp'), 'void a(){}\n');
    fs.writeFileSync(path.join(repo, 'engine', 'b.cpp'), 'void b(){}\n');
  });
  afterEach(() => { delete process.env.APG_COMPILE_DB; try { fs.rmSync(repo, { recursive: true, force: true }); } catch {} });
  const writeDb = (rel, entries) => {
    const p = path.join(repo, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(entries, null, 2));
  };
  const nativeEntry = (dir, rel) => ({
    directory: path.join(repo, dir).replace(/\\/g, '/'),
    file: path.join(repo, rel).replace(/\\/g, '/'),
    arguments: ['clang-cl', '-I' + path.join(repo, 'engine').replace(/\\/g, '/'), '-c', path.join(repo, rel).replace(/\\/g, '/')],
  });

  it('on win32, a native build-win-clangd/ wins over a foreign build/ even with MORE foreign entries', () => {
    if (!isWin) return; // foreign detection is a win32-only concept
    // Foreign build/ with 2 entries (/mnt/ paths) vs native build-win-clangd/ with 1.
    writeDb('build/compile_commands.json', [
      { directory: wslish(repo, 'build'), file: wslish(repo, 'engine/a.cpp'), command: `/usr/bin/c++ -c ${wslish(repo, 'engine/a.cpp')}` },
      { directory: wslish(repo, 'build'), file: wslish(repo, 'engine/b.cpp'), command: `/usr/bin/c++ -c ${wslish(repo, 'engine/b.cpp')}` },
    ]);
    writeDb('build-win-clangd/compile_commands.json', [nativeEntry('build-win-clangd', 'engine/a.cpp')]);
    const r = prepareCompileDb({ projectRoot: repo });
    expect(r.found).toBe(true);
    expect(r.sourcePath.replace(/\\/g, '/')).toMatch(/build-win-clangd\/compile_commands\.json$/);
    expect(!!r.foreignToolchain).toBe(false);
  });

  it('APG_COMPILE_DB pins a specific DB, overriding the probe (cross-platform)', () => {
    writeDb('build/compile_commands.json', [nativeEntry('build', 'engine/a.cpp')]);
    writeDb('custom-db/compile_commands.json', [nativeEntry('custom-db', 'engine/b.cpp')]);
    process.env.APG_COMPILE_DB = path.join(repo, 'custom-db', 'compile_commands.json');
    const r = prepareCompileDb({ projectRoot: repo });
    expect(r.found).toBe(true);
    expect(r.sourcePath.replace(/\\/g, '/')).toMatch(/custom-db\/compile_commands\.json$/);
  });
});
