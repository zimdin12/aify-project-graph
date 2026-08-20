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
  // ⛔ THE WALK BOUND IS NOT THE BATCH BOUND. `maxFiles` was handed to the ENUMERATOR, so the walk
  // stopped at the cap and the resume ledger was subtracted from that truncated list. Once those
  // files were collected every later call re-enumerated the same ones, found nothing pending, and
  // said "The collection is COMPLETE; re-running is a no-op."
  //
  // Measured on this repo at dc26d13: 554 first-party files, 210 collected, 352 NEVER collected,
  // and the recovery loop reported CONVERGED. Resume could not advance past the cap.
  it('★★★ caps the BATCH, not the walk — leftover work is reported, not hidden', async () => {
    await writeFile(path.join(repo, 'a.ts'), 'export function a() {}\n');
    // The enumerator now returns the whole corpus; the batch cap belongs to collectViaLsp.
    const enumerateFiles = () => ({
      files: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      stats: { total: 5, after_filter: 5, truncated: false, max_files: 20000 },
    });
    const out = await collectViaLsp({
      req: { projectRoot: repo, scope: 'all', operations: ['symbols'], maxFiles: 2, resume: false },
      language: 'typescript', providerName: 'ts-langserver', providerVersion: 'test',
      spawnFor, enumerateFiles, freshnessBasis: 'tsconfig_hash', freshnessValue: 'x',
    });
    expect(out.session.filesTotal, 'this batch is 2 files').toBe(2);
    expect(out.session.remaining, 'and 3 are still owed').toBe(3);
    expect(out.status, 'a batch with work left is partial').toBe('partial');
    expect(out.notes.some((n) => n.code === 'batch_capped')).toBe(true);
    // ⚠ NOT enumeration_truncated: the walk saw everything. Conflating the two is the defect.
    expect(out.notes.some((n) => n.code === 'enumeration_truncated')).toBe(false);
  });

  it('★★★ CONTROL: a corpus that fits under the cap owes nothing and is ok', async () => {
    // Without this, "always report remaining" passes and every collection is permanently partial —
    // a completion signal that never fires is as useless as one that always does.
    await writeFile(path.join(repo, 'a.ts'), 'export function a() {}\n');
    const enumerateFiles = () => ({
      files: ['a.ts'],
      stats: { total: 1, after_filter: 1, truncated: false, max_files: 20000 },
    });
    const out = await collectViaLsp({
      req: { projectRoot: repo, scope: 'all', operations: ['symbols'], maxFiles: 200, resume: false },
      language: 'typescript', providerName: 'ts-langserver', providerVersion: 'test',
      spawnFor, enumerateFiles, freshnessBasis: 'tsconfig_hash', freshnessValue: 'x',
    });
    expect(out.session.remaining).toBe(0);
    expect(out.status).toBe('ok');
    expect(out.notes.some((n) => n.code === 'batch_capped')).toBe(false);
  });
  it('★★★ the ENUMERATOR is handed the walk ceiling, never the batch cap', async () => {
    // ⛔ THIS IS THE ASSERTION THAT ACTUALLY GUARDS THE REGRESSION, and the two tests above do
    // NOT. They drive a stub enumerator that ignores `maxFiles`, so they stay green even if the
    // batch cap is handed straight back to the walk — which is precisely the defect.
    //
    // The bug was `enumerateFiles(projectRoot, { maxFiles })`: the walk stopped at 200, the resume
    // ledger was subtracted from that truncated list, and every later call re-enumerated the same
    // 200 and declared the collection complete. 352 of 554 files were never seen.
    await writeFile(path.join(repo, 'a.ts'), 'export function a() {}\n');
    let sawMaxFiles = null;
    const enumerateFiles = (_root, opts) => {
      sawMaxFiles = opts?.maxFiles;
      return { files: ['a.ts'], stats: { total: 1, after_filter: 1, truncated: false, max_files: opts?.maxFiles } };
    };
    await collectViaLsp({
      req: { projectRoot: repo, scope: 'all', operations: ['symbols'], maxFiles: 2, resume: false },
      language: 'typescript', providerName: 'ts-langserver', providerVersion: 'test',
      spawnFor, enumerateFiles, freshnessBasis: 'tsconfig_hash', freshnessValue: 'x',
    });
    expect(sawMaxFiles, 'the walk must not be bounded by the batch size').not.toBe(2);
    expect(sawMaxFiles, 'it gets the corpus-scale ceiling instead').toBeGreaterThan(1000);
  });
});
