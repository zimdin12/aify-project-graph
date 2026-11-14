// #8 step 2: the provider's `references` and `definitions` calls, shaped from the live code-intel handlers.
//
// What these tests hold:
//   · the arguments are file, line, col and limit only; anything else, and any path that could leave the repository,
//     is refused BEFORE the path guard or the language server is asked anything;
//   · a guard refusal also stops the call before the language server;
//   · a location outside the repository is withheld and counted, decided from the path itself, never from the
//     handler's own outsideRepo flag (definitions never set it);
//   · an upstream error, a throw, or a shape this file does not know is a refusal with a reason code, never an ok
//     answer with an empty list;
//   · nothing here claims an exhaustive set, and every answer says it read the working tree.
//
// The handler outputs below copy the shapes code_intel_live.js returns (codeIntelReferences :1099-1129,
// codeIntelDefinitions :1157-1169, errorResponse :31). No language server runs in this file.
import { describe, it, expect } from 'vitest';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';
import { parseLiveArgs, readLive, LIVE_BOUNDS, LIVE_CALLS, LIVE_HOW } from '../../../scripts/lib/provider-live.mjs';

const REPO = 'C:/repo';
const range = (l1, c1, l2, c2) => ({ start: { line: l1, col: c1 }, end: { line: l2, col: c2 } });
const loc = (file, extra = {}) => ({ file, range: range(3, 5, 3, 11), provenance: 'clangd@live', confidence: 'high', ...extra });
const evidence = (over = {}) => ({
  ready: true, degraded: true, cause: 'index_population_unattested', confidence: 'medium', exhaustive: false,
  fallback: 'verify with rg', warnings: ['the set is a floor'], contractVersion: 1, ...over,
});
const referencesOk = (over = {}) => ({
  status: 'ok', freshness: 'fresh', result_state: 'found', warmedFiles: 3,
  references: [loc('src/a.cpp'), loc('src/b.cpp')],
  referenceLocations: [loc('src/a.cpp'), loc('src/b.cpp')],
  definitionLocations: [loc('include/t.h')],
  definitionSource: 'definition_request',
  evidence: evidence(),
  telemetry: { operation: 'references', references: 2, callsites: 2, definitions: 1 },
  ...over,
});
const definitionsOk = (over = {}) => ({
  status: 'ok', freshness: 'fresh', warmedFiles: 1,
  definitions: [loc('src/t.cpp')],
  evidence: evidence({ cause: 'partial_compile_db_coverage' }),
  telemetry: { operation: 'definitions', definitions: 1 },
  ...over,
});

/** A recorder for the two dependencies, so a refusal can prove neither was reached. */
function deps({ answer = referencesOk(), guard = () => ({ ok: true }) } = {}) {
  const calls = { guard: [], invoke: [] };
  return {
    calls,
    guardPath: async (req) => { calls.guard.push(req); return guard(req); },
    invoke: async (req) => { calls.invoke.push(req); return typeof answer === 'function' ? answer(req) : answer; },
  };
}
const ask = (call, args, d = deps()) => readLive({ call, args, repoRoot: REPO, invoke: d.invoke, guardPath: d.guardPath });

