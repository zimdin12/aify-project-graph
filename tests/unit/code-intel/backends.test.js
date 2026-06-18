import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inferLanguage, normalizeLanguage, getBackend } from '../../../mcp/stdio/code-intel/backends.js';
import { computeCoverage, coverageCause } from '../../../mcp/stdio/code-intel/coverage.js';
import { resolveNodeBin } from '../../../mcp/stdio/code-intel/node-bin.js';

describe('inferLanguage — extension → backend', () => {
  it('maps C/C++ extensions to cpp', () => {
    for (const f of ['a.c', 'a.h', 'a.cc', 'a.cpp', 'a.cxx', 'a.hpp']) expect(inferLanguage(f)).toBe('cpp');
  });
  it('maps TS/JS extensions to typescript (one server)', () => {
    for (const f of ['a.ts', 'a.tsx', 'a.mts', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs']) expect(inferLanguage(f)).toBe('typescript');
  });
  it('maps Python extensions to python', () => {
    for (const f of ['a.py', 'a.pyi']) expect(inferLanguage(f)).toBe('python');
  });
  it('returns null for unknown / extensionless', () => {
    expect(inferLanguage('a.rs')).toBeNull();
    expect(inferLanguage('Makefile')).toBeNull();
    expect(inferLanguage(null)).toBeNull();
  });
});

describe('normalizeLanguage + getBackend', () => {
  it('aliases js→typescript, py→python, c++→cpp', () => {
    expect(normalizeLanguage('javascript')).toBe('typescript');
    expect(normalizeLanguage('js')).toBe('typescript');
    expect(normalizeLanguage('py')).toBe('python');
    expect(normalizeLanguage('c++')).toBe('cpp');
  });
  it('has backends for cpp, typescript, python with a providerName', () => {
    for (const l of ['cpp', 'typescript', 'python']) {
      const b = getBackend(l);
      expect(b).toBeTruthy();
      expect(typeof b.spawnFor).toBe('function');
      expect(b.providerName).toBeTruthy();
    }
  });
  it('returns null for an unregistered language', () => {
    expect(getBackend('rust')).toBeNull();
  });
});

describe('computeCoverage — per-language exhaustiveness strategy', () => {
  it('python is ALWAYS partial (duck typing — never provably exhaustive)', () => {
    const c = computeCoverage({ language: 'python', projectRoot: '/x' });
    expect(c.complete).toBe(false);
    expect(c.partial).toBe(true);
    expect(c.reason).toMatch(/duck typing|dynamic|getattr/i);
  });
  it('typescript with a tsconfig → complete', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-ts-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
    const c = computeCoverage({ language: 'typescript', projectRoot: dir });
    expect(c.complete).toBe(true);
    expect(c.partial).toBe(false);
  });
  it('typescript without a tsconfig → partial (loose inferred project)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-ts2-'));
    const c = computeCoverage({ language: 'typescript', projectRoot: dir });
    expect(c.complete).toBe(false);
    expect(c.partial).toBe(true);
    expect(c.reason).toMatch(/tsconfig/i);
  });
  it('cpp routes to compile-DB coverage (no DB → complete:false but partial:false — not a downgrade of pre-collected edges)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-cpp-'));
    const c = computeCoverage({ language: 'cpp', projectRoot: dir });
    expect(c.complete).toBe(false);   // live verbs: no DB ⇒ not exhaustive
    expect(c.partial).toBe(false);    // graph banners: absent DB ⇒ don't downgrade ground-truth edges
  });

  // Audit 2026-06-12 (B1): root-tsconfig presence is NOT proof the queried file
  // is in a configured project — file-aware coverage closes that false-exhaustive.
  it('typescript file INSIDE a root tsconfig include → complete', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-tsinc-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ include: ['src'] }));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const c = computeCoverage({ language: 'typescript', projectRoot: dir, file: 'src/a.ts' });
    expect(c.complete).toBe(true);
    expect(c.partial).toBe(false);
  });
  it('typescript file OUTSIDE the tsconfig include scope → partial (false-exhaustive closed)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-tsout-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ include: ['src'] }));
    const c = computeCoverage({ language: 'typescript', projectRoot: dir, file: 'packages/other/b.ts' });
    expect(c.complete).toBe(false);
    expect(c.partial).toBe(true);
    expect(c.reason).toMatch(/outside|scope|inferred/i);
  });
  it('typescript uses the NEAREST enclosing tsconfig (monorepo per-package)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-tsmono-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ include: ['nothing'] }));
    const pkg = path.join(dir, 'packages', 'app');
    fs.mkdirSync(path.join(pkg, 'src'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'tsconfig.json'), JSON.stringify({ include: ['src'] }));
    const c = computeCoverage({ language: 'typescript', projectRoot: dir, file: 'packages/app/src/x.ts' });
    expect(c.complete).toBe(true);
  });
  it('typescript with a tsconfig but no include/files → covers its whole subtree', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-tsall-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }');
    const c = computeCoverage({ language: 'typescript', projectRoot: dir, file: 'lib/deep/y.ts' });
    expect(c.complete).toBe(true);
  });
  it('typescript file with NO enclosing tsconfig → partial', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-tsnone-'));
    const c = computeCoverage({ language: 'typescript', projectRoot: dir, file: 'src/a.ts' });
    expect(c.complete).toBe(false);
    expect(c.partial).toBe(true);
  });
});

describe('coverageCause — accurate degraded cause per language (audit #12)', () => {
  it('cpp / unknown / missing kind → partial_compile_db_coverage (preserves the server-instructions contract)', () => {
    expect(coverageCause({ kind: 'compile_db' })).toBe('partial_compile_db_coverage');
    expect(coverageCause({})).toBe('partial_compile_db_coverage');
    expect(coverageCause({ kind: 'unknown' })).toBe('partial_compile_db_coverage');
  });
  it('typescript → partial_tsconfig_scope (NOT a compile DB)', () => {
    expect(coverageCause({ kind: 'tsconfig' })).toBe('partial_tsconfig_scope');
  });
  it('python → python_dynamic_dispatch', () => {
    expect(coverageCause({ kind: 'python_dynamic' })).toBe('python_dynamic_dispatch');
  });
});

describe('resolveNodeBin — resolution order', () => {
  it('prefers a project-local node_modules/.bin over plugin/PATH', () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-proj-'));
    const binDir = path.join(proj, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const name = process.platform === 'win32' ? 'toolx.cmd' : 'toolx';
    fs.writeFileSync(path.join(binDir, name), '');
    const resolved = resolveNodeBin('toolx', proj);
    expect(resolved.startsWith(proj)).toBe(true);
  });
  it('falls through to the bare name (PATH) when nowhere on disk', () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-proj2-'));
    expect(resolveNodeBin('definitely-not-installed-xyz', proj)).toBe('definitely-not-installed-xyz');
  });
});
