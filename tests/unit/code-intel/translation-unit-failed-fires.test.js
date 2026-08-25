import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codeIntelReferences } from '../../../mcp/stdio/query/verbs/code_intel_live.js';
import { shutdownAllSessions } from '../../../mcp/stdio/code-intel/live.js';

// ⛔ THIS GUARD HAD NO TEST AT ALL, AND ITS FIRING HALF WAS UNPROVEN IN BOTH PLACES.
//
// `evidence.translationUnitFailed` exists so that an empty caller set from a TU that never
// compiled stops being byte-identical to a TU with no callers — the defect this whole line of
// work is about. It was observed firing ONCE, by hand, against a real clangd
// (scripts/probe-clangd-stdlib-env.mjs: 0 refs + translationUnitFailed on a TU including
// <cstddef>). Then:
//   · ef-manager's field test could not produce a failing TU, so the firing half stayed unproven;
//   · the suite tested `fatalIncludeErrors` in isolation and never that the verb SETS the flag.
// A guard proven once by hand and pinned by nothing can stop firing silently.
//
// ⚠ The fixture could not express the state until now: it emitted only "use of undeclared
// identifier", a severity-1 error the matcher correctly IGNORES. A `unresolved.<ext>` case was
// added so the state is CONSTRUCTIBLE — the same reason the not-ready index knob was added.
//
// ⭐ THREE CASES, BECAUSE THE POINT IS DISCRIMINATION, NOT FIRING. A flag that trips on any hard
// error would mean "something went wrong", not "this TU has no AST", and would be one more field
// to ignore.

const fakeServer = path.resolve('tests/fixtures/code-intel/lsp/fake-lsp-server.mjs');
const spawnCfg = { command: process.execPath, args: [fakeServer], env: { ...process.env } };

let repo;
function tmpRepo(files) {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-tuf-'));
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  for (const name of files) fs.writeFileSync(path.join(repo, 'src', name), 'void f(){}\n');
  return repo;
}

beforeEach(() => { repo = null; });
afterEach(async () => {
  try { await shutdownAllSessions(); } catch { /* ignore */ }
  if (repo) { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } }
});

const refs = (root, file) => codeIntelReferences({
  repoRoot: root, language: 'cpp', file: `src/${file}`, line: 1, col: 6, spawn: spawnCfg,
});

describe('evidence.translationUnitFailed — the firing half', () => {
  it('⭐ FIRES on an unresolved include, and names the header', async () => {
    const root = tmpRepo(['unresolved.cpp']);
    const r = await refs(root, 'unresolved.cpp');

    expect(r.status, 'the verb must still answer (positive control)').toBe('ok');
    expect(r.evidence.translationUnitFailed).toBe(true);
    expect(r.evidence.missingHeaders).toContain('cstddef');
    expect(r.evidence.exhaustive).toBe(false);
    // The remedy must travel with the finding, or a reader learns only that something is wrong.
    expect(r.evidence.warnings.join(' ')).toMatch(/DID NOT COMPILE/);
    expect(r.evidence.warnings.join(' ')).toMatch(/not evidence of absence|badly incomplete/i);
  });

  it('⛔ does NOT fire on a hard error that is not an include failure', async () => {
    // `bad.cpp` publishes severity 1 "use of undeclared identifier". A TU can fail to link, fail
    // to typecheck, and still have a perfectly good AST — the caller set from it is real. If the
    // flag tripped here it would mean "something went wrong" rather than "there is no AST", and
    // would be one more field to ignore.
    const root = tmpRepo(['bad.cpp']);
    const r = await refs(root, 'bad.cpp');
    expect(r.evidence.translationUnitFailed ?? false).toBe(false);
  });

  it('⛔ does NOT fire on a clean TU — the quiet half, which the field test did confirm', async () => {
    const root = tmpRepo(['clean.cpp']);
    const r = await refs(root, 'clean.cpp');
    expect(r.evidence.translationUnitFailed ?? false).toBe(false);
    expect(r.evidence.missingHeaders ?? []).toHaveLength(0);
  });
});

// ⛔ THE CAUSE VALUE WAS DEAD CODE FROM THE DAY I WROTE IT.
//
// The guard set `if (!evidence.cause) evidence.cause = 'translation_unit_did_not_compile'`, with a
// comment claiming "an existing cause is more specific". The reverse is true, and `cause` is NEVER
// null — measured, 0 of 1,134 combinations. So the standing `index_population_unattested` always
// won and this value could not be emitted by any input, while the skill text I wrote told agents
// to branch on it.
//
// ⇒ A STANDING LIMIT MUST NOT CROWD OUT AN INCIDENT. "This TU did not compile, here is the header"
// is actionable; "the index population is unattested" is true of every call.
describe('translationUnitFailed — the cause value must actually be reachable', () => {
  it('⭐ a failed TU reports the SPECIFIC cause, not the standing one', async () => {
    const root = tmpRepo(['unresolved.cpp']);
    const r = await refs(root, 'unresolved.cpp');
    expect(r.evidence.translationUnitFailed).toBe(true);
    expect(r.evidence.cause).toBe('translation_unit_did_not_compile');
    expect(r.evidence.cause).not.toBe('index_population_unattested');
  });

  it('a healthy TU keeps the standing cause — the override is not unconditional', () => {
    // The negative control. If the specific cause appeared everywhere it would be the same
    // non-discriminating field `degraded` already is.
    // (Driven through the builder rather than a session, so no clangd is required.)
    return import('../../../mcp/stdio/query/verbs/code_intel_live.js').then(({ buildReferencesEvidence }) => {
      const e = buildReferencesEvidence({ freshness: 'fresh', callsiteCount: 5, defCount: 1, resultState: 'found', coverage: { complete: true } });
      expect(e.cause).toBe('index_population_unattested');
      expect(e.translationUnitFailed ?? false).toBe(false);
    });
  });
});
