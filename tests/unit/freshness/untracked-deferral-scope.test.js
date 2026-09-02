// ⛔ AN UNTRACKED FILE THE GRAPH ALREADY HOLDS MUST KEEP BEING REFRESHED.
//
// The deferral (`shouldDeferUntrackedFreshness`, 00169db "avoid untracked refresh churn") exists to
// keep scratch files, build output and half-written experiments OUT of the graph. It was never meant
// to freeze a file the graph is already answering questions about.
//
// ⚠ REGRESSION, introduced in a665e99 and fixed 2026-09-03. The body had become
// `return Boolean(entry?.untracked)` — deferring EVERY untracked file — and the two now-unused
// parameters were the fingerprint of the lost `getNodesByFile` condition.
//
// Measured before the fix: a file indexed by a full rebuild, then edited while still untracked, never
// picked the edit up. The graph kept answering with content that no longer existed on disk while
// every freshness signal stayed green — the worst shape of wrong for an agent.
//
// ⚠ BOTH HALVES ARE PINNED HERE ON PURPOSE. Fixing this by deleting the deferral would have been
// easy and wrong: it would drag every scratch file into the graph. The second test is what stops
// that "fix".
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let repo = null;
afterEach(() => { if (repo) { rmSync(repo, { recursive: true, force: true }); repo = null; } });

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'apg-untracked-scope-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'base.js'), 'export function baseFn(){return 0;}\n');
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');
  return dir;
}

async function hasSymbol(dir, label) {
  const { openExistingDb } = await import('../../../mcp/stdio/storage/db.js');
  const db = openExistingDb(join(dir, '.aify-graph', 'graph.sqlite'));
  try { return (db.get('SELECT COUNT(*) AS c FROM nodes WHERE label = $l', { l: label })?.c ?? 0) > 0; }
  finally { db.close?.(); }
}

describe('the untracked deferral is scoped to files the graph does NOT already hold', () => {
  it('★★★ an edit to an ALREADY-INDEXED untracked file is still picked up', async () => {
    const { graphIndex } = await import('../../../mcp/stdio/query/verbs/index.js');
    repo = makeRepo();

    // A full rebuild DOES include untracked files, so this is how such a file gets into the graph.
    writeFileSync(join(repo, 'src', 'note.js'), 'export function scopeOriginal(){return 1;}\n');
    await graphIndex({ repoRoot: repo, force: true });
    expect(await hasSymbol(repo, 'scopeOriginal'),
      'precondition: force:true must index the untracked file, or this proves nothing').toBe(true);

    // Edit it while it is STILL untracked, then run an INCREMENTAL index.
    writeFileSync(join(repo, 'src', 'note.js'),
      'export function scopeOriginal(){return 1;}\nexport function scopeAfterEdit(){return 2;}\n');
    await graphIndex({ repoRoot: repo, force: false });

    expect(await hasSymbol(repo, 'scopeAfterEdit'),
      'the graph is answering with content that no longer matches disk, and reporting itself fresh')
      .toBe(true);
  }, 120_000);

  it('⛔ but a BRAND-NEW untracked file is still deferred — the churn the deferral exists to avoid', async () => {
    // The guard against "fixing" the above by deleting the deferral. Scratch files, build output and
    // half-written experiments must stay out until they are committed.
    const { graphIndex } = await import('../../../mcp/stdio/query/verbs/index.js');
    repo = makeRepo();
    await graphIndex({ repoRoot: repo, force: false });
    expect(await hasSymbol(repo, 'baseFn'), 'control: the graph was built at all').toBe(true);

    writeFileSync(join(repo, 'src', 'scratch.js'), 'export function scopeScratch(){return 3;}\n');
    await graphIndex({ repoRoot: repo, force: false });

    expect(await hasSymbol(repo, 'scopeScratch'),
      'a brand-new untracked file must NOT be dragged in by an incremental run').toBe(false);
  }, 120_000);
});
