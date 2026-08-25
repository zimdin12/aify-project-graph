// WHEN NOTHING TRACKED IS DIRTY, THE FILE-NAME SAMPLE IS NOISE.
//
// Measured (the field test, 2026-08-09) on echoes: `graph_health` shipped 25 sampled
// dirty-file names costing 537 tokens, EVERY one an untracked backup directory
// (.aify-graph.bak-*, .aify-graph-PRE-RESTORE-*), out of 2824 — while
// `trackedDirtyFiles` was [], one line, and that is the field carrying the signal. Both
// of his calls that session paid the 537 and neither used it.
//
// `graph_health` is the verb everyone is told to call first, so its default payload is
// the most-paid response in the product.
//
// ★★ CONVERTED FROM SOURCE-GREP 2026-08-11, AFTER MUTATION PROVED IT WAS DECORATION.
//
// The previous version asserted regexes over `health.js`. Mutation test: corrupt the
// arithmetic it describes — `dirtyFilesTotal: dirtyFiles.length + 999` — with every
// predicate string left intact: **3/3 still green**.
//
// ⚠ AND THE IRONY IS RECORDED BECAUSE IT IS THE ARGUMENT. the field test caught the real
// `dirtyFilesOmitted` arithmetic bug by READING A LIVE PAYLOAD — not with this test,
// which sits on that exact line. A test guarding an arithmetic invariant that survives
// the arithmetic being wrong by 999 was never guarding it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';

let repoRoot;

const git = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'ignore' });

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-dirty-noise-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'a.js'), 'export function alpha() { return 1; }\n');
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('add', '-A');
  execFileSync('git', ['-C', repoRoot, 'commit', '-qm', 'init'], { stdio: 'ignore' });
  await ensureFresh({ repoRoot });
});

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
});

const text = (r) => (typeof r === 'string' ? r : JSON.stringify(r));

describe('graph_health omits the dirty-file sample when nothing tracked is dirty', () => {
  it('★★ UNTRACKED-only dirt: the sample is suppressed and the summary says why', async () => {
    // The echoes shape: many dirty paths, none of them tracked. This is where 537 tokens
    // of backup-directory names went.
    await mkdir(join(repoRoot, '.aify-graph.bak-1'), { recursive: true });
    await writeFile(join(repoRoot, '.aify-graph.bak-1', 'junk.js'), 'export const x = 1;\n');
    await writeFile(join(repoRoot, 'untracked-scratch.js'), 'export const y = 2;\n');

    const res = await graphHealth({ repoRoot });

    expect(res.trackedDirtyFiles ?? [], 'nothing tracked has been modified').toEqual([]);
    expect(text(res), 'the summary must say the dirt is untracked').toMatch(/none of them tracked by git|Nothing tracked has moved/);
    // The sample itself must not be shipped — that is the whole 537-token point.
    expect(res.dirtyFiles ?? [], 'the name sample is noise when nothing tracked is dirty').toEqual([]);
  });

  it('★★ the TOTAL is the real count — arithmetic, not spelling', async () => {
    // The mutation the old version survived: dirtyFilesTotal + 999 stayed green because
    // nothing ever compared the number to reality. Here it is compared.
    await writeFile(join(repoRoot, 'untracked-1.js'), 'export const a = 1;\n');
    await writeFile(join(repoRoot, 'untracked-2.js'), 'export const b = 2;\n');

    const res = await graphHealth({ repoRoot });
    const total = res.dirtyFilesTotal ?? 0;

    // Bounded rather than exact: the real count depends on what git reports as dirty in a
    // fresh temp repo, and pinning an exact integer would make this fragile for no gain.
    // What must hold is that it is a REAL count of a small repo — an off-by-999 fails.
    expect(total, 'a two-file scratch repo cannot have hundreds of dirty files').toBeLessThan(50);
    expect(total, 'and it must actually count them').toBeGreaterThan(0);
  });

  it('★ TRACKED dirt IS reported — suppression must not swallow the signal', async () => {
    // The other half. Suppressing everything would satisfy case 1, and this is the field
    // that carries the actual signal, so losing it would be a far worse regression than
    // the noise it replaced.
    await writeFile(join(repoRoot, 'src', 'a.js'), 'export function alpha() { return 999; }\n');

    const res = await graphHealth({ repoRoot });

    expect(res.trackedDirtyFiles ?? [], 'a modified tracked file must be named').toContain('src/a.js');
    expect(text(res)).not.toMatch(/none of them tracked by git/);
  });
});
