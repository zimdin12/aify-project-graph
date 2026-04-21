import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function waitExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.once('close', () => resolve());
  });
}

function withJsonLine(child, requests) {
  return new Promise((resolve) => {
    const responses = [];
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id) {
            responses.push(msg);
            if (responses.length >= requests.length) resolve(responses);
          }
        } catch {}
      }
    });
    for (const r of requests) child.stdin.write(JSON.stringify(r) + '\n');
  });
}

describe('MCP resources — briefs + overlays exposed over stdio', () => {
  let repo;
  let child;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'apg-mcp-res-'));
    await mkdir(join(repo, '.aify-graph'), { recursive: true });
    await writeFile(join(repo, '.aify-graph', 'brief.agent.md'), 'REPO: tiny\nENTRY: server.js:1\nTRUST ok');
    await writeFile(join(repo, '.aify-graph', 'functionality.json'), '{"version":"0.1","features":[]}');

    child = spawn('node', ['mcp/stdio/server.js'], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_OPTIONS: '' },
    });
  });

  afterAll(async () => {
    child.kill();
    await waitExit(child);
    // Windows holds file descriptors briefly after a child exits. Retry
    // rmdir a few times rather than letting EBUSY fail the whole suite.
    for (let i = 0; i < 10; i++) {
      try { await rm(repo, { recursive: true, force: true }); return; } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  it('initialize advertises resources capability', async () => {
    const res = await withJsonLine(child, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    ]);
    expect(res[0].result.capabilities.resources).toBeDefined();
  });

  it('resources/list on a repo with brief.agent.md + functionality.json shows both', async () => {
    // Change server cwd to the temp repo by spawning a fresh child with cwd set.
    const subchild = spawn('node', [join(process.cwd(), 'mcp/stdio/server.js')], {
      cwd: repo,
    });
    const res = await withJsonLine(subchild, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', id: 2, method: 'resources/list' },
    ]);
    subchild.kill();
    const listRes = res.find(r => r.id === 2);
    expect(listRes).toBeDefined();
    const uris = listRes.result.resources.map(r => r.uri).sort();
    expect(uris).toContain('aify://brief.agent.md');
    expect(uris).toContain('aify://functionality.json');
    // Missing files should not be listed
    expect(uris).not.toContain('aify://tasks.json');
    expect(uris).not.toContain('aify://brief.plan.md');
  });

  it('resources/read returns brief content', async () => {
    const subchild = spawn('node', [join(process.cwd(), 'mcp/stdio/server.js')], {
      cwd: repo,
    });
    const res = await withJsonLine(subchild, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'aify://brief.agent.md' } },
    ]);
    subchild.kill();
    const readRes = res.find(r => r.id === 2);
    expect(readRes.result.contents[0].text).toContain('REPO: tiny');
    expect(readRes.result.contents[0].mimeType).toBe('text/markdown');
  });

  it('resources/read rejects non-aify URIs', async () => {
    const subchild = spawn('node', [join(process.cwd(), 'mcp/stdio/server.js')], {
      cwd: repo,
    });
    const res = await withJsonLine(subchild, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'file:///etc/passwd' } },
    ]);
    subchild.kill();
    const readRes = res.find(r => r.id === 2);
    expect(readRes.error).toBeDefined();
  });

  it('resources/read rejects non-whitelisted filenames', async () => {
    const subchild = spawn('node', [join(process.cwd(), 'mcp/stdio/server.js')], {
      cwd: repo,
    });
    const res = await withJsonLine(subchild, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'aify://graph.sqlite' } },
    ]);
    subchild.kill();
    const readRes = res.find(r => r.id === 2);
    expect(readRes.error).toBeDefined();
    expect(readRes.error.message).toMatch(/not exposed/);
  });
});
