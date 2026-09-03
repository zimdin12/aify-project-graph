// ⛔ AN ABSENCE ANSWER WITH NO SCOPE READS AS A FACT ABOUT THE REPOSITORY.
//
// Two standing guards already cover seven verbs between them (no-match-names-its-scope, and
// empty-set-absence-names-uncommitted). This covers the REST, and it exists because the sweep that
// originally caught `consequences` and `trace` hand-rolling their own NO MATCH was a ONE-OFF: it
// fixed what it found and left nothing standing behind, so `graph_path` and `graph_explore` sat
// bare until 2026-09-03.
//
// ⛔ WHAT THEY OFFERED WAS WORSE THAN SILENCE. Their only next step was `Try graph_search(...)`,
// and miss-scope.js records why that is inert for exactly this case: graph_search queries the SAME
// node table, so a symbol never indexed cannot be found by a second verb reading the same rows
// (confirmed in the field on `kEquatorLatBandsPerShell`). A remedy that cannot change the answer.
//
// ⚠ THE POPULATION IS COUNTED FROM CODE, NOT FROM COMMENTS. My first census said 18 files and the
// real number is 13: four matched only inside comments — TWO OF WHICH I HAD WRITTEN THAT DAY
// documenting this very work — and one (packet-live.js) matches a regex that DETECTS "NO MATCH"
// rather than emitting it. Writing up a finding creates new text matching the pattern the finding
// is about, so a naive scan over-counts, and it over-counts in the direction that makes the work
// look bigger.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const VERBS_DIR = join(ROOT, 'mcp/stdio/query/verbs');
const ABSENT = 'definitelyNotAnySymbolZzz';
const PRESENT = 'realCaller';

// Verbs whose absence answers are pinned by the two OTHER absence suites. Listed with the file that
// owns each so a reader can follow it, and cross-checked against the derived population below.
const COVERED_ELSEWHERE = new Set([
  'callers.js', 'callees.js', 'impact.js', 'consequences.js', 'trace.js', // no-match-names-its-scope
  'neighbors.js',                                                         // empty-set-absence-names-uncommitted
  'whereis.js',                                                           // absence-names-its-population
]);

// Driven here. Each entry names the arg shape, because these verbs do not share one.
const DRIVEN = [
  { name: 'graph_change_plan', mod: 'change_plan.js', fn: 'graphChangePlan', mk: (s) => ({ symbol: s }) },
  { name: 'graph_lookup', mod: 'lookup.js', fn: 'graphLookup', mk: (s) => ({ symbol: s }) },
  { name: 'graph_path', mod: 'path.js', fn: 'graphPath', mk: (s) => ({ symbol: s }) },
  { name: 'graph_preflight', mod: 'preflight.js', fn: 'graphPreflight', mk: (s) => ({ symbol: s }) },
  { name: 'graph_explore', mod: 'explore.js', fn: 'graphExplore', mk: (s) => ({ symbols: [s] }) },
  { name: 'graph_packet', mod: 'packet.js', fn: 'graphPacket', mk: (s) => ({ target: s }) },
];

const ABSENCE_STRING = /NO MATCH|NO CALLERS|NO CALLEES|NO NEIGHBORS|NO PATH|noMatchMessage/;

/** Files that emit an absence-shaped string in CODE. Comment lines are stripped first — see header. */
function absenceEmittingVerbFiles() {
  return readdirSync(VERBS_DIR).filter((f) => f.endsWith('.js')).filter((f) => {
    const lines = readFileSync(join(VERBS_DIR, f), 'utf8').split('\n');
    return lines.some((l) => {
      const t = l.trim();
      if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
      return ABSENCE_STRING.test(l);
    });
  }).sort();
}

// The disclosure shapes this project actually ships for an absence.
const SCOPE = /behind HEAD|could NOT be determined|NOT COVERED|not exhaustive|indexed graph|in the indexed scope|declaration types|NOT MODELLED|from the heuristic graph|is a FLOOR|STATEMENT ABOUT THIS GRAPH|not in the graph|no feature overlay/i;

