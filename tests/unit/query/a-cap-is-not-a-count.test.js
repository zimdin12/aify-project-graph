// ⛔ THE DEFECT AN A/B FOUND, 2026-09-07.
//
// Four agents were asked how many callers `has` has. The graph told the two graph-armed ones
// `CONFIDENCE: 100 callers`. The real answer is 10 call sites in one function, and one of them wrote
// back unprompted: *"the headline number the verb prints is still 100 callers, and 100 is wrong by a
// factor of 100."*
//
// ⭐ AND 100 WAS NEVER A COUNT. `EDGE_FETCH_CAP` is 100, so `mapped.length` saturates there. The verb
// already KNOWS it saturated — `edgesTruncated` is computed from a deliberate `LIMIT CAP + 1` — and
// that flag reaches the trust banner while never reaching the line that prints the number. Computed
// and not consumed, the same shape as the unwired claims this repository keeps finding.
//
// ⛔ `graph_impact` is worse: it uses `LIMIT 100` with no `+ 1`, so it caps SILENTLY and cannot even
// detect that it did. A number it reports as a count may be a cap and nothing in the code can tell.
//
// ⇒ A capped result is a FLOOR. Saying "100" states a fact the query did not establish, and the
// caveat that rescued those agents sits below the number rather than on it.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { graphImpact } from '../../../mcp/stdio/query/verbs/impact.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';
import { describeResultCount } from '../../../mcp/stdio/query/overcount-risk.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// ⛔ THE CAP IS DUPLICATED HERE ON PURPOSE. Importing IMPACT_FETCH_CAP would make the fixture
// track whatever the subject says, so a cap changed to 5 would still "saturate" and the test
// would agree with any value. The number is written down so the fixture and the subject can
// DISAGREE, which is the only way this assertion can fail for the right reason.
const CAP = 100;

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

