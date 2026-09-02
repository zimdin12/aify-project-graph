// ⛔ AN AGENT WRITES A FILE, ASKS ABOUT A SYMBOL IN IT, AND IS TOLD IT DOES NOT EXIST.
//
// `graph_callers` for an unresolved symbol returned `NO MATCH for "X". Try graph_search(...)` and
// nothing else. The freshness warnings that every NON-EMPTY result carries are dropped on the
// absence path: callers/callees/impact return `[noMatchMessage, staleNotFoundCaveat].join()`
// directly, without prefixReadWarnings. So the one answer that is a CLAIM ABOUT THE REPOSITORY was
// the one answer carrying the least evidence about what the repository actually contains.
//
// ⚠ MEASURED BEFORE BUILDING, with a positive control in the same pass (2026-09-03): the same repo,
// same dirty tree, queried for a symbol that EXISTS returned
// "SNAPSHOT WARNINGS - working tree has 1 modified tracked file"; the not-found returned none. That
// control is what separates "the absence path drops warnings" from "no warning was generated".
//
// ★ WHY IT EARNS ITS BYTES. Grep finds a symbol in an uncommitted file instantly. This is one of
// the few places the graph is strictly WORSE than the tool it competes with, and the failure is the
// expensive kind — a false absence an agent acts on.
//
// ⛔ AND WHY IT IS A PREDICATE, NOT A COUNT. The first design qualified the absence with the count
// of dirty files. The real field population kills that: 2026-07-30 reported 592 untracked files,
// every one `.aify-graph.bak-*` JSON residue. A count-based caveat fires on all 592 and trains a
// reader to ignore it — the exact noise read_freshness already avoids by keying staleness on
// TRACKED modifications only. `hasLanguageConfig` is the discriminator, derived from the real
// LANGUAGE_CONFIGS registry rather than a parallel extension list.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { staleNotFoundCaveat, uncommittedSourceFiles } from '../../../mcp/stdio/query/verbs/read_freshness.js';
import { WorktreeState } from '../../../mcp/stdio/freshness/worktree-state.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

let repo = null;
afterEach(() => { if (repo) { rmSync(repo, { recursive: true, force: true }); repo = null; } });

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'apg-uncommitted-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'base.js'),
    'export function ucBase(){ return ucHelper(); }\nexport function ucHelper(){ return 1; }\n');
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');
  return dir;
}

