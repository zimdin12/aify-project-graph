import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURE = 'tests/fixtures/integration/sample-project';

let repo;

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'apg-server-toolset-'));
  await cp(FIXTURE, repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo });
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

function runRpcSequence(messages, args = [], env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['mcp/stdio/server.js', ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);

    for (const message of messages) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
    child.stdin.end();

    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`server exited with code ${code}: ${stderr}`));
        return;
      }

      const lines = stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      resolve(lines);
    });
  });
}

function runToolRpc(args = [], env = {}) {
  return runRpcSequence([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ], args, env);
}

function extractTools(lines) {
  const toolsResponse = lines.find(line => line.id === 2);
  return toolsResponse?.result?.tools ?? [];
}

describe('server toolset selection', () => {
  it('exposes the full toolset by default', async () => {
    const tools = extractTools(await runToolRpc());
    const names = tools.map(tool => tool.name);
    expect(names).toContain('graph_callers');
    expect(names).toContain('graph_dashboard');
    expect(names).not.toContain('graph_summary');
    expect(names).not.toContain('graph_report');
    expect(names).not.toContain('graph_onboard');
    expect(names).not.toContain('graph_lookup');
  });

  it('exposes the new lean-3 verbs in lean mode (v3)', async () => {
    const tools = extractTools(await runToolRpc(['--toolset=lean']));
    const names = tools.map(tool => tool.name).sort();
    expect(names).toEqual([
      'graph_change_plan',
      'graph_consequences',
      'graph_pull',
    ]);
  });

  it('supports lean profile through the environment', async () => {
    const lines = await runToolRpc([], { AIFY_GRAPH_PROFILE: 'lean' });
    const names = extractTools(lines).map(tool => tool.name).sort();
    expect(names).toEqual([
      'graph_change_plan',
      'graph_consequences',
      'graph_pull',
    ]);
  });

  it('keeps non-listed verbs callable in lean mode', async () => {
    const lines = await runRpcSequence([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_summary', arguments: { symbol: 'User', repo } } },
    ], ['--toolset=lean']);
    const callResponse = lines.find(line => line.id === 2);
    const text = callResponse?.result?.content?.[0]?.text ?? '';
    expect(text).toContain('NODE');
    expect(text).toContain('User');
  });

  it('defaults lean mode to compact output unless explicitly overridden', async () => {
    const compactLines = await runRpcSequence([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_callers', arguments: { symbol: 'authenticate', repo } } },
    ], ['--toolset=lean'], { AIFY_GRAPH_OUTPUT: '' });
    const compactText = compactLines.find(line => line.id === 2)?.result?.content?.[0]?.text ?? '';
    expect(compactText).toContain('src/main.py:4');
    expect(compactText).not.toContain('EDGE ');

    const verboseLines = await runRpcSequence([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_callers', arguments: { symbol: 'authenticate', repo } } },
    ], ['--toolset=lean'], { AIFY_GRAPH_OUTPUT: 'verbose' });
    const verboseText = verboseLines.find(line => line.id === 2)?.result?.content?.[0]?.text ?? '';
    expect(verboseText).toContain('EDGE ');
  });
});
