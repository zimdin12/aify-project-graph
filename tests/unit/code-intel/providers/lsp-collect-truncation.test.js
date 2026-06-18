// Audit 2026-06-12 B3 — a collection whose file enumeration hit the maxFiles cap
// must report status:'partial' (not 'ok'), so downstream trust banners never
// treat a partial TS/Python index as complete. Mirrors the cpp budget path.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectViaLsp } from '../../../../mcp/stdio/code-intel/providers/lsp-collect.js';

const fakeServer = path.resolve('tests/fixtures/code-intel/lsp/fake-lsp-server.mjs');
const spawnFor = () => ({ command: process.execPath, args: [fakeServer] });

describe('collectViaLsp — enumeration truncation → partial', () => {
  let repo;
  beforeEach(async () => { repo = await mkdtemp(path.join(tmpdir(), 'apg-collect-trunc-')); });
  afterEach(async () => { await rm(repo, { recursive: true, force: true }); });

  it('marks the collection partial when enumerateFiles reports truncated', async () => {
    await writeFile(path.join(repo, 'a.ts'), 'export function a() {}\n');
    const enumerateFiles = () => ({
      files: ['a.ts'],
      stats: { total: 500, after_filter: 1, truncated: true, max_files: 1 },
    });
    const out = await collectViaLsp({
      req: { projectRoot: repo, scope: 'all', operations: ['symbols'] },
      language: 'typescript', providerName: 'ts-langserver', providerVersion: 'test',
      spawnFor, enumerateFiles, freshnessBasis: 'tsconfig_hash', freshnessValue: 'x',
    });
    expect(out.status).toBe('partial');
    expect(out.notes.some((n) => n.code === 'enumeration_truncated')).toBe(true);
    for (const op of Object.values(out.operations)) {
      expect(op.status).toBe('partial');
    }
  });

  it('stays ok when enumeration is NOT truncated', async () => {
    await writeFile(path.join(repo, 'a.ts'), 'export function a() {}\n');
    const enumerateFiles = () => ({
      files: ['a.ts'],
      stats: { total: 1, after_filter: 1, truncated: false, max_files: 200 },
    });
    const out = await collectViaLsp({
      req: { projectRoot: repo, scope: 'all', operations: ['symbols'] },
      language: 'typescript', providerName: 'ts-langserver', providerVersion: 'test',
      spawnFor, enumerateFiles, freshnessBasis: 'tsconfig_hash', freshnessValue: 'x',
    });
    expect(out.status).toBe('ok');
    expect(out.notes.some((n) => n.code === 'enumeration_truncated')).toBe(false);
  });
});