describe('arguments', () => {
  it('★★★ file, line and col are taken as sent; limit defaults only when it was not sent', () => {
    expect(parseLiveArgs({ file: 'src/a.cpp', line: 3, col: 5 }))
      .toEqual({ ok: true, value: { file: 'src/a.cpp', line: 3, col: 5, limit: LIVE_BOUNDS.limit.fallback } });
    expect(parseLiveArgs({ file: 'src/a.cpp', line: 1, col: 1, limit: LIVE_BOUNDS.limit.max }).value.limit).toBe(1000);
    expect(LIVE_BOUNDS.limit).toEqual({ fallback: 100, max: 1000 });
  });

  const malformedArgs = [
      [null, /args must be an object/u],
      [['src/a.cpp'], /args must be an object/u],
      [{ line: 1, col: 1 }, /args.file/u],
      [{ file: '', line: 1, col: 1 }, /args.file/u],
      [{ file: 3, line: 1, col: 1 }, /args.file/u],
      [{ file: 'src/a.cpp', col: 1 }, /args.line/u],
      [{ file: 'src/a.cpp', line: 0, col: 1 }, /args.line/u],
      [{ file: 'src/a.cpp', line: 1.5, col: 1 }, /args.line/u],
      [{ file: 'src/a.cpp', line: '3', col: 1 }, /args.line/u],
      [{ file: 'src/a.cpp', line: Number.MAX_SAFE_INTEGER + 1, col: 1 }, /args.line/u],
      [{ file: 'src/a.cpp', line: 1 }, /args.col/u],
      [{ file: 'src/a.cpp', line: 1, col: -1 }, /args.col/u],
      [{ file: 'src/a.cpp', line: 1, col: 1, limit: 0 }, /args.limit/u],
      [{ file: 'src/a.cpp', line: 1, col: 1, limit: 1001 }, /args.limit/u],
      // Caller-controlled language-server options are not part of the call.
      [{ file: 'src/a.cpp', line: 1, col: 1, warmupFiles: ['src/b.cpp'] }, /warmupFiles/u],
      [{ file: 'src/a.cpp', line: 1, col: 1, language: 'cpp' }, /language/u],
      [{ file: 'src/a.cpp', line: 1, col: 1, spawn: 'x' }, /spawn/u],
      [{ file: 'src/a.cpp', line: 1, col: 1, waitForReadyMs: 60000 }, /waitForReadyMs/u],
    ];
  it.each(malformedArgs)('refuses malformed args before either dependency: %j', async (args, problem) => {
      const parsed = parseLiveArgs(args);
      expect(parsed.ok, JSON.stringify(args)).toBe(false);
      expect(parsed.problem, JSON.stringify(args)).toMatch(problem);
      const d = deps();
      const out = await ask('references', args, d);
      expect(out, JSON.stringify(args)).toMatchObject({ ok: false, reasonCode: 'invalid_request' });
      expect(d.calls, JSON.stringify(args)).toEqual({ guard: [], invoke: [] });
  });

  const escapes = [
      '/etc/passwd', 'C:/Windows/win.ini', 'c:\\x.cpp', 'C:x.cpp', '\\\\server\\share\\a.cpp', '//server/share/a.cpp',
      'file:///C:/repo/a.cpp', '../outside.cpp', 'src/../../outside.cpp', 'src/..', '..', 'src\\..\\..\\x.cpp',
      'src//a.cpp', './src/a.cpp', 'src/./a.cpp', 'src/a.cpp\u0000.h', 'src/a.cpp:stream',
    ];
  it.each(escapes)('refuses unsafe file before either dependency: %s', async (file) => {
      const d = deps();
      const out = await ask('definitions', { file, line: 1, col: 1 }, d);
      expect(out, file).toMatchObject({ ok: false, reasonCode: 'path_outside_repository' });
      expect(d.calls, file).toEqual({ guard: [], invoke: [] });
  });
  it('accepts ordinary repository-relative paths as controls', () => {
    // CONTROL: plain repository-relative paths, including dotted names and a nested one, are accepted.
    for (const file of ['src/a.cpp', 'a.cpp', '.config/x.ts', 'src/a..b.cpp', 'deep/er/still/x.py']) {
      expect(parseLiveArgs({ file, line: 1, col: 1 }).ok, file).toBe(true);
    }
  });
});

