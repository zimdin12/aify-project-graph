// AN ABSENT POPULATION MUST NOT RENDER AS A MEASURED ONE.
//
// Both packet consumers used to read `matched?.symbols_total ?? symHits.length`. That `??`
// conflates two states which must never look alike:
//   1. a producer that MEASURED the population and found total === sample.length;
//   2. a producer that omitted it, or does not know.
//
// ⛔ THIS IS NOT HYPOTHETICAL. While `symbols_total` was wrongly deleted from
// graphConsequences (2026-08-12, restored same day at dfa198a), this fallback silently
// substituted the sample for the population and printed "UNRANKED (3 matches)" on a repo with
// NINE definitions. The packet tests stayed green throughout — the fallback did not merely
// fail to catch the deletion, it ABSORBED it and manufactured a confident wrong number.
//
// review, hermes session's ruling, implemented here: `symHits.length` is a display count,
// not a population authority. A total is usable only when producer-attested AND internally
// consistent (>= the sample it accompanies); everything else is `unknown`. A boolean cannot
// mint a count — `symbols_truncated === false` with no total is still unknown.
//
// ⚠ WHY THE MATRIX IS TESTED DIRECTLY: the producer now always supplies the field, so the
// absent/null/invalid states are not reachable end-to-end without mutating production. Those
// arms are asserted against the resolver itself; the two integration arms below prove each
// CONSUMER is wired to it. Both layers are needed — the resolver being right does not prove
// a call site uses it, which is the exact split that let one consumer stay broken for a day
// after the other was "fixed".
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphPacket, resolvePopulation } from '../../../mcp/stdio/query/verbs/packet.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
  repoRoot = undefined;
});

// `anchorSymbol` decides WHICH consumer is exercised: anchored -> the feature branch
// (matchedViaSymbol / "DEFINED IN"), unanchored -> the symbol-pointer branch ("UNRANKED").
//
// ★ `noFeatures` IS THE DOOR TO THE EXPENSIVE ROUTE, and finding it took a surviving mutant.
// `resolveFeatureForSymbolCheap` (packet.js:853) returns null when `functionality.features`
// is EMPTY — so an empty overlay is what makes packet fall through to graphConsequences at
// :872. With ANY feature present (even an unrelated one) the cheap producer answers and
// synthesizes its own `symbols_total`, and a producer-side mutation is invisible.
// `secondLanguageAfter: N` puts a SECOND language only in rows past index N — so a census
// computed from the 50-row retrieval page cannot see it, and one computed over the uncapped
// predicate can. That difference is the whole point of the arm that uses it.
async function makeRepo({ defs = 9, anchorSymbol = false, noFeatures = false, distinctFiles = false, secondLanguageAfter = null } = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'apg-popclosed-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  await writeFile(join(repo, '.aify-graph', 'functionality.json'), JSON.stringify({
    features: noFeatures ? [] : [{
      id: anchorSymbol ? 'mat' : 'unrelated',
      name: anchorSymbol ? 'mat' : 'unrelated',
      anchors: { symbols: [anchorSymbol ? 'GpuMaterial' : 'somethingElse'], files: [] },
    }],
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  // Default: one canonical key (one label, ONE file) so the rows clear BOTH ambiguity guards
  // and reach the structured `matched` route — the canonical-collapse shape.
  //
  // `distinctFiles`: many files, so the rows are GENUINELY ambiguous and short-circuit to the
  // AMBIGUOUS string route instead. Mixed languages so the cross-language finding has something
  // to find. This is the third branch, and no fixture reached it until the field test hit it on
  // real C++.
  for (let i = 0; i < defs; i += 1) {
    db.run(
      `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
       VALUES ($id, 'Class', 'GpuMaterial', $f, $l, $e, $lang, 1, '{}')`,
      {
        id: `n${i}`,
        f: secondLanguageAfter !== null
          ? (i < secondLanguageAfter ? `engine/cpp/m${i}.h` : `engine/shaders/m${i}.glsl`)
          : (distinctFiles ? `engine/shaders/mirror_${i}.glsl` : 'engine/GpuMaterialPalette.h'),
        l: 10 + i,
        e: 20 + i,
        lang: secondLanguageAfter !== null
          ? (i < secondLanguageAfter ? 'cpp' : 'glsl')
          : (distinctFiles && i > 0 ? 'glsl' : 'cpp'),
      },
    );
  }
  db.close();
  return repo;
}

