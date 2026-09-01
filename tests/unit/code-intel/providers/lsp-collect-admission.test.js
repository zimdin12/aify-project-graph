// The lsp-collect CALL SITE must consume the shared validator — proven at this provider, not
// inherited from cpp-clangd's tests.
//
// ⛔ WHY THIS FILE EXISTS. Two mutants survived the first run of this slice:
//   M3 — flatten lsp-collect's scope policy to cpp's (store out-of-repo nodes)   SURVIVED
//   M4 — bypass the shared validator entirely at the definition site            SURVIVED
// The guard could be deleted from this provider and every test still passed. A shared helper
// exercised by one consumer proves nothing about the other, and this is the path carrying the
// records: 163,531 file-bearing rows in this repository come from ts-langserver, and ZERO from
// cpp-clangd.
//
// After this file: all five slice mutants are KILLED (M1 1 failed, M2 3, M3 2, M4 1, M5 3),
// each verified applied and the tree restored clean.
//
// ⚠ THE cpp EXTERNAL CONTROL DOES NOT TRANSFER. On lsp-collect an out-of-repo Location is
// correctly SCOPE-SKIPPED. A control expecting it to be admitted would fail for exactly the right
// reason and invite weakening the guard to "fix" it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectViaLsp } from '../../../../mcp/stdio/code-intel/providers/lsp-collect.js';

const fakeServer = fileURLToPath(new URL('../../../fixtures/code-intel/lsp/fake-lsp-server.mjs', import.meta.url));

let repo;
beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'apg-lsp-admit-'));
  await writeFile(path.join(repo, 'a.ts'), 'export function foo() {}\n');
});
afterEach(async () => { try { await rm(repo, { recursive: true, force: true }); } catch { /* handle */ } });

// ⚠ collectViaLsp takes a `req` envelope, not flat fields. My first version passed them flat and
// ALL FIVE tests failed — including the positive control, which is what told me the harness was
// broken rather than the guard. A run where even the control fails is an instrument fault.
const collect = (env = {}) => collectViaLsp({
  req: { projectRoot: repo, files: ['a.ts'], operations: ['definitions'] },
  language: 'typescript',
  providerName: 'ts-langserver',
  providerVersion: '0.1.0',
  // `export function foo() {}` puts `foo` at characters 16..19. The fake's DEFAULT definition
  // range is 20..23, tuned to the cpp fixture — on this source that covers `() {` and is correctly
  // refused as a token mismatch. Stating the range explicitly keeps the fixture natural and the
  // reason visible.
  spawnFor: () => ({ command: process.execPath, args: [fakeServer], env: { ...process.env, FAKE_LSP_DEF_RANGE: '0,16,19', ...env } }),
  enumerateFiles: () => ['a.ts'],
  freshnessBasis: 'tsconfig_hash',
  freshnessValue: 'x',
});

const definitions = (out) => (out?.records ?? []).filter((r) => r.kind === 'definition');
const sess = (out) => out?.session ?? out ?? {};

describe('lsp-collect consumes the shared admission validator', () => {
  it('POSITIVE CONTROL: an ordinary in-repo definition is still ADMITTED', async () => {
    // Without this, every assertion below could pass because the provider produced nothing.
    const out = await collect();
    expect(definitions(out).length, 'the provider must still produce records').toBeGreaterThan(0);
  });

  it('⛔ an OUT-OF-REPO definition is SCOPE-SKIPPED, not refused and not stored', async () => {
    const out = await collect({ FAKE_LSP_OUT_OF_REPO: '1' });
    const s = sess(out);
    expect(definitions(out), 'an out-of-repo node must not be stored').toHaveLength(0);
    expect(s.outOfRepoSkipped, 'the existing scope counter must still move').toBeGreaterThan(0);
    // A scope decision is not an accusation about the producer.
    expect(s.incoherentLocationsRefused ?? 0, 'a scope skip must not be counted as a refusal').toBe(0);
  });

  it('⛔ an INCOHERENT in-repo definition is REFUSED, with accounting', async () => {
    // In-repo URI, range far past the end of a one-line file: structurally decodable, document
    // incoherent. This is the case M4 proved was going entirely unchecked here.
    const out = await collect({ FAKE_LSP_INCOHERENT: '1' });
    const s = sess(out);
    expect(definitions(out), 'an incoherent location must not become a record').toHaveLength(0);
    expect(s.incoherentLocationsRefused, 'the refusal must be counted, not silently dropped').toBeGreaterThan(0);
    expect(s.outOfRepoSkipped ?? 0, 'an incoherent location is not out of scope').toBe(0);
  });

  it('the two dispositions are DISTINCT — scope skip and refusal never collapse', async () => {
    // Guards the M2/M3 direction: if either bucket absorbed the other, one of these would show
    // both counters moving for a single cause.
    const skipped = sess(await collect({ FAKE_LSP_OUT_OF_REPO: '1' }));
    const refused = sess(await collect({ FAKE_LSP_INCOHERENT: '1' }));
    expect(skipped.outOfRepoSkipped).toBeGreaterThan(0);
    expect(skipped.incoherentLocationsRefused ?? 0).toBe(0);
    expect(refused.incoherentLocationsRefused).toBeGreaterThan(0);
    expect(refused.outOfRepoSkipped ?? 0).toBe(0);
  });

  it('the collection owns a document snapshot, and it reports its accounting', async () => {
    const s = sess(await collect());
    const snap = s.documentSnapshot;
    expect(snap, 'lsp-collect must own a per-collection snapshot').toBeTruthy();
    expect(snap.hits + snap.misses, 'the access partition must hold here too').toBe(snap.snapshotAccesses);
    const p = snap.missPartition;
    expect(p.capturedDocuments + p.cachedFailureEntries + p.countBudgetRefusals).toBe(snap.misses);
  });
});
