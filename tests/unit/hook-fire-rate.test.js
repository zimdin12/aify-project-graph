import { describe, expect, it, vi, afterEach } from 'vitest';
import { measure, controlFailure, isCountedPath, verifiedEdgeCoverage } from '../../scripts/measure-hook-fire-rate.mjs';

// ⛔ A RATE NOBODY CAN RE-DERIVE IS A CLAIM, NOT A MEASUREMENT.
//
// The deletion-guard hook's own header cites "4.8% upper bound", measured once on a corpus that no
// longer exists. Enabling a PostToolUse hook means running a check after every edit forever, so
// "how noisy is it" is the first question — and it must be answerable on any repository, today.
//
// ⚠ THE NOUN IS GUARDED HERE. The unit is a source FILE-CHANGE inside a commit. The hook fires per
// EDIT, and a commit bundles many, so the two are different numbers and the result object says
// which one it is. Reporting file-changes as "edits" is the wrong-noun error this project has paid
// for more than any code defect.
//
// ⛔ AND THE SCRIPT REFUSES TO REPORT WITHOUT ITS CONTROLS. A rate from a filter that cannot say
// "no" is meaningless; one that cannot say "yes" is worse. `measure` throws rather than return a
// number when either direction fails — asserted below by feeding it a deliberately broken git.

const fakeGit = (log, filesBySha, diffs) => (repo, ...args) => {
  if (args[0] === 'log') return log.join('\n');
  if (args[0] === 'diff-tree') return (filesBySha[args[args.length - 1]] ?? []).join('\n');
  if (args[0] === 'diff') {
    const sha = args[1].replace(/\^$/, '');
    const file = args[args.length - 1];
    return diffs[`${sha}:${file}`] ?? '';
  }
  return '';
};

const DEL_EXPORTED = ['--- a/a.js', '+++ b/a.js', '-export function gone() {}'].join('\n');
const DEL_INTERNAL = ['--- a/b.js', '+++ b/b.js', '-function helper() {}'].join('\n');
const ADD_ONLY = ['--- a/c.js', '+++ b/c.js', '+export function added() {}'].join('\n');

