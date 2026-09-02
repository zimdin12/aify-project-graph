// ⛔ APG MUST NEVER CONVERT AN INTERNALLY INCOHERENT LSP LOCATION INTO A NORMAL DEFINITION RECORD.
//
// The obligation is ours, not clangd's. clangd is external and has already been observed emitting
// a DIRECTORY uri carrying a character-precise identifier range:
//
//   uri:  file:///C:/Program%20Files/.../MSVC/14.43.34604/include        <- a directory
//   range: line 4, characters 5-16                                        <- exactly `alphaCaller`
//
// Captured at the wire, before any rewrite, on the real provider path — receipts in
// docs/evidence/m1a-step-c/receipts/boundary-capture.jsonl, contract in CONTRACT-lsp-location.md
// which was frozen BEFORE that payload was seen. Six candidate causes for clangd's behaviour have
// been falsified; the cause is still open. That does not matter here: whatever clangd does, a
// record claiming a definition lives in a DIRECTORY is one no consumer can honour, and shipping it
// makes `graph_callers` point an agent at a path that cannot be opened.
//
// ⚠ These frames are REPLAYED through a fake clangd process, not a stubbed function, so LspClient
// framing and decode are exercised too — one of the layers the boundary capture had to rule out.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createCppClangdProvider } from '../../../mcp/stdio/code-intel/providers/cpp-clangd.js';

const FAKE = fileURLToPath(new URL('../../fixtures/lsp-replay/fake-clangd.mjs', import.meta.url));

const SOURCES = {
  'src/callers.cpp': [
    '#include "widgets.h"',
    '',
    '// two comment lines so alphaCaller lands on line 5 (0-based 4),',
    '// matching the captured frame exactly',
    'void alphaCaller() {',
    '  int x = 1;',
    '  (void)x;',
    '}',
  ].join('\n'),
};

function buildRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'apg-replay-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  for (const [rel, text] of Object.entries(SOURCES)) writeFileSync(join(dir, rel), text, 'utf8');
  mkdirSync(join(dir, 'build'), { recursive: true });
  writeFileSync(
    join(dir, 'build', 'compile_commands.json'),
    JSON.stringify([
      { directory: join(dir, 'build'), file: join(dir, 'src', 'callers.cpp'), command: 'clang-cl /c src/callers.cpp' },
    ]),
    'utf8',
  );
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@test');
  git('config', 'user.name', 'test');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'init');
  return dir;
}

// A REAL readable file OUTSIDE the repo, whose bytes actually carry the expected token at the
// range the fake returns. The control has to prove a valid external location survives; pointing at
// this host's MSVC headers proved only that this host has MSVC headers.
let externalDir;
let externalUri;

async function collectWith(repoRoot, mode) {
  const provider = createCppClangdProvider({
    spawn: () => ({
      command: process.execPath,
      args: [FAKE],
      env: {
        ...process.env,
        APG_FAKE_CLANGD_MODE: mode,
        APG_FAKE_EXTERNAL_URI: externalUri,
        APG_FAKE_EXTERNAL_LINE: '0',
        // The mixed frame's VALID sibling, pointed at the file this harness actually created.
        // Its captured URI was a hardcoded absolute path that nothing creates; the test passed
        // only while a LEAKED temp directory from an older run happened to still exist, and it
        // went red the moment that leak was purged (2026-09-02). A control that depends on
        // ambient machine state is not a control.
        APG_FAKE_VALID_URI: pathToFileURL(join(repoRoot, 'src', 'callers.cpp')).href,
      },
    }),
  });
  return provider.collect({ projectRoot: repoRoot, operations: ['definitions'], files: ['src/callers.cpp'] });
}

const definitionRecords = (result) => (result?.records ?? []).filter((r) => r.kind === 'definition');

describe('an internally incoherent LSP location is refused, not recorded', () => {
  let repo;
  beforeEach(() => {
    repo = buildRepo();
    externalDir = mkdtempSync(join(tmpdir(), 'apg-external-'));
    // characters 5..16 on line 0 are exactly `alphaCaller`
    writeFileSync(join(externalDir, 'external.cpp'), ['void alphaCaller() {', '  return;', '}', ''].join('\n'), 'utf8');
    externalUri = pathToFileURL(join(externalDir, 'external.cpp')).toString();
  });
  afterEach(() => {
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* windows handle */ }
    try { rmSync(externalDir, { recursive: true, force: true }); } catch { /* windows handle */ }
  });

  it('POSITIVE CONTROL: the replay harness reaches the provider and produces records at all', async () => {
    // Without this, every assertion below could pass because the fake clangd never answered and
    // the provider produced nothing — an empty result satisfying a "refuses" test for the wrong
    // reason. This is the liveness check the earlier silent probe lacked.
    const result = await collectWith(repo, 'external_readable_file');
    expect(result, 'provider returned no result object').toBeTruthy();
    expect(definitionRecords(result).length, 'harness produced zero records: it never reached the admission path').toBeGreaterThan(0);
  });

  it('a genuine external/system FILE location stays admissible as typed outside-project evidence', async () => {
    // The guard must reject INCOHERENCE, not every URI outside the repo. A system header is a real
    // definition site and refusing it would trade one wrong answer for another.
    const result = await collectWith(repo, 'external_readable_file');
    const defs = definitionRecords(result);
    expect(defs.length).toBeGreaterThan(0);
    expect(defs.some((r) => String(r.file).endsWith('external.cpp'))).toBe(true);
  });

  it('⛔ a DIRECTORY uri paired with an identifier range is REFUSED, with a typed reason', async () => {
    const result = await collectWith(repo, 'invalid_directory');
    const defs = definitionRecords(result);
    const admittedDirectory = defs.filter((r) => /MSVC[\\/][^\\/]+[\\/]include$/.test(String(r.file)));
    expect(admittedDirectory, 'a directory was admitted as a definition site').toEqual([]);
  });

  it('⛔ an ONLY-invalid response yields zero admitted records AND explicit refusal accounting', async () => {
    // The dangerous shape: an unexplained empty result is indistinguishable from "no definitions
    // exist". A refusal must be counted, not merely produce silence.
    const result = await collectWith(repo, 'invalid_directory');
    expect(definitionRecords(result).length).toBe(0);
    const refusals = result?.index?.incoherentLocationsRefused
      ?? result?.incoherentLocationsRefused
      ?? (result?.errors ?? []).filter((e) => /incoherent/i.test(e.code ?? '')).length;
    expect(refusals, 'zero records with no refusal accounting is an unexplained empty result').toBeGreaterThan(0);
  });

  it('the valid sibling survives when a response mixes a good location with an incoherent one', async () => {
    // Refusing the whole response would discard a real definition. The unit of refusal is the
    // LOCATION, not the message.
    const result = await collectWith(repo, 'mixed');
    const defs = definitionRecords(result);
    expect(defs.some((r) => String(r.file).endsWith('callers.cpp')), 'the valid sibling was discarded').toBe(true);
    expect(defs.some((r) => /include$/.test(String(r.file))), 'the incoherent sibling was admitted').toBe(false);
  });
});
