// The hook body ends `>/dev/null 2>&1 &` — it discards every error. A reindex
// that fails leaves the graph stale with nobody informed, which is the silent-
// failure class v0.4.0 spent 137 commits eliminating. A refresh mechanism that
// can quietly stop working is worse than none, because its presence becomes the
// reason not to check.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeRefreshBreadcrumb, readRefreshBreadcrumb, BREADCRUMB_FILE } from '../../../mcp/stdio/freshness/refresh-breadcrumb.js';

describe('refresh breadcrumb', () => {
  let repo;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'apg-crumb-'));
    mkdirSync(join(repo, '.aify-graph'), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch {} });

  it('records a successful refresh with its trigger and commit transition', () => {
    writeRefreshBreadcrumb(repo, { trigger: 'post-merge', from: '88085d5', to: '0b090ea', status: 'ok' });
    const got = readRefreshBreadcrumb(repo);
    expect(got.trigger).toBe('post-merge');
    expect(got.from).toBe('88085d5');
    expect(got.to).toBe('0b090ea');
    expect(got.status).toBe('ok');
    expect(typeof got.at).toBe('string');
    expect(Number.isNaN(Date.parse(got.at))).toBe(false);
  });

  it('records a FAILED refresh with the error text', () => {
    writeRefreshBreadcrumb(repo, { trigger: 'post-commit', from: 'a', to: 'b', status: 'failed', error: 'ENOSPC: no space left' });
    const got = readRefreshBreadcrumb(repo);
    expect(got.status).toBe('failed');
    expect(got.error).toContain('ENOSPC');
  });

  it('returns null when no breadcrumb exists', () => {
    expect(readRefreshBreadcrumb(repo)).toBeNull();
  });

  it('returns null on a corrupt breadcrumb rather than throwing', () => {
    // A half-written file must not take down every graph_health call.
    writeFileSync(join(repo, '.aify-graph', BREADCRUMB_FILE), '{not json');
    expect(readRefreshBreadcrumb(repo)).toBeNull();
  });

  it('writing never throws, even when .aify-graph is missing', () => {
    const bare = mkdtempSync(join(tmpdir(), 'apg-bare-'));
    expect(() => writeRefreshBreadcrumb(bare, { trigger: 'post-commit', from: null, to: null, status: 'ok' })).not.toThrow();
    try { rmSync(bare, { recursive: true, force: true }); } catch {}
  });

  it('truncates a huge error so the breadcrumb stays small', () => {
    writeRefreshBreadcrumb(repo, { trigger: 'post-commit', from: 'a', to: 'b', status: 'failed', error: 'x'.repeat(5000) });
    expect(readRefreshBreadcrumb(repo).error.length).toBeLessThanOrEqual(500);
  });
});
