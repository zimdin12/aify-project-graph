// ⛔ A TRUE VALUE NOBODY READS IS THE DEFECT THIS ARC KEEPS REDISCOVERING.
//
// `zeroFilesProcessedReason` is unit-tested next door. That proves the mapper, and proves nothing
// about whether the shipped verb emits it. Review's rule, and it is the one that matters here:
// hard-to-miss is a CONSUMER/WIRING property, not a nesting property — a top-level field can have
// zero consumers just as easily as a nested one. So this calls the real `graphCollectCodeIntel`
// and reads what a caller would actually receive.
//
// I argued for top-level placement to avoid exactly this failure. That argument was wrong: the
// remedy is this file, not a different key path.
//
// Preregistration: docs/evidence/typed-zero-reason/PREREGISTRATION.md
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphCollectCodeIntel } from '../../../mcp/stdio/query/verbs/collect_code_intel.js';

let repoRoot;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-zerofiles-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'a.cpp'), 'int alpha(int x) { return x + 1; }\n');
  // ⚠ A compile DB is REQUIRED to reach the path under test. Without it the provider returns
  // `compile_db_missing` and never gets as far as its no-files branch — which is itself the right
  // behaviour (a typed error, on the error route), and is why the control below asserts errors do
  // NOT grow a zero-files field. My first version of this fixture omitted it and the test failed
  // for the wrong reason.
  const posix = repoRoot.replace(/\\/g, '/');
  await writeFile(join(repoRoot, 'compile_commands.json'), JSON.stringify(
    [{ directory: posix, file: `${posix}/src/a.cpp`, command: 'clang++ -std=c++17 -c src/a.cpp' }], null, 2));
  for (const args of [['init', '-q'], ['config', 'user.email', 'z@z'], ['config', 'user.name', 'z'], ['add', '-A'], ['commit', '-qm', 'x']]) {
    execFileSync('git', args, { cwd: repoRoot });
  }
});

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
});

describe('the typed zero-files reason reaches a real caller', () => {
  it('⛔ a scope that offers no files surfaces NO_FILES_IN_REQUESTED_SCOPE to the caller', async () => {
    // Neither files[] nor scope=all/changed, so the producer takes its `no_files` return. Before
    // this work that arrived as an untyped zero the caller had to interpret.
    const res = await graphCollectCodeIntel({
      repoRoot, language: 'cpp', scope: 'none-of-the-above', operations: ['definitions'],
    });
    expect(res.index, 'the index block must exist, or this test is asserting on nothing').toBeTruthy();
    expect(res.index.zeroFilesProcessed).toBeTruthy();
    expect(res.index.zeroFilesProcessed.reason).toBe('NO_FILES_IN_REQUESTED_SCOPE');
  });

  it('⛔ the value names WHAT asserted it, so a reader can weigh the claim', async () => {
    const res = await graphCollectCodeIntel({
      repoRoot, language: 'cpp', scope: 'none-of-the-above', operations: ['definitions'],
    });
    expect(res.index.zeroFilesProcessed.authority).toBe('producer_note:no_files');
    expect(res.index.zeroFilesProcessed.schema).toBe('zero-files-reason/1');
  });

  it('⛔ it says NOTHING about the repository — only about the requested scope', async () => {
    // The name is the contract. `NO_FILES_IN_REQUESTED_SCOPE` must never be readable as "this
    // repository has no C++ files": src/a.cpp exists and is committed right there.
    const res = await graphCollectCodeIntel({
      repoRoot, language: 'cpp', scope: 'none-of-the-above', operations: ['definitions'],
    });
    expect(res.index.zeroFilesProcessed.reason).toMatch(/REQUESTED_SCOPE$/);
    expect(res.index.zeroFilesProcessed.reason).not.toMatch(/REPO|REPOSITORY|NO_SOURCES/);
  });

  it('POSITIVE CONTROL: the caller receives the population alongside the reason', async () => {
    // A reason without its denominator would be half an answer, and the denominator is the half
    // an agent needs to decide whether to trust an absence.
    const res = await graphCollectCodeIntel({
      repoRoot, language: 'cpp', scope: 'none-of-the-above', operations: ['definitions'],
    });
    expect(res.index.filesProcessed).toBe(0);
    expect(res.index.filesTotal).toBe(0);
  });

  it('POSITIVE CONTROL: an error envelope keeps its OWN route and grows no zero-files field', async () => {
    // The wrapper returns early on error with no index block at all. Without this control, a
    // future refactor could route errors through the zero-files field and quietly turn a failure
    // into an explained emptiness.
    const res = await graphCollectCodeIntel({ language: 'cpp', scope: 'all' });
    expect(res.status).toBe('error');
    expect(res.index).toBeUndefined();
  });
});
