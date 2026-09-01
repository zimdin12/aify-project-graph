// "NO STATIC PATH" is an ABSENCE claim and must carry the absence caveat, not the presence one.
//
// ⛔ THE DEFECT WAS A MISMATCH, NOT AN OMISSION. Both branches called buildTrustLine. With no
// verified edges — exactly the no-path case — that returns HEURISTIC_TRUST_LINE, whose warning is
// about OVERCOUNTING: tree-sitter "resolves calls BY NAME, so a common name" collides. Correct for a
// result that CONTAINS edges; wrong for one that contains none.
//
// A reader here is deciding whether A reaches B, and "no path" reads as licence to change A. What
// they need is the SPINE'S SCOPE — was there a collection, how much did it cover, was there a
// compile DB — not a caution about name collisions among edges that were never returned.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { graphIndex } from '../../../mcp/stdio/query/verbs/index.js';
import { graphTrace } from '../../../mcp/stdio/query/verbs/trace.js';
// THIRD RATCHET CATCH THIS SESSION. I wrote two more bare negatives here after being corrected
// twice already. The gate is carrying this, not the habit.
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

const FIXTURE = fileURLToPath(new URL('../../fixtures/identity-callers-js', import.meta.url));
let repo;

beforeAll(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-trace-abs-'));
  fs.cpSync(FIXTURE, repo, { recursive: true });
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'i');
  await graphIndex({ repoRoot: repo });
}, 300000);

afterAll(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* handle */ } });

describe('trace gives an absence the absence caveat', () => {
  it('POSITIVE CONTROL: a path that EXISTS is found, so the no-path arm is not vacuous', async () => {
    // Without this, "the absence branch behaves correctly" could pass because trace never finds
    // anything at all — two empty answers, and no evidence the branches differ.
    const out = String(await graphTrace({ repoRoot: repo, from: 'alphaCaller', to: 'alphaHelper' }));
    expectAbsentWithLiveMatcher(
      /NO STATIC PATH/,
      { forbidden: 'TRACE a to b: NO STATIC PATH within 7 hops.', allowed: 'TRACE alphaCaller to alphaHelper: 1 hop' },
      out,
      'alphaCaller calls alphaHelper, so this path must resolve',
    );
  }, 60000);

  it('★ a NO STATIC PATH answer names the spine that could not find one', async () => {
    const out = String(await graphTrace({ repoRoot: repo, from: 'alphaCaller', to: 'betaCaller' }));
    expect(out).toMatch(/NO STATIC PATH/);
    expect(out, 'an absence must carry the absence caveat').toMatch(/absence is from the heuristic graph/);
    expect(out, 'and it must name the scope, which is what the reader acts on').toMatch(/SCOPE:/);
    // The noun travels into the remedy, so the advice matches the question that was asked.
    expect(out).toMatch(/"no path"/);
  }, 60000);

  it('⛔ the two branches get DIFFERENT caveats — that was the whole defect', async () => {
    const found = String(await graphTrace({ repoRoot: repo, from: 'alphaCaller', to: 'alphaHelper' }));
    const absent = String(await graphTrace({ repoRoot: repo, from: 'alphaCaller', to: 'betaCaller' }));
    // The presence arm keeps the OVERCOUNT caveat: it returned edges, and name collisions are the
    // real risk there.
    expect(found, 'a result WITH edges keeps the by-name overcount caveat').toMatch(/heuristic only|BY NAME/);
    expectAbsentWithLiveMatcher(
      /resolves calls BY NAME/,
      { forbidden: 'TRUST: heuristic only (tree-sitter) resolves calls BY NAME, so a common name',
        allowed: 'TRUST: absence is from the heuristic graph and is NOT exhaustive' },
      absent,
      'a result with NO edges must not claim its edges may be overcounted',
    );
    expect(absent).not.toBe(found);
  }, 60000);
});
