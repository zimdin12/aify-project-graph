// ⛔ A FRESHNESS CHECK THAT COULD NOT LOOK MUST NOT REPORT "CLEAN".
//
// Preregistered in docs/2026-08-22-prereg-freshness-unknown.md BEFORE the fix, including the
// falsification conditions. The induction was verified first — `git status --porcelain` and
// `git rev-parse HEAD` both THROW outside a repository, and both SUCCEED inside one — because a
// control aimed at a `catch` that never fires proves nothing at all.
//
// ⛔⛔ THE ONE THAT ALMOST GOT AWAY. My design was "make `stale` tri-state; `null` is falsy so every
// `if (stale)` consumer keeps its behaviour and I cannot over-correct." That is true for three
// consumers and EXACTLY BACKWARDS for the fourth: graph_search printed "Ruled out: the index is
// fresh" behind `!freshnessState.stale`, and `!null` is `true`. Falsy-preservation preserved the
// defect at the only site that turns the value into a positive claim about the index. The design
// was wrong before the tests were; C6 is what pins it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorktreeState } from '../../../mcp/stdio/freshness/worktree-state.js';

// A directory with no repository above it: the one induction that reaches every `catch` under test.
let nonRepo;
beforeEach(() => { nonRepo = mkdtempSync(join(tmpdir(), 'apg-nonrepo-')); });
afterEach(() => rmSync(nonRepo, { recursive: true, force: true, maxRetries: 3 }));

describe('the induction actually reaches the failure path', () => {
  it('★★★⛔ THE INSTRUMENT CHECK: git genuinely fails outside a repo, and succeeds inside one', async () => {
    // ⛔ Without BOTH halves this file is decoration. A probe that only asserts "unknown" passes
    // just as well when the import is broken, the git binary is missing, or the temp dir happens
    // to sit inside some other checkout — every one of which reads exactly like a proven
    // induction. The positive half is what says the instrument can still return KNOWN.
    const broken = await WorktreeState.observe(nonRepo);
    expect(broken.headKnown, 'HEAD must be unreadable outside a repo').toBe(false);
    expect(broken.dirtyKnown, 'the working tree must be unreadable outside a repo').toBe(false);

    const real = await WorktreeState.observe(process.cwd());
    expect(real.headKnown, 'and READABLE inside this one — otherwise the negative half proves nothing').toBe(true);
    expect(real.dirtyKnown).toBe(true);
    expect(real.head).toMatch(/^[0-9a-f]{40}$/u);
  });
});

describe('C1 — a failed working-tree query is an unknown, never an empty list', () => {
  it('★★★⛔ trackedDirty is null, not [] — the shape a clean tree produces', async () => {
    // ⛔ THE DEFECT, STATED AS A TYPE. `[]` and "we could not look" were byte-identical, so
    // `trackedDirty.length > 0` never fired and the tracked-modification warning — whose own
    // comment calls it "the only thing standing between a user and a stale answer" — was silenced
    // by exactly the condition it exists to report.
    const s = await WorktreeState.observe(nonRepo);
    expect(s.trackedDirty, 'null is an unknown; [] is a measurement nobody took').toBeNull();
    expect(s.allDirty).toBeNull();
    expect(s.untrackedCount).toBeNull();
  });

  it('★★★ and it DISCLOSES, naming what the silence does not mean', async () => {
    const d = (await WorktreeState.observe(nonRepo)).disclosures();
    expect(d.length, 'both queries failed, so both are disclosed').toBe(2);
    expect(d.join('\n')).toMatch(/not evidence the tree is clean/);
    expect(d.join('\n')).toMatch(/not evidence the snapshot is current/);
    expect(d.join('\n'), 'and git’s own reason is carried, not swallowed').toMatch(/not a git repository/i);
  });
});