describe('the path guard', () => {
  it('★★★ a guard refusal is the answer, and the language server is never asked', async () => {
    const d = deps({ guard: () => ({ ok: false, problem: 'src/link.cpp resolves outside the repository', reasonCode: 'path_outside_repository' }) });
    const out = await ask('references', { file: 'src/link.cpp', line: 1, col: 1 }, d);
    expect(out).toEqual({ ok: false, problem: 'src/link.cpp resolves outside the repository', reasonCode: 'path_outside_repository' });
    expect(d.calls.guard).toEqual([{ repoRoot: REPO, file: 'src/link.cpp' }]);
    expect(d.calls.invoke).toEqual([]);
  });

  it('★★★ no guard, or a guard that throws or answers nonsense, refuses rather than passing the path through', async () => {
    const noGuard = deps();
    expect(await readLive({ call: 'references', args: { file: 'src/a.cpp', line: 1, col: 1 }, repoRoot: REPO, invoke: noGuard.invoke }))
      .toMatchObject({ ok: false, reasonCode: 'path_guard_unavailable' });
    expect(noGuard.calls.invoke).toEqual([]);
    for (const guard of [() => { throw new Error('stat failed'); }, () => undefined, () => ({ ok: 'yes' })]) {
      const d = deps({ guard });
      expect(await ask('references', { file: 'src/a.cpp', line: 1, col: 1 }, d)).toMatchObject({ ok: false, reasonCode: 'path_guard_unavailable' });
      expect(d.calls.invoke).toEqual([]);
    }
  });

  it('★★★ CONTROL: past the guard, the server is asked with exactly file, line and col, and the repository', async () => {
    const d = deps();
    await ask('references', { file: 'src/a.cpp', line: 3, col: 5, limit: 7 }, d);
    expect(d.calls.invoke).toEqual([{ call: 'references', repoRoot: REPO, file: 'src/a.cpp', line: 3, col: 5 }]);
  });

  it('★★★ a call that is not references or definitions is refused before either dependency', async () => {
    expect(LIVE_CALLS).toEqual(['references', 'definitions']);
    for (const call of ['hover', 'find', '', undefined]) {
      const d = deps();
      expect(await ask(call, { file: 'src/a.cpp', line: 1, col: 1 }, d), String(call)).toMatchObject({ ok: false, reasonCode: 'invalid_request' });
      expect(d.calls).toEqual({ guard: [], invoke: [] });
    }
  });
});

