// The exit code a scheduler sees from a real run of scripts/post-watch-signals.mjs, not from the pure classifier.
//
// ⛔ The classifier was right and the PROCESS was wrong: fetch's TypeError escaped main() uncaught, so a dashboard
// that was down exited 1, which the aify-env schedule reads as a bug. Only a spawned run can see that, because the
// mapping that failed was the script's own catch, never the function the unit tests call.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../scripts/post-watch-signals.mjs');

let repo;
let refusing;
let refusingPort;
let closedPort;

/** A port that was free a moment ago: listened on, then closed. */
async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

// ⚠ ASYNC ON PURPOSE. spawnSync blocks this process's event loop, and the refusing server lives in this process,
// so the child's request was never answered and the run timed out with status null.
function sweepAgainst(port) {
  const child = spawn(process.execPath, [SCRIPT], {
    cwd: repo,
    env: {
      ...process.env,
      APG_DASHBOARD_URL: `http://127.0.0.1:${port}`,
      APG_DASHBOARD_KEY: 'sk-test-not-a-key',
      APG_DASHBOARD_PROJECT: 'PROJ',
      APG_DASHBOARD_HOST: 'host-test',
      APG_DASHBOARD_REPORTER: 'apg@test/win32/00000000',
      APG_DASHBOARD_ENV: '',
    },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((done) => child.on('close', (status) => done({ status, stdout, stderr })));
}

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'apg-sweep-exit-'));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
  git('init', '-q');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'one');
  // The service's real refusal shape (http/server.ts): `{ error: message, code }`.
  refusing = createServer((req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'this route needs agent authentication', code: 'unauthenticated' }));
  });
  await new Promise((done) => refusing.listen(0, '127.0.0.1', done));
  refusingPort = refusing.address().port;
  closedPort = await freePort();
});

afterAll(async () => {
  await new Promise((done) => refusing.close(done));
  rmSync(repo, { recursive: true, force: true });
});

describe('what a scheduler is told by a real sweep run', () => {
  it('★★★ nothing listening exits 5, not 1: a dashboard restart is not a bug', async () => {
    const run = await sweepAgainst(closedPort);
    expect(run.status, run.stderr).toBe(5);
    expect(run.stderr).toMatch(/^UNAVAILABLE no answer: ECONNREFUSED/mu);
  });

  it('★★★ a refusal at the reservation exits 6 with the status and code on one line, and no key', async () => {
    const run = await sweepAgainst(refusingPort);
    expect(run.status, run.stderr).toBe(6);
    expect(run.stderr).toMatch(/^REFUSED 401 unauthenticated: this route needs agent authentication$/mu);
    expect(`${run.stdout}${run.stderr}`.includes('sk-test-not-a-key')).toBe(false);
  });
});