describe('C2 — an unknown HEAD does not read as "not stale"', () => {
  it('★★★⛔ stalenessAgainst returns null, and null is NOT false', async () => {
    // The old expression was Boolean(manifest.commit && head && manifest.commit !== head).
    // getHeadCommit was already honest — it returns null — and the CONSUMER laundered that
    // unknown into `false`. An honest producer buys nothing if its consumer discards the honesty.
    const s = await WorktreeState.observe(nonRepo);
    expect(s.stalenessAgainst('a8c3f158d50b')).toBeNull();
    expect(s.stalenessAgainst('a8c3f158d50b'), 'must not be the boolean it used to be').not.toBe(false);
  });

  it('★★★ POSITIVE CONTROL: a readable HEAD still decides staleness in BOTH directions', async () => {
    // ⛔ Without both directions, the null above is satisfied by a method that returns null
    // always — which would pass C2 while destroying every staleness warning in the product.
    const s = await WorktreeState.observe(process.cwd());
    expect(s.stalenessAgainst('0000000000000000000000000000000000000000'),
      'a different commit is STALE').toBe(true);
    expect(s.stalenessAgainst(s.head), 'the same commit is CURRENT — measured, not assumed').toBe(false);
  });

  it('★★★ an absent indexed commit is also unknown, not "fresh"', async () => {
    // Nothing indexed yet is not the same as indexed-and-current, and `null && ...` used to make
    // them identical.
    const s = await WorktreeState.observe(process.cwd());
    expect(s.stalenessAgainst(null)).toBeNull();
    expect(s.stalenessAgainst(undefined)).toBeNull();
  });
});

describe('C3 — THE OVER-CORRECTION GUARD, and the control that matters most here', () => {
  it('★★★⛔ a healthy repo produces NO disclosure at all', async () => {
    // ⛔ These lines print on EVERY read verb in the product. A caveat emitted on the ordinary
    // path would be permanent noise on every answer and would train readers to skip the block
    // that carries the warning that matters — correct, and ruinous. Over-correction has been the
    // dangerous direction three times this week, so the healthy path's emptiness is asserted
    // rather than assumed.
    const s = await WorktreeState.observe(process.cwd());
    expect(s.disclosures(), 'silence on the happy path is a requirement, not an accident').toEqual([]);
  });
});

describe('C5 — untracked files still do not count as tracked modifications', () => {
  it('★★★ the field-report defect stays fixed: tracked and untracked remain separate', async () => {
    // ⚠ 592 untracked / 0 tracked, and two verbs reported "592 dirty" and "4 dirty" for the same
    // tree. Untracked files were never in the graph, so they cannot make an indexed file stale.
    // This change touches the FAILURE path only; the split must survive it untouched.
    const s = new WorktreeState({
      head: 'a'.repeat(40),
      entries: [
        { path: 'src/tracked.js', untracked: false },
        { path: 'build/residue.txt', untracked: true },
        { path: 'build/other.txt', untracked: true },
      ],
    });
    expect(s.trackedDirty).toEqual(['src/tracked.js']);
    expect(s.untrackedCount).toBe(2);
    expect(s.allDirty.length).toBe(3);
    expect(s.disclosures(), 'a dirty tree is still an OBSERVED tree — no disclosure').toEqual([]);
  });
});

describe('the two queries fail independently', () => {
  it('★★★⛔ one failure does not manufacture the other', async () => {
    // ⚠ `git rev-parse HEAD` fails on an unborn branch while `git status` succeeds; an index.lock
    // breaks status while rev-parse still answers. Collapsing them into one "git is broken" flag
    // would report a condition neither query established — a claim with no measurement behind it,
    // which is the whole defect class this file exists for.
    const headOnly = new WorktreeState({ head: null, headError: 'unborn branch', entries: [] });
    expect(headOnly.headKnown).toBe(false);
    expect(headOnly.dirtyKnown, 'the tree WAS read').toBe(true);
    expect(headOnly.trackedDirty).toEqual([]);
    expect(headOnly.disclosures().length, 'exactly one disclosure, for the half that failed').toBe(1);
    expect(headOnly.disclosures()[0]).toMatch(/could not read HEAD/);

    const dirtyOnly = new WorktreeState({ head: 'b'.repeat(40), entries: null, entriesError: 'index.lock' });
    expect(dirtyOnly.headKnown).toBe(true);
    expect(dirtyOnly.dirtyKnown).toBe(false);
    expect(dirtyOnly.stalenessAgainst('c'.repeat(40)), 'staleness is still decidable').toBe(true);
    expect(dirtyOnly.disclosures().length).toBe(1);
    expect(dirtyOnly.disclosures()[0]).toMatch(/could not read the working tree/);
  });
});