describe('references', () => {
  it('★★★ found: callsites and declarations are repository paths with ranges, and the answer says what it read', async () => {
    const out = await ask('references', { file: 'src/t.cpp', line: 3, col: 5 });
    expect(out.ok, out.problem).toBe(true);
    expect(out.value).toMatchObject({
      file: 'src/t.cpp', position: { line: 3, col: 5 }, observed: 'working_tree', resultState: 'found', freshness: 'fresh',
      references: [
        { path: 'src/a.cpp', range: range(3, 5, 3, 11), provenance: 'clangd@live' },
        { path: 'src/b.cpp', range: range(3, 5, 3, 11), provenance: 'clangd@live' },
      ],
      declarations: [{ path: 'include/t.h', range: range(3, 5, 3, 11), provenance: 'clangd@live' }],
      declarationSource: 'definition_request',
      matched: { references: 2, declarations: 2 - 1 },
      withheld: { outsideRepository: { references: 0, declarations: 0 } },
      truncated: false,
    });
    expect(out.value).not.toHaveProperty('definitions');
    expect(LIVE_HOW).toMatch(/working tree/u);
  });

  it('keeps factual failure details, with provider-owned advice and no exhaustive claim', async () => {
    const out = await ask('references', { file: 'src/t.cpp', line: 3, col: 5 }, deps({
      answer: referencesOk({ evidence: evidence({ exhaustive: true, cause: 'translation_unit_did_not_compile', translationUnitFailed: true, missingHeaders: ['vector'] }) }),
    }));
    expect(out.value.evidence).toMatchObject({
      exhaustive: false, cause: 'translation_unit_did_not_compile', translationUnitFailed: true, missingHeaders: ['vector'],
      fallback: expect.stringContaining('working-tree source'),
    });
  });

  it('publishes provider-supported advice rather than legacy options or exhaustive-result promises', async () => {
    const out = await ask('references', { file: 'src/t.cpp', line: 3, col: 5 }, deps({ answer: referencesOk({
      evidence: evidence({ fallback: 'pass warmupFiles[] or wait_for_ready', warnings: ['Add a tsconfig for exhaustive results'] }),
    }) }));
    expect(out.ok).toBe(true);
    expect(out.value.evidence.cause).toBe('index_population_unattested');
    expect(out.value.evidence.fallback).toContain('working-tree source');
    for (const forbidden of ['warmupFiles', 'wait_for_ready', 'exhaustive results']) {
      expectAbsentWithLiveMatcher(/warmupFiles|wait_for_ready|exhaustive results/u, { forbidden, allowed: 'Read the working-tree source' }, JSON.stringify(out.value.evidence), 'advice must fit the provider contract');
    }
  });

  it('★★★ empty is answered as empty, with the result state that says the server looked twice', async () => {
    const out = await ask('references', { file: 'src/t.cpp', line: 3, col: 5 }, deps({
      answer: referencesOk({ result_state: 'not_found_after_retry', references: [], referenceLocations: [], definitionLocations: [], definitionSource: 'none' }),
    }));
    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({ resultState: 'not_found_after_retry', references: [], declarations: [], matched: { references: 0, declarations: 0 } });
  });

  it('★★★ a location outside the repository is withheld and counted, judged by its path and not by the flag', async () => {
    const out = await ask('references', { file: 'src/t.cpp', line: 3, col: 5 }, deps({
      answer: referencesOk({
        referenceLocations: [
          loc('src/a.cpp'),
          loc('C:/Program Files/LLVM/include/x.h', { outsideRepo: true, reason: 'outside_project_root' }),
          // Flag missing, path absolute: still outside.
          loc('/usr/include/stdio.h'),
          loc('untitled:Untitled-1'),
          loc('../sibling/y.cpp'),
          // Flag set on a relative path: trusted in the direction of withholding.
          loc('src/c.cpp', { outsideRepo: true }),
        ],
        definitionLocations: [loc('C:/sdk/t.h', { outsideRepo: true })],
      }),
    }));
    expect(out.ok, out.problem).toBe(true);
    expect(out.value.references.map((r) => r.path)).toEqual(['src/a.cpp']);
    expect(out.value.declarations).toEqual([]);
    expect(out.value.withheld).toEqual({ outsideRepository: { references: 5, declarations: 1 } });
    expect(out.value.matched).toEqual({ references: 1, declarations: 0 });
    for (const forbidden of ['Program Files', 'usr/include', 'C:/sdk', 'untitled:', 'sibling']) {
      expectAbsentWithLiveMatcher(/Program Files|usr\/include|C:\/sdk|untitled:|sibling/u, { forbidden, allowed: 'src/a.cpp' }, JSON.stringify(out.value), 'outside locations must not leak host paths');
    }
  });

  it('★★★ limit cuts the list after the repository filter, and matched counts past the cut', async () => {
    const many = Array.from({ length: 5 }, (_, i) => loc(`src/r${i}.cpp`));
    const out = await ask('references', { file: 'src/t.cpp', line: 3, col: 5, limit: 2 }, deps({ answer: referencesOk({ referenceLocations: many }) }));
    expect(out.value.references.map((r) => r.path)).toEqual(['src/r0.cpp', 'src/r1.cpp']);
    expect(out.value.matched.references).toBe(5);
    expect(out.value.truncated).toBe(true);
    const all = await ask('references', { file: 'src/t.cpp', line: 3, col: 5, limit: 5 }, deps({ answer: referencesOk({ referenceLocations: many }) }));
    expect(all.value.truncated, 'CONTROL: a limit equal to the set is not a cut').toBe(false);
  });
});

describe('definitions', () => {
  it('★★★ found: the definitions are repository paths, and the answer carries no references field', async () => {
    const out = await ask('definitions', { file: 'src/a.cpp', line: 3, col: 5 }, deps({ answer: definitionsOk() }));
    expect(out.ok, out.problem).toBe(true);
    expect(out.value).toMatchObject({
      file: 'src/a.cpp', position: { line: 3, col: 5 }, observed: 'working_tree', freshness: 'fresh',
      definitions: [{ path: 'src/t.cpp', range: range(3, 5, 3, 11), provenance: 'clangd@live' }],
      matched: { definitions: 1 }, withheld: { outsideRepository: { definitions: 0 } }, truncated: false,
      evidence: { exhaustive: false, cause: 'partial_compile_db_coverage' },
    });
    expect(out.value).not.toHaveProperty('references');
  });

  it('★★★ the handler never flags an outside definition; the path alone withholds it', async () => {
    const out = await ask('definitions', { file: 'src/a.cpp', line: 3, col: 5 }, deps({
      answer: definitionsOk({ definitions: [loc('src/t.cpp'), loc('C:/Program Files (x86)/Windows Kits/10/Include/um/winbase.h'), loc('file:///C:/x.h')] }),
    }));
    expect(out.value.definitions.map((d) => d.path)).toEqual(['src/t.cpp']);
    expect(out.value.withheld.outsideRepository.definitions).toBe(2);
  });

  it('★★★ an empty definition list is an ok, empty answer', async () => {
    const out = await ask('definitions', { file: 'src/a.cpp', line: 3, col: 5 }, deps({ answer: definitionsOk({ definitions: [], freshness: 'stale', noValueAdded: true }) }));
    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({ definitions: [], matched: { definitions: 0 }, freshness: 'stale' });
  });
});

