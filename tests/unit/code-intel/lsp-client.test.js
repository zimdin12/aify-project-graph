import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { LspClient, canonicalUri } from '../../../mcp/stdio/code-intel/lsp-client.js';

const itWin = process.platform === 'win32' ? it : it.skip;

const fakeServer = path.resolve('tests/fixtures/code-intel/lsp/fake-lsp-server.mjs');

describe('LspClient (against fake server)', () => {
  it('initializes, gets references, and shuts down cleanly', async () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///r' });
    await client.start();
    await client.didOpen('file:///r/src/foo.cpp', 'cpp', 'void foo(int) {}');
    const refs = await client.references('file:///r/src/foo.cpp', { line: 0, character: 5 });
    expect(Array.isArray(refs)).toBe(true);
    expect(refs.length).toBe(1);
    expect(refs[0].uri).toContain('bar.cpp');
    await client.shutdown();
  });

  it('start() rejects cleanly when the binary is missing (no uncaughtException)', async () => {
    // Review-fix #1: pre-fix, ENOENT fired async past start()'s try/catch
    // and bubbled to uncaughtException. The fix added an early 'error'
    // listener that races initialize and rejects start() with the original
    // error so callers can wrap it cleanly.
    const client = new LspClient({
      command: 'apg-definitely-not-a-real-binary',
      args: [],
      rootUri: 'file:///r',
    });
    let caught = null;
    try { await client.start(); } catch (err) { caught = err; }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe('ENOENT');
    expect(caught.path).toBe('apg-definitely-not-a-real-binary');
    // Sanity: no lingering listeners that would crash later. Give the
    // event loop a tick to fire any deferred error events.
    await new Promise(r => setTimeout(r, 50));
  });

  it('collects diagnostics published during didOpen', async () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///r' });
    await client.start();
    await client.didOpen('file:///r/src/bad.cpp', 'cpp', 'int x = ;');
    // give the server a moment to emit the publishDiagnostics notification
    await new Promise(r => setTimeout(r, 50));
    const diags = client.diagnosticsFor('file:///r/src/bad.cpp');
    expect(diags.length).toBe(1);
    expect(diags[0].message).toMatch(/undeclared/);
    await client.shutdown();
  });

  it('returns freshness when waiting for publish diagnostics', async () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///r' });
    await client.start();
    const uri = 'file:///r/src/bad.cpp';
    const before = client.diagnosticPublishCount(uri);
    await client.didOpen(uri, 'cpp', 'int x = ;');
    const result = await client.diagnostics(uri, 250, { sincePublishCount: before });
    expect(result.freshness).toBe('fresh');
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0].message).toMatch(/undeclared/);
    await client.shutdown();
  });

  it('uses pull diagnostics when the server advertises diagnosticProvider', async () => {
    const client = new LspClient({
      command: process.execPath,
      args: [fakeServer],
      env: { ...process.env, FAKE_LSP_PULL_DIAGNOSTICS: '1' },
      rootUri: 'file:///r'
    });
    await client.start();
    const result = await client.diagnostics('file:///r/src/pull-bad.cpp', 0);
    expect(result.freshness).toBe('fresh');
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0].message).toMatch(/pull diagnostic/);
    await client.shutdown();
  });

  it('tracks navigation readiness from LSP progress events', async () => {
    const client = new LspClient({
      command: process.execPath,
      args: [fakeServer],
      env: { ...process.env, FAKE_LSP_PROGRESS: '1' },
      rootUri: 'file:///r'
    });
    await client.start();
    // Plan #14 Step B: 'fresh' requires both ready signal AND workspace
    // warm. Before any didOpen, the client is 'cold' even when the LSP
    // has emitted progress=ready — there's no workspace to be ready ON.
    expect(client.navigationFreshness()).toBe('cold');
    await client.didOpen('file:///r/src/foo.cpp', 'cpp', 'void foo(int) {}');
    const freshness = await client.waitForReady(500);
    expect(freshness).toBe('fresh');
    expect(client.navigationFreshness()).toBe('fresh');
    await client.shutdown();
  });

  it('waitForIndexReady resolves ready after background indexing drains (FIX A)', async () => {
    const client = new LspClient({
      command: process.execPath,
      args: [fakeServer],
      env: { ...process.env, FAKE_LSP_PROGRESS: '1' },
      rootUri: 'file:///r'
    });
    await client.start();
    await client.didOpen('file:///r/src/foo.cpp', 'cpp', 'void foo(int) {}');
    // The fake server emits progress begin immediately and end after ~20ms.
    const r = await client.waitForIndexReady({ timeoutMs: 2000, settleMs: 500 });
    expect(r.ready).toBe(true);
    expect(typeof r.waitMs).toBe('number');
    // Depending on timing the index may already have drained before/within the
    // grace window — any of these are legitimately "ready", and crucially NOT
    // a timeout.
    expect(['index_drained', 'already_ready', 'ready_no_index_needed']).toContain(r.reason);
    expect(r.reason).not.toBe('index_wait_timeout');
    await client.shutdown();
  });

  it('waitForIndexReady resolves ready when no progress is ever signalled (index on disk)', async () => {
    // No FAKE_LSP_PROGRESS → server never emits $/progress. With a warmed
    // file and no pending index work, readiness is reached via the grace
    // window rather than blocking the full timeout.
    const client = new LspClient({
      command: process.execPath,
      args: [fakeServer],
      rootUri: 'file:///r'
    });
    await client.start();
    await client.didOpen('file:///r/src/foo.cpp', 'cpp', 'void foo(int) {}');
    const t0 = Date.now();
    const r = await client.waitForIndexReady({ timeoutMs: 5000, settleMs: 200 });
    expect(r.ready).toBe(true);
    expect(r.reason).toBe('no_progress_signalled');
    // Must not have blocked anywhere near the 5s timeout.
    expect(Date.now() - t0).toBeLessThan(2000);
    await client.shutdown();
  });

  it('returns hover content', async () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///r' });
    await client.start();
    await client.didOpen('file:///r/src/foo.cpp', 'cpp', 'void foo(int) {}');
    const hover = await client.hover('file:///r/src/foo.cpp', { line: 0, character: 5 });
    expect(hover.contents.value).toMatch(/void foo/);
    await client.shutdown();
  });
});