describe('the hook fire-rate measurement', () => {
  it('⭐ POSITIVE CONTROL: the text filter discriminates, so a rate means something', () => {
    // If this ever fails, every number this script has ever printed is void.
    expect(controlFailure()).toBeNull();
  });

  it('⛔ counts production source files and EXCLUDES tests', () => {
    // The hook serves production edits. Counting test files would inflate the denominator with
    // changes the hook is not for, quietly lowering the rate.
    expect(isCountedPath('mcp/stdio/query/verbs/health.js')).toBe(true);
    expect(isCountedPath('scripts/lib/thing.mjs')).toBe(true);
    expect(isCountedPath('tests/unit/foo.test.js')).toBe(false);
    expect(isCountedPath('test/foo.js')).toBe(false);
    expect(isCountedPath('docs/readme.md')).toBe(false);
    expect(isCountedPath('package.json')).toBe(false);
  });

  it('⛔ the rate counts only EXPORTED removals, over every source file-change', () => {
    const git = fakeGit(
      ['sha1', 'sha2', 'sha3'],
      { sha1: ['a.js'], sha2: ['b.js'], sha3: ['c.js'] },
      { 'sha1:a.js': DEL_EXPORTED, 'sha2:b.js': DEL_INTERNAL, 'sha3:c.js': ADD_ONLY },
    );
    const r = measure({ repo: '/x', commits: 3, git });

    expect(r.fileChanges).toBe(3);
    expect(r.withRemoval, 'both deletions count as removals').toBe(2);
    expect(r.withExportedRemoval, 'only the exported one can reach the caller check').toBe(1);
    expect(r.upperBoundFireRate).toBeCloseTo(1 / 3, 5);
  });

  it('⭐ IT DISCRIMINATES: an all-additions history yields a rate of ZERO, not null or NaN', () => {
    // The other half of the control. A measurement that can only produce non-zero is not measuring.
    const git = fakeGit(['s1', 's2'], { s1: ['c.js'], s2: ['c.js'] }, { 's1:c.js': ADD_ONLY, 's2:c.js': ADD_ONLY });
    const r = measure({ repo: '/x', commits: 2, git });
    expect(r.fileChanges).toBe(2);
    expect(r.withExportedRemoval).toBe(0);
    expect(r.upperBoundFireRate).toBe(0);
  });

  it('⛔ NAMES ITS NOUN AND ITS BOUND in the result, not only in prose', () => {
    // The two things most easily lost when a number is quoted second-hand: what was counted, and
    // that it is a ceiling rather than the rate.
    const git = fakeGit(['s1'], { s1: ['a.js'] }, { 's1:a.js': DEL_EXPORTED });
    const r = measure({ repo: '/x', commits: 1, git });
    expect(r.unit).toMatch(/file-change/i);
    expect(r.unit, 'it must say it is NOT an edit').toMatch(/NOT an edit/i);
    expect(r.bound).toMatch(/upper/i);
  });

  it('⛔ THE PRECONDITION TRAVELS WITH THE RATE, because the rate alone misleads', () => {
    // ⛔ MEASURED BY EXECUTION: a freshly-indexed graph of this repository holds 12,837 EXTRACTED
    // and 1,230 AMBIGUOUS call edges and ZERO verified ones, while the same repository's COLLECTED
    // graph holds 2,379 (15.5%). `callersOf` counts only LSP_VERIFIED edges, so the hook is SILENT
    // BY CONSTRUCTION until a collection has run.
    //
    // ⇒ "2.2% of file-changes could fire" beside a graph with no verified edges is a true number
    // producing a false impression. The result object carries the precondition so it cannot be
    // separated from the figure when quoted.
    const r = measure({ repo: '/no/such/repo', commits: 1, git: () => '' });
    expect(r, 'the field must exist even when unknown').toHaveProperty('verifiedEdges');
    expect(verifiedEdgeCoverage('/no/such/repo'), 'no graph means UNKNOWN, never assumed clean').toBeNull();
  });

  it('⛔ an empty history yields a NULL rate, never a division by zero', () => {
    const git = fakeGit([], {}, {});
    const r = measure({ repo: '/x', commits: 5, git });
    expect(r.fileChanges).toBe(0);
    expect(r.upperBoundFireRate, 'no denominator means no rate, not 0%').toBeNull();
  });
});

// ⛔ THE GATE MUST ACTUALLY REFUSE, and a mutant deleting it SURVIVED until this existed. With the
// real filter working, gating or not gating produces the same answer — so the only way to test the
// refusal is to break the filter and watch the script decline to publish.
describe('it refuses to report a rate when its own controls fail', () => {
  afterEach(() => { vi.resetModules(); vi.restoreAllMocks(); });

  it('⛔ a DEAD filter (never reports a removal) makes measure THROW, not return 0%', async () => {
    // The dangerous failure: a filter that always says "no" yields a clean, plausible 0% — the most
    // reassuring possible number, produced by an instrument that cannot see anything.
    vi.resetModules();
    vi.doMock('../../mcp/stdio/analysis/deleted-with-callers.js', () => ({ removedDeclarations: () => [] }));
    const mod = await import('../../scripts/measure-hook-fire-rate.mjs');
    expect(mod.controlFailure()).toBeTruthy();
    expect(() => mod.measure({ repo: '/x', commits: 1, git: () => '' })).toThrow(/controls failed/i);
  });

  it('⛔ an OVERBROAD filter (reports a removal in an add-only diff) also refuses', async () => {
    // The opposite dead end, and it inflates rather than deflates — a rate that looks alarming.
    vi.resetModules();
    vi.doMock('../../mcp/stdio/analysis/deleted-with-callers.js', () => ({
      removedDeclarations: () => [{ name: 'x', exported: true }],
    }));
    const mod = await import('../../scripts/measure-hook-fire-rate.mjs');
    expect(mod.controlFailure()).toBeTruthy();
    expect(() => mod.measure({ repo: '/x', commits: 1, git: () => '' })).toThrow(/controls failed/i);
  });
});
