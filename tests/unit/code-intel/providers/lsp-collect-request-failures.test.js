// ⛔⛔ A REQUEST THAT FAILED IS NOT AN ANSWER OF "NOTHING". THE COLLECTION THAT HAD ONE IS PARTIAL.
//
// Found 2026-10-01. A full suite run reported M1's caller set for `alpha.Widget.render` as EMPTY while its positive
// control passed (collection `ok`, edges created). Run alone, the test passes every time. The likely mechanism, read in
// collectViaLsp: every per-symbol request (definition, references, hover) sat in `catch { /* per-symbol */ }`, and a
// failed documentSymbol became an empty outline. A references request that threw (the client's 30s timeout under load,
// or an error reply) recorded nothing, counted nothing, and left the collection `ok`. Its symbol then had no callers,
// which reads as "nothing calls this": the answer this codebase exists not to give falsely.
//
// Failures are now counted per operation, the operation and the collection become `partial`, and a note names how many
// failed and the first one, so a caller set built on it is labelled a floor.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectViaLsp } from '../../../../mcp/stdio/code-intel/providers/lsp-collect.js';

const fakeServer = path.resolve('tests/fixtures/code-intel/lsp/fake-lsp-server.mjs');
const spawnWith = (env) => () => ({ command: process.execPath, args: [fakeServer], env: { ...process.env, ...env } });
const enumerateFiles = () => ({ files: ['a.ts'], stats: { total: 1, after_filter: 1, truncated: false, max_files: 200 } });

let repo;
beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'apg-collect-fail-'));
  // The fake server's default symbol is `foo` at characters 20..23 of line 0.
  await writeFile(path.join(repo, 'a.ts'), 'namespace ns { void foo(int x) {} }\n');
});
afterEach(async () => { await rm(repo, { recursive: true, force: true }); });

const collect = (env, operations = ['symbols', 'references']) => collectViaLsp({
  req: { projectRoot: repo, scope: 'all', operations },
  language: 'typescript', providerName: 'ts-langserver', providerVersion: 'test',
  spawnFor: spawnWith(env), enumerateFiles, freshnessBasis: 'tsconfig_hash', freshnessValue: 'x',
});

describe('a failed request makes the collection partial, and says so', () => {
  it('★★★ a references request that FAILS is counted, and references and the collection are partial', async () => {
    const out = await collect({ FAKE_LSP_REFS_ERROR: '1' });
    expect(out.status).toBe('partial');
    expect(out.operations.references.status).toBe('partial');
    // The reason names the failure. The cap block's reasons (budget, enumeration, batch) must not be borrowed:
    // the first version of this fix let it label a request failure `batch_capped_1_of_1_pending_files`.
    expect(out.operations.references.reason).toBe('requests_failed_1');
    expect(out.session.failedRequests.references).toBe(1);
    const note = out.notes.find((n) => n.code === 'requests_failed');
    expect(note?.message).toMatch(/1 references request/u);
    expect(note?.message).toMatch(/fake references failure/u);
  });

  it('★★★ a documentSymbol request that FAILS is counted: the file\'s symbols are unknown, not absent', async () => {
    const out = await collect({ FAKE_LSP_DOCSYM_ERROR: '1' });
    expect(out.status).toBe('partial');
    expect(out.operations.symbols.status).toBe('partial');
    // The file's references were never asked, because there were no symbols to ask about: that is partial too.
    expect(out.operations.references.status).toBe('partial');
    expect(out.operations.references.reason).toBe('outline_failed_1_files');
    expect(out.session.failedRequests.symbols).toBe(1);
    expect(out.notes.some((n) => n.code === 'requests_failed')).toBe(true);
  });

  it('★★★ an operation that did not fail is NOT relabelled: diagnostics stay ok when only references failed', async () => {
    // The collection is partial; the diagnostics it gathered are complete. The cap block (budget, enumeration, batch)
    // used to mark every remaining operation partial whenever the collection was, and with no cap involved it fell
    // through to `batch_capped_...`, a reason that names something that never happened.
    const out = await collect({ FAKE_LSP_REFS_ERROR: '1' }, ['symbols', 'references', 'diagnostics']);
    expect(out.status).toBe('partial');
    expect(out.operations.diagnostics.status).toBe('ok');
    expect(out.operations.diagnostics.reason).toBeUndefined();
  });

  it('★★★ CONTROL: with no failures the same collection is ok, with nothing counted', async () => {
    // Without this, a provider that marked EVERY collection partial would pass both tests above.
    const out = await collect({});
    expect(out.status).toBe('ok');
    expect(out.operations.references.status).toBe('ok');
    expect(out.session.failedRequests).toEqual({ symbols: 0, definitions: 0, references: 0, hover: 0 });
    expect(out.notes.some((n) => n.code === 'requests_failed')).toBe(false);
  });
});
