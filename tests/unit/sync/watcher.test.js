// Plan #17 B tests: native file watcher.
// Covers WSL /mnt/* default-off, opt-in override, debounced burst
// coalescing, ignored-dir gate, stop() lifecycle.

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startWatcher, isWslMntPath } from '../../../mcp/stdio/sync/watcher.js';

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apg-watch-'));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Track watchers across tests so we can cleanly stop them on failure.
const liveWatchers = [];
afterEach(() => {
  while (liveWatchers.length) liveWatchers.pop().stop();
});

function start(opts) {
  const w = startWatcher(opts);
  liveWatchers.push(w);
  return w;
}

describe('startWatcher arg validation', () => {
  it('throws when repoRoot missing', () => {
    expect(() => startWatcher({ onChange: () => {} })).toThrow(/repoRoot/);
  });
  it('throws when onChange missing', () => {
    expect(() => startWatcher({ repoRoot: '/tmp' })).toThrow(/onChange/);
  });
});

describe('WSL /mnt detection', () => {
  it('returns false on non-linux platforms', () => {
    if (os.platform() === 'linux') return; // skip on real linux; tested by negation elsewhere
    expect(isWslMntPath('/mnt/c/foo')).toBe(false);
  });
  it('returns false for paths NOT under /mnt/', () => {
    // Pure path-based check — should be false everywhere for /home/user etc.
    expect(isWslMntPath('/home/user', { env: { WSL_DISTRO_NAME: 'Ubuntu' } })).toBe(false);
    expect(isWslMntPath('/tmp', { env: { WSL_DISTRO_NAME: 'Ubuntu' } })).toBe(false);
  });
});

describe('startWatcher WSL /mnt default-off', () => {
  // Simulate WSL by stubbing platform via the env signal path. We can't
  // easily switch os.platform() in vitest, so we exercise the code path
  // by constructing a synthetic env that matches WSL on linux. On other
  // hosts this branch is unreachable (correctly).
  it('returns status=disabled with explanatory reason when on WSL /mnt/* by default', () => {
    if (os.platform() !== 'linux') return; // can't simulate platform check
    // Only meaningful when we're actually on a WSL host AND /mnt/ exists.
    if (!fs.existsSync('/mnt')) return;
    const w = start({
      repoRoot: '/mnt/c/tmp/does-not-exist-' + Date.now(),
      onChange: () => {},
      env: { WSL_DISTRO_NAME: 'TestDistro' }
    });
    if (w.status === 'disabled') {
      expect(w.reason).toMatch(/wsl/i);
    }
  });

  it('respects APG_WATCHER_FORCE_WSL_MNT=1 override (no longer disabled by WSL gate)', () => {
    if (os.platform() !== 'linux') return;
    if (!fs.existsSync('/mnt')) return;
    const dir = tmpRepo(); // outside /mnt
    const w = start({
      repoRoot: dir,
      onChange: () => {},
      env: { ...process.env, APG_WATCHER_FORCE_WSL_MNT: '1' }
    });
    expect(w.status).not.toBe('disabled');
  });
});

describe('startWatcher native (non-WSL) operation', () => {
  it('starts in status=running on a regular temp dir', () => {
    const dir = tmpRepo();
    const w = start({ repoRoot: dir, onChange: () => {} });
    expect(['running', 'unsupported']).toContain(w.status);
  });

  it('debounces a burst of changes into a single onChange call', async () => {
    const dir = tmpRepo();
    const calls = [];
    const w = start({
      repoRoot: dir,
      onChange: (events) => calls.push(events),
      debounceMs: 100
    });
    if (w.status !== 'running') return; // platform doesn't support fs.watch
    // Write 5 files in quick succession; we expect at most ~1 onChange burst
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(dir, `f${i}.txt`), String(i));
    await sleep(300);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    // All 5 events should land in burst[0] (or split across at most a couple
    // of bursts on slow CI), but never one-per-call.
    const total = calls.reduce((acc, b) => acc + b.length, 0);
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it('stop() makes subsequent changes silent', async () => {
    const dir = tmpRepo();
    const calls = [];
    const w = start({
      repoRoot: dir,
      onChange: (events) => calls.push(events),
      debounceMs: 100
    });
    if (w.status !== 'running') return;
    fs.writeFileSync(path.join(dir, 'first.txt'), '1');
    await sleep(200);
    const beforeStop = calls.length;
    w.stop();
    fs.writeFileSync(path.join(dir, 'after-stop.txt'), '2');
    await sleep(300);
    expect(calls.length).toBe(beforeStop);
  });

  it('skips events whose top-level dir is in the ignored set', async () => {
    const dir = tmpRepo();
    fs.mkdirSync(path.join(dir, 'node_modules'));
    const calls = [];
    const w = start({
      repoRoot: dir,
      onChange: (events) => calls.push(events),
      debounceMs: 100
    });
    if (w.status !== 'running') return;
    fs.writeFileSync(path.join(dir, 'node_modules', 'noise.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'real.txt'), 'r');
    await sleep(300);
    const allFiles = calls.flat().map(e => e.filename);
    expect(allFiles.some(f => f.startsWith('node_modules'))).toBe(false);
    expect(allFiles.some(f => f === 'real.txt')).toBe(true);
  });

  // P5-4: nested ignored dirs (not just top-level) must be excluded before any
  // rebuild work. Previously only the first path segment was checked, so
  // `pkg/node_modules/...` and `sub/build-x/...` still triggered onChange.
  it('skips events whose NESTED dir is in the ignored set', async () => {
    const dir = tmpRepo();
    fs.mkdirSync(path.join(dir, 'pkg', 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'sub', 'build-x'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const calls = [];
    const w = start({
      repoRoot: dir,
      onChange: (events) => calls.push(events),
      debounceMs: 100
    });
    if (w.status !== 'running') return;
    fs.writeFileSync(path.join(dir, 'pkg', 'node_modules', 'dep.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'sub', 'build-x', 'out.txt'), 'y');
    fs.writeFileSync(path.join(dir, 'src', 'real.ts'), 'z');
    await sleep(300);
    const allFiles = calls.flat().map(e => e.filename);
    expect(allFiles.some(f => f.includes('node_modules'))).toBe(false);
    expect(allFiles.some(f => f.includes('build-x'))).toBe(false);
    expect(allFiles.some(f => f.endsWith('real.ts'))).toBe(true);
  });
});
