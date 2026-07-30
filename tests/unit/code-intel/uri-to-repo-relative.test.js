// WINDOWS URI NORMALIZATION — found the first time the real-clangd suite
// actually executed on a Windows box (2026-07-30).
//
// clangd canonicalizes paths to their LONG form; Node reports some roots in 8.3
// SHORT form (`os.tmpdir()` → `C:\Users\ADMINI~1\...`). The two never compare
// equal, so path.win32.relative produced `..\..\..`, toRepoRelative threw
// "outside projectRoot", and the caller's bare `catch { return uri }` shipped the
// RAW `file:///C:/...` URI as if it were a repo-relative path — while
// `evidence.exhaustive: true` was asserted alongside it.
//
// Impact beyond cosmetics: an agent cannot navigate to a file:// URI, absolute
// host paths leak into responses, and any downstream comparison against
// repo-relative graph paths matches NOTHING — a silent zero-overlap that reads as
// "no results" rather than "two different path formats".
//
// This test existed in spirit in the integration suite, which had been SKIPPING
// because its gate checked bare PATH instead of the resolver the product uses.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  uriToRepoRelativeSafe,
  _resetRealpathCache,
} from '../../../mcp/stdio/ingest/code-intel/paths.js';

describe('uriToRepoRelativeSafe', () => {
  beforeEach(() => { _resetRealpathCache(); });

  it('normalizes a plain in-repo URI', () => {
    const root = process.platform === 'win32' ? 'C:/repo' : '/repo';
    const uri = pathToFileURL(path.join(root, 'src', 'a.cpp')).toString();
    expect(uriToRepoRelativeSafe(uri, root)).toEqual({ path: 'src/a.cpp', ok: true });
  });

  it('resolves a root/URI mismatch that differs only by canonical form', () => {
    // The real defect. mkdtemp under os.tmpdir() can hand back an 8.3 short path
    // while the LSP server reports the long one (or vice versa). Both name the
    // same file, so normalization must succeed rather than fall back to the URI.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-uri-t-'));
    try {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      const file = path.join(dir, 'src', 'b.cpp');
      fs.writeFileSync(file, 'int b();\n');

      // Canonical (realpath) form stands in for what the server reports.
      const canonical = fs.realpathSync.native
        ? fs.realpathSync.native(file)
        : fs.realpathSync(file);
      const uri = pathToFileURL(canonical).toString();

      // `dir` is whatever Node handed us; `uri` is canonical. These may differ.
      const out = uriToRepoRelativeSafe(uri, dir);
      expect(out.ok).toBe(true);
      expect(out.path).toBe('src/b.cpp');
      // The exact regression: a file:// URI must never survive as the "path".
      expect(out.path).not.toMatch(/^file:/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never returns a file:// URI for a path inside the repo', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-uri-u-'));
    try {
      fs.mkdirSync(path.join(dir, 'deep', 'nest'), { recursive: true });
      const file = path.join(dir, 'deep', 'nest', 'c.cpp');
      fs.writeFileSync(file, 'int c();\n');
      const out = uriToRepoRelativeSafe(pathToFileURL(file).toString(), dir);
      expect(out.path).toBe('deep/nest/c.cpp');
      expect(out.path).not.toMatch(/^file:/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports ok:false for a genuinely out-of-repo path, and returns a usable path', () => {
    // A system header is not a repo file. Returning its absolute path is correct;
    // ok:false is what lets a caller distinguish that from a normalization failure.
    const root = process.platform === 'win32' ? 'C:/repo' : '/repo';
    const outside = process.platform === 'win32' ? 'C:/other/h.hpp' : '/other/h.hpp';
    const out = uriToRepoRelativeSafe(pathToFileURL(outside).toString(), root);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('outside_project_root');
    expect(out.path).not.toMatch(/^file:/);
    expect(out.path).toContain('h.hpp');
  });

  it('reports ok:false on input that is not a file URI at all', () => {
    const out = uriToRepoRelativeSafe('untitled:Untitled-1', '/repo');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('not_a_file_uri');
  });
});
