// A FAILED SYNC RECORDED ITSELF AS A SUCCESS.
//
// ⛔ graph-senior-dev, 2026-08-19, found this while reading for the receipt's carrier binding
// rather than by looking for a bug: `openIfNeeded` caught a `didChange` rejection with
// `/* best-effort */` and then updated `openDocState` on the very next line regardless. Our
// record said the document was synced at the new version while the language server still held
// the OLD text — so every answer afterwards was computed against text nobody could see was
// stale, and nothing in the response could reveal it.
//
// ★ THE GENERAL SHAPE, which is why this is worth its own file: the state was written from the
// INTENT to send, not from the SEND. That is the same defect as a coverage census describing a
// repo that has since changed, and as a digest bound to a post-hoc disk read rather than to the
// bytes that actually travelled — a claim attached to a LOOKALIKE of its carrier.
//
// ⇒ Record only what was successfully sent, hash exactly those bytes, and remember the failure
// so both the answer's evidence and any future receipt can refuse rather than guess.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openIfNeeded } from '../../../mcp/stdio/query/verbs/code_intel_live.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-sync-'));
  const file = path.join(dir, 'a.cpp');
  fs.writeFileSync(file, 'int a;\n');
  return { dir, file };
}

// Minimal session double: records what the client was asked to send, and can be told to fail.
function session({ failChange = false } = {}) {
  const sent = [];
  return {
    language: 'cpp',
    openedUris: new Set(),
    openDocState: new Map(),
    sent,
    client: {
      async didOpen(uri, lang, text) { sent.push({ kind: 'open', uri, text }); },
      async didChange(uri, text, version) {
        if (failChange) throw new Error('transport closed');
        sent.push({ kind: 'change', uri, text, version });
      },
    },
  };
}

describe('the open-document carrier', () => {
  it('★★★ records the hash of the bytes actually sent, not of the file on disk later', async () => {
    const { dir, file } = fixture();
    const s = session();
    const uri = await openIfNeeded(s, file);
    const state = s.openDocState.get(uri);
    expect(state.sentSha256).toBe(createHash('sha256').update('int a;\n', 'utf8').digest('hex'));
    // Mutating the file afterwards must NOT change what we claim was sent.
    fs.writeFileSync(file, 'int b;\n');
    expect(s.openDocState.get(uri).sentSha256, 'the record describes the send, not the disk')
      .toBe(createHash('sha256').update('int a;\n', 'utf8').digest('hex'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('★★★ a FAILED didChange does not advance the recorded state', async () => {
    const { dir, file } = fixture();
    const s = session();
    const uri = await openIfNeeded(s, file);
    const atOpen = { ...s.openDocState.get(uri) };

    // Change the file so the re-sync path fires, with a client that rejects.
    s.client.didChange = async () => { throw new Error('transport closed'); };
    fs.writeFileSync(file, 'int completely_different;\n');
    fs.utimesSync(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    await openIfNeeded(s, file);

    const after = s.openDocState.get(uri);
    expect(after.version, 'a rejected send must not bump the version').toBe(atOpen.version);
    expect(after.sentSha256, 'nor claim new bytes reached the server').toBe(atOpen.sentSha256);
  });

  it('★★★ the failure is REMEMBERED, so a later claim can refuse rather than guess', async () => {
    const { dir, file } = fixture();
    const s = session();
    const uri = await openIfNeeded(s, file);
    s.client.didChange = async () => { throw new Error('transport closed'); };
    fs.writeFileSync(file, 'int other;\n');
    fs.utimesSync(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    await openIfNeeded(s, file);
    expect(s.docSyncFailures?.get(uri), 'an unrecorded failure is indistinguishable from success')
      .toMatch(/transport closed/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('★★★ a later SUCCESSFUL sync clears the remembered failure', async () => {
    // Otherwise one transient failure would pin the session as unsyncable forever — the same
    // "standing vs incident" confusion that broke sticky-degraded earlier today.
    const { dir, file } = fixture();
    const s = session();
    const uri = await openIfNeeded(s, file);
    s.client.didChange = async () => { throw new Error('transport closed'); };
    fs.writeFileSync(file, 'int other;\n');
    fs.utimesSync(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    await openIfNeeded(s, file);
    expect(s.docSyncFailures.get(uri)).toBeTruthy();

    s.client.didChange = async () => { /* recovered */ };
    fs.writeFileSync(file, 'int recovered;\n');
    fs.utimesSync(file, new Date(Date.now() + 10_000), new Date(Date.now() + 10_000));
    await openIfNeeded(s, file);
    expect(s.docSyncFailures.get(uri), 'recovery must clear an incident').toBeUndefined();
    expect(s.openDocState.get(uri).sentSha256)
      .toBe(createHash('sha256').update('int recovered;\n', 'utf8').digest('hex'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
