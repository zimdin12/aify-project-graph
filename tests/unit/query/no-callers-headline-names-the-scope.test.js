// THE HEADLINE IS THE ONLY GUARANTEED READ.
//
// ef-manager, reviewing the absence surface, rejected all three of my remedies for the unwired
// coverage gate and replaced them with one sentence:
//
//   "Both are branches, and today you proved a branch can go uncalled for weeks. A hurried agent
//    reads the headline; the headline is the only guaranteed read. So: change the terminal string,
//    not the control flow."
//
// The argument is load-bearing and it is empirical, not aesthetic. `absenceAuthority` is computed,
// correct, fails closed on every clause, is tested — and `graph_callers` never reads it, which is
// how a repo at 11.6% spine coverage answered `NO CALLERS` twelve times out of twelve. A design with
// NO branch to skip is strictly better than a correct branch nobody calls.
//
// Measured before this change, on the real graph:
//
//     line 1  NO CALLERS for "MANIFEST". Try graph_whereis(symbol="MANIFEST", expand=true) ...
//     line 2  TRUST: ... INDEXED SCOPE: 939 files — not the whole repository. LSP SCOPE: ...
//
// The qualifier sat ~200 bytes into a ~600-byte second line. A reader who stops at the first period
// has been told "nothing calls this", full stop, by a tool that searched part of one repository.
//
// ⚠ WHAT THIS TEST DOES NOT CLAIM. It does not claim agents read headlines and skip clauses — that
// is the A/B and this cannot touch it. It pins one structural property: the scope qualifier is
// reachable without reading past the first sentence.
//
// ⛔ AND THE NUMBER IS THE ONE WE OWN. ef-manager proposed "(n of total files)". We do NOT have that
// denominator: `indexedScopeClause` is numerator-only BY DESIGN, and the other figure on this surface
// (627) is the typescript COLLECTION's eligible count — a different noun for a different population.
// Shipping "939 of 627" or inventing a repo total would be the wrong-noun error this project keeps
// recording. The headline carries the count we measured and the limit we can defend.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphIndex } from '../../../mcp/stdio/query/verbs/index.js';
import { graphCallers } from '../../../mcp/stdio/query/verbs/callers.js';

function git(repo, ...args) {
  execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
}

let repo;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'apg-headline-scope-'));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  await mkdir(join(repo, 'src'), { recursive: true });
  // `orphan` is never called; `hub` is, so the two shapes can be told apart in the same fixture.
  await writeFile(join(repo, 'src', 'orphan.js'), 'export function orphan() { return 1; }\n');
  await writeFile(join(repo, 'src', 'hub.js'), 'export function hub() { return 2; }\n');
  await writeFile(join(repo, 'src', 'use.js'),
    "import { hub } from './hub.js';\nexport function hubCaller() { return hub(); }\n");
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'fixture');
  await graphIndex({ repoRoot: repo, force: true });
}, 60_000);

afterEach(async () => {
  if (repo) await rm(repo, { recursive: true, force: true });
});

// ⛔ LOCATE THE CLAIM; DO NOT ASSUME IT IS LINE 0. Measured while writing this test: on a DIRTY tree
// `prefixReadWarnings` puts "SNAPSHOT WARNINGS" above everything, so the absence headline is NOT the
// first line. The property under test is that the scope sits in the SAME SENTENCE as the claim, not
// that the claim comes first — the positional version would have passed on this clean fixture and
// said nothing about the tree an agent actually works in.
const claimLine = (text) => String(text).split('\n').find((l) => /NO CALLERS/.test(l)) ?? '';

describe('the NO CALLERS headline carries its own scope', () => {
  it('★★★ the CLAIM SENTENCE names the indexed scope and its limit', async () => {
    const out = String(await graphCallers({ repoRoot: repo, symbol: 'orphan' }));
    const head = claimLine(out);

    // Fixture precondition: this must actually be the absence shape, or the assertions describe
    // something else. Bucket by the shape OBSERVED, never the shape intended.
    expect(head, 'fixture precondition: orphan must produce the NO CALLERS shape').toMatch(/NO CALLERS/);

    expect(head, 'a reader who stops at the first period must already know the search was scoped')
      .toMatch(/\d+ indexed files?/);
    expect(head, 'the count alone invites a completeness reading it cannot support')
      .toMatch(/not the whole repository/);
  }, 60_000);

  it('★★ POSITIVE CONTROL — a symbol WITH callers does not get the absence headline', async () => {
    // Without this, a headline that unconditionally announced a scoped absence would pass the test
    // above while destroying every real answer. This repository has shipped a "fix" of exactly that
    // shape before: a guard that fired correctly and also deleted real edges.
    const out = String(await graphCallers({ repoRoot: repo, symbol: 'hub' }));
    expect(out, 'the caller set must still be returned').toMatch(/hubCaller/);
    expect(claimLine(out), 'a result is not an absence').toBe('');
  }, 60_000);

  it('★★ the scope fact appears ONCE, not twice', async () => {
    // The clause `INDEXED SCOPE: <n> files — not the whole repository.` lives in the shared absence
    // trust line. Moving the fact into the headline without suppressing the clause would state it
    // twice on a surface with a 999 B ceiling, and a caveat repeated is a caveat discounted.
    const out = String(await graphCallers({ repoRoot: repo, symbol: 'orphan' }));
    const occurrences = (out.match(/not the whole repository/g) ?? []).length;
    expect(occurrences, `the scope limit is stated ${occurrences} times; it must be stated exactly once`)
      .toBe(1);
  }, 60_000);
});
