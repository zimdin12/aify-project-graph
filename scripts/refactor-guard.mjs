// REFACTOR GUARD — prove a slice changed no behaviour, or refuse to say so.
//
// The last refactor proved the server surface unchanged by comparing a `tools/list` payload
// byte-for-byte against a detached pre-refactor worktree. That worked because the payload is a
// pure function of the code. A VERB's output is not: it depends on graph state, on the working
// tree, on git HEAD. Comparing two runs of a verb across a code change only means something if
// everything else was pinned — and "everything else" is exactly what nobody pinned last time.
//
// ⛔ SO THE FIRST JOB OF THIS TOOL IS TO REFUSE. If the graph moved between baseline and verify,
// the comparison is meaningless and reporting a pass would be worse than reporting nothing: it
// would be the two-snapshot defect wearing a green tick. A guard that cannot detect its own
// invalid conditions certifies whatever happened to run.
//
// ⚠ AND THE CORPUS TRAVELS IN THE BASELINE. A digest of results without the inputs that produced
// them cannot be audited — the reader can see two numbers differ and not what differs. Same
// lesson as the selection receipt: membership goes in the body.
//
//   node scripts/refactor-guard.mjs --baseline   # before a slice
//   node scripts/refactor-guard.mjs --verify     # after; exits 1 on any drift
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
// The carrier predicate lives in its own module because a check inside a CLI whose main()
// runs on import cannot be called by a test — and this one was wrong for weeks.
import { carrierMovement } from './lib/carrier.mjs';
import { guardVerdict, baselineVerdict, VERDICT, REFUSAL } from './lib/guard-verdict.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⛔ THE BASELINE LIVED UNDER .aify-graph AND REINDEXING DELETED IT. the reviewer hit that
// during review: "running focused tests/reindex removed refactor-guard-baseline.json, proving
// the evidence cannot be rerun after the fact." Evidence stored inside the thing that
// regenerates is not evidence.
const ARTIFACT = join(REPO, '.refactor-guard-baseline.json');
const sha = (b) => createHash('sha256').update(b).digest('hex');

// ── the carrier: everything the outputs depend on that is NOT the code under test ────────────
//
// If any of this moves, the run is not comparable. Recorded rather than assumed, and compared
// rather than trusted.
function carrier() {
  const dbPath = join(REPO, '.aify-graph', 'graph.sqlite');
  const manifestPath = join(REPO, '.aify-graph', 'manifest.json');
  const out = { graphPresent: existsSync(dbPath) };
  if (out.graphPresent) {
    // Hash the whole DB. It is the population every verb answers from; a size/mtime pair would
    // miss a same-size edit, which is the defect this project has now found three times.
    out.graphSha256 = sha(readFileSync(dbPath));
    out.graphBytes = statSync(dbPath).size;
  }
  if (existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    out.indexedCommit = m.commit ?? null;
    out.nodes = m.nodes ?? null;
    out.edges = m.edges ?? null;
  }
  try {
    out.workingTreeDirty = execFileSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' })
      .split('\n').filter(Boolean).length;
  } catch { out.workingTreeDirty = null; }
  return out;
}

// ── the corpus ───────────────────────────────────────────────────────────────────────────────
//
// Explicit, not sampled. A sampled corpus makes a pass mean "the parts I happened to draw did
// not change", which is a claim about the draw rather than about the code.
// ⛔ 55/55 WAS A DENOMINATOR OVER INPUTS, NOT OVER THE MOVED ROUTES. the reviewer made
// `buildFeaturePacket` emit a marker string and the guard STILL reported 55 of 55 unchanged —
// because this checkout has no functionality/tasks overlay, so no corpus cell ever reached the
// moved feature or task builder. A false green on the core proof of the slice.
//
// ⇒ An immutable fixture repo with a real feature and a real task, and a ROUTES ledger whose
// markers can only appear if the moved builder actually ran. `routes executed / routes declared`
// is reported SEPARATELY from corpus entries, because more inputs is not more coverage.
const FIXTURE = join(REPO, 'tests', 'fixtures', 'packet-routes');

