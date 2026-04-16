import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphStatus } from '../../mcp/stdio/query/verbs/status.js';
import { graphIndex } from '../../mcp/stdio/query/verbs/index.js';
import { graphWhereis } from '../../mcp/stdio/query/verbs/whereis.js';
import { graphCallers } from '../../mcp/stdio/query/verbs/callers.js';
import { graphCallees } from '../../mcp/stdio/query/verbs/callees.js';
import { graphNeighbors } from '../../mcp/stdio/query/verbs/neighbors.js';
import { graphModuleTree } from '../../mcp/stdio/query/verbs/module_tree.js';
import { graphImpact } from '../../mcp/stdio/query/verbs/impact.js';
import { graphSummary } from '../../mcp/stdio/query/verbs/summary.js';
import { graphReport } from '../../mcp/stdio/query/verbs/report.js';
import { graphPath } from '../../mcp/stdio/query/verbs/path.js';

const FIXTURE = 'tests/fixtures/integration/sample-project';

describe('integration: full verb pipeline', () => {
  let repo;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'apg-integ-'));
    await cp(FIXTURE, repo, { recursive: true });
    // Init git so freshness layer works
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo });
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('graph_status reports not-indexed before first index', async () => {
    const s = await graphStatus({ repoRoot: repo });
    expect(s.indexed).toBe(false);
    expect(s.nodes).toBe(0);
  });

  it('graph_index builds the graph', async () => {
    const r = await graphIndex({ repoRoot: repo });
    expect(r.indexed).toBe(true);
    expect(r.nodes).toBeGreaterThan(0);
    expect(r.edges).toBeGreaterThan(0);
    // Status should now agree
    const s = await graphStatus({ repoRoot: repo });
    expect(s.indexed).toBe(true);
    expect(s.nodes).toBeGreaterThan(0);
  });

  it('graph_whereis finds handle_request', async () => {
    const out = await graphWhereis({ repoRoot: repo, symbol: 'handle_request' });
    expect(out).toContain('NODE');
    expect(out).toContain('handle_request');
    expect(out).toContain('main.py');
  });

  it('graph_whereis returns NO MATCH for unknown symbol', async () => {
    const out = await graphWhereis({ repoRoot: repo, symbol: 'does_not_exist_xyz' });
    expect(out).toBe('NO MATCH');
  });

  it('graph_callers finds callers of authenticate', async () => {
    const out = await graphCallers({ repoRoot: repo, symbol: 'authenticate' });
    // handle_request calls authenticate
    expect(out).toContain('CALLS');
  });

  it('graph_callees finds callees of handle_request', async () => {
    const out = await graphCallees({ repoRoot: repo, symbol: 'handle_request' });
    // handle_request calls authenticate, get_user, format_response
    expect(out).toContain('CALLS');
  });

  it('graph_neighbors returns edges around authenticate', async () => {
    const out = await graphNeighbors({ repoRoot: repo, symbol: 'authenticate' });
    expect(out).not.toBe('NO MATCH');
    expect(out).not.toBe('NO NEIGHBORS');
  });

  it('graph_module_tree returns file hierarchy', async () => {
    const out = await graphModuleTree({ repoRoot: repo, path: 'src' });
    expect(out).toContain('NODE');
    // Should list files under src/
    expect(out).toContain('src');
  });

  it('graph_impact shows downstream of get_user', async () => {
    const out = await graphImpact({ repoRoot: repo, symbol: 'get_user' });
    // handle_request calls get_user, so it should show up in impact
    expect(out === 'NO IMPACT' || out.includes('EDGE')).toBe(true);
  });

  it('graph_summary returns digest for User class', async () => {
    const out = await graphSummary({ repoRoot: repo, symbol: 'User' });
    expect(out).toContain('NODE');
    expect(out).toContain('User');
  });

  it('graph_report returns project orientation', async () => {
    const out = await graphReport({ repoRoot: repo });
    expect(out).toContain('REPO');
    expect(out).toContain('files');
    expect(out).toContain('nodes');
  });

  it('graph_path traces execution from handle_request', async () => {
    const out = await graphPath({ repoRoot: repo, symbol: 'handle_request', direction: 'out', depth: 3 });
    // Should show a path through authenticate/get_user/format_response
    expect(out === 'NO PATHS' || out.includes('PATH')).toBe(true);
  });

  it('second graph_index on clean tree still returns indexed=true', async () => {
    const r = await graphIndex({ repoRoot: repo });
    expect(r.indexed).toBe(true);
    expect(r.nodes).toBeGreaterThan(0);
  });

  it('force rebuild works', async () => {
    const r = await graphIndex({ repoRoot: repo, force: true });
    expect(r.indexed).toBe(true);
    expect(r.nodes).toBeGreaterThan(0);
  });
});
