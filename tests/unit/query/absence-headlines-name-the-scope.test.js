// THE HEADLINE IS THE ONLY GUARANTEED READ, AND IT WAS TRUE OF ONE VERB OUT OF FIVE.
//
// ef-manager, reviewing the absence surface, rejected all three of my remedies for the unwired
// coverage gate and replaced them with one sentence:
//
//   "Both are branches, and today you proved a branch can go uncalled for weeks. A hurried agent
//    reads the headline; the headline is the only guaranteed read. So: change the terminal string,
//    not the control flow."
//
// `graph_callers` migrated first (fa3325d3) because it is the highest-traffic absence and the one an
// agent reads before deleting code. `scopeInHeadline` was introduced as a MIGRATION FLAG with the
// follow-up written into `lsp-evidence.js` in the same commit: callees, impact, neighbors and trace
// still carried the fact in a ~600 B second line, and when their headlines named it, the parameter
// and its branch were to be DELETED.
//
// This file is that follow-up's guard. It SUBSUMES `no-callers-headline-names-the-scope.test.js`,
// which is deleted in the same commit — a second test of one property is cost without coverage, and
// the property was never specific to callers.
//
// ⛔ AND THE NUMBER IS THE ONE WE OWN. ef-manager proposed "(n of total files)". We do NOT have that
// denominator: `indexedScopeClause` is numerator-only BY DESIGN (miss-scope.js says so), and the
// other figure on this surface (627) is the typescript COLLECTION's eligible count — a different
// noun for a different population. Shipping "939 of 627" or inventing a repo total would be the
// wrong-noun error this project keeps recording.
//
// ⚠ WHAT THIS DOES NOT CLAIM. It does not claim agents read headlines and skip clauses — that is the
// A/B's question and this cannot touch it. It pins one structural property: on every absence-emitting
// verb, the scope qualifier is reachable without reading past the claim sentence.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { graphIndex } from '../../../mcp/stdio/query/verbs/index.js';
import { graphCallers } from '../../../mcp/stdio/query/verbs/callers.js';
import { graphCallees } from '../../../mcp/stdio/query/verbs/callees.js';
import { graphImpact } from '../../../mcp/stdio/query/verbs/impact.js';
import { graphNeighbors } from '../../../mcp/stdio/query/verbs/neighbors.js';
import { graphTrace } from '../../../mcp/stdio/query/verbs/trace.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

const ROOT = dirname(fileURLToPath(new URL('../../../package.json', import.meta.url)));

function git(repo, ...args) {
  execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
}

let repo;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'apg-absence-headline-'));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  await mkdir(join(repo, 'src'), { recursive: true });
  // `orphan` has no callers and no callees, so one symbol drives four of the five absence shapes
  // (neighbours needs an edge-type filter — see the row for why). `hub` is called, which gives
  // every case a present counterpart in the same graph.
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

// ⛔ LOCATE THE CLAIM; DO NOT ASSUME IT IS LINE 0. Measured while writing the callers version: on a
// DIRTY tree `prefixReadWarnings` puts "SNAPSHOT WARNINGS" above everything, so the absence headline
// is NOT the first line. The property is that the scope sits in the SAME SENTENCE as the claim, not
// that the claim comes first — the positional version passes on a clean fixture and says nothing
// about the tree an agent actually works in.
const claimLine = (text, marker) => String(text).split('\n').find((l) => marker.test(l)) ?? '';

// One row per absence-emitting verb that shares `buildAbsenceTrustLine`. The marker is the verb's
// own terminal string, so a row cannot silently match another verb's output.
const VERBS = [
  {
    name: 'graph_callers',
    marker: /NO CALLERS/,
    absent: () => graphCallers({ repoRoot: repo, symbol: 'orphan' }),
    present: () => graphCallers({ repoRoot: repo, symbol: 'hub' }),
    presentProof: /hubCaller/,
  },
  {
    name: 'graph_callees',
    marker: /NO CALLEES/,
    absent: () => graphCallees({ repoRoot: repo, symbol: 'orphan' }),
    present: () => graphCallees({ repoRoot: repo, symbol: 'hubCaller' }),
    presentProof: /hub/,
  },
  {
    name: 'graph_impact',
    marker: /NO IMPACT/,
    absent: () => graphImpact({ repoRoot: repo, symbol: 'orphan' }),
    present: () => graphImpact({ repoRoot: repo, symbol: 'hub' }),
    presentProof: /hubCaller/,
  },
  {
    name: 'graph_neighbors',
    marker: /NO NEIGHBORS/,
    // ⛔ SPECIMEN CORRECTED, PREMISE UNCHANGED. `graph_neighbors('orphan')` is NOT an absence: a
    // DEFINES edge from the file to the symbol always exists, so the verb returned a real edge and
    // all three rows failed — including the positive control, which is how the fixture defect
    // announced itself rather than passing quietly. Filtering to CALLS gives a symbol with a
    // genuinely empty neighbour set. The property under test never changed.
    absent: () => graphNeighbors({ repoRoot: repo, symbol: 'orphan', edge_types: ['CALLS'] }),
    present: () => graphNeighbors({ repoRoot: repo, symbol: 'hub', edge_types: ['CALLS'] }),
    // Neighbors renders raw EDGE lines with node ids, not labels, so the proof is the relation.
    presentProof: /CALLS/,
  },
  {
    name: 'graph_trace',
    marker: /NO STATIC PATH/,
    absent: () => graphTrace({ repoRoot: repo, from: 'orphan', to: 'hub' }),
    present: () => graphTrace({ repoRoot: repo, from: 'hubCaller', to: 'hub' }),
    presentProof: /hub/,
  },
];