describe('P5-3: clangd orphan self-exit (PPID poll)', () => {
  it('shuts the child down when the parent process is detected dead', async () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///r' });
    await client.start();
    const shutdownSpy = vi.spyOn(client, 'shutdown');
    let orphaned = false;
    // Drive the poll directly with a fast interval and a parent-liveness probe
    // that always reports "dead". _startPpidPoll re-reads APG_PPID_POLL_MS, so
    // restart it with a tiny interval and a forced-dead process.kill.
    client._stopPpidPoll();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, sig) => {
      if (sig === 0) { const e = new Error('no such process'); e.code = 'ESRCH'; throw e; }
      return true;
    });
    client._startPpidPoll({ env: { APG_PPID_POLL_MS: '10' }, onOrphaned: () => { orphaned = true; } });
    await new Promise(r => setTimeout(r, 60));
    killSpy.mockRestore();
    expect(orphaned).toBe(true);
    expect(shutdownSpy).toHaveBeenCalled();
    // Timer should be cleared after firing.
    expect(client._ppidPollTimer).toBeNull();
    await client.shutdown();
  });

  it('does NOT shut down while the parent is alive', async () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///r' });
    await client.start();
    let orphaned = false;
    client._stopPpidPoll();
    // process.kill(pid,0) succeeds → parent alive. Force ppid stable too.
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    client._startPpidPoll({ env: { APG_PPID_POLL_MS: '10' }, onOrphaned: () => { orphaned = true; } });
    await new Promise(r => setTimeout(r, 60));
    killSpy.mockRestore();
    expect(orphaned).toBe(false);
    expect(client._ppidPollTimer).not.toBeNull();
    await client.shutdown();
  });

  it('is opt-outable via APG_PPID_POLL_MS=0 (no timer started)', async () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///r' });
    await client.start();
    client._stopPpidPoll();
    client._startPpidPoll({ env: { APG_PPID_POLL_MS: '0' } });
    expect(client._ppidPollTimer).toBeNull();
    await client.shutdown();
  });

  it('shutdown() clears the poll timer', async () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///r' });
    await client.start();
    client._stopPpidPoll();
    client._startPpidPoll({ env: { APG_PPID_POLL_MS: '10000' } });
    expect(client._ppidPollTimer).not.toBeNull();
    await client.shutdown();
    expect(client._ppidPollTimer).toBeNull();
  });
});

