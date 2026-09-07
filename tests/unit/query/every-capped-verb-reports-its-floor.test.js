// ⛔ THE GUARD FIRES AT RENDER TIME, SO ITS FIRST FIRING WOULD HAVE BEEN IN FRONT OF A USER.
//
// `renderCompact` now throws when a verb reports a remainder without saying whether its fetch
// saturated. That is the right shape — the bad state is unconstructible rather than guarded — but
// it only fires when a query ACTUALLY saturates, and the fixtures in this suite are small enough
// that nothing ever truncates. So a verb added next month with a cap and no flag would pass the
// whole suite green and throw the first time somebody queried a real repository.
//
// ⭐ A DOOR NOBODY HAS PUSHED IS NOT KNOWN TO OPEN. (Found by an outside reviewer looking for the
// INVERSE risk of the fix — what a newly-REQUIRED parameter breaks, rather than what it catches.)
//
// ⇒ Two different jobs here, and neither substitutes for the other:
//
//     per-verb driving   proves each CURRENT verb computes the flag correctly.
//                        Cannot catch a verb nobody added to the list below.
//     the door test      proves the MECHANISM protects every verb that does not exist yet.
//                        Cannot catch a verb that passes the flag and computes it WRONG.
//
// ⛔ AND THE VERB LIST BELOW IS ITSELF A HAND-MAINTAINED LIST — the same failure mode as writing
// "both verbs" about a renderer with seven callers, moved one layer up into the thing built to
// prevent it. The reviewer caught me at exactly that: my first draft named four verbs and there
// are five. The door test is the half that does not depend on this list being complete, which is
// why it is here and not a nicety.
//
// ⛔ WHY NOT A SOURCE SCAN. The cheap version — grep renderCompact's callers, assert each one
// passing `truncated:` also passes `truncatedIsFloor:` — asserts a SPELLING of code. This file's
// sibling spent three versions learning what that is worth, and a scan would also pass for a verb
// that passes the flag and computes it wrongly. Drive the object.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';
import { renderCompact } from '../../../mcp/stdio/query/renderer.js';
import { graphCallers } from '../../../mcp/stdio/query/verbs/callers.js';
import { graphImpact } from '../../../mcp/stdio/query/verbs/impact.js';
import { graphCallees } from '../../../mcp/stdio/query/verbs/callees.js';
import { graphNeighbors } from '../../../mcp/stdio/query/verbs/neighbors.js';
import { graphSearch } from '../../../mcp/stdio/query/verbs/search.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

// ⛔ EACH CAP IS WRITTEN DOWN PER VERB, NOT IMPORTED — and not shared either.
//
// Not imported, because a fixture that reads the subject's own constant tracks whatever the subject
// says: a cap silently changed to 5 would still "saturate" and every assertion here would keep
// agreeing with it. The fixture and the subject must be able to DISAGREE.
//
// Not shared, because graph_search's cap is 200 while the rest are 100. A single CAP + 1 fixture
// sized for 100 exercises four verbs and SILENTLY UNDER-FILLS THE FIFTH — search never saturates,
// so its "must report a floor" assertion would fail for the wrong reason, or pass while testing
// nothing. That trap is the reviewer's, found before this file was written.
const EDGE_CAP = 100;   // callers · impact · callees · neighbors
const SEARCH_CAP = 200; // search, over candidate NODES rather than edges

// Below any fetch cap, above the display budget: truncates for DISPLAY and does not saturate.
const UNDER = 40;

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