const ROUTES = [
  { id: 'feature-body', repo: FIXTURE, target: 'feature:feat-terrain', mode: 'plan',
    owner: 'packet-overlay.js::buildFeaturePacket', marker: 'ROUTE_MARKER_FEATURE' },
  { id: 'feature-contracts', repo: FIXTURE, target: 'feature:feat-terrain', mode: 'audit',
    owner: 'packet-overlay.js::contractsFromFeature', marker: 'CONTRACT_MARKER_A' },
  { id: 'feature-tests', repo: FIXTURE, target: 'feature:feat-terrain', mode: 'review',
    owner: 'packet-overlay.js::testsFromFeature', marker: 'TEST_MARKER_A' },
  { id: 'task-body', repo: FIXTURE, target: 'task:CU-999', mode: 'plan',
    owner: 'packet-overlay.js::buildTaskPacket', marker: 'ROUTE_MARKER_TASK' },
  // ⛔ SLICE 2 REPRODUCED BLOCKER 1 BEFORE IT SHIPPED. The guard reported "59 of 59 identical ·
  // routes executed 4/4" while TWO OF THE THREE declarations slice 2 moved were never executed by
  // the corpus. I proved it the way dev proved it against slice 1 — mutate the moved function and
  // watch the guard: `resolvePopulation` turned 25 cells red, `countByLanguage` and
  // `resolveFeatureForSymbolCheap` turned nothing red at all.
  //
  // The mechanism, and it is not subtle once measured: `resolveFeatureForSymbolCheap` returns
  // null on its FIRST line when there is no functionality overlay, and THIS REPO HAS NO
  // functionality.json. So all 55 live-repo cells exit that function immediately, and
  // `countByLanguage` — which is only ever called from inside it — cannot run at all. A corpus of
  // 55 bare-symbol inputs against a repo with no overlay is 55 inputs and zero coverage of the
  // cheap path.
  //
  // ⇒ A bare-symbol route against the FIXTURE, which does have features. The marker is a LANGUAGE
  // string: the fixture graph carries a second definition of `generateTerrain` in
  // `src/terrain.glsl` with language `ROUTEMARKERLANG`, so that token can only reach the output
  // through countByLanguage's census — which only runs inside resolveFeatureForSymbolCheap, which
  // only produces a feature at all when the cheap path resolves. One marker, three declarations,
  // and it cannot be satisfied by any of them individually.
  { id: 'symbol-cheap-census', repo: FIXTURE, target: 'generateTerrain', mode: 'plan',
    owner: 'packet-symbol.js::countByLanguage + resolveFeatureForSymbolCheap',
    // ⚠ LOWERCASE, because the renderer lowercases language names on the way out. The guard
    // REFUSED on the uppercase spelling — "a baseline that cannot reach the moved code certifies
    // nothing" — and it was right to: the marker as written did not appear in the output, so the
    // route was unproven even though it was in fact running. Reading the rendered text rather
    // than assuming the marker survived is what found the transform.
    marker: 'routemarkerlang' },
  // ⛔ AND THE ROUTE ABOVE STILL DID NOT REACH `countByLanguage` — 2/3, not 3/3. Mutating it left
  // the guard green even with the symbol route running, because the census has TWO producers:
  //
  //     const census = exactCensus ?? countByLanguage(nodes);
  //
  // `languageCensusExact` answers whenever the query matched by EXACT LABEL, which every
  // plain-symbol lookup does — so `countByLanguage` is the FALLBACK and a bare-symbol route can
  // never execute it. Reaching it needs a resolution path where the matched node's label differs
  // from the string that was asked for.
  //
  // ⇒ A QUALIFIED symbol. `Terrain::qualifiedMarker` resolves through the qname index onto nodes
  // labelled `qualifiedMarker`, so the exact-label census finds nothing, returns null, and the
  // fallback runs. Two fixture nodes share that qname in different languages so the cross-language
  // line renders and carries the marker.
  //
  // ⚠ THE LESSON IS NOT "ADD A ROUTE". It is that a declaration can be moved, live, imported and
  // covered by a passing corpus while never running — and that only mutating it says so. Route
  // count and executed-declaration count are different denominators and this slice needed both.
  { id: 'symbol-qualified-census-fallback', repo: FIXTURE, target: 'Terrain::qualifiedMarker',
    mode: 'plan', owner: 'packet-symbol.js::countByLanguage (fallback census path)',
    marker: 'censusmarkerlang' },
];

const MODES = ['orient', 'plan', 'debug', 'review', 'audit'];
const TARGETS = [
  'graphPacket', 'clampToBudget', 'renderPacketLines', 'openExistingDb', 'graphWhereis',
  'mcp/stdio/query/verbs/packet.js', 'mcp/stdio/query/verbs/whereis.js', 'docs/THE-GOAL.md',
  'nodeText', 'estimateTokens', 'ZZZ_definitely_absent_symbol',
];

