// #12: the viewer's /api/diff never hands git an option, and says which of its two failures happened.
//
// `base` was cleaned to [\w./~^-] and passed straight to `git diff --name-only <base>`, so `base=-Ofoo` reached git
// as the -O option. And every git failure answered `not_a_git_repo_or_git_missing`, so an unknown revision in a real
// repository was reported as a missing repository. Driven against a real in-process server and a real git
// repository; execFileSync is wrapped only to record the git calls a request makes.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const gitCalls = [];
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execFileSync: (cmd, args, ...rest) => {
      if (cmd === 'git') gitCalls.push(args);
      return actual.execFileSync(cmd, args, ...rest);
    },
  };
});

const { execFileSync } = await import('node:child_process');
const { openDb } = await import('../../../mcp/stdio/storage/db.js');
const { startDashboard } = await import('../../../mcp/stdio/dashboard/server.js');

const servers = [];
async function serve(repoRoot) {
  fs.mkdirSync(path.join(repoRoot, '.aify-graph'), { recursive: true });
  const db = openDb(path.join(repoRoot, '.aify-graph', 'graph.sqlite'));
  const { server, port } = await startDashboard({ db, port: 0, repoRoot });
  servers.push({ server, db });
  return port;
}
const get = (port, urlPath) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: urlPath, headers: { Host: `127.0.0.1:${port}` } }, (res) => {
    let body = '';
    res.on('data', (d) => { body += d; });
    res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
  });
  req.on('error', reject);
  req.end();
});
// The git calls one request makes, and its answer.
async function diff(port, query) {
  gitCalls.length = 0;
  const answer = await get(port, `/api/diff${query}`);
  return { ...answer, git: gitCalls.splice(0) };
}

let dir; let gitPort; let plainPort;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-diffbase-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'ignore' });
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.aify-graph/\n'); // the server's own graph is not a change
  git('add', '-A');
  git('commit', '-q', '-m', 'one');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n');
  gitPort = await serve(repo);
  const plain = path.join(dir, 'plain');
  fs.mkdirSync(plain);
  plainPort = await serve(plain);
});
afterAll(async () => {
  for (const { server, db } of servers) { await new Promise((r) => server.close(r)); db.close?.(); }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* win lock */ }
});

describe('/api/diff', () => {
  it('★★★ control: the default base answers with the changed file and no error', async () => {
    const r = await diff(gitPort, '');
    expect(r.status).toBe(200);
    expect(r.body.error).toBeUndefined();
    expect(r.body.changed).toBe(1);
  });

  it('★★★ a base that starts with "-" is refused with 400 and git is never run', async () => {
    for (const base of ['-Ofoo', '--output', '-']) {
      const r = await diff(gitPort, `?base=${encodeURIComponent(base)}`);
      expect(r.status, base).toBe(400);
      expect(r.body.error, base).toBe('base_is_an_option');
      expect(r.git, `${base}: no git call`).toEqual([]);
    }
  });

  it('★★★ an unknown revision and a directory that is not a repository get different answers', async () => {
    const unknown = await diff(gitPort, '?base=no-such-revision');
    const notRepo = await diff(plainPort, '');
    expect(unknown.body.error).toBe('unknown_revision');
    expect(notRepo.body.error).toBe('not_a_git_repo_or_git_missing');
  });
});
