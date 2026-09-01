// PUBLIC-OUTPUT / TRANSPORT TEST — reachability, and deliberately not more than that.
//
// ⛔ CLAIM CEILING, STATED BECAUSE I FIRST OVERCLAIMED IT. An earlier version of this file was
// called a "consumer test". It is not one: reading returned JSON proves the value REACHES a
// caller, never that anything CONSUMES it. No production decision or render path branches on
// `index.zeroFilesProcessed` today. If the intended consumer is the agent reading the envelope,
// that is a claim about agents, not something this file demonstrates.
//
// What it does prove is worth having on its own: the field survives the producer→summary boundary
// and arrives with its population, its authority and its schema — which is the half that has
// silently failed twice already in this unit.
//
// ⚠ AND THE ROUTE IS SCHEMA-REACHABLE. My first fixture drove `scope: 'none-of-the-above'`, a
// value the shipped enum (`changed | files | all`) does not admit — so it exercised a path no
// caller can take. `scope: 'files'` with an empty `files[]` reaches the same producer branch and
// is a request an agent can actually make.
//
// Preregistration: docs/evidence/typed-zero-reason/PREREGISTRATION.md
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphCollectCodeIntel } from '../../../mcp/stdio/query/verbs/collect_code_intel.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

let repoRoot;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-zerofiles-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'a.cpp'), 'int alpha(int x) { return x + 1; }\n');
  // A compile DB is required to reach the branch under test; without it the provider returns
  // `compile_db_missing` on the error route and never gets there. My first fixture omitted it and
  // the test failed for the wrong reason.
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

const collectEmptyFilesScope = () => graphCollectCodeIntel({
  repoRoot, language: 'cpp', scope: 'files', files: [], operations: ['definitions'],
});

describe('the typed zero-files reason survives to the public envelope', () => {
  it('⛔ an empty files[] scope surfaces NO_FILES_IN_REQUESTED_SCOPE', async () => {
    const res = await collectEmptyFilesScope();
    expect(res.index, 'the index block must exist, or this test asserts on nothing').toBeTruthy();
    expect(res.index.zeroFilesProcessed).toBeTruthy();
    expect(res.index.zeroFilesProcessed.reason).toBe('NO_FILES_IN_REQUESTED_SCOPE');
  });

  it('⛔ the value names WHAT asserted it, so a reader can weigh the claim', async () => {
    const res = await collectEmptyFilesScope();
    expect(res.index.zeroFilesProcessed.authority).toBe('producer_note:no_files');
    expect(res.index.zeroFilesProcessed.schema).toBe('zero-files-reason/1');
  });

  it('⛔ it says NOTHING about the repository — only about the requested scope', async () => {
    // The name IS the contract: `NO_FILES_IN_REQUESTED_SCOPE` must never read as "this repository
    // has no C++ files", with src/a.cpp committed right there.
    //
    // ⚠ A BARE `not.toMatch` USED TO SIT HERE — my seventh this session, written inside the file
    // whose subject is that a name must not overclaim, using the one assertion form this repo bans
    // because it passes just as happily when the pattern is dead.
    const res = await collectEmptyFilesScope();
    // ⛔ NO WORD-BOUNDARY ANCHORS HERE, AND THE REASON IS THE WHOLE POINT OF THIS HELPER.
    // Underscore is a WORD character, so an anchored `NO_SOURCES` can never match inside
    // `NO_SOURCES_IN_REPOSITORY` — there is no boundary between `S` and `_`. My first version was
    // anchored and the live matcher rejected it as a DEAD INSTRUMENT: the pattern could not fire,
    // so a green result would have meant nothing. A bare `not.toMatch` would have passed silently
    // and asserted nothing at all. The subject is a screaming-snake enum token, so substring
    // presence is the correct test.
    expectAbsentWithLiveMatcher(
      /(REPOSITORY|NO_SOURCES)/,
      { forbidden: 'NO_SOURCES_IN_REPOSITORY', allowed: 'NO_FILES_IN_REQUESTED_SCOPE' },
      res.index.zeroFilesProcessed.reason,
      'the reason must not make a claim about the repository',
    );
    expect(res.index.zeroFilesProcessed.reason).toMatch(/REQUESTED_SCOPE$/);
  });

  it('POSITIVE CONTROL: the population travels with the reason', async () => {
    // A reason without its denominator is half an answer, and the denominator is the half an agent
    // needs to decide whether an absence is trustworthy.
    const res = await collectEmptyFilesScope();
    expect(res.index.filesProcessed).toBe(0);
    expect(res.index.filesTotal).toBe(0);
  });

  it('POSITIVE CONTROL: an error envelope keeps its OWN route and grows no zero-files field', async () => {
    // The wrapper returns early on error with no index block at all. Without this, a refactor
    // could route errors through the zero-files field and turn a failure into an explained
    // emptiness — a strictly worse lie than the one being fixed.
    const res = await graphCollectCodeIntel({ language: 'cpp', scope: 'all' });
    expect(res.status).toBe('error');
    expect(res.index).toBeUndefined();
  });
});