let repo = null;
beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'apg-scope-census-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'target.js'), 'export function realTarget() { return 1; }\n');
  writeFileSync(join(repo, 'src', 'caller.js'),
    "import { realTarget } from './target.js';\nexport function realCaller() { return realTarget(); }\n");
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');
  const { graphIndex } = await import('../../../mcp/stdio/freshness/orchestrator.js')
    .then(() => import('../../../mcp/stdio/query/verbs/index.js'));
  await graphIndex({ repoRoot: repo, force: true });
}, 240_000);
afterAll(() => { if (repo) { rmSync(repo, { recursive: true, force: true }); repo = null; } });

describe('every absence-emitting verb names the scope it searched', () => {
  it('⛔ INSTRUMENT: the matcher fires on each real disclosure shape and NOT on a bare absence', () => {
    // ⚠ ONE CANARY PER SHAPE, and that is the whole point. My first version canaried ONLY the
    // heuristic-graph line, passed, and then reported FOUR verbs as bare that were disclosing
    // perfectly well through the declaration-types shape — a matcher tightened until it stopped
    // matching. A control with one canary proves the matcher fires on THAT string, never on the
    // family it claims to cover.
    const shapes = {
      heuristic: 'TRUST: absence is from the heuristic graph and is NOT exhaustive.',
      declarationTypes: "⚠ THIS IS A STATEMENT ABOUT THIS GRAPH'S DECLARATION TYPES. Searched declaration types: Function, Method.",
      allTypes: '⚠ A STATEMENT ABOUT THIS GRAPH, NOT THE REPOSITORY: every node type was searched.',
      packet: 'HINT: no feature overlay exists here, so it is not in the graph under that name.',
      stale: 'NOTE: index is 2 commits behind HEAD.',
    };
    for (const [name, text] of Object.entries(shapes)) {
      expect(SCOPE.test(text), `the matcher cannot see the ${name} disclosure shape`).toBe(true);
    }
    // ⛔ AND IT MUST NOT FIRE ON A BARE ABSENCE, or every row below passes for free.
    expect(SCOPE.test('NO MATCH for "x". Try graph_search(query="x") to find similar names.'),
      'the matcher fires on a BARE absence — every assertion below would be vacuous').toBe(false);
  });

  it('★★★ the derived population is fully accounted for — nothing emits an absence unwatched', () => {
    // A new verb that starts answering "NO MATCH" fails here until someone decides where it belongs.
    // It does NOT assert HOW a verb discloses: graph_packet hand-rolls its own scope statement and
    // imports no shared builder, so a structural "must import a builder" rule would fail it while
    // it behaves correctly. Population from source, verdict from behaviour.
    const emitting = absenceEmittingVerbFiles();
    expect(emitting.length, 'the scan found no absence-emitting verbs — it is broken, not the code')
      .toBeGreaterThan(0);

    const driven = new Set(DRIVEN.map((d) => d.mod));
    const unaccounted = emitting.filter((f) => !driven.has(f) && !COVERED_ELSEWHERE.has(f)
      // packet-live.js DETECTS "NO MATCH" with a regex to classify a downstream answer; it does not
      // emit one. Named explicitly rather than filtered silently.
      && f !== 'packet-live.js');
    expect(unaccounted, 'a verb emits an absence answer and no suite drives it').toEqual([]);
  });

  for (const { name, mod, fn, mk } of DRIVEN) {
    it(`★★★ ${name} names its scope on an absence`, async () => {
      const m = await import(`../../../mcp/stdio/query/verbs/${mod}`);
      const answer = String(await m[fn]({ repoRoot: repo, ...mk(ABSENT) }));

      // ⛔ POSITIVE CONTROL: the verb must answer DIFFERENTLY for a symbol that exists. Without it a
      // pass could mean the verb throws or returns nothing on this fixture — the vacuity that made
      // an earlier M1 check worthless when it "verified" two empty caller sets as disjoint.
      const present = String(await m[fn]({ repoRoot: repo, ...mk(PRESENT) }));
      expect(present.length, `${name} produced nothing for a symbol that EXISTS`).toBeGreaterThan(0);
      expect(present, `${name} answers identically for present and absent — it is not discriminating`)
        .not.toBe(answer);

      expect(answer, `${name} answers a BARE absence: it states no scope an agent can act on`)
        .toMatch(SCOPE);
    }, 120_000);
  }
});