describe('a NO MATCH says when uncommitted sources could explain it', () => {
  it('★★★ an UNTRACKED source file is named on the absence path', async () => {
    const { graphIndex } = await import('../../../mcp/stdio/query/verbs/index.js');
    const { graphCallers } = await import('../../../mcp/stdio/query/verbs/callers.js');
    repo = makeRepo();
    await graphIndex({ repoRoot: repo, force: true });

    // The normal mid-task state: the agent has written a file and not committed it.
    writeFileSync(join(repo, 'src', 'fresh.js'), 'export function ucBrandNew(){ return 7; }\n');
    const answer = String(await graphCallers({ repoRoot: repo, symbol: 'ucBrandNew' }));

    // ⛔ POSITIVE CONTROL: the symbol must really be absent from a POPULATED graph. Without this,
    // the assertion below could pass against an empty graph, where NO MATCH means something else.
    expect(answer, 'precondition: the symbol is genuinely unresolved').toContain('NO MATCH');
    expect(String(await graphCallers({ repoRoot: repo, symbol: 'ucHelper' })),
      'control: the graph is populated and CAN resolve a symbol').not.toContain('NO MATCH');

    expect(answer, 'the file the agent just wrote must be named').toMatch(/src\/fresh\.js/);
    expect(answer).toMatch(/untracked/);
    expect(answer, 'and the remedy must be an action that changes the answer')
      .toMatch(/commit|force/i);
  }, 120_000);

  it('★★★ a MODIFIED TRACKED file is named too — the more common trigger', async () => {
    // Found by the control in the pre-build measurement rather than by design: the absence path
    // drops the "working tree has N modified tracked file(s)" warning as well, and editing a
    // tracked file is far more common than creating an untracked one.
    const { graphIndex } = await import('../../../mcp/stdio/query/verbs/index.js');
    const { graphCallers } = await import('../../../mcp/stdio/query/verbs/callers.js');
    repo = makeRepo();
    await graphIndex({ repoRoot: repo, force: true });

    writeFileSync(join(repo, 'src', 'base.js'),
      'export function ucBase(){ return ucHelper(); }\nexport function ucHelper(){ return 1; }\n'
      + 'export function ucAddedButUncommitted(){ return 2; }\n');
    const answer = String(await graphCallers({ repoRoot: repo, symbol: 'ucAddedButUncommitted' }));

    expect(answer, 'precondition: unresolved').toContain('NO MATCH');
    expect(answer).toMatch(/src\/base\.js/);
    expect(answer).toMatch(/modified/);
  }, 120_000);

  it('⛔ SILENT on a clean tree — the control that keeps this from being noise', async () => {
    // The standard the whereis miss-scope work set, and the reason the 592-untracked field report
    // mattered: "a generic 'results may be incomplete' costs the reader as much as a false claim —
    // they go and check either way." A caveat printed unconditionally would pass both tests above
    // while telling a reader nothing.
    const { graphIndex } = await import('../../../mcp/stdio/query/verbs/index.js');
    const { graphCallers } = await import('../../../mcp/stdio/query/verbs/callers.js');
    repo = makeRepo();
    await graphIndex({ repoRoot: repo, force: true });

    const answer = String(await graphCallers({ repoRoot: repo, symbol: 'ucNoSuchSymbolZzz' }));
    expect(answer, 'precondition: still an absence answer').toContain('NO MATCH');

    expectAbsentWithLiveMatcher(
      /uncommitted source file/i,
      {
        forbidden: 'NOTE: 3 uncommitted source file(s) are NOT covered by this answer',
        allowed: 'NO MATCH for "ucNoSuchSymbolZzz". Try graph_search(...) to find similar names.',
      },
      answer,
      'nothing is uncommitted here, so this caveat is pure noise',
    );
  }, 120_000);

  it('⛔ a dirty tree of NON-SOURCE files stays silent — the field population that killed the count', async () => {
    // ⚠ THROUGH THE REAL REPO, NOT A HAND-BUILT LIST. My first version of this test passed the
    // residue paths straight to staleNotFoundCaveat and failed: the language filter lives in the
    // PRODUCER (uncommittedSourceFiles), and the caveat trusts the list it is handed. Asserting on
    // a fabricated list would have tested a contract nothing in production relies on.
    //
    // This is the 2026-07-30 shape: hundreds of untracked files, all backup residue, nothing
    // tracked modified. `.aify-graph.bak-test` is NOT in IGNORED_DIRS — a different segment name
    // from `.aify-graph` — so these paths really do reach the filter and really are discriminated
    // by extension rather than by luck.
    const { graphIndex } = await import('../../../mcp/stdio/query/verbs/index.js');
    const { graphCallers } = await import('../../../mcp/stdio/query/verbs/callers.js');
    repo = makeRepo();
    await graphIndex({ repoRoot: repo, force: true });

    mkdirSync(join(repo, '.aify-graph.bak-test'), { recursive: true });
    for (let i = 0; i < 5; i += 1) writeFileSync(join(repo, '.aify-graph.bak-test', `f${i}.json`), '{}');
    writeFileSync(join(repo, 'notes.md'), '# notes\n');
    writeFileSync(join(repo, 'package-lock.json'), '{}');

    const answer = String(await graphCallers({ repoRoot: repo, symbol: 'ucNoSuchSymbolZzz' }));
    expect(answer, 'precondition: still an absence answer').toContain('NO MATCH');
    expectAbsentWithLiveMatcher(
      /uncommitted source file/i,
      {
        forbidden: 'NOTE: 7 uncommitted source file(s) are NOT covered by this answer',
        allowed: 'NO MATCH for "ucNoSuchSymbolZzz". Try graph_search(...) to find similar names.',
      },
      answer,
      'a caveat here fires on every not-found in any repo with a backup directory',
    );

    // ⛔ POSITIVE CONTROL IN THE SAME REPO AND THE SAME PASS. Add ONE source file to the identical
    // dirty tree: if the caveat stays silent now too, the assertion above proved only that the
    // feature is dead, not that it discriminates.
    writeFileSync(join(repo, 'src', 'now-real.js'), 'export function ucLateArrival(){ return 9; }\n');
    const after = String(await graphCallers({ repoRoot: repo, symbol: 'ucNoSuchSymbolZzz' }));
    expect(after, 'one source file among the residue must be picked out, and only it')
      .toMatch(/1 uncommitted source file/);
    expect(after).toMatch(/src\/now-real\.js/);
    expectAbsentWithLiveMatcher(
      /\.json|\.md\b/i,
      {
        forbidden: 'src/now-real.js (untracked), notes.md, .aify-graph.bak-test/f0.json',
        allowed: 'src/now-real.js (untracked)',
      },
      after.split('NOTE:')[1] ?? '',
      'the residue must not be listed alongside the real source file',
    );
  }, 120_000);

  it('⛔ an UNOBSERVED tree SAYS SO — null is a failed measurement, not an empty one', () => {
    // ⚠ THIS TEST IS HERE BECAUSE A MUTANT SURVIVED. The first version asserted that null produced
    // '' — silence — which a mutant returning `[]` satisfied just as well, because both were empty.
    // The producer's tri-state died one function later and nothing noticed.
    //
    // Worse, silence was the wrong behaviour: `git status` and `git rev-parse HEAD` fail
    // independently, so a broken status with a readable HEAD leaves `stale === false`, the
    // staleness branch quiet, and the dirty-unknown warning dropped with every other warning on the
    // absence path. A bare NO MATCH backed by a check that never ran.
    expect(staleNotFoundCaveat({ stale: false, uncommittedSources: null }),
      'a failed dirty check must not read as a clean tree').toMatch(/could not be read/i);

    // ⛔ THE DISCRIMINATION, in the same pass: an OBSERVED empty tree is silent. Without this the
    // assertion above is satisfied by a clause that fires unconditionally.
    expect(staleNotFoundCaveat({ stale: false, uncommittedSources: [] }),
      'a MEASURED clean tree has nothing to disclose').toBe('');
    // and a caller that never set the field at all is not a failed measurement either.
    expect(staleNotFoundCaveat({ stale: false })).toBe('');
    // ⚠ and the stale===null path still gets its OWN caveat, unchanged by this addition.
    expect(staleNotFoundCaveat({ stale: null, uncommittedSources: null }),
      'the unknown-staleness caveat must survive').toMatch(/could NOT be determined/i);
  });

  it('⛔ the PRODUCER returns null for an unobserved tree — the fail-closed rule itself', () => {
    // ⚠ THIS TEST EXISTS BECAUSE A MUTANT SURVIVED TWICE. Deleting the producer's
    // "tree not observed → null" guard passed every test I had, because both of my attempts
    // asserted on hand-built freshness objects — testing the CONSUMER while the mutant changed the
    // PRODUCER. A test that cannot see the code it is meant to guard is not a guard.
    //
    // WorktreeState takes entriesError directly, so the failed-git-status state is constructible
    // without breaking a real repo. That matters: this branch is otherwise reachable only when
    // `git status` fails while `git rev-parse HEAD` succeeds — an index.lock, say — and when BOTH
    // fail the stale===null caveat masks it upstream. Unreachable-by-accident is exactly how a
    // fail-open default survives a green suite.
    const unobserved = new WorktreeState({ head: 'abc123', entries: null, entriesError: 'index.lock' });
    expect(uncommittedSourceFiles(unobserved),
      'a failed git status must not be reported as a measured empty tree').toBe(null);

    // ⛔ POSITIVE CONTROL, same call: an OBSERVED tree returns a real (possibly empty) list, so the
    // assertion above cannot be satisfied by a function that returns null unconditionally.
    const observedClean = new WorktreeState({ head: 'abc123', entries: [], entriesError: null });
    expect(uncommittedSourceFiles(observedClean),
      'a measured clean tree is an empty list, NOT null').toEqual([]);

    const observedDirty = new WorktreeState({
      head: 'abc123',
      entries: [{ path: 'src/live.js', untracked: true }, { path: 'notes.md', untracked: true }],
      entriesError: null,
    });
    expect(uncommittedSourceFiles(observedDirty), 'and it discriminates by language config')
      .toEqual([{ path: 'src/live.js', why: 'untracked' }]);
  });

  it('both facts appear together when the index is ALSO behind HEAD', () => {
    // They have different remedies — graph_index() for staleness, commit for uncommitted work — so
    // one must not stand in for the other.
    const out = staleNotFoundCaveat({
      stale: true,
      commitsBehind: 3,
      uncommittedSources: [{ path: 'src/both.js', why: 'modified' }],
    });
    expect(out).toMatch(/3 commits behind HEAD/);
    expect(out).toMatch(/src\/both\.js/);
  });
});
