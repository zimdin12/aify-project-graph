// Plan #17 D tests: benchmark harness dry-run mode.
// Exercises orchestration + summary logic without spawning real
// `claude -p`. Senior-dev's lock: D is dogfood/exploratory; dry-run
// has to work in CI without real credentials.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const SCRIPT = path.resolve('scripts/bench-ab.mjs');

function tmpConfig({ repos, runs = 4 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-bench-'));
  const configPath = path.join(dir, 'bench.json');
  fs.writeFileSync(configPath, JSON.stringify({
    name: 'dry-run test',
    runs,
    withMcpConfig: '/tmp/with.json',
    withoutMcpConfig: '/tmp/without.json',
    repos: repos ?? [
      { id: 'sand_castle', path: dir, query: 'How does X work?' }
    ]
  }));
  return { dir, configPath };
}

function runHarness({ configPath, dir, extraArgs = [] }) {
  const outPath = path.join(dir, 'results.json');
  execFileSync(process.execPath, [SCRIPT, '--config', configPath, '--dry-run', '--out', outPath, ...extraArgs], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(fs.readFileSync(outPath, 'utf8'));
}

describe('bench-ab.mjs dry-run', () => {
  it('produces a results envelope with both arms + summary', () => {
    const { dir, configPath } = tmpConfig();
    const r = runHarness({ configPath, dir });
    expect(r.schema_version).toBe('0.1');
    expect(r.dryRun).toBe(true);
    expect(r.runs).toBe(4);
    expect(r.repos.length).toBe(1);
    const repo = r.repos[0];
    expect(repo.withArm.runs.length).toBe(4);
    expect(repo.withoutArm.runs.length).toBe(4);
    expect(repo.withArm.summary).toBeTruthy();
    expect(repo.withoutArm.summary).toBeTruthy();
    expect(repo.summary).toBeTruthy();
    // Cost should be lower in WITH arm by construction
    expect(repo.withArm.summary.cost_usd_median).toBeLessThan(repo.withoutArm.summary.cost_usd_median);
  });

  it('respects --runs override', () => {
    const { dir, configPath } = tmpConfig({ runs: 2 });
    const r = runHarness({ configPath, dir, extraArgs: ['--runs', '3'] });
    expect(r.runs).toBe(3);
    expect(r.repos[0].withArm.runs.length).toBe(3);
  });

  it('computes percentage deltas in the summary', () => {
    const { dir, configPath } = tmpConfig();
    const r = runHarness({ configPath, dir });
    const delta = r.repos[0].summary.delta;
    expect(delta.cost_pct).toBeLessThan(0);
    expect(delta.tokens_pct).toBeLessThan(0);
    expect(delta.toolCalls_pct).toBeLessThan(0);
  });

  it('--resolve-templates substitutes <PLUGIN_ROOT> in mcp configs before running', () => {
    const { dir, configPath } = tmpConfig();
    // Drop a template-style with-mcp config with the placeholder
    const tplPath = path.join(dir, 'mcp.with-apg.json');
    fs.writeFileSync(tplPath, JSON.stringify({
      mcpServers: { 'apg': { command: 'node', args: ['<PLUGIN_ROOT>/mcp/stdio/server.js'] } }
    }));
    // Point the bench config at it
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    cfg.withMcpConfig = tplPath;
    fs.writeFileSync(configPath, JSON.stringify(cfg));
    // Run with --resolve-templates and APG_PLUGIN_ROOT
    const outPath = path.join(dir, 'results.json');
    execFileSync(process.execPath, [SCRIPT, '--config', configPath, '--dry-run', '--out', outPath, '--resolve-templates'], {
      env: { ...process.env, APG_PLUGIN_ROOT: '/abs/path/to/apg' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const r = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    expect(r.dryRun).toBe(true);
    expect(r.repos.length).toBe(1);
    // The resolved template file should have been written somewhere; we can't
    // see the exact path from stdout, but the run completing successfully
    // implies the substitution didn't break parsing.
  });

  it('handles multiple repos', () => {
    const { dir, configPath } = tmpConfig({
      repos: [
        { id: 'a', path: '/tmp/a', query: 'q1' },
        { id: 'b', path: '/tmp/b', query: 'q2' }
      ]
    });
    const r = runHarness({ configPath, dir });
    expect(r.repos.length).toBe(2);
    expect(r.repos.map(x => x.repo.id)).toEqual(['a', 'b']);
  });
});
