// THE NAME A CALLER ASKS FOR MUST REACH THE VERB THAT NAME MEANS.
//
// graph-senior-dev-hermes misbound `graph_collect_code_intel` to `graphHealth` in the
// server's tool table and the boundary + server-toolset suites stayed 19/19 GREEN. Every
// test that exercises a verb imports it DIRECTLY — which proves the verb works and says
// nothing about whether the RPC registry hands that name to that function.
//
// ⇒ A caller does not import anything. It sends a name over stdio, and the mapping from
// name to handler is a separate fact from the handler being correct. Nothing in the suite
// was asserting it, so a swapped row in a 42-entry table was invisible.
//
// ★ Same shape as the shutdown that was written and never wired: the PART was right and
// the CONNECTION was untested. Only an end-to-end call can see it.
//
// This spawns the real server and calls verbs by NAME over the actual protocol, then
// requires each response to be recognisably that verb's own output.
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
  const repo = await mkdtemp(join(tmpdir(), 'apg-routing-'));
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
     VALUES ('n', 'Class', 'RoutingProbe', 'src/probe.cpp', 1, 9, 'cpp', 1, '{}')`,
  );
  db.close();
  return repo;
}

function rpc(proc, id, method, params) {
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
}

function waitForReply(proc, id, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`no reply to id=${id} within ${timeoutMs}ms`)), timeoutMs);
    const onData = (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            clearTimeout(timer);
            proc.stdout.off('data', onData);
            resolve(msg);
            return;
          }
        } catch { /* not a complete json line */ }
      }
    };
    proc.stdout.on('data', onData);
  });
}

// Each verb is identified by something ONLY IT emits. A marker another verb also produces
// would let a misbinding pass, which is the entire defect.
const ROUTES = [
  { tool: 'graph_health', args: {}, mustMatch: /trustLevel|trust_level|codeIntel/, mustNotMatch: /collectionId/ },
  { tool: 'graph_collect_code_intel', args: { operations: ['references'] }, mustMatch: /collectionId|schema_version/, mustNotMatch: /trustLevel/ },
  { tool: 'graph_search', args: { query: 'RoutingProbe' }, mustMatch: /RoutingProbe/, mustNotMatch: /collectionId/ },
];

describe('the MCP registry routes each tool NAME to its own verb', () => {
  it('★★ every probed name returns that verb\'s own output, not another\'s', async () => {
    repoRoot = await makeRepo();
    child = spawn(process.execPath, [serverPath], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, APG_TELEMETRY_DIR: join(repoRoot, '.telemetry') },
    });

    rpc(child, 1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    await waitForReply(child, 1);

    let id = 10;
    for (const route of ROUTES) {
      id += 1;
      rpc(child, id, 'tools/call', { name: route.tool, arguments: { repo: repoRoot, ...route.args } });
      const reply = await waitForReply(child, id);
      const text = JSON.stringify(reply);

      // LIVENESS: an error reply would satisfy most negative checks trivially, so the
      // call must have reached a handler at all before its identity means anything.
      expect(text, `${route.tool}: the call must reach a handler`).not.toMatch(/"code":\s*-3260[12]/);
      expect(text, `${route.tool}: must return its OWN output`).toMatch(route.mustMatch);
      expect(text, `${route.tool}: must not return a different verb's output`)
        .not.toMatch(route.mustNotMatch);
    }

    child.stdin.end();
  }, 120_000);
});
