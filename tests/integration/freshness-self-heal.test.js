import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureFresh } from '../../mcp/stdio/freshness/orchestrator.js';
import { openExistingDb } from '../../mcp/stdio/storage/db.js';
import { autoReindexEnabled } from '../../mcp/stdio/freshness/auto-reindex.js';

function git(cwd, ...args) { execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' }); }
function hasSymbol(repo, label) {
  const db = openExistingDb(join(repo, '.aify-graph', 'graph.sqlite'));
  try {
    return db.all(`SELECT label FROM nodes WHERE label = $l`, { l: label }).length > 0;
  } finally { db.close(); }
}

// Proves the engine underpinning the central-gate self-heal: once HEAD advances
// with a new symbol, an ensureFresh (which the gate triggers when
// APG_AUTO_REINDEX is set) picks the symbol up — so a behind-HEAD graph stops
// returning false-empty results. (server.js wires this before the read handler.)
describe('freshness self-heal engine', () => {
  let repo;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'apg-fresh-'));
    git(repo, 'init'); git(repo, 'config', 'user.email', 't@t'); git(repo, 'config', 'user.name', 't');
    writeFileSync(join(repo, 'a.js'), 'export function oldSym(){return 1;}\n');
    git(repo, 'add', '.'); git(repo, 'commit', '-m', 'first');
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch {} });

  it('indexes a newly-committed symbol after HEAD advances (stale → fresh)', async () => {
    await ensureFresh({ repoRoot: repo });
    expect(hasSymbol(repo, 'oldSym')).toBe(true);
    expect(hasSymbol(repo, 'brandNewSym')).toBe(false); // not yet committed/indexed

    writeFileSync(join(repo, 'b.js'), 'export function brandNewSym(){return 2;}\n');
    git(repo, 'add', '.'); git(repo, 'commit', '-m', 'second');
    // graph is now stale (indexed at first commit, HEAD at second) — the
    // self-heal path runs ensureFresh, which must surface the new symbol.
    await ensureFresh({ repoRoot: repo });
    expect(hasSymbol(repo, 'brandNewSym')).toBe(true);
  });

  it('the gate predicate decides whether the self-heal runs', () => {
    expect(autoReindexEnabled('1')).toBe(true);   // gate engages
    expect(autoReindexEnabled(undefined)).toBe(false); // warn-only default
  });
});
