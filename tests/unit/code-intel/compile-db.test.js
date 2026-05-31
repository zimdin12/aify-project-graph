import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wslToHost, prepareCompileDb, enumerateFirstParty } from '../../../mcp/stdio/code-intel/compile-db.js';

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