// Audit 2026-06-12 Wave 1 — Windows URI keying + JSON-RPC robustness.
describe('LspClient — URI canonicalization (Windows diagnostics keying)', () => {
  itWin('collapses %3A-encoded colon and drive-letter case to one key', () => {
    const a = canonicalUri('file:///c%3A/Users/x/A.ts');
    const b = canonicalUri('file:///C:/Users/x/A.ts');
    const c = canonicalUri('file:///c:/Users/x/A.ts');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('passes non-file and unparseable strings through unchanged', () => {
    expect(canonicalUri('untitled:foo')).toBe('untitled:foo');
    expect(canonicalUri(undefined)).toBe(undefined);
  });

  itWin('diagnostics published under vscode-uri encoding resolve via a Node file URL key', () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///C:/r' });
    // pyright/tsserver publish `file:///c%3A/...`; we query with pathToFileURL form.
    client._handle({ method: 'textDocument/publishDiagnostics', params: { uri: 'file:///c%3A/r/foo.ts', diagnostics: [{ message: 'boom' }] } });
    expect(client.diagnosticsFor('file:///C:/r/foo.ts')).toHaveLength(1);
    expect(client.diagnosticPublishCount('file:///C:/r/foo.ts')).toBe(1);
  });
});

describe('LspClient — JSON-RPC server-request / crash robustness', () => {
  it('does not resolve a pending client request when a server REQUEST reuses its id', () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///r' });
    client._send = () => {}; // avoid touching a real (null) stdin
    let resolved = false;
    client.pending.set(1, { resolve: () => { resolved = true; }, reject: () => {} });
    // Server-initiated request reusing id 1 (it has a `method`) must NOT be
    // treated as the response to our pending request.
    client._handle({ jsonrpc: '2.0', id: 1, method: 'workspace/configuration', params: {} });
    expect(resolved).toBe(false);
    expect(client.pending.has(1)).toBe(true);
  });

  it('replies MethodNotFound to an unhandled server request so the server is not left waiting', () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///r' });
    const sent = [];
    client._send = (m) => sent.push(m);
    client._handle({ jsonrpc: '2.0', id: 7, method: 'window/showMessageRequest', params: {} });
    expect(sent).toHaveLength(1);
    expect(sent[0].id).toBe(7);
    expect(sent[0].error.code).toBe(-32601);
  });

  it('rejects in-flight requests and marks dead when the server exits', () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///r' });
    let rejected = null;
    client.pending.set(5, { resolve: () => {}, reject: (e) => { rejected = e; } });
    client._onProcExit(1);
    expect(rejected).toBeInstanceOf(Error);
    expect(client.dead).toBe(true);
    expect(client.pending.size).toBe(0);
  });

  it('_send throws on a dead client instead of writing to a destroyed pipe', () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///r' });
    client.dead = true;
    expect(() => client._send({ jsonrpc: '2.0', method: 'noop' })).toThrow(/not connected/);
  });
});
