// THE STALENESS GUARD CACHED ITS OWN NEGATIVE VERDICT.
//
// serverBuildInfo() cached its ENTIRE result on first call. Two of its values are
// immutable by construction — the commit this process loaded, when it started —
// but `staleProcess` is a comparison against the tree RIGHT NOW, and the tree is
// the thing that moves. So the guard answered "not stale" once and never looked
// again.
//
// Measured (the field fleet, 2026-08-07). Their server loaded 709cacf on Aug 4, called
// a verb that day while the tree still matched, and cached staleProcess:false.
// Two commits landed Aug 5. On Aug 7 graph_health returned no staleProcess field
// at all, and they concluded — reasonably — that the field post-dated their
// binary. It did not: it shipped Jul 30, five days before their process started.
// The check was present and correct, and had stopped asking the question.
//
// The population this guard exists for is long-lived processes, and a long-lived
// process is precisely the one that has had time to cache "fresh" before going
// stale. The cache disabled the guard exactly where it was needed — the same
// shape as the defect it detects.
//
// Second defect, same report: the negative verdict OMITTED the key rather than
// setting it false, so a frozen "not stale" was indistinguishable from a build
// with no check at all. That ambiguity is what made the wrong diagnosis the
// natural one.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = join(HERE, '..', '..', '..');

/**
 * Stand up a throwaway git repo containing a copy of server-build.js, so the
 * module's SERVER_ROOT git lookups resolve against a tree we control and can
 * move underneath a live process — which is the whole scenario.
 */
async function makeFakeInstall(root) {
  await mkdir(join(root, 'mcp', 'stdio'), { recursive: true });
  await cp(join(REPO, 'mcp', 'stdio', 'server-build.js'), join(root, 'mcp', 'stdio', 'server-build.js'));
  // ⚠ AND ITS SIBLINGS. Copying a module without its local imports produces
  // "Cannot find module" at import time — which is what three tests started reporting the
  // moment server-build gained `./stale-warning-claims.js`.
  //
  // ★ Those three failures are the ones I dismissed as "an undiagnosed flake" in a6a02d9.
  // They were never flaky: they were reproducible, caused by this copy, and they were the
  // signal that the commit was broken. A re-run happened to pass only because the schema
  // file had already been lost by then — the suite went green because the WORK WAS GONE.
  // ⇒ An unexplained failure is a finding, not noise, and "it passed on retry" is a
  // question rather than an answer.
  for (const sibling of ['stale-warning-claims.js']) {
    await cp(join(REPO, 'mcp', 'stdio', sibling), join(root, 'mcp', 'stdio', sibling));
  }
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fake', version: '9.9.9' }));
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'first');
}

function headOf(root) {
  return execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
}

describe('staleProcess is re-evaluated, not frozen at first call', () => {
  let root;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'apg-stale-'));
    await makeFakeInstall(root);
  });

  afterEach(async () => {
    if (root) { try { await rm(root, { recursive: true, force: true }); } catch { /* windows lock */ } }
  });

  it('★ reports stale AFTER the tree moves, even though the first call said fresh', async () => {
    const mod = await import(`file://${join(root, 'mcp', 'stdio', 'server-build.js').replace(/\\/g, '/')}?t=${Date.now()}`);

    // 1. First call while the tree still matches — the field fleet's Aug 4.
    const first = mod.serverBuildInfo();
    expect(first.staleProcess, 'not stale yet').toBe(false);
    const loaded = first.commit;

    // 2. The tree moves under the running process — my Aug 5 commits.
    await writeFile(join(root, 'NEW.md'), 'a commit landed after the process started');
    execFileSync('git', ['-C', root, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'second'], { stdio: 'ignore' });
    expect(headOf(root)).not.toBe(loaded);

    // 3. Ask again. Before the fix this returned the cached Aug 4 verdict forever.
    // The TTL is 5s, so wait it out rather than reaching into module internals —
    // a test that pokes private state would not prove the real caller's path.
    await new Promise((r) => setTimeout(r, 5200));

    const second = mod.serverBuildInfo();
    expect(second.staleProcess, 'the tree moved; the verdict must move with it').toBe(true);
    expect(second.commit, 'still reports the commit this process LOADED').toBe(loaded);
    expect(second.workingTreeCommit).toBe(headOf(root));
    expect(second.staleWarning).toMatch(/SERVER IS RUNNING STALE CODE/);
  }, 30000);

  it('a fresh process states staleProcess:false rather than omitting it', async () => {
    // An absent key cannot be told apart from a build that never had the check.
    // That ambiguity is what made "the field post-dates my binary" the natural
    // reading of a frozen verdict.
    const mod = await import(`file://${join(root, 'mcp', 'stdio', 'server-build.js').replace(/\\/g, '/')}?t=${Date.now()}b`);
    const info = mod.serverBuildInfo();
    expect(Object.hasOwn(info, 'staleProcess'), 'the key is present even when false').toBe(true);
    expect(info.staleProcess).toBe(false);
    expect(info.staleWarning, 'no warning when not stale').toBeUndefined();
  });

  it('immutable identity survives re-evaluation', async () => {
    // The recompute must not disturb what the process IS — only what it thinks
    // about the tree.
    const mod = await import(`file://${join(root, 'mcp', 'stdio', 'server-build.js').replace(/\\/g, '/')}?t=${Date.now()}c`);
    const a = mod.serverBuildInfo();
    await new Promise((r) => setTimeout(r, 5200));
    const b = mod.serverBuildInfo();
    expect(b.commit).toBe(a.commit);
    expect(b.startedAt).toBe(a.startedAt);
    expect(b.version).toBe('9.9.9');
  }, 30000);
});
