import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { resolveClangd, buildClangdSpawn } from '../../../mcp/stdio/code-intel/resolve-clangd.js';

describe('resolveClangd precedence', () => {
  const origEnv = process.env.APG_CLANGD;
  let existsSpy;

  beforeEach(() => { existsSpy = vi.spyOn(fs, 'existsSync'); });
  afterEach(() => {
    existsSpy.mockRestore();
    if (origEnv === undefined) delete process.env.APG_CLANGD;
    else process.env.APG_CLANGD = origEnv;
  });

  it('APG_CLANGD wins when set and the file exists', () => {
    process.env.APG_CLANGD = '/custom/clangd';
    existsSpy.mockImplementation(p => p === '/custom/clangd');
    const r = resolveClangd();
    expect(r).toEqual({ command: '/custom/clangd', source: 'env' });
  });

  it('ignores APG_CLANGD when the file does not exist', () => {
    process.env.APG_CLANGD = '/missing/clangd';
    existsSpy.mockReturnValue(false); // nothing exists
    const r = resolveClangd();
    expect(r.command).toBe('clangd');
    expect(r.source).toBe('path');
  });

  it('falls back to bare clangd on PATH when nothing else resolves', () => {
    delete process.env.APG_CLANGD;
    existsSpy.mockReturnValue(false);
    const r = resolveClangd();
    expect(r).toEqual({ command: 'clangd', source: 'path' });
  });

  it('prefers the win32 LLVM install when present (win32 only)', () => {
    if (process.platform !== 'win32') return;
    delete process.env.APG_CLANGD;
    existsSpy.mockImplementation(p => p === 'C:/Program Files/LLVM/bin/clangd.exe');
    const r = resolveClangd();
    expect(r).toEqual({ command: 'C:/Program Files/LLVM/bin/clangd.exe', source: 'win32-llvm' });
  });
});

describe('buildClangdSpawn', () => {
  let existsSpy;
  beforeEach(() => {
    existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    delete process.env.APG_CLANGD;
  });
  afterEach(() => existsSpy.mockRestore());

  it('emits L1 args with background-index ON and no --background-index=false', () => {
    const { command, args } = buildClangdSpawn({ projectRoot: '/r' });
    expect(command).toBe('clangd');
    expect(args).toContain('--background-index');
    expect(args).toContain('--pch-storage=memory');
    expect(args).toContain('-j=4');
    expect(args).toContain('--limit-results=2000');
    expect(args).not.toContain('--background-index=false');
    expect(args.some(a => a.startsWith('--compile-commands-dir'))).toBe(false);
  });

  it('adds --compile-commands-dir when a normalized DB is present', () => {
    const { args } = buildClangdSpawn({
      projectRoot: '/r',
      compileDb: { found: true, normalizedDir: '/r/.aify-graph/code-intel' }
    });
    expect(args).toContain('--compile-commands-dir=/r/.aify-graph/code-intel');
  });
});
