// A SHUTDOWN FUNCTION THAT NOTHING CALLS IS NOT A SHUTDOWN.
//
// I found that graphDashboard filed {db, server} in a write-only registry, added
// stopAllDashboards(), wrote a test asserting the registry drains, and called it fixed.
// graph-senior-dev-hermes then ran the only probe that could see the truth: boot the real
// server, call graph_dashboard (succeeds, real URL), CLOSE STDIN, wait 5 seconds.
//
//   ⇒ THE PROCESS DID NOT EXIT. They had to kill it.
//
// `stopAllDashboards` appeared exactly twice in the repo: its own definition, and my test.
// ZERO production consumers. The leak I had correctly promoted from a test problem to a
// production one was still entirely present, and my registry assertion could never have
// noticed — it tested the function, not the wiring.
//
// ★ THE GENERAL FORM, and it is the third time today: WRITING THE MECHANISM IS NOT
// INSTALLING IT. Same shape as `noteProbeArmed` imported nowhere, and as the collect verb
// that emitted counters the importer never persisted. A capability with no caller is
// indistinguishable from an absent capability at runtime, and perfectly distinguishable in
// a code review — which is why only an end-to-end probe finds it.
//
// ⇒ So this test does what dev did, not what I did: it spawns the REAL server as a child
// process, opens a dashboard through the actual MCP protocol, closes stdin, and requires
// the process to exit on its own.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';

const serverPath = join(dirname(fileURLToPath(import.meta.url)), '../../../mcp/stdio/server.js');

let repoRoot;
let child;

afterEach(async () => {
  if (child && child.exitCode === null) { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  child = undefined;
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
  repoRoot = undefined;
});

async function makeRepo() {
  const repo = await mkdtemp(join(tmpdir(), 'apg-procexit-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ('n', 'File', 'probe', 'src/probe.cpp', 1, 2, 'cpp', 1, '{}')`,
  );
  db.close();
  return repo;
}

// Speaks just enough MCP to call one tool and read one reply.
function rpc(proc, id, method, params) {
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
}

function waitForReply(proc, id, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`no reply to id=${id} within ${timeoutMs}ms`)), timeoutMs);
    const onData = (chunk) => {
      buf += chunk.toString();
      for (const line of buf.split('\n')) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            clearTimeout(timer);
            proc.stdout.off('data', onData);
            resolve(msg);
            return;
          }
        } catch { /* partial line; keep buffering */ }
      }
    };
    proc.stdout.on('data', onData);
  });
}

const exitsWithin = (proc, ms) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), ms);
  proc.once('exit', () => { clearTimeout(timer); resolve(true); });
});

describe('the server process exits after a dashboard has been opened', () => {
  it('★★ closing stdin releases the HTTP listener and the process exits on its own', async () => {
    repoRoot = await makeRepo();
    child = spawn(process.execPath, [serverPath], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, APG_TELEMETRY_DIR: join(repoRoot, '.telemetry') },
    });

    rpc(child, 1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    await waitForReply(child, 1);

    rpc(child, 2, 'tools/call', { name: 'graph_dashboard', arguments: { repo: repoRoot, port: 0 } });
    const res = await waitForReply(child, 2);

    // LIVENESS: the dashboard must genuinely have started, or "the process exited" proves
    // nothing — a server that failed to listen exits trivially.
    const text = JSON.stringify(res);
    expect(text, `harness sanity: the dashboard must have started — got ${text.slice(0, 200)}`)
      .toMatch(/http:\/\/127\.0\.0\.1:\d+/);

    // The MCP host closing stdin is the standard stdio shutdown signal.
    child.stdin.end();

    const exited = await exitsWithin(child, 15_000);
    expect(exited, 'a listening dashboard must not pin the event loop after stdin closes').toBe(true);
  }, 60_000);
});
