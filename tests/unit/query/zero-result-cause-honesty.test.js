// ROOT DEFECT (field report, 2026-07-27): "APG emits an UNVERIFIED CAUSE on every
// zero-result path." Four instances were found across three verbs, each naming a
// cause nobody checked and pointing at expensive remediation that could not work:
// re-export compile_commands, hunt a virtual dispatch, verify graph coverage.
//
// A wrong cause is more expensive than no cause — it converts a dead end into
// hours of misdirected work AND spends the credibility of the FLOOR banners that
// ARE accurate.
//
// Rule: a zero-result path states what it KNOWS and what it RULED OUT, and never
// names a cause it did not verify.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { graphSearch } from '../../../mcp/stdio/query/verbs/search.js';
import { graphTrace } from '../../../mcp/stdio/query/verbs/trace.js';

function initGit(root) {
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '.'); git('commit', '-m', 'i');
}

function node(db, id, label, file, start = 1, end = 3) {
  db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ($id,'Function',$label,$file,$s,$e,'javascript',1,'{}')`,
    { id, label, file, s: start, e: end });
}

describe('zero-result paths do not invent a cause', () => {
  let repoRoot;
  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-zero-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    await mkdir(join(repoRoot, 'src'), { recursive: true });
  });
  afterEach(async () => { try { await rm(repoRoot, { recursive: true, force: true }); } catch {} });

  it('graph_search NO RESULTS states what was ruled out, not an unchecked cause', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    node(db, 'a', 'alpha', 'src/a.js');
    db.close();

    const out = await graphSearch({ repoRoot, query: 'nonexistent_symbol_xyz' });

    expect(out).toMatch(/NO RESULTS/);
    // The old text asserted a cause it never checked and prescribed a probe.
    expect(out).not.toMatch(/verify the graph covers your files/);
    expect(out).toMatch(/Ruled out:|Next:/);
  });

  it('graph_trace failure says CAUSE UNKNOWN when no dispatch site exists', async () => {
    // Two genuinely unrelated symbols with plain bodies — the field case where the
    // tool asserted a dynamic-dispatch boundary that did not exist.
    await writeFile(join(repoRoot, 'src', 'a.js'), 'export function alpha() {\n  return 1;\n}\n');
    await writeFile(join(repoRoot, 'src', 'b.js'), 'export function beta() {\n  return 2;\n}\n');
    initGit(repoRoot);
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    node(db, 'a', 'alpha', 'src/a.js');
    node(db, 'b', 'beta', 'src/b.js');
    db.close();

    const out = await graphTrace({ repoRoot, from: 'alpha', to: 'beta' });

    expect(out).toMatch(/NO STATIC PATH/);
    expect(out).toMatch(/CAUSE UNKNOWN/);
    expect(out).toMatch(/Ruled out: no dynamic-dispatch site/);
    // Must NOT assert the dispatch-boundary story it used to print unconditionally.
    expect(out).not.toMatch(/most likely breaks at a dynamic-dispatch/);
  });

  it('graph_trace DOES blame dispatch when a dispatch site is actually found', async () => {
    // The guard must not over-correct into never naming a cause it did verify.
    await writeFile(join(repoRoot, 'src', 'a.js'),
      'export function alpha() {\n  return handlers["save"](1);\n}\n');
    await writeFile(join(repoRoot, 'src', 'b.js'), 'export function beta() {\n  return 2;\n}\n');
    initGit(repoRoot);
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    node(db, 'a', 'alpha', 'src/a.js', 1, 3);
    node(db, 'b', 'beta', 'src/b.js', 1, 3);
    db.close();

    const out = await graphTrace({ repoRoot, from: 'alpha', to: 'beta' });

    expect(out).toMatch(/dynamic-dispatch site WAS found/);
    expect(out).not.toMatch(/CAUSE UNKNOWN/);
  });
});
