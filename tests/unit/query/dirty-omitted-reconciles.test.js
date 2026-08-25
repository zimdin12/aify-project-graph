// AN OMITTED-COUNT THAT DISAGREES WITH THE PAYLOAD IS WORSE THAN NO COUNT.
//
// I introduced this the same day I suppressed the untracked name list, and the field test
// caught it one commit later: `dirtyFilesOmitted` kept subtracting `DIRTY_LIST_CAP`
// unconditionally, so echoes reported omitted 2799 of total 2824 — arithmetic asserting
// 25 names were shown, in a response that shows none.
//
// A reader reconciles those two numbers and concludes the payload was truncated somewhere
// they cannot see. Same family as positionGuessSkipped 0 against 21 position_unresolved
// records, which was fixed by explaining the disagreement in place; here the right fix is
// for the numbers not to disagree at all.
//
// ★★ CONVERTED FROM SOURCE-GREP 2026-08-11 AFTER MUTATION SPLIT IT.
//
// The old file had two cases and mutation separated them cleanly:
//   · case 1 asserted the arithmetic EXPRESSION and DID catch a different arithmetic
//     error of the same class (`DIRTY_LIST_CAP * 2`) — a real guard, but one that pins a
//     spelling and would break on a harmless refactor of the same maths.
//   · case 2 asserted that a COMMENT ("must match what was actually printed") appeared
//     within 900 chars of the field. It cannot fail for ANY arithmetic reason. Pure
//     decoration, and I would have defended it.
//
// ⇒ The property is a RECONCILIATION between two emitted numbers and a list, so it is
// checkable end to end without reading the source at all.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';

let repoRoot;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-omitted-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'a.js'), 'export function alpha() { return 1; }\n');
  execFileSync('git', ['-C', repoRoot, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoRoot, 'config', 'user.email', 't@t'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoRoot, 'config', 'user.name', 't'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoRoot, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoRoot, 'commit', '-qm', 'init'], { stdio: 'ignore' });
  await ensureFresh({ repoRoot });
});

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
});

describe('dirtyFilesOmitted matches what was actually printed', () => {
  it('★★ omitted + shown === total, whatever the suppression did', async () => {
    // The invariant, stated as arithmetic over the ACTUAL payload rather than over the
    // expression that computes it. The historical bug (2799 omitted of 2824 total, with
    // zero names shown) violates this directly; so does any future arithmetic error,
    // including ones spelled differently.
    await writeFile(join(repoRoot, 'untracked-1.js'), 'export const a = 1;\n');
    await writeFile(join(repoRoot, 'untracked-2.js'), 'export const b = 2;\n');

    const res = await graphHealth({ repoRoot });

    const total = res.dirtyFilesTotal ?? 0;
    const shown = (res.dirtyFiles ?? []).length;
    const omitted = res.dirtyFilesOmitted ?? 0;

    expect(total, 'harness sanity: the fixture must produce dirty files').toBeGreaterThan(0);
    expect(omitted + shown, 'omitted + shown must reconcile to the total').toBe(total);
  });

  it('★ when the list is SUPPRESSED, omitted equals the total — not total minus a cap', async () => {
    // The exact historical failure. Nothing tracked is dirty, so the name sample is
    // suppressed and NOTHING is printed — therefore everything is omitted. Subtracting a
    // cap here is what produced "25 names were shown" in a response showing none.
    await writeFile(join(repoRoot, 'untracked-only.js'), 'export const c = 3;\n');

    const res = await graphHealth({ repoRoot });

    expect(res.trackedDirtyFiles ?? [], 'fixture must have no TRACKED dirt').toEqual([]);
    expect((res.dirtyFiles ?? []).length, 'the sample must be suppressed').toBe(0);
    expect(res.dirtyFilesOmitted ?? 0, 'nothing shown means everything omitted')
      .toBe(res.dirtyFilesTotal ?? 0);
  });

  it('★ a CLEAN repo reports zero on every axis — the count must not invent omissions', async () => {
    // Without this, `omitted = total` would satisfy the case above by always claiming
    // everything was omitted, including when there was nothing to omit.
    const res = await graphHealth({ repoRoot });

    expect(res.dirtyFilesTotal ?? 0).toBe(0);
    expect(res.dirtyFilesOmitted ?? 0).toBe(0);
    expect((res.dirtyFiles ?? []).length).toBe(0);
  });
});