describe('an unattested population must render as UNKNOWN, never as the sample', () => {
  // ---- the resolver matrix. Hand-written expectations, one row per state dev enumerated.
  it('★★ RESOLVER — only a producer-attested, internally consistent total is usable', () => {
    // attested, total === sample: a MEASURED equality, and it must stay distinguishable
    // from an absent field that happens to produce the same number.
    expect(resolvePopulation(3, 3)).toEqual({ attested: true, total: 3 });
    // attested, total > sample
    expect(resolvePopulation(9, 3)).toEqual({ attested: true, total: 9 });
    // absent / null / undefined -> unknown, NEVER the sample length
    expect(resolvePopulation(undefined, 3)).toEqual({ attested: false, total: null });
    expect(resolvePopulation(null, 3)).toEqual({ attested: false, total: null });
    // ⛔ CONTRADICTING total: smaller than the sample in hand is not a total, it is a
    // contradiction — and a field must not be trusted merely for existing.
    expect(resolvePopulation(2, 3)).toEqual({ attested: false, total: null });
    // non-integer shapes must not slip through as truthy numbers
    expect(resolvePopulation('9', 3)).toEqual({ attested: false, total: null });
    expect(resolvePopulation(3.5, 3)).toEqual({ attested: false, total: null });
    expect(resolvePopulation(NaN, 3)).toEqual({ attested: false, total: null });
    // a zero-sample call is still answerable
    expect(resolvePopulation(0, 0)).toEqual({ attested: true, total: 0 });
  });

  it('★★ A BOOLEAN CANNOT MINT A COUNT — truncated:false with no total is still unknown', () => {
    // The tempting inference is "not truncated, therefore sample === population". It does
    // not follow: the flag describes the sample, and no flag value supplies a number.
    expect(resolvePopulation(undefined, 3).attested, 'truncated=false cannot imply a total').toBe(false);
    expect(resolvePopulation(undefined, 3).total).toBeNull();
  });

  // ---- consumer wiring. The resolver being correct does not prove a call site uses it.
  // ⛔ THESE TWO ARMS EXERCISE THE **CHEAP** PRODUCER, NOT graphConsequences — MEASURED.
  //
  // I wrote them believing they were end-to-end over the expensive route. They are not:
  // `resolveFeatureForSymbolCheap` (packet.js:853) resolves any symbol the graph knows and
  // SYNTHESIZES its own `symbols_total: cheap.locationsTotal` (:862, :868). graphConsequences
  // is only reached at :872 when the cheap path found nothing.
  //
  // Proof they do not cover the producer: with `symbols_total` DELETED from consequences.js,
  // all four cases in this file still passed. A surviving mutant — so these arms are
  // discriminator-absent for the producer contract, whatever else they show.
  //
  // ⇒ They are kept because they DO pin the cheap route's rendering, which is a real public
  // path. They are relabelled so nobody reads them as the expensive-route coverage that
  // review, hermes session required ("include the real graphConsequences 9→3 producer route
  // for at least one end-to-end arm"). That arm is OWED and is not in this file yet; whether
  // the consequences→packet consumer route is reachable at all is the open question.
  it('★★ CHEAP-ROUTE CONSUMER 1 (symbol-pointer / UNRANKED) reports the attested population, not the cap', async () => {
    repoRoot = await makeRepo({ defs: 9, anchorSymbol: false });
    const out = await graphPacket({ repoRoot, target: 'GpuMaterial', mode: 'orient' });
    const text = typeof out === 'string' ? out : JSON.stringify(out);

    // 9 rows exist; the sample is capped at 3. The population must appear, and the sample
    // must not be presented as the total.
    expect(text, 'this fixture must reach the unranked branch').toMatch(/UNRANKED/);
    expect(text, 'the attested population must be stated').toMatch(/showing 3 of 9/);
    expect(text, 'the cap must never be rendered as the population').not.toMatch(/UNRANKED \(3 matches\)/);
  }, 30_000);

  it('★★★ END-TO-END OVER THE REAL graphConsequences PRODUCER — the arm the others could not be', async () => {
    // ⇒ dev's required anti-target, and the ONLY arm here that covers the producer contract.
    // Empty overlay -> cheap resolver returns null -> packet.js:872 calls graphConsequences,
    // whose canonical-collapse route (9 rows, one key) returns matched.symbols_total = 9 with
    // a 3-row sample.
    //
    // MEASURED both ways, because a passing assertion is not a discriminator:
    //   fields present  -> "showing 3 of 9"
    //   fields DELETED  -> "showing 3; total population UNKNOWN"   (no manufactured 9)
    // The identical mutation against the cheap-route arms above leaves them green, which is
    // exactly why this arm exists and why they were relabelled.
    repoRoot = await makeRepo({ defs: 9, noFeatures: true });
    const out = await graphPacket({ repoRoot, target: 'GpuMaterial', mode: 'orient' });
    const text = typeof out === 'string' ? out : JSON.stringify(out);

    expect(text, 'the empty-overlay fixture must reach a population line').toMatch(/UNRANKED/);
    expect(text, 'the producer-attested population must survive the round trip').toMatch(/showing 3 of 9/);
    // Hand-written negative: with the producer supplying the field, the fail-closed wording
    // must NOT appear — otherwise this arm would pass whether or not the producer worked.
    expect(text, 'UNKNOWN here would mean the producer contract silently broke')
      .not.toMatch(/population UNKNOWN/);
  }, 30_000);

  it('★★★ THIRD ROUTE — the AMBIGUOUS branch must carry the population it is already reading', async () => {
    // ⛔ the field test, on real C++ (echoes, no overlay): `GpuMaterial` printed FIVE candidates
    // with no count, no truncation marker and no cross-language finding — while
    // `graph_consequences`, the source of that very text, printed "16 concrete candidates
    // found", "SHOWING 5 OF 16 — 11 omitted" and the DUPLICATE finding for the same symbol in
    // the same repo. Eleven definitions silently absent, including the sole C++ declaration.
    //
    // ★ Third branch of one verb with the same cap-as-total defect. A fix applied per-route
    // does not cover the other routes reading the same data — two branches got population and
    // this one did not, and no fixture reached it. That is a route-coverage failure, not a
    // C++-specific one: a JS fixture COULD have caught it if it had been aimed here.
    //
    // ⇒ Their construction method, which is the reusable part: a graph with NO overlay forces
    // every symbol off the feature route. Here that is `features: []`.
    repoRoot = await makeRepo({ defs: 16, noFeatures: true, distinctFiles: true });
    const out = await graphPacket({ repoRoot, target: 'GpuMaterial', mode: 'orient' });
    const text = typeof out === 'string' ? out : JSON.stringify(out);

    expect(text, 'this fixture must reach the AMBIGUOUS branch').toMatch(/AMBIGUOUS/);
    expect(text, 'the producer-attested population must be carried through').toMatch(/showing \d+ of 16/);
    expect(text, 'the omission must be stated, not left to be inferred').toMatch(/not listed here/);
    // Hand-written negative: a bare CANDIDATES header is the defect the field test found.
    expect(text, 'a bare candidate list implies the enumeration is complete').not.toMatch(/CANDIDATES:\n/);
  }, 30_000);

  it('★★★ FOURTH STATE — above the retrieval cap the population is a FLOOR, not a total', async () => {
    // ⛔ the field test built the case both of us had recorded as untested: 60 definitions, above
    // the 50-row retrieval cap. `graph_consequences` was exactly right — "AT LEAST 50 concrete
    // candidates, identified from 50 of 60 matching rows — the full ambiguity population is NOT
    // established (retrieval was capped before grouping)". The packet rendered `showing 5 of
    // 50`: THE CAP AS THE POPULATION, when the truth is 60 and the sibling says so.
    //
    // ★ The three-state vocabulary was one state short. `of N` is the only wrong choice
    // available here — 50 is real and useful, so it is not UNKNOWN, and it is not the total.
    //
    // ⚠ AND THIS IS WHY THE SHARED RENDERER WAS NOT ENOUGH — the field test's point, which the
    // parity arm below CANNOT catch: a renderer handed the bare integer 50 prints "of 50" in
    // every branch at once, and parity passes with both routes agreeing on the same wrong word.
    // Exactness has to travel WITH the value. This arm is the one that fails if it does not.
    repoRoot = await makeRepo({ defs: 60, noFeatures: true, distinctFiles: true });
    const text = String(await graphPacket({ repoRoot, target: 'GpuMaterial', mode: 'orient' }));

    expect(text, 'a capped population must be rendered as a floor').toMatch(/AT LEAST/);
    expect(text, 'the rows seen vs matched must be stated').toMatch(/matching rows/);
    expect(text, 'the reader must be told grouping happened after the cap').toMatch(/FLOOR/);
    // Hand-written negative: the exact wrong rendering the field test measured.
    expect(text, 'the retrieval cap must never be printed as the total').not.toMatch(/showing \d+ of 50\b/);
  }, 60_000);

  it('★★★ A SECOND LANGUAGE BEYOND THE RETRIEVAL PAGE MUST STILL BE FOUND', async () => {
    // ⛔ dev's probe: 60 definitions, the first 50 C++ and the last 10 GLSL, produced
    //     DEFINED IN … showing 3 of 60
    //     PARSED 60 BY LANGUAGE: cpp 50
    // and NO CROSS-LANGUAGE DUPLICATE. An EXACT total (from a COUNT) lending its authority to a
    // SAMPLED composition (from the 50-row page) — and the absence of the second language from
    // that page SUPPRESSED the finding. The suppression is worse than the wrong count: a
    // missing warning cannot be doubted.
    //
    // ⇒ The census is now grouped over the UNCAPPED predicate. This fixture puts the second
    // language ONLY beyond the page, so a census built from the sample cannot see it.
    repoRoot = await makeRepo({ defs: 60, anchorSymbol: true, secondLanguageAfter: 50 });
    const text = String(await graphPacket({ repoRoot, target: 'GpuMaterial', mode: 'orient' }));

    expect(text, 'the uncapped total must still be reported').toMatch(/of 60/);
    expect(text, 'the census must count the language that exists only past the page')
      .toMatch(/glsl 10/);
    expect(text, 'and the finding it enables must not be suppressed').toMatch(/CROSS-LANGUAGE DUPLICATE/);
  }, 60_000);

  it('★★★ ROUTE IDENTITY — the object-form symbol-pointer branch uses the shared renderer too', async () => {
    // ⛔ My claim that one renderer is consumed by EVERY branch was false. This route —
    // unanchored symbol, object-form consequences — read `matched.symbols` and the total but
    // never `symbols_by_language`, and never called renderCandidateDisclosures(). dev's probe
    // (1 C++ / 15 GLSL) got the population warning and NO duplicate finding, NO floor caveat.
    //
    // ★ Branch PARITY could not catch this: parity compares the branches you already listed.
    // This asserts route IDENTITY — that this specific route reaches the renderer at all.
    repoRoot = await makeRepo({ defs: 16, noFeatures: false, distinctFiles: true });
    const text = String(await graphPacket({ repoRoot, target: 'GpuMaterial', mode: 'orient' }));

    expect(text, 'the unanchored object route must reach the shared renderer').toMatch(/CROSS-LANGUAGE DUPLICATE/);
    expect(text, 'including the floor caveat the renderer owns').toMatch(/count is a FLOOR/);
  }, 60_000);

  it('★★★ BRANCH PARITY — both routes emit the SAME disclosures, from one renderer', async () => {
    // ⛔ THE DIVERGENCE THIS EXISTS TO PREVENT. After the third per-branch fix, the field test
    // compared the two survivors and found a fourth: both branches printed the CROSS-LANGUAGE
    // DUPLICATE finding, and only ONE carried the FLOOR caveat — same verb, same symbol, same
    // repo content. A disclosure added where someone was burned, not to its sibling.
    //
    // ★ Their prescription, and it is the right one: stop patching branches. One renderer
    // consumed by every branch means a new branch cannot be BORN missing the disclosures —
    // which closes the class instead of the instance and makes the next "third route"
    // impossible rather than findable.
    const feature = await makeRepo({ defs: 16, anchorSymbol: true, distinctFiles: true });
    const featureText = String(await graphPacket({ repoRoot: feature, target: 'GpuMaterial', mode: 'orient' }));
    await rm(feature, { recursive: true, force: true });

    repoRoot = await makeRepo({ defs: 16, noFeatures: true, distinctFiles: true });
    const ambiguousText = String(await graphPacket({ repoRoot, target: 'GpuMaterial', mode: 'orient' }));

    for (const [label, text] of [['feature route', featureText], ['ambiguous route', ambiguousText]]) {
      expect(text, `${label}: cross-language duplicate must be reported`).toMatch(/CROSS-LANGUAGE DUPLICATE/);
      expect(text, `${label}: the FLOOR caveat must not be branch-specific`).toMatch(/count is a FLOOR/);
      expect(text, `${label}: unparsed-source mechanism must be named`).toMatch(/generated or embedded/);
    }
  }, 60_000);

  it('★★ CHEAP-ROUTE CONSUMER 2 (feature branch / DEFINED IN) is wired to the SAME resolver', async () => {
    // A separate call site with its own cap. It kept the defect for a day after the other
    // was fixed, which is why it gets its own arm rather than sharing one.
    repoRoot = await makeRepo({ defs: 9, anchorSymbol: true });
    const out = await graphPacket({ repoRoot, target: 'GpuMaterial', mode: 'orient' });
    const text = typeof out === 'string' ? out : JSON.stringify(out);

    expect(text, 'this fixture must reach the feature branch').toMatch(/DEFINED IN/);
    expect(text, 'the attested population must be stated here too').toMatch(/showing 3 of 9/);
    expect(text, 'a bare "DEFINED IN:" would imply the list is complete')
      .not.toMatch(/DEFINED IN \(the symbol you asked for, not the feature\):/);
  }, 30_000);
});
