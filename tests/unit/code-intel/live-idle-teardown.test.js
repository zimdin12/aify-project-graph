// ⛔⛔ A LANGUAGE SERVER NOBODY IS USING IS SHUT DOWN.
//
// Every APG MCP server kept each live language server (clangd, tsserver, pyright) until the session ended. Measured
// on 2026-10-04 with three sessions on one C++ repo (fmt 11.1.4, clangd under WSL): 3 clangds, 3.01 GB together,
// all three still alive after 120 idle seconds. Killing them gave the memory back (WSL's VM fell from 20.1 to 17.8
// GB), so a server that exits frees what it held. These tests pin the teardown: an unused session is shut down after
// a configurable window, any use restarts the window, and a request still in flight holds it open.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { getLiveSession, shutdownAllSessions, _resetSessions, idleMsFrom, DEFAULT_IDLE_MS } from '../../../mcp/stdio/code-intel/live.js';

const fakeServer = path.resolve('tests/fixtures/code-intel/lsp/fake-lsp-server.mjs');
const fakeSpawn = { command: process.execPath, args: [fakeServer] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Timers fire late under load, never early, so "still alive" checks cannot flake; "gone" is polled with a ceiling.
async function gone(session, ceilingMs = 15000) {
  const until = Date.now() + ceilingMs;
  while (Date.now() < until) { if (session.client.dead) return true; await sleep(50); }
  return false;
}

let repo;
let savedIdle;
beforeEach(() => {
  _resetSessions();
  savedIdle = process.env.APG_LSP_IDLE_MS;
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-idle-'));
});
afterEach(async () => {
  await shutdownAllSessions();
  _resetSessions();
  if (savedIdle === undefined) delete process.env.APG_LSP_IDLE_MS; else process.env.APG_LSP_IDLE_MS = savedIdle;
});

describe('an unused language server is shut down', () => {
  it('★★★ after the idle window it exits, and the next call starts a fresh one', async () => {
    process.env.APG_LSP_IDLE_MS = '300';
    const first = await getLiveSession({ language: 'cpp', projectRoot: repo, spawn: fakeSpawn });
    expect(first.client.dead).toBeFalsy();
    expect(await gone(first), 'the idle session must exit').toBe(true);
    const second = await getLiveSession({ language: 'cpp', projectRoot: repo, spawn: fakeSpawn });
    expect(second).not.toBe(first);
    expect(second.client.dead).toBeFalsy();
  });

  it('★★★ any use restarts the window', async () => {
    process.env.APG_LSP_IDLE_MS = '600';
    const session = await getLiveSession({ language: 'cpp', projectRoot: repo, spawn: fakeSpawn });
    await sleep(350);
    expect(await getLiveSession({ language: 'cpp', projectRoot: repo, spawn: fakeSpawn })).toBe(session);
    // 750 ms after the start, past the first window, but only 400 ms after the last use.
    await sleep(400);
    expect(session.client.dead, 'a session used 400 ms ago must still be alive').toBeFalsy();
    expect(await gone(session)).toBe(true);
  });

  it('★★★ a request still in flight holds it open past the window', async () => {
    process.env.APG_LSP_IDLE_MS = '300';
    const session = await getLiveSession({ language: 'cpp', projectRoot: repo, spawn: fakeSpawn });
    session.client.pending.set('held', { resolve() {}, reject() {} });
    await sleep(900);
    expect(session.client.dead, 'a session with a request in flight must not be shut down').toBeFalsy();
    session.client.pending.delete('held');
    expect(await gone(session)).toBe(true);
  });
});

describe('the window comes from configuration', () => {
  it('★★★ APG_LSP_IDLE_MS sets it, and anything that is not a positive number gives the default', () => {
    expect(DEFAULT_IDLE_MS).toBe(10 * 60_000);
    expect(idleMsFrom({ APG_LSP_IDLE_MS: '1500' })).toBe(1500);
    for (const bad of [undefined, '', '0', '-5', 'soon']) expect(idleMsFrom({ APG_LSP_IDLE_MS: bad })).toBe(DEFAULT_IDLE_MS);
  });
});
