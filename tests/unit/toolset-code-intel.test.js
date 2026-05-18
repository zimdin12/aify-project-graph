// Verifies --toolset=code-intel exposes the bounded inner-loop verbs +
// the relevant graph verbs and nothing else by default.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

function listToolsViaServer(args = []) {
  const serverPath = path.resolve('mcp/stdio/server.js');
  const child = spawnSync(process.execPath, [serverPath, ...args], {
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n',
    encoding: 'utf8',
    timeout: 15000
  });
  const lines = (child.stdout || '').split(/\r?\n/u).filter(Boolean);
  const last = lines[lines.length - 1] || '{}';
  let parsed = {};
  try { parsed = JSON.parse(last); } catch { /* leave empty */ }
  return parsed?.result?.tools || [];
}

describe('--toolset=code-intel', () => {
  it('exposes the 5 bounded code_intel_* verbs', () => {
    const tools = listToolsViaServer(['--toolset=code-intel']);
    const names = tools.map(t => t.name);
    expect(names).toContain('code_intel_diagnostics');
    expect(names).toContain('code_intel_references');
    expect(names).toContain('code_intel_definitions');
    expect(names).toContain('code_intel_hover');
    expect(names).toContain('code_intel_symbols');
    expect(names).toContain('code_intel_analyze');
  });

  it('also exposes graph_packet, graph_health, graph_collect_code_intel', () => {
    const tools = listToolsViaServer(['--toolset=code-intel']);
    const names = tools.map(t => t.name);
    expect(names).toContain('graph_packet');
    expect(names).toContain('graph_health');
    expect(names).toContain('graph_collect_code_intel');
  });

  it('does NOT expose discovery/orient verbs like graph_search or graph_report', () => {
    const tools = listToolsViaServer(['--toolset=code-intel']);
    const names = tools.map(t => t.name);
    expect(names).not.toContain('graph_search');
    expect(names).not.toContain('graph_report');
    expect(names).not.toContain('graph_lookup');
  });
});