// ⛔ THE FIXTURE'S GIT REPO AND GRAPH CANNOT BE COMMITTED, and my first version shipped them as
// an EMBEDDED GIT REPOSITORY — git warned that no clone would contain it, which would have made
// the routes silently unreachable on any other machine while the guard reported 4/4 here. The
// same false-green shape as the defect this fixture exists to fix, one layer out.
// ⇒ The committed part is the source and the overlay JSON. The git repo and the sqlite graph are
// DERIVED and rebuilt here if absent, so a fresh clone reaches the routes.
// ⚠ The commit SHA differs per machine. That is harmless: it only reaches the SNAPSHOT line,
// which is the one named exclusion, covered by tests/unit/query/packet-snapshot-line.test.js.
function ensureFixture() {
  const git = join(FIXTURE, '.git');
  if (!existsSync(git)) {
    execFileSync('git', ['-C', FIXTURE, 'init', '-q'], { stdio: 'ignore' });
    execFileSync('git', ['-C', FIXTURE, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', FIXTURE, '-c', 'user.email=fixture@apg', '-c', 'user.name=fixture',
      'commit', '-qm', 'packet-routes fixture'], { stdio: 'ignore' });
  }
  const db = join(FIXTURE, '.aify-graph', 'graph.sqlite');
  if (!existsSync(db)) return { seeded: false, db };
  return { seeded: true, db };
}