describe('failures are refusals with a reason code, never an empty ok', () => {
  it('★★★ the handler\'s own errors keep their code and message', async () => {
    const cases = [
      ['invalid_request', 'repoRoot, file and line are all required'],
      ['language_unsupported', 'no live code-intel backend for .rs'],
      ['language_server_missing', 'clangd not found'],
      ['unsupported_evidence_contract_version', 'version 9 is not supported'],
      ['internal_error', 'session died'],
    ];
    for (const [code, message] of cases) {
      const out = await ask('references', { file: 'src/a.rs', line: 1, col: 1 }, deps({ answer: { status: 'error', errors: [{ code, message, hint: '' }] } }));
      expect(out, code).toMatchObject({ ok: false, reasonCode: code });
      expect(out.problem, code).toContain(message);
    }
  });

  it('★★★ an error code this file does not know is kept in the text but reported as backend_error', async () => {
    const out = await ask('definitions', { file: 'src/a.cpp', line: 1, col: 1 }, deps({ answer: { status: 'error', errors: [{ code: 'ENOENT', message: 'spawn clangd ENOENT' }] } }));
    expect(out).toMatchObject({ ok: false, reasonCode: 'backend_error' });
    expect(out.problem).toMatch(/ENOENT/u);
  });

  it('★★★ a throw from the handler is an in-band refusal', async () => {
    const out = await ask('references', { file: 'src/a.cpp', line: 1, col: 1 }, deps({ answer: () => { throw new Error('pipe closed'); } }));
    expect(out).toMatchObject({ ok: false, reasonCode: 'backend_failed' });
    expect(out.problem).toMatch(/pipe closed/u);
  });

  it.each([
    ['references', referencesOk({ referenceLocations: [loc('src/a.cpp', { range: range(0, 1, 1, 2) })] })],
    ['definitions', definitionsOk({ definitions: [loc('src/a.cpp', { range: range(3, 5, 2, 9) })] })],
  ])('%s refuses a backend range with nonpositive or reversed positions', async (call, answer) => {
    expect(await ask(call, { file: 'src/a.cpp', line: 1, col: 1 }, deps({ answer })))
      .toMatchObject({ ok: false, reasonCode: 'malformed_backend_answer' });
  });

  it('★★★ a shape this file does not know is refused, not read as zero results', async () => {
    const malformed = [
      // A function, because `answer: undefined` would fall back to the recorder's default good answer.
      ['references', () => undefined],
      ['references', null],
      ['references', { status: 'pending' }],
      ['references', { status: 'error' }],
      ['references', { status: 'error', errors: [] }],
      ['references', referencesOk({ referenceLocations: undefined })],
      ['references', referencesOk({ definitionLocations: 'none' })],
      ['references', referencesOk({ referenceLocations: [{ range: null }] })],
      ['references', referencesOk({ referenceLocations: [loc('src/a.cpp', { range: 'line 3' })] })],
      ['references', referencesOk({ evidence: undefined })],
      ['definitions', definitionsOk({ definitions: undefined })],
      ['definitions', definitionsOk({ definitions: [null] })],
      // The other call's shape is not this call's answer.
      ['definitions', referencesOk()],
    ];
    for (const [call, answer] of malformed) {
      const out = await ask(call, { file: 'src/a.cpp', line: 1, col: 1 }, deps({ answer }));
      expect(out, `${call} ${JSON.stringify(answer)?.slice(0, 80)}`).toMatchObject({ ok: false, reasonCode: 'malformed_backend_answer' });
    }
  });
});
