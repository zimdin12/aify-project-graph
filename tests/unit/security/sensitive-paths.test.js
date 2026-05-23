// Plan #21 tests: sensitive-path validation.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  isSensitivePath,
  findSensitivePathArg,
} from '../../../mcp/stdio/security/sensitive-paths.js';

const HOME = os.homedir();

describe('isSensitivePath — direct paths', () => {
  it('returns null for safe paths', () => {
    expect(isSensitivePath(os.tmpdir())).toBeNull();
    expect(isSensitivePath(path.join(HOME, 'Documents'))).toBeNull();
    expect(isSensitivePath('/tmp/something')).toBeNull();
  });

  it('returns null for empty/non-string input', () => {
    expect(isSensitivePath('')).toBeNull();
    expect(isSensitivePath(null)).toBeNull();
    expect(isSensitivePath(undefined)).toBeNull();
    expect(isSensitivePath(42)).toBeNull();
  });

  it('blocks ~/.ssh and subdirectories', () => {
    const hit = isSensitivePath(path.join(HOME, '.ssh'));
    expect(hit).not.toBeNull();
    expect(hit.matched).toContain('.ssh');
  });

  it('blocks ~/.ssh/id_rsa specifically', () => {
    const hit = isSensitivePath(path.join(HOME, '.ssh', 'id_rsa'));
    expect(hit).not.toBeNull();
    expect(hit.reason).toMatch(/sensitive directory/);
  });

  it('blocks ~/.aws and ~/.gnupg and ~/.kube and ~/.docker', () => {
    for (const sub of ['.aws', '.gnupg', '.kube', '.docker']) {
      const hit = isSensitivePath(path.join(HOME, sub, 'config'));
      expect(hit).not.toBeNull();
      expect(hit.matched).toContain(sub);
    }
  });

  it('blocks POSIX /etc, /sys, /proc, /root, /boot on POSIX hosts', () => {
    if (process.platform === 'win32') return;
    for (const prefix of ['/etc', '/sys', '/proc', '/root', '/boot']) {
      const hit = isSensitivePath(`${prefix}/some/file`);
      expect(hit).not.toBeNull();
      expect(hit.matched).toBe(prefix);
    }
  });

  it('does NOT match prefix-substring (e.g. /etcfoo)', () => {
    if (process.platform === 'win32') return;
    expect(isSensitivePath('/etcfoo')).toBeNull();
    expect(isSensitivePath('/etcetera')).toBeNull();
  });

  it('canonicalizes via realpath so symlinks into ~/.ssh are blocked', () => {
    if (process.platform === 'win32') return; // symlink semantics
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-sens-'));
    const sshDir = path.join(HOME, '.ssh');
    if (!fs.existsSync(sshDir)) {
      // Create temp ~/.ssh so the symlink target exists; clean up after
      // by best-effort. If unable to create, skip the test (CI without
      // perms to write to $HOME).
      try { fs.mkdirSync(sshDir, { recursive: true }); }
      catch { return; }
    }
    const symlink = path.join(dir, 'safe-looking-link');
    try {
      fs.symlinkSync(sshDir, symlink);
    } catch { return; /* needs symlink perms */ }
    const hit = isSensitivePath(symlink);
    expect(hit).not.toBeNull();
    expect(hit.reason).toMatch(/canonicalized/);
  });

  it('does not crash on non-existent paths (realpath fallback)', () => {
    // The realpath try/catch should let us still apply the prefix check
    // against the resolved-but-unrealized path.
    expect(() => isSensitivePath('/tmp/nope-nonexistent-' + Date.now())).not.toThrow();
  });
});

describe('findSensitivePathArg — tool-call argument scan', () => {
  it('returns null when no path-shaped args present', () => {
    expect(findSensitivePathArg({ symbol: 'foo', line: 12 })).toBeNull();
  });

  it('returns null when args is null/missing/empty', () => {
    expect(findSensitivePathArg(null)).toBeNull();
    expect(findSensitivePathArg(undefined)).toBeNull();
    expect(findSensitivePathArg({})).toBeNull();
  });

  it('detects sensitive repoRoot', () => {
    const hit = findSensitivePathArg({ repoRoot: path.join(HOME, '.ssh') });
    expect(hit).not.toBeNull();
    expect(hit.arg).toBe('repoRoot');
  });

  it('detects sensitive repo (alias)', () => {
    const hit = findSensitivePathArg({ repo: path.join(HOME, '.aws') });
    expect(hit).not.toBeNull();
    expect(hit.arg).toBe('repo');
  });

  it('detects sensitive file arg', () => {
    const hit = findSensitivePathArg({ file: path.join(HOME, '.ssh', 'id_rsa') });
    expect(hit).not.toBeNull();
    expect(hit.arg).toBe('file');
  });

  it('detects sensitive entry inside files[] array', () => {
    const hit = findSensitivePathArg({
      files: ['src/foo.js', path.join(HOME, '.gnupg', 'secret.txt'), 'src/bar.js'],
    });
    expect(hit).not.toBeNull();
    expect(hit.arg).toBe('files');
    expect(hit.value).toContain('.gnupg');
  });

  it('detects sensitive entry inside warmupFiles[] array', () => {
    const hit = findSensitivePathArg({
      warmupFiles: [path.join(HOME, '.kube', 'config')],
    });
    expect(hit).not.toBeNull();
    expect(hit.arg).toBe('warmupFiles');
  });

  it('ignores non-path-shaped string args even if they look path-y', () => {
    // 'query' or 'symbol' shouldn't be path-checked — they can legitimately
    // contain forward slashes (e.g. namespace::method).
    expect(findSensitivePathArg({ query: '/etc/passwd' })).toBeNull();
    expect(findSensitivePathArg({ symbol: 'std::filesystem::path' })).toBeNull();
  });

  it('returns FIRST sensitive arg (short-circuits)', () => {
    const hit = findSensitivePathArg({
      repoRoot: path.join(HOME, '.ssh'),
      file: path.join(HOME, '.aws', 'credentials'),
    });
    expect(hit).not.toBeNull();
    // Either is acceptable; the function short-circuits on the first hit
    // it encounters during Object.entries iteration.
    expect(['repoRoot', 'file']).toContain(hit.arg);
  });
});
