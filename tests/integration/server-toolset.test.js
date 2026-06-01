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

// The intent verbs the DEFAULT (no --toolset) profile lists (P4-1). graph_index
// added 2026-06-01 so managed workers can self-refresh a stale graph.
const DEFAULT_LISTED = [
  'code_intel_hierarchy',
  'code_intel_references',
  'graph_callers',
  'graph_collect_code_intel',
  'graph_consequences',
  'graph_digest',
  'graph_explain_diff',
  'graph_explore',
  'graph_health',
  'graph_impact',
  'graph_index',
  'graph_packet',
  'graph_pull',
  'graph_search',
  'graph_trace',
  'graph_whereis',
].sort();

describe('server toolset selection', () => {
  it('lists the focused ~15-verb default set when no toolset is given (P4-1)', async () => {
    const tools = extractTools(await runToolRpc());
    const names = tools.map(tool => tool.name).sort();
    // The default surface is EXACTLY the focused intent set — not the full API.
    expect(names).toEqual(DEFAULT_LISTED);
    expect(names.length).toBe(16);
    // graph_index must be listed so managed workers can self-refresh a stale
    // graph (2026-06-01 Sand Castle A/B field-report fix).
    expect(names).toContain('graph_index');

    // Verbs that are full-listed but NOT in the focused default must be absent
    // from the default listing (still callable — proven in a later test).
    expect(names).not.toContain('graph_callees');
    expect(names).not.toContain('graph_onboard');
    expect(names).not.toContain('graph_dashboard');
    expect(names).not.toContain('graph_overview');
    expect(names).not.toContain('graph_shader');
    expect(names).not.toContain('graph_file');
  });

  it('keeps a hidden-by-default verb callable when no toolset is given (P4-1)', async () => {
    // graph_overview is NOT in the default listing but must still resolve via
    // tools/call — gating is listing-only, never a capability removal.
    const lines = await runRpcSequence([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_index', arguments: { repo } } },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'graph_overview', arguments: { repo, top_k: 3 } } },
    ]);
    const resp = lines.find(line => line.id === 3);
    const text = resp?.result?.content?.[0]?.text ?? '';
    expect(resp?.error).toBeUndefined();
    expect(text).toContain('OVERVIEW');
  });

  it('APG_MCP_TOOLS restricts the default listing to exactly the allowlist (P4-1)', async () => {
    const lines = await runToolRpc([], { APG_MCP_TOOLS: 'graph_packet,graph_pull,graph_consequences' });
    const names = extractTools(lines).map(tool => tool.name).sort();
    expect(names).toEqual(['graph_consequences', 'graph_packet', 'graph_pull']);
  });

  it('APG_MCP_TOOLS gates listing only — omitted verbs stay callable', async () => {
    // Allowlist excludes graph_whereis from the listing, but tools/call must
    // still resolve it.
    const lines = await runRpcSequence([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'graph_whereis', arguments: { symbol: 'User', repo } } },
    ], [], { APG_MCP_TOOLS: 'graph_packet' });
    const listNames = extractTools(lines).map(tool => tool.name);
    expect(listNames).toEqual(['graph_packet']);
    const callResp = lines.find(line => line.id === 3);
    expect(callResp?.error).toBeUndefined();
    expect(callResp?.result?.content?.[0]?.text ?? '').toContain('User');
  });

  it('exposes the trimmed coherent full toolset under --toolset=full (R2 cohesion)', async () => {
    const tools = extractTools(await runToolRpc(['--toolset=full']));
    const names = tools.map(tool => tool.name);
    // ── Visible primary set (the coherent navigable product) ──
    expect(names).toContain('graph_callers');
    expect(names).toContain('graph_dashboard');
    // P1-4 — graph_explain_diff is registered + listed in the full profile.
    expect(names).toContain('graph_explain_diff');
    // P1-2 / P1-3 — graph_trace + graph_explore listed in the full profile.
    expect(names).toContain('graph_trace');
    expect(names).toContain('graph_explore');
    // graph_digest is the ONE analytics front door (composes overview/hotspots/cycles).
    expect(names).toContain('graph_digest');
    // graph_onboard is a VISIBLE orientation primary in full (hidden in default).
    expect(names).toContain('graph_onboard');
    // Live code-intel primaries stay visible.
    expect(names).toContain('code_intel_references');
    expect(names).toContain('code_intel_hierarchy');

    // ── Hidden (still callable by name, just not in tools/list) ──
    // Legacy locator aliases briefs replaced.
    expect(names).not.toContain('graph_summary');
    expect(names).not.toContain('graph_report');
    expect(names).not.toContain('graph_lookup');
    // Planning verbs redundant with graph_packet (share computeDecision).
    expect(names).not.toContain('graph_change_plan');
    expect(names).not.toContain('graph_preflight');
    // Analytics long-tail folded behind graph_digest.
    expect(names).not.toContain('graph_overview');
    expect(names).not.toContain('graph_hotspots');
    expect(names).not.toContain('graph_cycles');
    expect(names).not.toContain('graph_module_tree');
    // Code-intel long-tail.
    expect(names).not.toContain('code_intel_replay');
    expect(names).not.toContain('code_intel_analyze');

    // The trimmed listed set is exactly 30 verbs (41 registered − 11 hidden).
    expect(names.length).toBe(30);
  });

  it('keeps R2-hidden verbs callable by name in the full profile', async () => {
    // graph_overview is hidden from tools/list but must still resolve via
    // tools/call — trimming is manifest-only, never a capability removal.
    const lines = await runRpcSequence([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_index', arguments: { repo } } },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'graph_overview', arguments: { repo, top_k: 3 } } },
    ]);
    const resp = lines.find(line => line.id === 3);
    const text = resp?.result?.content?.[0]?.text ?? '';
    expect(resp?.error).toBeUndefined();
    expect(text).toContain('OVERVIEW');
  });

  it('exposes the lean-5 verbs in lean mode (v5: adds graph_health for skill alignment)', async () => {
    const tools = extractTools(await runToolRpc(['--toolset=lean']));
    const names = tools.map(tool => tool.name).sort();
    expect(names).toEqual([
      'graph_change_plan',
      'graph_consequences',
      'graph_health',
      'graph_packet',
      'graph_pull',
      'graph_watch',
    ]);
  });

  it('supports lean profile through the environment', async () => {
    const lines = await runToolRpc([], { AIFY_GRAPH_PROFILE: 'lean' });
    const names = extractTools(lines).map(tool => tool.name).sort();
    expect(names).toEqual([
      'graph_change_plan',
      'graph_consequences',
      'graph_health',
      'graph_packet',
      'graph_pull',
      'graph_watch',
    ]);
  });

  it('keeps non-listed verbs callable in lean mode', async () => {
    const summaryLines = await runRpcSequence([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_summary', arguments: { symbol: 'User', repo } } },
    ], ['--toolset=lean']);
    const summaryResponse = summaryLines.find(line => line.id === 2);
    const summaryText = summaryResponse?.result?.content?.[0]?.text ?? '';
    expect(summaryText).toContain('NODE');
    expect(summaryText).toContain('User');

    const lookupLines = await runRpcSequence([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_lookup', arguments: { symbol: 'authenticate', repo } } },
    ], ['--toolset=lean']);
    const lookupResponse = lookupLines.find(line => line.id === 2);
    const lookupText = lookupResponse?.result?.content?.[0]?.text ?? '';
    expect(lookupText).toContain('src/auth.py:');
  });

  it('returns a non-empty server-instructions playbook on initialize (P1-1)', async () => {
    const lines = await runRpcSequence([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    ]);
    const init = lines.find(line => line.id === 1);
    const instructions = init?.result?.instructions;
    expect(typeof instructions).toBe('string');
    expect(instructions.length).toBeGreaterThan(0);
    // Trust-spine guidance must be present — the whole point of the channel.
    expect(instructions).toContain('LSP_VERIFIED');
    expect(instructions).toMatch(/TRUST/);
    expect(instructions).toMatch(/lsp/i);
    // Intent routing + orient mentioned.
    expect(instructions).toContain('graph_packet');
    expect(instructions).toContain('graph_consequences');
    // serverInfo still intact alongside the new field.
    expect(init.result.serverInfo.name).toBe('aify-project-graph');
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

// P2a / P2-9 — analytics verbs end-to-end against an indexed fixture repo.
describe('analytics verbs (P2a)', () => {
  beforeAll(async () => {
    // Index the fixture so the analytics verbs have a real graph to read.
    await runRpcSequence([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_index', arguments: { repo } } },
    ]);
  });

  async function callVerb(name, args = {}) {
    const lines = await runRpcSequence([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: { repo, ...args } } },
    ]);
    return lines.find(line => line.id === 2)?.result?.content?.[0]?.text ?? '';
  }

  it('graph_digest returns a budgeted text summary with the key sections', async () => {
    const text = await callVerb('graph_digest', { budget: 6000 });
    expect(text).toContain('DIGEST');
    expect(text).toContain('HOTSPOTS');
    expect(text).toMatch(/PROVENANCE|CYCLES/);
  });

  it('graph_overview returns a cluster map', async () => {
    const text = await callVerb('graph_overview', { top_k: 5 });
    expect(text).toContain('OVERVIEW');
    expect(text).toContain('CLUSTER');
    expect(text).toContain('"clusters"'); // structured data attached
  });

  it('graph_hotspots ranks god nodes', async () => {
    const text = await callVerb('graph_hotspots', { limit: 5 });
    expect(text).toContain('HOTSPOTS');
    expect(text).toContain('"hotspots"');
  });

  it('graph_cycles reports cycles or honestly says none', async () => {
    const text = await callVerb('graph_cycles', { max_len: 5, top_k: 10 });
    expect(text).toContain('CYCLES');
    expect(text).toContain('"cycles"');
  });
});
