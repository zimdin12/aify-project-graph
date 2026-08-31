// ⛔ WIRED IS A PROPERTY OF THE CALL SITE, AND IT KEPT BEING THE UNTESTED HALF.
//
// captureExistingSnapshot has a real concurrency test: it commits from a second connection mid-read
// and proves the snapshot holds. That test says nothing about whether any VERB uses it. Reviewer's
// P0 was exactly this — the helper had zero production callers while the TOCTOU was reported closed
// — and after wiring three consumers, mutants that reverted preflight to an unpinned handle and to
// the wrong manifest/database order BOTH SURVIVED the suite.
//
// ⚠ WHAT THIS FILE PROVES AND WHAT IT DOES NOT. It proves the authority verbs route their decision
// reads through the pinned owner, and that the manifest is read BEFORE the database. It does NOT
// prove isolation — that is the helper's own test, over a real concurrent commit. Two different
// claims, and conflating them is how "wired" came to stand in for "closed" in the first place.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

const calls = [];
const order = [];
vi.mock('../../../mcp/stdio/storage/db.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    captureExistingSnapshot: (dbPath, capture) => {
      calls.push(dbPath);
      order.push('capture');
      return real.captureExistingSnapshot(dbPath, capture);
    },
  };
});

vi.mock('../../../mcp/stdio/freshness/manifest.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    loadManifest: async (dir) => { order.push('manifest'); return real.loadManifest(dir); },
  };
});

let repo;

