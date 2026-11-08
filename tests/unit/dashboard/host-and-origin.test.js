// #12: the operator's graph viewer answers only requests addressed to itself, and never invites cross-origin reads.
//
// Its JSON and text routes sent `Access-Control-Allow-Origin: null`, which any sandboxed iframe or file: page
// satisfies, and nothing checked Host, so a DNS-rebound page could read /api/source while the viewer ran. Driven here
// against a real in-process server on an ephemeral port; no service is started.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { startDashboard } from '../../../mcp/stdio/dashboard/server.js';

let dir; let db; let server; let port;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-host-'));
  fs.mkdirSync(path.join(dir, '.aify-graph'), { recursive: true });
  db = openDb(path.join(dir, '.aify-graph', 'graph.sqlite'));
  ({ server, port } = await startDashboard({ db, port: 0, repoRoot: dir }));
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  db.close?.();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* win lock */ }
});

const get = (urlPath, host) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: urlPath, headers: { Host: host, Origin: 'null' } }, (res) => {
    res.resume();
    res.on('end', () => resolve({ status: res.statusCode, acao: res.headers['access-control-allow-origin'] }));
  });
  req.on('error', reject);
  req.end();
});
const noHost = () => new Promise((resolve, reject) => {
  const socket = net.connect(port, '127.0.0.1', () => socket.write('GET /api/graph HTTP/1.0\r\n\r\n'));
  let text = '';
  socket.on('data', (d) => { text += d; });
  socket.on('end', () => resolve(Number(/^HTTP\/1\.\d (\d{3})/u.exec(text)?.[1])));
  socket.on('error', reject);
});

describe('the viewer answers only requests addressed to itself', () => {
  it('★★★ its own address works with no ACAO header (control), on JSON and static routes', async () => {
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
      const json = await get('/api/graph', host);
      expect(json.status, host).toBe(200);
      expect(json.acao, 'no cross-origin read is invited').toBeUndefined();
    }
  });

  it('★★★ a foreign, wrong-port or missing Host is refused before any route runs', async () => {
    for (const [route, host] of [['/api/graph', `attacker.example:${port}`], ['/', `attacker.example:${port}`], ['/api/graph', '127.0.0.1:1']]) {
      expect((await get(route, host)).status, `${route} ${host}`).toBe(421);
    }
    expect(await noHost()).toBe(421);
  });
});