/** A repo where `callerCount` distinct functions each call one target. */
async function fanInRepo(callerCount) {
  const r = await mkdtemp(join(tmpdir(), 'apg-cap-'));
  await mkdir(join(r, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', r, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', r, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(r, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: callerCount + 1, edges: callerCount,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(r, '.aify-graph', 'graph.sqlite'));
  const node = (id, label) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ('${id}','Function','${label}','src/a.js',1,2,'javascript',1,'{}')`);
  node('t', 'target');
  for (let i = 0; i < callerCount; i += 1) {
    node(`c${i}`, `caller${i}`);
    // ⚠ One edge per (from,to,relation): the edges table carries a UNIQUE index on exactly that
    // triple, so distinct callers are the only way to build a fan-in of a given size.
    db.run(`INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
            VALUES ('c${i}','t','CALLS','src/a.js',${i + 10},0.9,'EXTRACTED','test')`);
  }
  db.close();
  return r;
}

describe('a capped result is a floor, and says so', () => {
  it('★★★ THE REAL CASE: a truncated result reads as AT LEAST, never as a count', () => {
    const r = describeResultCount({ resultCount: 100, truncated: true });
    expect(r.isFloor).toBe(true);
    expect(r.text).toMatch(/at least 100/i);
    // ⛔ The bare number must not stand alone anywhere in the phrase, or a reader skimming for a
    // figure takes the cap as the answer — which is exactly what happened to a live agent.
    expect(r.text).not.toBe('100');
  });

  it('★★★ THE POSITIVE CONTROL: an untruncated result is reported plainly', () => {
    // A qualifier on every answer is decoration, and this repository has torn out an always-on
    // caveat before. The floor language must appear only when the query actually saturated.
    const r = describeResultCount({ resultCount: 12, truncated: false });
    expect(r.isFloor).toBe(false);
    expect(r.text).toBe('12');
  });

  it('★★ zero is a real answer and is never dressed as a floor', () => {
    expect(describeResultCount({ resultCount: 0, truncated: false }))
      .toMatchObject({ isFloor: false, text: '0' });
  });

  it('★★★ THE WIRING: graph_callers puts the truncation on the NUMBER, not only the banner', () => {
    // The flag existed and reached `buildTrustLine` while the confidence line printed a bare count.
    // Fixing the helper without wiring it would leave the exact defect the A/B measured.
    const src = read('../../../mcp/stdio/query/verbs/callers.js');
    expect(src, 'the confidence line must consult the helper').toContain('describeResultCount');
    // Live control: the identifier does exist in the module that owns it, so its absence would be a
    // measured result rather than a misspelling that can never match.
    expect(read('../../../mcp/stdio/query/overcount-risk.js')).toContain('describeResultCount');
  });

  // ⛔⛔ THIS TEST TOOK FOUR VERSIONS AND ONLY THE FOURTH CAN FAIL. The first three are the
  // lesson, so they are written down rather than deleted.
  //
  //   v1  `/LIMIT 100\b/`            matched the COMMENT explaining the fix.
  //   v2  added a backtick to "pin it to the query literal" — matched the same comment, because
  //       the comment writes the phrase in backticks. Mention-not-use, twice, inside the very
  //       test written to catch mention-not-use.
  //   v3  stripped `//` lines first, then asserted the stripped code contains no `LIMIT 100`.
  //       Clean today. ⛔ AND DEAD ON ARRIVAL: the fixed query is `LIMIT ${IMPACT_FETCH_CAP + 1}`,
  //       so the literal "LIMIT 100" appears NOWHERE in the code and never will. Drop the `+ 1` —
  //       exactly the regression this test names — and the source still contains no "LIMIT 100".
  //       A prohibition on a spelling the codebase cannot write is a gate that cannot fail.
  //
  // ⭐⭐⭐ AND CONVERTING v3 TO `expectAbsentWithLiveMatcher` DID NOT SAVE IT. That helper proves
  // the MATCHER can fire against a canary. It says nothing about whether the SUBJECT could ever
  // reach a state the matcher would reject. Canaries bolted to a dead prohibition make it look
  // MORE rigorous while certifying exactly as much as before: nothing. The missing control is a
  // third one — HAS THIS SUBJECT EVER BEEN IN A STATE THIS ASSERTION WOULD REJECT? For a
  // prohibition added in the same commit that removed the thing it forbids, the answer is no and
  // can never become yes. (Found by an outside reviewer briefed to falsify, 2026-09-07.)
  //
  // ⇒ v4 ASSERTS THE BEHAVIOUR INSTEAD OF A SPELLING OF THE CODE. Feed the verb one more row than
  // it keeps and require it to notice. This is the assertion that goes red when the `+ 1` dies:
  // with `LIMIT CAP` the query returns exactly CAP rows, `edges.length > CAP` is false, and the
  // verb reports a saturated result as a plain count — the original defect, restored.
  it('★★★ THE REGRESSION: fed one more row than it keeps, graph_impact reports a FLOOR', async () => {
    repoRoot = await fanInRepo(CAP + 1);
    const out = await graphImpact({ repoRoot, symbol: 'target', depth: 1 });
    expect(out, 'a saturated result stated as a count is the defect the A/B found')
      .toMatch(/at least/i);
  }, 30_000);

  // ⛔⛔ THE DEFECT THIS TEST FOUND ON ITS FIRST RUN, which is why it exists in this shape.
  //
  // v4 went red against the fixed code, and the red was RIGHT. Driving the real verb on a fan-in of
  // 101 printed thirty rows and `TRUNCATED 70 more` — implying exactly 100 — and NO confidence line
  // at all. The floor language shipped that morning sits behind `if (suspicious)` in impact.js, and
  // a six-character symbol with one indexed node is not suspicious. ⇒ THE FIX HAD GONE INTO THE
  // LINE THAT SOMETIMES PRINTS AND NOT THE LINE THAT ALWAYS DOES, and `graph_callers` shared the
  // hole through `renderCompact`. Repaired once, in the renderer, and wired from both verbs.
  //
  // ⭐ A test that only ever agreed with the code would not have found that. This one disagreed.
  it('★★★ THE DISCRIMINATING CONTROL: display truncation WITHOUT saturation stays a plain count', async () => {
    // ⛔ THE 5-CALLER CASE IS TOO WEAK TO BE THE CONTROL. It emits no TRUNCATED line at all, so it
    // cannot tell "the floor fires only on saturation" from "the floor never fires". 40 callers
    // overflows the display budget and does NOT reach the fetch cap, which is the only shape that
    // separates the two. This repository has shipped an always-on caveat and had to tear it out.
    repoRoot = await fanInRepo(40);
    const out = await graphImpact({ repoRoot, symbol: 'target', depth: 1 });
    expect(out, 'the display budget truncated, so the marker must be present').toMatch(/TRUNCATED/);
    // ⭐ AND HERE THE THIRD CONTROL IS SATISFIED, WHICH IS WHY THIS PROHIBITION IS WORTH WRITING.
    // The sibling test above feeds CAP + 1 and proves the subject really does reach the state this
    // matcher rejects. So the canaries below are not decoration on a dead rule: the rule can fire,
    // it discriminates, and the subject has been observed violating it.
    expectAbsentWithLiveMatcher(
      /at least/i,
      { forbidden: 'TRUNCATED at least 70 more', allowed: 'TRUNCATED 10 more' },
      out,
      'nothing saturated, so a floor here would be decoration',
    );
  }, 30_000);

  it('★★ the floor language is wired into graph_impact, not only available to it', () => {
    // Kept from v3 because it is an EXPECTATION rather than a prohibition: it names something the
    // source must contain, so it fails the moment the wiring is removed.
    const src = read('../../../mcp/stdio/query/verbs/impact.js');
    expect(src, 'it must fetch one extra to detect saturation').toMatch(/IMPACT_FETCH_CAP \+ 1/);
    expect(src, 'and report the floor').toContain('describeResultCount');
  });
});