async function runCorpus() {
  ensureFixture();
  const { graphPacket } = await import('../mcp/stdio/query/verbs/packet.js');
  const { openDb } = await import('../mcp/stdio/storage/db.js');
  const fixtureDb = join(FIXTURE, '.aify-graph', 'graph.sqlite');
  if (!existsSync(fixtureDb)) {
    const db = openDb(fixtureDb);
    try {
      // ⛔ THE SEED IS THE ONLY COMMITTED FORM OF THIS GRAPH — `.aify-graph/` is gitignored, so
      // every node a route depends on must be created HERE or that route is unreachable on any
      // machine but mine. I hand-edited the sqlite first and `git add` refused the file, which is
      // the only reason I noticed: the guard would have kept reporting 6/6 locally while refusing
      // on a fresh clone. Fail-closed, but broken for everyone else.
      //
      // `language` and `extra` are per-node because the last two routes turn on exactly those
      // fields: a distinct language proves countByLanguage's census reached the output, and a
      // shared qname is what forces resolution down the non-exact path where that census is the
      // FALLBACK rather than the exact one.
      const SEED = [
        ['n1', 'generateTerrain', 'src/terrain.js', 'javascript', '{}'],
        ['n2', 'buildMesh', 'src/mesh.js', 'javascript', '{}'],
        // second definition of generateTerrain -> cross-language census renders (route 5)
        ['n3', 'generateTerrain', 'src/terrain.glsl', 'routemarkerlang', '{}'],
        // shared qname, two languages -> qualified lookup, exact census null, fallback runs (route 6)
        ['n4', 'qualifiedMarker', 'src/terrain.js', 'censusmarkerlang', '{"qname":"Terrain.qualifiedMarker"}'],
        ['n5', 'qualifiedMarker', 'src/mesh.js', 'javascript', '{"qname":"Terrain.qualifiedMarker"}'],
      ];
      for (const [id, label, file, lang, extra] of SEED) {
        db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
                VALUES ('${id}','Function','${label}','${file}',1,1,'${lang}',1,'${extra}')`);
      }
    } finally { db.close(); }
  }
  const results = [];

  // Routes first, so a run that cannot reach the moved code fails loudly rather than reporting
  // a large clean number over inputs that never touched it.
  for (const r of ROUTES) {
    const entry = { target: `${r.id}`, mode: r.mode, route: r.id, owner: r.owner };
    try {
      const out = await graphPacket({ repoRoot: r.repo, target: r.target, mode: r.mode });
      const text = typeof out === 'string' ? out : JSON.stringify(out);
      const { stable, excluded } = splitVolatile(text);
      entry.outcome = 'ok';
      entry.bytes = Buffer.byteLength(stable, 'utf8');
      entry.sha256 = sha(stable);
      entry.volatileLines = excluded.length;
      entry.volatileShapeOk = volatileShapeOk(excluded);
      // The marker is the proof the OWNER ran. Without it the row is an input, not a route.
      entry.routeExecuted = text.includes(r.marker);
    } catch (err) {
      entry.outcome = 'threw';
      entry.error = String(err?.message || err).slice(0, 200);
      entry.routeExecuted = false;
    }
    results.push(entry);
  }

  for (const target of TARGETS) {
    for (const mode of MODES) {
      const entry = { target, mode };
      try {
        const out = await graphPacket({ repoRoot: REPO, target, mode });
        const text = typeof out === 'string' ? out : JSON.stringify(out);
        const { stable, excluded } = splitVolatile(text);
        entry.outcome = 'ok';
        entry.bytes = Buffer.byteLength(stable, 'utf8');
        entry.sha256 = sha(stable);
        // The excluded line's SHAPE is pinned even though its VALUE is not. If the snapshot line
        // stops being emitted, or changes format, that is a behaviour change the exclusion must
        // not hide — which is the whole risk of excluding anything.
        entry.volatileLines = excluded.length;
        entry.volatileShapeOk = volatileShapeOk(excluded);
      } catch (err) {
        // ⚠ A THROW IS A RESULT, NOT A SKIP. Dropping it would let a slice that starts throwing
        // on one input still report a clean pass over the inputs that survived — the
        // census-with-no-population defect, in the guard.
        entry.outcome = 'threw';
        entry.error = String(err?.message || err).slice(0, 200);
      }
      results.push(entry);
    }
  }
  return results;
}

// ⛔ MY FIRST VERSION HASHED THE WHOLE OUTPUT AGAINST A LIVE, MUTATING REPO, and it reported
// drift immediately — 614 vs 616 bytes on a run with no behaviour change at all. The cause is
// legitimate: every packet carries
//     SNAPSHOT: indexed=<sha> head=<sha> dirty=<n> trust=<tier>
// and `head` moves on every commit while `dirty` moves on every edit. During a refactor both
// change constantly, so the baseline decays as the work proceeds. A guard whose reference drifts
// under the work it is guarding will cry wolf until someone disables it.
//
// ⚠ the reviewer named this class before I hit it: "do not normalize elapsed_ms, HEAD, dirt
// or timestamps generically — a regex scrub is another way to erase a real drift." So this does
// NOT scrub. It excludes ONE named line, records that it excluded it, and gives that line its
// own shape invariant. The exclusion is visible in the artifact rather than silent in a regex.
//
// ⛔⛔ AND THE REGEX BELOW DID NOT DELIVER WHAT THE PARAGRAPH ABOVE PROMISES. It was anchored
// immediately after `trust=<tier>`, but the producer appends ` STALE` whenever the indexed commit
// differs from HEAD — which is the NORMAL condition during exactly the active refactor this guard
// exists to survive. A stale line therefore failed to match, fell through to the COMPARED set, and
// carried its per-machine SHA and per-edit dirty count straight into the baseline. The guard's one
// protection switched itself off precisely when it was needed, and the failure is the cry-wolf
// false refusal described two paragraphs up.
//
// ⇒ The sibling of this defect was fixed in the packet test at bcaf565, where the same end-anchored
// spelling made a shape assertion unpassable on a stale graph. I fixed that site and did not sweep
// for the spelling elsewhere, so this one survived another day. ONE FIX IS NOT A SWEEP.
//
// ⚠ `dirty=` NOW ACCEPTS `?`, and this widening lands in the SAME COMMIT that teaches the producer
// to emit it. Until now no input could produce `dirty=?`, and a guard no input can reach is
// decoration — so widening earlier would have been a branch nothing could exercise.
const VOLATILE_LINE = /^SNAPSHOT: indexed=\S+ head=\S+ dirty=(?:\d+|\?) trust=\S+( STALE)?$/;

// ⛔⛔ `[].every(pred)` IS VACUOUSLY TRUE, AND THAT IS HOW THIS CHECK CERTIFIED ITS OWN FAILURE.
//
// The comment at the call site says the excluded line's SHAPE is pinned so that "if the snapshot
// line stops being emitted, or changes format, that is a behaviour change the exclusion must not
// hide — which is the whole risk of excluding anything." The code implemented the exact opposite.
// A format change makes the line stop matching, `excluded` comes back EMPTY, and `every` on an
// empty array returns TRUE. The check designed to catch a format change was disabled BY the format
// change, and reported `volatileShapeOk: true` while doing it.
//
// ⇒ MEASURED, NOT ASSUMED: every one of the 61 corpus rows emits exactly ONE snapshot line. Before
// the anchor fix all 61 recorded `volatileLines: 0` with `volatileShapeOk: true` — the exclusion
// was totally inert and the artifact asserted health over it for as long as it has existed.
//
// ⇒ So ABSENCE IS NOW A FAILURE, not a vacuous pass. A packet with no volatile line has either
// stopped emitting the banner or changed its format, and both are exactly what this pins.
export function volatileShapeOk(excluded) {
  return excluded.length === 1 && VOLATILE_LINE.test(excluded[0]);
}

export function splitVolatile(text) {
  const stable = [];
  const excluded = [];
  for (const line of text.split('\n')) {
    if (VOLATILE_LINE.test(line)) excluded.push(line);
    else stable.push(line);
  }
  return { stable: stable.join('\n'), excluded };
}

const describe = (r) => `${r.target} [${r.mode}]`;

// ⛔ ONE PRINTER FOR BOTH MODES. Each refusal names a DIFFERENT remedy — collapsing them would
// tell a reader to re-baseline into the same non-determinism that just bit them. Derived from the
// reason value rather than duplicated per call site, so a new reason cannot fall through to a
// message about something else.
const REFUSAL_HEADLINE = {
  [REFUSAL.CARRIER_MIDRUN]: 'REFUSED: the carrier moved DURING the corpus run, so no output can be attributed.',
  [REFUSAL.CARRIER_DRIFT]: 'REFUSED: the carrier moved, so this comparison cannot attribute anything to the code.',
  [REFUSAL.CORPUS_MEMBERSHIP]: 'REFUSED: the corpus is a different population, so an identical count proves nothing.',
  [REFUSAL.DUPLICATE_KEYS]: 'REFUSED: duplicate corpus keys — one entry cannot stand in for another.',
  [REFUSAL.ROUTES_UNREACHED]: 'REFUSED: declared routes did not each execute exactly once, so a clean result does not cover them.',
  [REFUSAL.ALL_THREW]: 'REFUSED: every corpus entry threw — this baseline can certify nothing.',
};

const REFUSAL_REMEDY = {
  [REFUSAL.CARRIER_MIDRUN]: '  Nothing here is evidence about the code. Re-run on a settled graph.',
  [REFUSAL.CARRIER_DRIFT]: '  Re-baseline on the current graph, then slice.',
};

/**
 * Write the baseline, or refuse and make sure nothing usable is left behind.
 *
 * ⛔ EXPORTED BECAUSE THESE ARE THE SIDE EFFECTS THAT MATTER AND THEY WERE ONLY EVER INFERRED.
 * The artifact used to be written BEFORE validation, so a refused baseline stayed on disk and a
 * later verify could consume it. A test that cannot execute the write and the removal is trusting
 * the ordering it just read.
 *
 * @returns {boolean} true if a baseline was published
 */
export function publishBaseline({ decision, artifactPath, carrier: carrierSample, results, onMessage = () => {} }) {
  if (decision.verdict !== VERDICT.PASS) {
    // ⛔ THE STALE ARTIFACT GOES. Leaving the PREVIOUS baseline after a refused attempt is worse
    // than leaving nothing: the next verify would silently compare against a population nobody
    // chose, with no indication that the attempt to replace it had failed.
    if (existsSync(artifactPath)) {
      unlinkSync(artifactPath);
      onMessage('  the previous baseline was REMOVED — a refused attempt must not leave a usable '
        + 'artifact behind. Re-baseline once the corpus is sound.');
    }
    return false;
  }
  // Temp + atomic rename, so a crash mid-write cannot leave a truncated artifact that still parses.
  const tmp = `${artifactPath}.tmp`;
  writeFileSync(tmp, JSON.stringify({ carrier: carrierSample, corpusSize: results.length, results }, null, 2));
  renameSync(tmp, artifactPath);
  return true;
}

export function printRefusal(decision) {
  // A reason with no headline must not print an empty line and exit; say so loudly instead.
  console.error(REFUSAL_HEADLINE[decision.reason]
    ?? `REFUSED: unmapped reason "${decision.reason}" — the guard cannot explain itself, which is itself a defect.`);
  for (const d of decision.detail) console.error(`  ${d}`);
  if (REFUSAL_REMEDY[decision.reason]) console.error(REFUSAL_REMEDY[decision.reason]);
}

async function main() {
  const mode = process.argv.includes('--verify') ? 'verify'
    : process.argv.includes('--baseline') ? 'baseline' : null;
  if (!mode) {
    console.error('usage: node scripts/refactor-guard.mjs --baseline | --verify');
    process.exit(2);
  }

  // ⛔⛔ THE CARRIER IS READ BEFORE **AND AFTER** THE CORPUS RUNS, AND BOTH MUST AGREE.
  //
  // Observed 2026-08-21 on a BYTE-IDENTICAL working tree (`git status --porcelain` empty,
  // packet.js verified identical by `diff -q`): this script reported **"BEHAVIOUR CHANGED on 7 of
  // 61 corpus entries"** and did NOT refuse. No code had changed at all.
  //
  // Cause: the old order was `carrier()` then `await runCorpus()`. The carrier was sampled once,
  // BEFORE 61 route executions that take real time. `APG_AUTO_REINDEX` self-heals the graph on MCP
  // dispatch, so a reindex can land DURING the corpus run — the outputs then come from the new
  // graph while the recorded carrier still matches the baseline. The refusal cannot fire, and the
  // difference is attributed to the code.
  //
  // ⇒ **A false FAIL is worse than the refusal it replaced.** A refusal says "cannot attribute";
  // this said "your code changed behaviour" about code that did not exist yet in any changed form.
  // It is the failure mode this whole script exists to prevent, inside the script itself.
  //
  // ⇒ THE FIX IS THE REVIEW-LEASE PROTOCOL APPLIED TO AN INSTRUMENT. the reviewer binds a
  // receipt by recording HEAD and status before a run, re-reading both after, and binding only if
  // the identity matched at BOTH ends. A single sample cannot detect movement during the window it
  // is supposed to certify — the second read is what makes the first one evidence.
  const before = carrier();
  const results = await runCorpus();
  const after = carrier();

  const now = before;
  const routeIds = ROUTES.map((r) => r.id);

  if (mode === 'baseline') {
    // ⛔⛔ THE ARTIFACT USED TO BE WRITTEN BEFORE THESE CHECKS RAN. `writeFileSync` came first, then
    // the route-coverage and all-threw refusals. A REFUSED baseline therefore stayed on disk and
    // could be consumed by a later verify — the refusal printed, and the bad artifact survived to
    // certify something. the reviewer: a refused baseline must never masquerade as an attempt.
    const decision = baselineVerdict({ before, after, results, routeIds });
    const published = publishBaseline({
      decision, artifactPath: ARTIFACT, carrier: now, results, onMessage: (m) => console.error(m),
    });
    if (!published) {
      printRefusal(decision);
      process.exit(1);
    }

    const threw = results.filter((r) => r.outcome === 'threw').length;
    console.log(`baseline written: ${results.length} entries (${threw} threw), `
      + `routes executed ${routeIds.length}/${routeIds.length} by identity, `
      + `graph ${now.graphSha256?.slice(0, 12)}`);
    return;
  }

  if (!existsSync(ARTIFACT)) {
    console.error('REFUSED: no baseline. Run --baseline before the slice, not after.');
    process.exit(1);
  }
  const base = JSON.parse(readFileSync(ARTIFACT, 'utf8'));

  // ⛔ EVERY REFUSAL IS EVALUATED BEFORE ANY OUTPUT IS COMPARED, and the decision lives in
  // lib/guard-verdict.mjs so a test can execute it. This function now only PRINTS the verdict.
  //
  // ⚠ `workingTreeDirty` is recorded but deliberately NOT a refusal condition: it changes on
  // every edit of the work being guarded, and its only leak into output is the excluded line.
  const decision = guardVerdict({ baseline: base, before, after, results, routeIds });

  if (decision.verdict === VERDICT.REFUSE) {
    printRefusal(decision);
    process.exit(1);
  }

  if (decision.verdict === VERDICT.FAIL) {
    console.error(`BEHAVIOUR CHANGED on ${decision.detail.length} of ${results.length} corpus entries:`);
    for (const c of decision.detail) console.error(`  ${c}`);
    process.exit(1);
  }

  const threw = results.filter((r) => r.outcome === 'threw').length;
  console.log(`unchanged: ${results.length} of ${results.length} corpus entries identical · `
    + `routes executed ${ROUTES.length}/${ROUTES.length} · ${threw} throw in both, which is itself pinned`);
}

// ⛔ MAIN RUNS ONLY WHEN THIS FILE IS THE ENTRY POINT. It used to run at import, so importing
// the module from a test executed the whole 61-entry corpus and then exited the process — which
// is precisely why the decision it contained went untested and shipped a false accusation.
// Same defect `authority-ledger.mjs` already fixed; taken here on the reviewer's ruling.
const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => { console.error('guard failed:', err); process.exit(2); });
}