async function emptyRepo(nodeCount, edgeCount) {
  const r = await mkdtemp(join(tmpdir(), 'apg-floor-'));
  await mkdir(join(r, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', r, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', r, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(r, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: nodeCount, edges: edgeCount,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  return r;
}

/** `edgeCount` distinct functions fanning in to, or out of, one target. */
async function fanRepo(edgeCount, direction) {
  const r = await emptyRepo(edgeCount + 1, edgeCount);
  const db = openDb(join(r, '.aify-graph', 'graph.sqlite'));
  const node = (id, label) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ('${id}','Function','${label}','src/a.js',1,2,'javascript',1,'{}')`);
  node('t', 'target');
  for (let i = 0; i < edgeCount; i += 1) {
    node(`c${i}`, `other${i}`);
    // The edges table carries a UNIQUE index on (from_id, to_id, relation), so distinct endpoints
    // are the only way to build a fan of a given size.
    const [from, to] = direction === 'in' ? [`c${i}`, 't'] : ['t', `c${i}`];
    db.run(`INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
            VALUES ('${from}','${to}','CALLS','src/a.js',${i + 10},0.9,'EXTRACTED','test')`);
  }
  db.close();
  return r;
}

/** `nodeCount` functions whose labels all match one query — graph_search caps over these. */
async function labelRepo(nodeCount) {
  const r = await emptyRepo(nodeCount, 0);
  const db = openDb(join(r, '.aify-graph', 'graph.sqlite'));
  for (let i = 0; i < nodeCount; i += 1) {
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('w${i}','Function','widget${i}','src/a.js',1,2,'javascript',1,'{}')`);
  }
  db.close();
  return r;
}

/**
 * The truncation marker line, and only it.
 *
 * ⛔ ASSERTING `/at least/` ON THE WHOLE ANSWER CANNOT ATTRIBUTE THE MATCH. `graph_search` already
 * carried a `candidate cap:` note reading "matched at least 200 nodes … results are a FLOOR", and
 * it fires on the SAME condition as the marker. So a whole-output assertion passes whether or not
 * `truncatedIsFloor` is wired at all, and would have kept passing if I had wired nothing — which is
 * the vacuous-test shape this file exists to avoid. Measured, not assumed: at 201 nodes the answer
 * contains "at least" twice, on two different lines.
 */
const markerLine = (out) => out.split('\n').find((l) => /^(TRUNCATED |\+\d)/.test(l));

const VERBS = [
  { name: 'graph_callers',   cap: EDGE_CAP,   build: (n) => fanRepo(n, 'in'),  run: (rr) => graphCallers({ repoRoot: rr, symbol: 'target' }) },
  { name: 'graph_impact',    cap: EDGE_CAP,   build: (n) => fanRepo(n, 'in'),  run: (rr) => graphImpact({ repoRoot: rr, symbol: 'target', depth: 1 }) },
  { name: 'graph_callees',   cap: EDGE_CAP,   build: (n) => fanRepo(n, 'out'), run: (rr) => graphCallees({ repoRoot: rr, symbol: 'target', depth: 1 }) },
  { name: 'graph_neighbors', cap: EDGE_CAP,   build: (n) => fanRepo(n, 'in'),  run: (rr) => graphNeighbors({ repoRoot: rr, symbol: 'target' }) },
  { name: 'graph_search',    cap: SEARCH_CAP, build: (n) => labelRepo(n),      run: (rr) => graphSearch({ repoRoot: rr, query: 'widget' }) },
];

describe('every capped verb reports a floor when its fetch saturates', () => {
  for (const verb of VERBS) {
    it(`★★★ ${verb.name} saturates at its own cap (${verb.cap}) and says so`, async () => {
      repoRoot = await verb.build(verb.cap + 1);
      // ⚠ THIS ALSO PROVES THE GUARD DOES NOT THROW FOR THIS VERB. renderCompact refuses to render
      // a remainder without the floor flag, so a verb that forgot it fails as an exception rather
      // than as a wrong number — an exception that would otherwise first appear in production,
      // because nothing else in this suite saturates a fetch.
      const out = await verb.run(repoRoot);
      const marker = markerLine(out);
      expect(marker, `${verb.name} saturated its fetch but emitted no truncation marker at all`)
        .toBeDefined();
      expect(marker, `${verb.name} hit its fetch cap, so its remainder is a floor, not a total`)
        .toMatch(/at least/i);
    }, 60_000);

    it(`★★★ ${verb.name} does NOT dress an unsaturated remainder as a floor`, async () => {
      // ⛔ THE CONTROL THAT DISCRIMINATES, and it is the one that looks uninteresting. A fixture
      // below the display budget emits no marker at all, so it cannot separate "the floor fires
      // only on saturation" from "the floor never fires" — A CONTROL THAT PRODUCES SILENCE CANNOT
      // TELL A CORRECT SILENCE FROM A DEAD INSTRUMENT. UNDER overflows the display budget without
      // reaching any fetch cap, which is the only shape that distinguishes them.
      repoRoot = await verb.build(UNDER);
      const marker = markerLine(await verb.run(repoRoot));
      // The marker must EXIST, or this is the silent case that discriminates nothing.
      expect(marker, `${verb.name} must still truncate for display, or this control is vacuous`)
        .toBeDefined();
      // ⭐ THE THIRD CONTROL IS SATISFIED HERE, which is what makes this prohibition worth writing:
      // the sibling test above drives the SAME verb at its cap + 1 and proves the subject really
      // does reach the state this matcher rejects. Canaries on a prohibition whose subject can
      // never violate it certify nothing — the lesson from the dead `LIMIT 100` rule next door.
      expectAbsentWithLiveMatcher(
        /at least/i,
        { forbidden: 'TRUNCATED at least 180 more', allowed: 'TRUNCATED 20 more' },
        marker,
        `${verb.name} truncated for display only — a floor here would be decoration`,
      );
    }, 60_000);
  }

  it('★★★ THE DOOR ITSELF: reporting a remainder without saying whether it is a floor THROWS', () => {
    // ⭐ THE HALF THAT DOES NOT DEPEND ON THE LIST ABOVE. Every test in this file drives a verb
    // that exists today; this one tests the mechanism, so it covers the verb added next month by
    // someone who never reads this file. Driving five verbs through a door tests five people
    // walking. This tests the door.
    expect(() => renderCompact({
      nodes: [],
      edges: [{ from_id: 'c', to_id: 'a', relation: 'CALLS', source_file: 'y.js', source_line: 2, confidence: 0.9 }],
      truncated: 5,
    })).toThrow(/truncatedIsFloor/);

    // ⛔ AND THE NEGATIVE CONTROL, or the assertion above would pass against a renderer that threw
    // on everything — a guard that fires on all input is worse than none, which this repository has
    // shipped and had to remove. Both answers must be constructible.
    expect(() => renderCompact({ nodes: [], edges: [], truncated: 5, truncatedIsFloor: false })).not.toThrow();
    expect(() => renderCompact({ nodes: [], edges: [], truncated: 5, truncatedIsFloor: true })).not.toThrow();

    // ⛔ AND NO REMAINDER MEANS NO QUESTION. A blanket requirement would have broken module_tree,
    // which passes a literal `truncated: 0`; scoping the guard to `> 0` is the only reason making
    // the parameter mandatory did not break five existing call sites.
    expect(() => renderCompact({ nodes: [], edges: [], truncated: 0 })).not.toThrow();
  });

  it('★★★ the harness itself can tell its two fixtures apart', async () => {
    // ⛔ POSITIVE CONTROL ON THE FIXTURE, IN THE SAME RUN. If `fanRepo` silently produced the same
    // graph at both sizes, every pair above would still pass — the saturating assertion and the
    // non-saturating one would both be reading whichever graph actually got built, and this file
    // would be vacuous while looking thorough. That is the shape of a probe whose answer was
    // structurally forced, which cost me a retracted refutation earlier today.
    repoRoot = await fanRepo(EDGE_CAP + 1, 'in');
    const saturated = await graphImpact({ repoRoot, symbol: 'target', depth: 1 });
    await rm(repoRoot, { recursive: true, force: true });
    repoRoot = await fanRepo(UNDER, 'in');
    const plain = await graphImpact({ repoRoot, symbol: 'target', depth: 1 });
    expect(saturated, 'the saturating fixture must truncate at all').toMatch(/TRUNCATED/);
    expect(plain, 'the control fixture must ALSO truncate, or it is not a control').toMatch(/TRUNCATED/);
    expect(saturated, 'the two fixtures must differ, or every pair above is vacuous').not.toBe(plain);
  }, 90_000);
});