beforeEach(async () => {
  vi.resetModules();
  calls.length = 0;
  order.length = 0;
  repo = mkdtempSync(join(tmpdir(), 'apg-pinned-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  writeFileSync(join(repo, 'src', 'a.js'),
    'export function target() { return 1; }\nexport function caller() { return target(); }\n');
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');
  const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
  await ensureFresh({ repoRoot: repo });
  calls.length = 0;
  order.length = 0;
});

afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

describe('the verbs that grant or withhold authority read through the pinned owner', () => {
  it('⛔ graph_preflight captures its decision inputs', async () => {
    const { graphPreflight } = await import('../../../mcp/stdio/query/verbs/preflight.js');
    await graphPreflight({ repoRoot: repo, symbol: 'target' });
    expect(calls.length, 'preflight decided from an unpinned handle').toBeGreaterThan(0);
    expect(calls.some((p) => p.endsWith('graph.sqlite'))).toBe(true);
  });

  it('⛔ graph_preflight reads the MANIFEST before the database', async () => {
    // The order is load-bearing: manifest first means a commit landing in between reads as a
    // generation mismatch and denies. Manifest second means the two reads straddle the commit and
    // agree only because of where they fell. It was loaded mid-database-work, across an await.
    const { graphPreflight } = await import('../../../mcp/stdio/query/verbs/preflight.js');
    await graphPreflight({ repoRoot: repo, symbol: 'target' });

    // ⛔ COMPARE THE POSITIONS, DO NOT MERELY COUNT THEM. My first version asserted that a manifest
    // load happened and that a capture happened, which is true in BOTH orders — read_freshness
    // loads the manifest before preflight runs at all, so the check could never fail. A mutant
    // that swapped preflight's two lines survived it.
    //
    // Correct order interleaves as manifest, capture, manifest, capture; the swapped version ends
    // manifest AFTER preflight's own capture. So the last manifest must precede the last capture.
    const lastManifest = order.lastIndexOf('manifest');
    const lastCapture = order.lastIndexOf('capture');
    expect(lastManifest, 'the manifest was never loaded').toBeGreaterThanOrEqual(0);
    expect(lastCapture, 'nothing was captured').toBeGreaterThanOrEqual(0);
    expect(lastManifest, 'the manifest must be read BEFORE the database snapshot it is compared against')
      .toBeLessThan(lastCapture);
  });

  it('⛔ graph_status captures its counts and publication together', async () => {
    const { graphStatus } = await import('../../../mcp/stdio/query/verbs/status.js');
    await graphStatus({ repoRoot: repo });
    expect(calls.length, 'status read nodes/edges and the generation unpinned').toBeGreaterThan(0);
  });

  it('⛔ the freshness gate captures its file count and publication together', async () => {
    const { inspectReadFreshness } = await import('../../../mcp/stdio/query/verbs/read_freshness.js');
    await inspectReadFreshness({ repoRoot: repo, verbName: 'graph_callers' });
    expect(calls.length, 'the freshness gate read both facts unpinned').toBeGreaterThan(0);
  });

  it('⛔ an ATTESTED graph must not be described as unattested by preflight', async () => {
    // ⭐ A REAL SURVIVOR FOUND THIS. Setting `publication: null` inside preflight's capture makes
    // classifyPublication see no generation, return legacy_unattested, and deny — and every test
    // passed, because preflight's decision tests call computeDecision directly with an attestation
    // handed to them, and no test ran the VERB end to end against a healthy graph.
    //
    // A gate whose closed state is permanent is off, not fail-closed. This is the positive control
    // for the whole verb path: the graph built in beforeEach is attested, so preflight must not
    // reach for any of the unattested wordings when describing it.
    const { graphPreflight } = await import('../../../mcp/stdio/query/verbs/preflight.js');
    const out = await graphPreflight({ repoRoot: repo, symbol: 'target' });
    expectAbsentWithLiveMatcher(
      /predates publication attestation|generation 0|DIFFERENT generations|could not be read \(missing or corrupt\)/,
      {
        forbidden: 'this graph predates publication attestation, so there is no way to check',
        allowed: 'caller set is heuristic, not exhaustive; verify with code_intel_references',
      },
      out,
      'an attested graph was described with an unattested reason',
    );
  });

  it('⛔ a NO MATCH from an unattested graph says so — an absence is the sharpest claim', async () => {
    // ⭐ REVIEWER FOUND THIS AND I REPRODUCED IT. preflight resolved the symbol BEFORE reading the
    // publication, so the miss and ambiguity branches returned before classification ever ran.
    // On a torn graph:
    //
    //   existing symbol -> "DECISION: REVIEW ... DIFFERENT generations"
    //   missing symbol  -> "NO MATCH for ghost" and nothing else
    //
    // The least attested answer got the least qualification. A NO MATCH is an absence claim, which
    // is the action class this whole unit protects.
    const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
    try { db.run('UPDATE graph_generation SET generation = generation + 1'); } finally { db.close(); }

    const { graphPreflight } = await import('../../../mcp/stdio/query/verbs/preflight.js');
    const out = String(await graphPreflight({ repoRoot: repo, symbol: 'ghost-that-does-not-exist' }));
    expect(out, 'the miss must still be reported').toMatch(/NO MATCH/);
    expect(out, 'and it must name the publication state').toMatch(/GENERATION_MISMATCH/);
    expect(out, 'and say what that means for the absence')
      .toMatch(/not evidence the symbol is gone/);
  });

  it('POSITIVE CONTROL: a NO MATCH from an ATTESTED graph carries no such warning', async () => {
    // ⛔ Without this the note could be unconditional — and a qualifier on every miss is one nobody
    // reads, which would bury the case that matters.
    const { graphPreflight } = await import('../../../mcp/stdio/query/verbs/preflight.js');
    const out = String(await graphPreflight({ repoRoot: repo, symbol: 'ghost-that-does-not-exist' }));
    expect(out).toMatch(/NO MATCH/);
    expectAbsentWithLiveMatcher(
      /THIS GRAPH IS [A-Z_]+:/,
      {
        forbidden: 'AND THIS GRAPH IS GENERATION_MISMATCH: its contents could not be verified',
        allowed: 'NO MATCH for "ghost". Try graph_search to find similar names.',
      },
      out,
      'an attested graph must not warn about its own publication',
    );
  });

  it('⛔ an AMBIGUOUS match from an unattested graph carries the verdict too', async () => {
    // A surviving mutant showed the ambiguity branch was untested. It is the same early return as
    // the miss — it leaves before the decision is built — and an ambiguity is a claim about what
    // this graph contains, made from a graph nobody verified.
    writeFileSync(join(repo, 'src', 'dup.js'), 'export function target() { return 2; }\n');
    execFileSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8', stdio: 'pipe' });
    execFileSync('git', ['-C', repo, 'commit', '-qm', 'dup'], { encoding: 'utf8', stdio: 'pipe' });
    const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    await ensureFresh({ repoRoot: repo, force: true });

    const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
    try { db.run('UPDATE graph_generation SET generation = generation + 1'); } finally { db.close(); }

    const { graphPreflight } = await import('../../../mcp/stdio/query/verbs/preflight.js');
    const out = String(await graphPreflight({ repoRoot: repo, symbol: 'target' }));
    // Either branch is acceptable as a RESULT — what is not acceptable is answering without the
    // verdict, so assert the verdict rather than which branch was taken.
    expect(out, 'the publication state must reach every early return')
      .toMatch(/GENERATION_MISMATCH|DIFFERENT generations/);
  });

  it('POSITIVE CONTROL: the spy records nothing when no verb runs', () => {
    // ⛔ Without this, `calls.length > 0` could be satisfied by leakage from setup rather than by
    // the verb under test — the assertions above would then pass while proving nothing.
    expect(calls).toEqual([]);
  });
});