describe('every absence headline carries its own scope', () => {
  for (const v of VERBS) {
    it(`★★★ ${v.name} — the CLAIM SENTENCE names the indexed scope and its limit`, async () => {
      const out = String(await v.absent());
      const head = claimLine(out, v.marker);

      // Bucket by the shape OBSERVED, never the shape intended: if this is not the absence shape,
      // the assertions below describe some other sentence.
      expect(head, `fixture precondition: ${v.name} must produce its absence shape`).toMatch(v.marker);

      expect(head, 'a reader who stops at the first period must already know the search was scoped')
        .toMatch(/\d+ indexed files?/);
      expect(head, 'the count alone invites a completeness reading it cannot support')
        .toMatch(/not the whole repository/);
    }, 60_000);

    it(`★★ ${v.name} — POSITIVE CONTROL: a real result does not get the absence headline`, async () => {
      // Without this, a headline that unconditionally announced a scoped absence would satisfy the
      // test above while destroying every real answer. This repository has shipped a "fix" of
      // exactly that shape before: a guard that fired correctly and also deleted real edges.
      const out = String(await v.present());
      expect(out, 'the real result must still be returned').toMatch(v.presentProof);
      expect(claimLine(out, v.marker), 'a result is not an absence').toBe('');
    }, 60_000);

    it(`★★ ${v.name} — the scope fact appears ONCE, not twice`, async () => {
      // Moving the fact into the headline without suppressing the shared clause would state it
      // twice on a surface with a 999 B ceiling, and a caveat repeated is a caveat discounted.
      const out = String(await v.absent());
      const n = (out.match(/not the whole repository/g) ?? []).length;
      expect(n, `the scope limit is stated ${n} times; it must be stated exactly once`).toBe(1);
    }, 60_000);
  }
});

describe('the migration flag is retired, not left as furniture', () => {
  it('★★★ scopeInHeadline no longer exists anywhere in mcp/', () => {
    // ⛔ THE POINT OF THE WHOLE MIGRATION. `lsp-evidence.js` wrote the follow-up down in the same
    // commit that introduced the flag, precisely so it would not become permanent furniture: "when
    // they do, this parameter and its branch are DELETED." A migration flag that outlives its
    // migration is a branch nobody reads and a default nobody re-derives.
    //
    // ⚠ Read from SOURCE rather than asserting behaviour, because the flag's absence is a
    // structural fact about the code and there is no runtime observation that distinguishes
    // "parameter deleted" from "parameter still there and always true".
    const files = [
      'mcp/stdio/query/lsp-evidence.js',
      'mcp/stdio/query/verbs/callers.js',
      'mcp/stdio/query/verbs/callees.js',
      'mcp/stdio/query/verbs/impact.js',
      'mcp/stdio/query/verbs/neighbors.js',
      'mcp/stdio/query/verbs/trace.js',
    ];
    // ⛔ COUNT FROM CODE, NOT FROM COMMENTS — the trap `every-absence-names-its-scope.test.js`
    // already records: writing up a finding creates new text matching the pattern the finding is
    // about, and it over-counts in the direction that makes the work look unfinished. The retired
    // flag is NAMED in a comment in lsp-evidence.js on purpose, so a reader meeting that code knows
    // what was removed and why. Strip comments, then look for the identifier.
    const stripComments = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    const offenders = files.filter((f) => stripComments(readFileSync(join(ROOT, f), 'utf8')).includes('scopeInHeadline'));
    expect(offenders, 'the migration is complete, so the flag must be gone').toEqual([]);
    // ⚠ POSITIVE CONTROL on the reader itself: a zero from a mis-resolved path would look identical
    // to a clean sweep. Prove the files are being read and contain what they should.
    const sample = stripComments(readFileSync(join(ROOT, 'mcp/stdio/query/verbs/callers.js'), 'utf8'));
    expect(sample, 'the file was read AND the comment stripper left the code standing')
      .toMatch(/buildAbsenceTrustLine/);
    // ⚠ And prove the stripper actually strips, or it is a no-op that happens to pass: the retired
    // flag IS named in lsp-evidence.js's prose and must survive a raw read while vanishing here.
    const raw = readFileSync(join(ROOT, 'mcp/stdio/query/lsp-evidence.js'), 'utf8');
    expect(raw, 'the comment naming the retired flag is deliberate documentation')
      .toMatch(/scopeInHeadline/);
    expectAbsentWithLiveMatcher(
      /scopeInHeadline/,
      {
        forbidden: 'const indexedScope = scopeInHeadline ? 1 : 2;',
        allowed: 'const indexedScope = 1;',
      },
      stripComments(raw),
      'and the stripper removes it, so the check above tested code and not prose',
    );
  });
});
