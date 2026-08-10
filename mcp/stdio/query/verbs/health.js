// graph_health — single trustable answer to "is the graph usable right now?"
//
// Echoes PM feedback 2026-04-21: "To answer 'is the graph usable right now?'
// an agent has to call graph_index, read brief.plan.md, parse the TRUST line,
// cross-reference. All three can disagree." This verb aggregates those signals
// into one response so a session can check health in a single call.
//
// Synthesis-only. No new data — just a coherent view of what graph_status +
// the overlay validator + the brief's trust logic already expose.

import { join, dirname } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { openExistingDb } from '../../storage/db.js';
import { loadManifest } from '../../freshness/manifest.js';
import { getDirtyFileEntries } from '../../freshness/git.js';
import { serverBuildInfo } from '../../server-build.js';
import { readArtifactIndexedAt } from '../../freshness/unresolved-categorization.js';
import { getHeadCommit } from '../../freshness/git.js';
import { getUnresolvedCounts, explainTrustExclusions } from '../../freshness/unresolved-metrics.js';
import { loadFunctionality, validateAnchors, hasOverlay } from '../../overlay/loader.js';
import { loadTasksArtifact, lintTaskSchema, summarizeDirtySeams, summarizeOverlayQuality } from '../../overlay/quality.js';
import { getLatestCollection } from '../../code-intel/query.js';
import { prepareCompileDb } from '../../code-intel/compile-db.js';
import { resolveClangCl } from '../../code-intel/resolve-clangd.js';
import { refreshMechanismVerdict } from '../../freshness/refresh-verdict.js';

// Cap for file lists in the health response. The counts stay exact; only the
// sample is bounded. See the dirtyFiles comment below for why this exists.
const DIRTY_LIST_CAP = 25;

// Single source of truth for trust-level thresholds. graph_health and the
// brief's trust() both consume this so they can't drift. Echoes bench
// 2026-04-21 showed them disagreeing (brief said "strong" while health said
// "weak (5421 unresolved)" on the same state) — fixed by centralizing.
export const UNRESOLVED_WEAK = 2000;
export const UNRESOLVED_OK = 500;
export function computeTrustLevel(unresolvedEdges) {
  if (unresolvedEdges > UNRESOLVED_WEAK) return 'weak';
  if (unresolvedEdges > UNRESOLVED_OK) return 'ok';
  return 'strong';
}

// (Removed) a PATH-only `hasOnPath` probe lived here for one hour. It answered
// "is clang-cl on PATH", which is NOT the question — see resolveClangCl in
// code-intel/resolve-clangd.js, which probes the configured toolchain directory
// and the standard install location first, exactly as we already resolve clangd.

// Which BUILD of the server is answering — not which commit of the target repo
// is indexed. An MCP server process is long-lived and does not hot-reload, so
// "pushed" and "in effect for this agent" are different states.
//
// Build identity moved to ../../server-build.js so EVERY surface can carry the
// stale-process warning, not only this diagnostic verb. A reader who never calls
// graph_health would otherwise never learn that the answers they are acting on
// came from code that is no longer on disk.
const serverBuild = serverBuildInfo;

// Ranked next steps, derived from measured state. Ordered by what actually blocks a
// user: fix the trust problem before offering an orientation shortcut, because a
// shortcut over an untrustworthy graph is worse than no shortcut. Capped at 3 — a
// list of ten suggestions is a list nobody reads, and the cost of being ignored is
// paid by the good suggestions too.
export function buildNextActions(s) {
  const out = [];

  // Trust first. These change whether ANY answer can be believed.
  if (s.codeIntel?.compileDbDrifted) {
    out.push({
      why: 'the code-intel collection was taken against a different compile DB than the one on disk now',
      do: 'graph_collect_code_intel({ scope: "all" })',
    });
  } else if (s.codeIntel?.available && s.codeIntel.lspVerifiedEdges === 0) {
    out.push({
      why: 'no [lsp✓] edges — graph-backed caller answers here are heuristic and cannot attest exhaustiveness',
      do: 'graph_collect_code_intel({ scope: "all" }) to build the trust spine (live verbs are unaffected)',
    });
  } else if (!s.codeIntel?.available) {
    out.push({
      why: 'no code-intel collection on this repo — caller/deletion answers will be heuristic only',
      do: 'graph_collect_code_intel({ scope: "all" }), or use code_intel_references for one bounded symbol',
    });
  }

  if (s.stale) {
    out.push({
      why: 'the graph snapshot is behind HEAD, so a "not found" may just be "not indexed yet"',
      do: 'graph_index(), or pass fresh:true on the next read that will justify an action',
    });
  }

  // ★ DELETED: a "this repo has N mapped features → try graph_packet" rule.
  //
  // It fired on every repo with an overlay, which is the definition of generic, and
  // a field reviewer took it apart precisely (ef-manager, 2026-07-31):
  //   1. "this repo has features" is INVENTORY, not a finding;
  //   2. its why and do CONTRADICTED — the why said the overlay is 96 days old and
  //      should not be trusted, the do said go and use it;
  //   3. it broke the contract stated three lines above it. I specified "EMPTY on a
  //      healthy repo, never generic", then shipped a rule that fires on a healthy
  //      repo — and cited it firing as VERIFICATION that the feature worked.
  //
  // His conclusion is the one that matters and it is a product argument, not a
  // cleanup: an EMPTY nextActions on a healthy repo is a stronger statement than a
  // populated one, because it is what makes a populated one mean something. A field
  // that always has something in it gets skimmed by the third session — which is
  // exactly the outcome the routing exists to avoid.
  //
  // A STALE overlay is still worth surfacing, because that is measured state rather
  // than inventory — but as a regenerate action, which is what the measurement
  // actually implies.
  const overlayAge = s.artifactAges?.functionality;
  if (out.length < 3 && s.overlayQuality?.featureCount > 0 && overlayAge != null && overlayAge > 14) {
    out.push({
      why: `the feature overlay is ${overlayAge}d old, so feature/task claims describe a previous state of the repo`,
      do: 'regenerate it (/graph-build-functionality), or treat feature anchors as unverified until you do',
    });
  }

  if (out.length < 3 && s.briefStaleVsManifest) {
    out.push({
      why: 'briefs are older than the graph, so they describe a previous state of the code',
      do: 'regenerate with scripts/graph-brief.mjs (briefs now carry their own GENERATED date)',
    });
  }

  return out.slice(0, 3);
}

export async function graphHealth({ repoRoot }) {
  const graphDir = join(repoRoot, '.aify-graph');
  const dbPath = join(graphDir, 'graph.sqlite');
  const indexed = existsSync(dbPath);

  if (!indexed) {
    return {
      indexed: false,
      trust: 'missing',
      summary: 'No graph at .aify-graph/graph.sqlite. Run graph_index() or /graph-build-all.',
    };
  }

  const { manifest } = await loadManifest(graphDir);
  const manifestStatus = manifest?.status ?? 'ok';
  const head = await getHeadCommit(repoRoot).catch(() => null);
  // health is the diagnostic verb, so it keeps BOTH numbers and labels them.
  // `dirtyFiles` (tracked + untracked) still feeds dirty-seam analysis — a new
  // untracked source file is a genuine seam signal — but the count reported in
  // the verdict line distinguishes the trust-relevant tracked number from
  // untracked noise. Unlabelled, a large untracked count reads as snapshot drift
  // (field report: 592 untracked, 0 tracked modifications).
  const dirtyEntries = await getDirtyFileEntries(repoRoot).catch(() => []);
  const dirtyFiles = dirtyEntries.map((e) => e.path);
  const trackedDirtyFiles = dirtyEntries.filter((e) => !e.untracked).map((e) => e.path);
  const untrackedDirtyCount = dirtyFiles.length - trackedDirtyFiles.length;
  const stale = Boolean(manifest?.commit && head && manifest.commit !== head);
  const { total: unresolvedEdges, trust: trustUnresolvedEdges } = getUnresolvedCounts(manifest);

  // Live counts agree with graph_status + graph_report
  let nodes = manifest?.nodes ?? 0;
  let edges = manifest?.edges ?? 0;
  try {
    const db = openExistingDb(dbPath);
    try {
      nodes = db.get('SELECT count(*) AS c FROM nodes').c;
      edges = db.get('SELECT count(*) AS c FROM edges').c;
    } finally {
      db.close();
    }
  } catch {
    // fall through with manifest values
  }

  // Overlay health
  const functionality = hasOverlay(repoRoot) ? loadFunctionality(repoRoot) : { features: [] };
  const tasksArtifact = loadTasksArtifact(repoRoot);
  const overlayQuality = summarizeOverlayQuality(functionality.features ?? [], tasksArtifact.tasks ?? []);
  // A task whose feature link was DROPPED (misspelled or wrong-shaped key) counts
  // as unlinked everywhere downstream, which is indistinguishable from a
  // genuinely unlinked backlog. Naming it is the difference between a one-line
  // fix and an unexplained "0 linked" the user cannot act on.
  const taskSchemaLint = lintTaskSchema(tasksArtifact.tasks ?? []);
  const dirtySeams = summarizeDirtySeams(functionality.features ?? [], dirtyFiles);
  let overlay = { present: false, checked: 0, broken: 0, sample: [] };
  if (functionality.features.length > 0 || hasOverlay(repoRoot)) {
    try {
      const db = openExistingDb(dbPath);
      try {
        const { features } = functionality;
        const { valid, broken } = validateAnchors(features ?? [], db, { repoRoot });
        const lint = Array.isArray(functionality.lint) ? functionality.lint : [];
        overlay = {
          present: true,
          checked: valid.length + broken.length,
          broken: broken.length,
          sample: broken.slice(0, 3).map((b) => ({ id: b.feature.id, resolved: b.totalResolved, declared: b.totalDeclared })),
          // Legacy/invalid overlay-shape warnings (legacy `paths`, missing
          // anchors, non-kebab ids) — so a silent 0/0 reads as "migrate this".
          ...(lint.length ? { lint, lintCount: lint.length } : {}),
        };
      } finally {
        db.close();
      }
    } catch {
      overlay = { present: true, checked: 0, broken: 0, error: 'validator threw' };
    }
  }

  // Code-intel availability + freshness, surfaced separately from graph
  // freshness so agents can see "graph fresh, code-intel stale" or vice
  // versa. Plan #3.
  let codeIntel = { available: false, reason: 'no_collection' };
  try {
    const db = openExistingDb(dbPath);
    try {
      const latest = getLatestCollection(db);
      if (latest) {
        codeIntel = {
          available: true,
          provider: latest.provider,
          providerVersion: latest.providerVersion,
          status: latest.status,
          language: latest.language,
          freshnessBasis: latest.freshnessBasis,
          freshnessValue: latest.freshnessValue,
          // HISTORICAL: the hash of the compile DB this COLLECTION was taken
          // against. Sits next to compileDbFirstPartyCount, which is measured from
          // the CURRENT probe — two adjacent fields with different provenance read
          // as a contradiction when a DB is swapped (field: same hash, changed
          // first-party count). currentCompileDbHash is always emitted alongside so
          // the pair is self-explaining rather than requiring the drift verdict.
          compileDbHash: latest.compileDbHash,
          indexedCommit: latest.indexedCommit,
          collectedAt: latest.collectedAt,
          operations: latest.operations,
          // The coverage figure below is a FLOOR, not a rate. These say how much
          // was never asked, so a reader does not mistake declined work for absent
          // callers. Reported as a pair with the percentage, never as a footnote.
          positionGuessSkipped: latest.positionGuessSkipped,
          refsTruncatedSymbols: latest.refsTruncatedSymbols,
          // ★ THESE WERE NEVER PROJECTED, which is why the contradiction check in
          // ccfe69c misfired on every populated collect: it tested fields that do
          // not exist on this object and read undefined as "session missing".
          // Instance twelve again — a legitimate absence (a field simply not
          // carried) read as evidence of a state. The reader in code-intel/query.js
          // had them all along.
          refsNotFoundByKind: latest.refsNotFoundByKind,
          refsFound: latest.refsFound,
          refsNotFound: latest.refsNotFound,
          refsDegraded: latest.refsDegraded,
          refsCleanNotFound: latest.refsCleanNotFound,
        };
      }
    } finally { db.close(); }
  } catch { /* leave codeIntel as not-available */ }

  const trust = computeTrustLevel(trustUnresolvedEdges);

  // Brief-vs-live staleness check. Echoes 2026-04-22 bench saw
  // brief.plan.md say "TRUST weak: 5424 unresolved" while graph_health
  // said "trust=strong (500 unresolved)" at the same moment. Same
  // thresholds, different inputs — brief was cached with an older
  // manifest snapshot. Fix: compare brief's recorded graph_indexed_at
  // against the current manifest.indexedAt; warn when they diverge so
  // consumers know the brief needs regen.
  let briefStaleVsManifest = false;
  try {
    const briefJsonPath = join(graphDir, 'brief.json');
    if (existsSync(briefJsonPath)) {
      const briefJson = JSON.parse(readFileSync(briefJsonPath, 'utf8'));
      const briefIndexedAt = briefJson.graph_indexed_at;
      if (briefIndexedAt && manifest?.indexedAt && briefIndexedAt !== manifest.indexedAt) {
        briefStaleVsManifest = true;
      }
    }
  } catch {
    // brief.json missing or malformed — skip the check
  }
  const unresolvedCategorizationStaleVsManifest = (() => {
    const categorizationIndexedAt = readArtifactIndexedAt(join(graphDir, 'unresolved-categorization.json'));
    return Boolean(categorizationIndexedAt && manifest?.indexedAt && categorizationIndexedAt !== manifest.indexedAt);
  })();

  // Plain-prose summary — one line per axis — so agents don't need to
  // interpret several numeric fields. Each axis states a decision, not a
  // measurement.
  const verdicts = [];
  // FIRST, above everything. If the running process is older than the checkout,
  // every other verdict below describes the OLD build — and a reader comparing
  // behaviour against a newly-landed fix will attribute the wrong result to it.
  const _build = serverBuild();
  // ★ A POINTER, NOT THE TEXT. Measured by ef-manager on e8c8d61: the full warning
  // is 265 tokens and was being emitted TWICE — here at the head of `summary`, and
  // again as `server.staleWarning` — making `server` the single largest field in the
  // response at 26.8%.
  //
  // This is the nextActions-duplicated-into-summary defect reported and fixed this
  // MORNING, recurring the same day in the stale-process feature shipped since. Same
  // shape, same field. Fixing an instance does not fix the pattern, and the pattern
  // here is: a summary that INLINES a field rather than naming it pays for that field
  // twice, and the second copy is pure cost because both land in the same response.
  //
  // ⚠ The warning itself must NOT be externalised into a skill — unlike invariant
  // prose it is VALUE-BEARING, embedding the loaded commit, the process start time and
  // the checkout commit. It must be printed once, not made cheaper.
  //
  // The saving lands exactly when it is worth most: on every response from a stale
  // process, which is when an agent is most likely to be making extra calls.
  if (_build.staleProcess) verdicts.push('⛔ STALE PROCESS — see server.staleWarning');
  verdicts.push(`nodes=${nodes} edges=${edges}`);

  // Proactive foreign-toolchain warning (Sand Castle live finding 1). On win32 a
  // Linux/WSL-built compile DB makes clangd silently TRUNCATE caller sets — even
  // same-file references — so code_intel_references can't be trusted as a
  // completeness oracle here. Surface it in health BEFORE a query returns a
  // partial set, not only in the degraded result after. Cheap + side-effect-free
  // in practice: prepareCompileDb is cached once a collect has run, and the check
  // is win32-gated (on Linux a Linux DB is native, not "foreign").
  // Two ways a compile DB can exist and still not support a completeness claim.
  // Both read the SAME prepared DB, so probe once.
  //   - FOREIGN (win32 only): a Linux/WSL-built DB against host clangd — TUs fail
  //     to compile, so caller sets truncate even for same-file references.
  //   - ZERO FIRST-PARTY (any platform): the DB is native and non-unity but holds
  //     only third-party/_deps entries, so clangd has no compile command for the
  //     project's own code. Measured on sand_castle: 441 entries, 0 first-party,
  //     which silently produced 3-of-8 caller sets while we reported exhaustive.
  //     A dependencies-only export is not a Windows quirk, hence not win32-gated.
  if (codeIntel.available) {
    try {
      const cdb = prepareCompileDb({ projectRoot: repoRoot });
      if (cdb?.found) {
        codeIntel.compileDbFirstPartyCount = Number(cdb.firstPartyCount ?? 0);
        if (process.platform === 'win32' && cdb.foreignToolchain) {
          codeIntel.compileDbForeign = true;
          codeIntel.callerCompletenessTrustworthy = false;
          // A PRESCRIBED FIX THAT CANNOT RUN IS AN UNVERIFIED CAUSE, WEARING A
          // DIFFERENT HAT. This banner recommended a Ninja+clang-cl recipe
          // unconditionally; a field tester checked and found clang-cl absent from
          // the host, so the only remedy we named was impossible for them
          // (ef-manager, echoes, 2026-07-30). Same defect family the zero-result
          // work removed — we told someone to do something without checking they
          // could — just on the ACTION side rather than the diagnosis side.
          //
          // So the recipe is now offered only when its toolchain exists, and the
          // WSL fallback is promoted to primary when it does not.
          // THE RECIPE MUST BE RUNNABLE AS WRITTEN, not merely correct in outline.
          //
          // The earlier one-liner (`-DCMAKE_CXX_COMPILER=clang-cl` alone) FAILS on a
          // standard Windows host, for two reasons a field tester hit in sequence
          // (ef-manager, echoes, 2026-07-30):
          //   - CMake's compiler test LINKS, and the link invokes `rc` (Windows
          //     Resource Compiler), which ships with the Windows SDK and is not on
          //     PATH outside a vcvars shell. clang-cl COMPILED fine; the configure
          //     still aborted and declared the compiler broken.
          //   - Only CXX was overridden, so a C+CXX project then failed with
          //     "No CMAKE_C_COMPILER could be found" on its C dependencies.
          //
          // ★ The general trap, worth stating because it will recur: a project can be
          // perfectly capable of EMITTING a compile database and still be blocked by
          // a LINK-only dependency, because CMake will not reach the emit step until
          // its compiler test links. A compile DB needs compile lines, not a binary.
          //
          // Both are answered from the LLVM install we just resolved — llvm-rc and
          // clang-cl are siblings — so the recipe stays self-consistent and needs no
          // vcvars wrapper.
          // ★ A FOREIGN DB ON WINDOWS IS OFTEN NOT MISCONFIGURATION.
          //
          // This banner said "FIX: generate a native Windows compile DB", which
          // reads as "you set this up wrong and a flag corrects it". For a large
          // class of Windows CMake projects that is false, and the field found out
          // the hard way (ef-manager, echoes, 2026-07-30):
          //
          //   CMAKE_EXPORT_COMPILE_COMMANDS is supported ONLY by the Makefile and
          //   Ninja generators. A project whose Windows build uses the Visual Studio
          //   generator CANNOT emit compile_commands.json at all.
          //
          // Echoes builds fine on Windows — VS 2022 generator, shipped .exe on disk
          // — and has NO compile_commands.json in that build tree, while its WSL
          // build (Ninja) produces one. The Linux DB is not sloppiness; it is the
          // only DB the project is capable of producing. Getting a native one means
          // standing up a SECOND, Ninja-based configure alongside the real build,
          // which then needs the dev-shell environment (LIB/INCLUDE) that the VS
          // generator supplies internally.
          //
          // So: state the cause, keep the recipe, but stop implying a one-flag fix
          // and name what it actually costs. Mislabelling a normal state as user
          // error is the same failure as naming an unverified cause — it sends
          // someone to fix something that is not broken.
          const clangCl = resolveClangCl();
          codeIntel.clangClAvailable = Boolean(clangCl);
          let remedy;
          if (clangCl) {
            const binDir = dirname(clangCl.command).replace(/\\/g, '/');
            // ★ ONE MISSING ENVIRONMENT, SURFACING REPEATEDLY AT INCREASING DEPTH.
            //
            // Field-walked end to end (ef-manager, echoes, 2026-07-30). A Ninja
            // configure outside a developer shell failed three times, each deeper
            // than the last, on three Windows SDK components that were all INSTALLED
            // and all off-PATH: rc.exe, then the import libraries (LIB unset), then
            // fxc.exe fifteen dependencies in.
            //
            // Those are not three problems. The Visual Studio generator supplies the
            // whole SDK environment internally, which is why the real build works and
            // why nobody notices these are off-PATH. A Ninja configure inherits none
            // of it and must be handed each piece by hand — so per-tool flags fix one
            // symptom at a time and the next one appears later and costs more.
            //
            // Hence the dev shell is recommended FIRST rather than as a fallback: it
            // supplies everything at once, which is the actual shape of the problem.
            // The per-tool overrides remain for hosts without VS installed.
            remedy = 'WHY: if this project\'s Windows build uses the Visual Studio generator it CANNOT emit compile_commands.json '
              + '(only the Makefile/Ninja generators support CMAKE_EXPORT_COMPILE_COMMANDS), so a Linux/WSL DB may be the only one that exists — '
              + 'this is usually not a misconfiguration. '
              + 'FIX (a SECOND configure alongside your real build, not a replacement) — run it from a Developer Command Prompt / vcvars64 shell, '
              + 'because a Ninja configure outside one inherits none of the Windows SDK environment the VS generator supplies internally '
              + '(rc.exe, the import libs via LIB, fxc.exe are typically installed but off-PATH, and they surface one at a time at increasing depth): '
              + `cmake -B build-win-clangd -G Ninja -DCMAKE_C_COMPILER="${binDir}/clang-cl.exe" `
              + `-DCMAKE_CXX_COMPILER="${binDir}/clang-cl.exe" -DCMAKE_RC_COMPILER="${binDir}/llvm-rc.exe" `
              + '-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY -DCMAKE_EXPORT_COMPILE_COMMANDS=ON '
              + '(TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY skips the compiler test\'s link, which a compile DB never needed. APG auto-discovers the result; keep your existing build dir). '
              + 'NOTE: on projects that FetchContent their dependencies this configure performs NETWORK DOWNLOADS and is not a side-effect-free local operation. '
              + 'CHEAPER ALTERNATIVE: APG_CLANGD_WSL=1 drives clangd under WSL against the DB you already have — no second build, no downloads, no dev shell.';
          } else {
            remedy = 'FIX: no clang-cl found in the configured toolchain dir, the standard LLVM install location, or PATH — '
              + 'set APG_CLANGD_WSL=1 to drive clangd inside WSL against this Linux DB (no rebuild needed), '
              + 'or install LLVM (winget install LLVM.LLVM) and re-check.';
          }
          // Deliberately NOT the word "truncated": `refsTruncatedSymbols` is OUR
          // per-symbol reference cap, and a reader seeing both in one response
          // reasonably assumed they were the same thing (ef-manager, 2026-07-30).
          // Two mechanisms, two words.
          verdicts.push('⚠ compile-db FOREIGN (Linux/WSL) on a Windows host — clangd silently DROPS cross-TU callers (and even same-file refs); code_intel_references is NOT a completeness oracle here. '
            + remedy + ' Do NOT trust "no callers / safe to delete" until fixed.');
        }
        // COLLECTION vs CURRENT COMPILE DB. We detect commit drift but never
        // checked whether the compile DB itself moved since the collection was
        // taken — so a collection could describe a toolchain state that no longer
        // exists and nothing said so. Surfaced by a tester noticing the cached DB
        // was dated NEWER than the collection that supposedly produced it
        // (2026-06-02 vs 2026-05-31). freshnessBasis is literally
        // 'compile_db_hash'; not comparing it was an unchecked freshness claim.
        codeIntel.currentCompileDbHash = cdb.dbHash ?? null;
        if (cdb.dbHash && codeIntel.compileDbHash && cdb.dbHash !== codeIntel.compileDbHash) {
          codeIntel.compileDbDrifted = true;
          codeIntel.currentCompileDbHash = cdb.dbHash;
          codeIntel.callerCompletenessTrustworthy = false;
          verdicts.push(`⚠ code-intel collection was taken against compile-db ${String(codeIntel.compileDbHash).slice(0, 8)} but the current DB hashes ${String(cdb.dbHash).slice(0, 8)}`
            + ' — the build configuration changed since collection, so its [lsp✓] edges describe a toolchain state that no longer exists. Re-run graph_collect_code_intel.');
        }
        if (codeIntel.compileDbFirstPartyCount === 0) {
          codeIntel.callerCompletenessTrustworthy = false;
          verdicts.push(`⚠ compile-db covers ZERO first-party sources (${cdb.entryCount ?? '?'} entries, all third-party/_deps) — clangd has no compile command for your own code and falls back to inferred commands, so caller sets are silently PARTIAL and code_intel_references is NOT a completeness oracle. FIX: export compile commands for YOUR targets, not just dependencies (-DCMAKE_EXPORT_COMPILE_COMMANDS=ON on a build that compiles them), then confirm your sources appear in compile_commands.json. Do NOT trust "no callers / safe to delete" until fixed.`);
        }
      }
    } catch { /* detection is best-effort — never block health on it */ }
  }
  verdicts.push(
    trustUnresolvedEdges === unresolvedEdges
      ? `trust=${trust} (${unresolvedEdges} unresolved)`
      : `trust=${trust} (${trustUnresolvedEdges} trust-relevant unresolved of ${unresolvedEdges} total — see trustBasis for the rule)`,
  );
  // ★ ATTACK TEN — publish the rule that takes the total to the trust-relevant
  // subset. `trust` is the most load-bearing word in the product; it gates whether
  // an agent believes anything else, and its denominator was invisible. Same
  // family as lspVerifiedPctOfCalls: a defensible filter nobody can see is still a
  // hidden population.
  //
  // ★ AND THE FIRST DRAFT OF THIS FIX COMMITTED ATTACK SEVEN, AGAIN.
  //
  // `manifest.dirtyEdges` is a 500-item SAMPLE; the true count is dirtyEdgeCount
  // (4853 here). Explaining the trust rule over the sample reported
  // "trust_relevant: 0 of 500" while the real answer is 402 of 4853 — a published
  // rule that was itself computed over a hidden subset, which is the exact defect
  // this field exists to close. Caught only by noticing the total disagreed with
  // the number three lines above it.
  //
  // The full set is written to dirty-edges.full.json. Read the real thing; fall
  // back to the sample only when it is absent, and SAY SO when that happens.
  const trustBasis = (() => {
    // ★ "NOTHING WAS EXCLUDED" AND "NOTHING COULD BE CLASSIFIED" ARE NOT THE SAME.
    //
    // This early return dropped trustBasis whenever no edge was excluded, on the
    // reasoning that there was nothing to explain. Two very different situations
    // reach it:
    //
    //   the classifier RAN and found nothing excludable   → nothing to say, fine
    //   the classifier COULD NOT RUN                      → the reader must know
    //
    // Measured 2026-08-10 on lc-api (PHP): trustBasis came back UNDEFINED against
    // 53,197 unresolved edges — MORE than its 50,527 total edges — and a `weak`
    // verdict. Cause: its unresolved-categorization.json is on an April schema
    // missing graph_commit/graph_indexed_at/source/writtenAt, so nothing could be
    // classified, so nothing was excluded, so the whole explanation vanished. The
    // reader was left with a raw five-figure count and a bad verdict caused by a
    // stale artifact rather than by the code.
    //
    // Compare the other three repos, same build, same day: 1.4% / 3.8% / 14.6%
    // trust-relevant. PHP's 105% is not a graph that is 70x worse — it is the
    // exclusion pass silently not happening.
    //
    // This is the defect this project exists to remove, sitting inside the metric
    // used to decide whether to trust everything else. So the no-exclusions case
    // now STATES which of the two it is.
    if (trustUnresolvedEdges === unresolvedEdges) {
      const catPath = join(graphDir, 'unresolved-categorization.json');
      let classifierRan = false;
      let staleSchema = false;
      if (existsSync(catPath)) {
        try {
          const cat = JSON.parse(readFileSync(catPath, 'utf8'));
          // These keys were added when the artifact gained provenance. Their
          // absence means the file predates it and cannot be trusted to describe
          // the current graph — the same reason a stale collection cannot attest
          // exhaustiveness.
          staleSchema = !cat?.graph_commit || !cat?.source;
          classifierRan = !staleSchema;
        } catch { staleSchema = true; }
      }
      if (classifierRan) return null; // ran, excluded nothing — genuinely nothing to say
      return {
        total_unresolved: unresolvedEdges,
        trust_relevant: trustUnresolvedEdges,
        excluded: null,
        classification: existsSync(catPath) ? 'STALE_ARTIFACT' : 'NOT_RUN',
        consequence:
          `NONE of the ${unresolvedEdges} unresolved edges could be classified, so ALL of them count as `
          + 'trust-relevant and the trust verdict above is a FLOOR, not a measurement. This is a fact about '
          + `the ${existsSync(catPath) ? 'categorization artifact being too old to trust' : 'categorization never having run'}`
          + ', NOT about the code. Do not compare this ratio against a repo where classification succeeded.',
        remedy: 'run graph_index() to regenerate .aify-graph/unresolved-categorization.json, then re-read this field.',
      };
    }
    const fullPath = join(graphDir, 'dirty-edges.full.json');
    if (existsSync(fullPath)) {
      try {
        const raw = JSON.parse(readFileSync(fullPath, 'utf8'));
        const edges = Array.isArray(raw) ? raw : (raw?.dirtyEdges ?? raw?.edges ?? []);
        if (edges.length > 0) return explainTrustExclusions(edges);
      } catch { /* fall through to the sample, labelled */ }
    }
    const sample = manifest?.dirtyEdges ?? [];
    const basis = explainTrustExclusions(sample);
    if (!basis) return null;
    return {
      ...basis,
      computed_over: 'SAMPLE',
      sample_size: sample.length,
      true_total: unresolvedEdges,
      sample_warning:
        `dirty-edges.full.json is missing, so this breakdown was computed over a ${sample.length}-edge SAMPLE `
        + `of ${unresolvedEdges} — the proportions may not hold and the counts definitely do not. `
        + 'Re-run graph_index to regenerate the full set.',
    };
  })();
  if (manifestStatus !== 'ok') verdicts.push(`rebuild-incomplete: status=${manifestStatus} (run graph_index(force=true))`);
  if (stale) verdicts.push(`stale: indexed ${manifest.commit.slice(0,7)}, HEAD ${head.slice(0,7)}`);
  else verdicts.push('fresh');

  // A stale snapshot is a fact; a dead refresh mechanism is WHY it will stay
  // stale. Report the second next to the first — the first is what a reader
  // notices, the second is the only one they can act on.
  const refreshMechanism = refreshMechanismVerdict(repoRoot);
  if (refreshMechanism.state === 'degraded') {
    verdicts.push(`⛔ refresh mechanism DEGRADED: ${refreshMechanism.consequence}`);
  } else if (refreshMechanism.state === 'unconfigured') {
    verdicts.push(`⚠ no auto-refresh: ${refreshMechanism.remedy}`);
  }

  // ★ THE NUMBER WITHOUT THE CONSEQUENCE IS HALF AN ANSWER.
  //
  // sc-manager, field-testing on a repo nobody tuned this against: "It told me the
  // fact (44 commits stale) but not the consequence. For orientation, 44 stale is
  // harmless. For 'is #96 linked to this file', 44 stale was fatal."
  //
  // He is right, and his own case shows why the split is not obvious: the task
  // overlay MISSED a card that the git layer FOUND, in the same call. Those two
  // layers do not age together — `last_touched` and activity run `git log` LIVE at
  // query time, while the task/feature overlay is a stored artifact. A single
  // "stale" flag cannot express that, so a reader either over-trusts everything or
  // discards everything.
  //
  // This states, per answer-class, whether being N commits behind actually matters.
  const stalenessImpact = stale ? (() => {
    // How far behind, in commits — the number sc-manager was given ("44 commits
    // stale") and could not act on without knowing what it invalidated.
    let behind = null;
    try {
      const out = execFileSync('git', ['rev-list', '--count', `${manifest.commit}..HEAD`], {
        cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
      }).trim();
      behind = Number(out) || null;
    } catch { /* unknown distance — the impact split below still holds */ }
    return {
      commits_behind: behind,
      unaffected: [
        'live code_intel_* verbs — they query the language server, not this snapshot',
        'last_touched / activity — these run `git log` at query time, not from the index',
      ],
      degraded: [
        'symbol lookups for code added since the indexed commit — a "not found" may mean "not indexed yet"',
        'callers/callees/impact over new or moved code',
        'file lists and per-file digests, which reflect the indexed tree',
      ],
      unaffected_by_staleness_but_check_separately: [
        'feature/task overlay fields — they age on their OWN clock (see artifactAges), not on commit distance',
      ],
      note:
        'Staleness is only fatal for questions ABOUT CODE THAT CHANGED. Orientation, architecture shape '
        + 'and "what connects to what" over untouched code are unaffected. If your question concerns recent '
        + 'work, run graph_index() first — an absence here is not evidence of absence.',
    };
  })() : null;

  // LH-3 (2026-07-26): `graph_index` refreshes the structural graph + briefs and
  // says NOTHING about the other derived artifacts, so "reindexed" reasonably
  // reads as "everything is current". Measured on sand_castle right after a
  // successful reindex: functionality.json 54 days old, tasks.json 85 days
  // (9 tasks, 0 linked), code-intel collection 5 weeks. Each has a DIFFERENT
  // refresh command, so name the artifact, its age, and the command.
  const artifactAges = {};
  const ageInDays = (iso) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86_400_000) : null;
  };
  // AGE IS NOT STALENESS for the curated overlays. `functionality.json` is
  // hand-maintained: a correct, stable one would emit a ⚠ forever, and a warning
  // that can never be resolved trains agents to ignore ⚠ lines on the one surface
  // where they must stay load-bearing. So ages are REPORTED structurally, and a
  // verdict fires only on a real, actionable signal — broken anchors (which
  // `overlay.broken` already measures) or, for tasks, links that resolve to
  // nothing. Drift after renames is the `graph-anchor-drift` skill's job.
  try {
    for (const [name, file] of [['functionality', 'functionality.json'], ['tasks', 'tasks.json']]) {
      const p = join(repoRoot, '.aify-graph', file);
      if (!existsSync(p)) continue;
      artifactAges[name] = Math.floor((Date.now() - statSync(p).mtimeMs) / 86_400_000);
    }
  } catch { /* best-effort */ }
  // The code-intel collection IS age-sensitive in a way the overlays are not: it
  // is a snapshot of a specific commit's index, and `graph_index` never refreshes
  // it. But the honest trigger is commit drift, not the calendar — a collection
  // whose indexedCommit still equals HEAD is current no matter how old it is.
  const collectedDays = ageInDays(codeIntel?.collectedAt);
  if (collectedDays != null) artifactAges.codeIntel = collectedDays;

  // A stored collection with ZERO materialized [lsp✓] edges is the silent
  // failure mode that makes this tool look useless: every caller query falls back
  // to the heuristic layer, so nothing can attest exhaustiveness, and nothing
  // says why. Measured on a real project: 0 of 17544 CALLS verified after a
  // reindex moved HEAD past the collection. One command fixes it.
  if (codeIntel?.available) {
    try {
      const db2 = openExistingDb(dbPath);
      try {
        const verified = db2.get("SELECT COUNT(*) AS c FROM edges WHERE provenance = 'LSP_VERIFIED'").c ?? 0;
        const calls = db2.get("SELECT COUNT(*) AS c FROM edges WHERE relation = 'CALLS'").c ?? 0;
        codeIntel.lspVerifiedEdges = verified;

        // ★ ATTACK EIGHT — THE DENOMINATOR WAS CONTAMINATED WITH EDGES THAT ARE
        //   UNVERIFIABLE IN PRINCIPLE.
        //
        // ef-manager, on the headline coverage number I had been quoting to him
        // since day one and that neither of us had ever opened up. The denominator
        // was every CALLS edge, unrestricted. This repo's graph contains GLSL and
        // Python: clangd cannot verify a single one of those edges — not because
        // the index is cold, but because they are not C++ and were never in
        // compile_commands.json.
        //
        // Measured here: 15530 CALLS = 12830 cpp + 1458 glsl + 1242 python. So
        // 17.4% of the denominator was unverifiable BY CONSTRUCTION, and the
        // number could never approach 100 however good collection got. Worse, its
        // MOVEMENT was uninterpretable: a rise could mean better verification, or
        // merely fewer shader edges after a refactor.
        //
        // And it broke the word `floor`, which is load-bearing here. A floor
        // implies the true value is above it and reachable. A ratio over a
        // contaminated denominator is not a floor of anything — it is a different
        // quantity wearing a coverage label.
        //
        // His generalization of tonight's other fix is exact: AN EDGE NOBODY COULD
        // HAVE VERIFIED IS NOT AN EDGE THAT FAILED VERIFICATION. Same shape as the
        // other five instances — a percentage stood in for coverage while the real
        // thing, the verifiable subset, was computable from data already in hand.
        // ★ ATTACK NINE — SCOPE AND VERIFIABILITY ARE ORTHOGONAL, AND THE
        //   LANGUAGE-ONLY MODEL CONFLATED THEM.
        //
        // ef-manager caught this in the attack-eight FIX, one commit old. Making
        // verifiability a language set means that when a Python backend lands,
        // every Python call edge reclassifies from `unverifiable` to `verifiable`
        // and enters the denominator as legitimate coverage debt — regardless of
        // whether those files are part of the project at all.
        //
        // The two classes he named are both real and were indistinguishable:
        //   (in-scope, unverifiable)  — GLSL under engine/voxel/shaders: real code
        //                               you cannot check yet. Belongs in the debt.
        //   (out-of-scope, verifiable) — vendored C++: you COULD check it and must
        //                               never count it.
        //
        // ★ AND THE SCOPE PREDICATE ITSELF MUST NOT BE A STAND-IN. A path-prefix
        // guess (engine/|game/|tests/) is exactly the failure this session named
        // six times: it would have silently excluded tools/ and the repo-root
        // scripts, which ARE first-party. The real signal is git tracking — a file
        // the project version-controls is a file the project owns — and it is one
        // command away. Vendored trees, build outputs and stale worktrees are all
        // untracked by construction, so this is a stronger predicate than any
        // prefix list AND it needs no maintenance.
        const trackedFiles = (() => {
          try {
            const out = execFileSync('git', ['ls-files'], {
              cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
              windowsHide: true, maxBuffer: 64 * 1024 * 1024,
            });
            const set = new Set(out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
            return set.size > 0 ? set : null;
          } catch { return null; } // unknown scope ≠ everything in scope
        })();

        const byLang = db2.all(
          `SELECT COALESCE(NULLIF(n.language, ''), '(unknown)') AS lang,
                  COALESCE(NULLIF(n.file_path, ''), '') AS fp,
                  COUNT(*) AS c
             FROM edges e JOIN nodes n ON n.id = e.from_id
            WHERE e.relation = 'CALLS' GROUP BY lang, fp`,
        ).reduce((acc, r) => {
          // Unknown tracking state is NOT in-scope — same fail-closed default as
          // truncation and worktree cleanliness. If git could not be read we say
          // scope is unknown rather than assuming everything counts.
          const inScope = trackedFiles == null ? null : trackedFiles.has(r.fp);
          const key = `${r.lang}\x00${inScope}`;
          acc.set(key, { lang: r.lang, inScope, c: (acc.get(key)?.c ?? 0) + r.c });
          return acc;
        }, new Map());
        const langScopeRows = [...byLang.values()];
        const outOfScope = langScopeRows.filter((r) => r.inScope === false);
        const inScopeRows = langScopeRows.filter((r) => r.inScope !== false);
        // Languages an LSP backend in this server can actually verify. Anything
        // else is unverifiable by construction, not unverified by omission.
        const LSP_VERIFIABLE_LANGUAGES = new Set(['cpp', 'c', 'cxx', 'cc', 'h', 'hpp']);
        // Verifiable AND in-scope. Out-of-scope edges never enter the denominator,
        // and — the point of attack nine — never MIGRATE into it when a backend
        // for their language lands.
        const verifiable = inScopeRows.filter((r) => LSP_VERIFIABLE_LANGUAGES.has(r.lang)).reduce((a, r) => a + r.c, 0);
        const unverifiable = inScopeRows.filter((r) => !LSP_VERIFIABLE_LANGUAGES.has(r.lang));

        // ★ SURFACE THE SPLIT. The honest headline is "833 not found, 833 degraded,
        // 0 clean" and until now the tool could not say it — the cause reached the
        // database and died one layer below the number people read.
        const degraded = codeIntel.refsDegraded;
        const cleanNotFound = codeIntel.refsCleanNotFound;
        if (degraded != null || cleanNotFound != null) {
          codeIntel.refsNotFoundBreakdown = {
            total: codeIntel.refsNotFound ?? null,
            degraded,
            clean: cleanNotFound,
            note: 'DEGRADED results (definition_only / no_index_entry) are NOT evidence of no callers — '
              + 'the index could not answer, which is a statement about the index, not about the code. '
              + 'Only `clean` counts as an observed absence. Never read `total` as "symbols with no callers".',
          };
          if (degraded > 0) {
            verdicts.push(`⚠ ${degraded} of ${codeIntel.refsNotFound} "not found" reference results are DEGRADED`
              + `${cleanNotFound === 0 ? ' and ZERO are clean absences' : `, only ${cleanNotFound} are clean absences`}`
              + ' — do not read the not-found count as dead code.');
          }
        }
        codeIntel.lspCallsTotal = calls;
        codeIntel.lspCallsVerifiable = verifiable;
        // ★ THE DENOMINATOR TRAVELS IN THE NAME, NOT IN AN ADJACENT FIELD.
        //
        // ef-manager, 2026-08-09, from having made the mistake himself: a caveat
        // stored beside a number protects the reader looking at the response, and
        // abandons the reader who COPIES THE NUMBER OUT. He read
        // refsNotFoundBreakdown.note — correct, well-worded — and days later still
        // wrote "833/833, recall effectively zero" into a published verdict,
        // because the 833 travelled and the note did not.
        //
        // lspVerifiedPctOfCalls was the same shape: `12` next to a separate
        // lspVerifiedPctDenominator field. Copied into a summary it reads as 12%
        // of ALL calls — false, and a far worse number than the truth.
        //
        // So the identifier carries it. Ugly on purpose: a name cannot be
        // separated from its value. The adjacent field stays for the reader who
        // is looking; the name protects the one who is not.
        //
        // The old key is retained as an alias — this ships mid-release and
        // breaking a field agents already read would be a worse trade than a
        // duplicated integer.
        const verifiedPct = verifiable > 0 ? Math.round((verified / verifiable) * 100) : 0;
        codeIntel.lspVerifiedPctOfVerifiableInScopeCalls = verifiedPct;
        codeIntel.lspVerifiedPctOfCalls = verifiedPct;
        codeIntel.lspVerifiedPctDenominator = trackedFiles == null
          ? 'verifiable_calls (SCOPE UNKNOWN — git ls-files unreadable, so out-of-scope edges could not be excluded)'
          : 'verifiable_and_in_scope_calls';
        if (outOfScope.length > 0) {
          const oosTotal = outOfScope.reduce((a, r) => a + r.c, 0);
          codeIntel.lspOutOfScopeCalls = {
            total: oosTotal,
            pct_of_all_calls: calls > 0 ? Math.round((oosTotal / calls) * 100) : 0,
            by_language: outOfScope.sort((a, b) => b.c - a.c).map((r) => ({ language: r.lang, edges: r.c })),
            basis: 'not tracked by git',
            note:
              'Untracked files — vendored dependencies, build output, stale worktrees. Excluded from BOTH '
              + 'numerator and denominator, and they will NOT migrate into the denominator when a backend for '
              + 'their language lands. Scope and verifiability are independent: an edge can be in-scope and '
              + 'unverifiable (real code, no backend yet) or out-of-scope and verifiable (vendored C++).',
          };
        }
        if (unverifiable.length > 0) {
          const unverifiableTotal = unverifiable.reduce((a, r) => a + r.c, 0);
          codeIntel.lspUnverifiableCalls = {
            total: unverifiableTotal,
            pct_of_all_calls: calls > 0 ? Math.round((unverifiableTotal / calls) * 100) : 0,
            by_reason: unverifiable
              .sort((a, b) => b.c - a.c)
              .map((r) => ({ language: r.lang, edges: r.c, reason: 'non_cpp_language — no LSP backend in this server can verify it' })),
            note:
              `${unverifiableTotal} CALLS edge(s) are unverifiable BY CONSTRUCTION and are excluded from the `
              + 'coverage denominator. An edge nobody could have verified is not an edge that failed verification. '
              + 'Including them would cap the achievable percentage below 100 and make its movement uninterpretable.',
          };
        }
        if (calls > 0 && verified === 0) {
          // ★ SCOPE THE CLAIM TO THE SURFACE IT GOVERNS.
          //
          // This said "every caller answer is heuristic-only and CANNOT attest
          // exhaustiveness". That is true of the STORED GRAPH and false of the LIVE
          // verbs, which query the language server directly and never touch these
          // edges. The field caught the pair in one session, minutes apart, on one
          // server (ef-manager, echoes, 2026-07-30):
          //
          //   graph_health           : trust spine EMPTY, CANNOT attest exhaustiveness
          //   code_intel_references  : exhaustive true, confidence high, degraded false
          //
          // Both were correct about different things, and that is precisely why the
          // pair was harmful: a reader deciding whether to delete a symbol could not
          // tell which surface governed the decision. An over-broad true statement
          // is not safer than a false one — it destroys the reader's ability to use
          // the accurate signal sitting next to it.
          //
          // `callerCompletenessTrustworthy` is likewise about the GRAPH spine, so it
          // is renamed in meaning rather than value: graphCallerCompletenessTrustworthy.
          // The old key stays for back-compat.
          codeIntel.callerCompletenessTrustworthy = false;
          codeIntel.graphCallerCompletenessTrustworthy = false;
          codeIntel.liveVerbsUnaffectedByEmptySpine = true;
          verdicts.push('⚠ trust spine EMPTY: 0 of ' + calls + ' CALLS edges are [lsp✓] verified — '
            + 'GRAPH-BACKED caller answers (graph_callers, graph_impact, graph_pull, graph_consequences) are heuristic-only here and cannot attest exhaustiveness. '
            + 'This does NOT constrain the LIVE verbs: code_intel_references / code_intel_hierarchy query the language server directly and carry their own evidence block — '
            + 'trust THEIR evidence.exhaustive for a delete decision, not this line. '
            + 'A full reindex drops verified edges; run graph_collect_code_intel to restore the graph spine.');
        }
        // THE PERCENTAGE IS A FLOOR, AND IT MUST SAY SO IN THE RENDERED LINE.
        //
        // Symbols we DECLINED to query — identifier column unlocatable, or a hub
        // whose reference set hit the cap — sit in the denominator and can never
        // reach the numerator. Quoting the percentage alone turns "not asked" into
        // "asked and found nothing", which are different states and only one of
        // them is evidence about the code. This is the same half-truth as a
        // partial sample wearing the name of the whole, so the caveat travels with
        // the number rather than living in a chat log.
        // ★ A CAVEAT MUST BE COMPUTED FROM THE SAME SOURCE AS THE NUMBER IT
        //   QUALIFIES, OR IT CAN BE DELETED INDEPENDENTLY AND THE NUMBER KEEPS
        //   PRINTING.
        //
        // ef-manager watched this happen with a before-image (2026-07-31). An
        // empty collection row wiped the session stats, and:
        //   BEFORE: "⚠ lsp coverage 12% is a FLOOR — 21 symbols NOT ASKED"
        //   AFTER:  warning gone, coverageIsFloor gone, 12% STILL REPORTED.
        // The percentage survived because it is computed from EDGES; the caveat
        // died because it is computed from the COLLECTION SESSION. THE NUMBER
        // OUTLIVED ITS QUALIFIER — which is the headline sentence of the entire
        // 52% arc, reproducing through an unrelated mechanism inside the session
        // convened to fix it.
        //
        // So the two are bound. `skipped`/`capped` being NULL is not the same as
        // being ZERO: null means the qualifier could not be computed, and an
        // uncomputable qualifier must produce a MORE cautious number, not a
        // cleaner one. Same fail-closed default as "unknown is not untruncated".
        // NOTE — a defect was suspected here and does not exist. The fresh collect
        // carries 21 `position_unresolved` RECORDS while positionGuessSkipped
        // reports 0, which looks like the capture-vs-aggregate gap seen elsewhere
        // tonight. It is not: all 21 are ANONYMOUS constructs, which are counted
        // separately (anonymousSkipped) and deliberately excluded from the
        // not-asked figure — see isAnonymousSymbolName. Counting them here would
        // INFLATE the very number a reviewer uses to judge whether a floor is
        // really a floor, which is the inflation that exclusion exists to prevent.
        // Deriving this count from records was drafted and reverted; 0 is correct.
        const skippedRaw = codeIntel.positionGuessSkipped;
        const cappedRaw = codeIntel.refsTruncatedSymbols;
        // Explain the disagreement a reader WILL find. positionGuessSkipped counts
        // symbols we declined to ask about; anonymous constructs are excluded from
        // it deliberately (counting them inflates the not-asked figure used to judge
        // whether a floor is really a floor). But they still emit
        // `position_unresolved` RECORDS, so anyone who greps the table finds a
        // larger number than this header reports and has no way to know why.
        // Two numbers that disagree with nothing explaining the gap is how a reader
        // learns to distrust both.
        try {
          const unresolvedRecs = db2.get(
            `SELECT COUNT(*) AS c FROM code_intel_records WHERE result_state = 'position_unresolved'`,
          ).c ?? 0;
          if (unresolvedRecs !== (skippedRaw ?? 0)) {
            codeIntel.positionUnresolvedRecords = unresolvedRecs;
            codeIntel.positionGuessSkippedNote =
              `${unresolvedRecs} position_unresolved record(s) exist but positionGuessSkipped is ${skippedRaw ?? 0}: `
              + 'anonymous constructs (e.g. "(anonymous namespace)") have no identifier to locate, so they are '
              + 'recorded but deliberately NOT counted as "not asked" — counting them would inflate the figure '
              + 'used to judge whether the coverage floor is really a floor.';
          }
        } catch { /* best-effort — never block health on the explanation */ }
        // The wiped row does not return null — it returns 0, which is itself a
        // stand-in: "0 symbols skipped" from a session that recorded nothing reads
        // identically to "0 symbols skipped" from a clean full run. The structural
        // discriminator is the CONTRADICTION between the two sources: verified
        // edges exist, while the session that supposedly produced them claims to
        // have examined no symbols at all. Numbers from different eras.
        // ★ THE CONTRADICTION CHECK KEYED ON A LEGITIMATE ZERO — instance twelve,
        //   verbatim, inside the code written to fix instance twelve.
        //
        // ef-manager measured it on the fresh collect: coverageFloorCause reported
        // `qualifier_unavailable` and the summary claimed the session "is missing"
        // — while THE SAME RESPONSE carried refsFoundSymbols 766,
        // refsNotFoundSymbols 833, positionGuessSkipped 0, refsTruncatedSymbols 0.
        // The session was fully populated. positionGuessSkipped being 0 is a
        // legitimate value on a clean run, and reading it as absence collapsed the
        // known/unknown distinction this whole field exists to preserve — in the
        // alarming direction.
        //
        // The fields here come from `sess`, so `refsFoundSymbols`/`refsNotFoundSymbols`
        // are the wrong names on this object anyway (they read undefined → 0 → the
        // contradiction fired on every populated collect). Use the reader's names,
        // and treat "session present at all" as the real question.
        const sessionExamined = (codeIntel.refsFound ?? 0) + (codeIntel.refsNotFound ?? 0);
        const sessionPresent = codeIntel.refsFound != null || codeIntel.refsNotFound != null;
        const qualifierUnavailable = (skippedRaw == null && cappedRaw == null)
          || (verified > 0 && sessionPresent && sessionExamined === 0)
          || (verified > 0 && !sessionPresent);
        const skipped = skippedRaw ?? 0;
        const capped = cappedRaw ?? 0;
        if (qualifierUnavailable) {
          codeIntel.coverageIsFloor = true;
          codeIntel.coverageFloorCause = 'qualifier_unavailable';
          verdicts.push(`⚠ lsp coverage ${codeIntel.lspVerifiedPctOfCalls}% CANNOT BE QUALIFIED — the collection`
            + ' session that records what was never asked (positionGuessSkipped, refsTruncatedSymbols) is missing,'
            + ' so this figure may be a floor by an unknown margin. Treat it as unqualified, not as clean.'
            + ' Re-run graph_collect_code_intel to restore the qualifier.');
        } else if (skipped > 0 || capped > 0) {
          const bits = [];
          if (skipped > 0) bits.push(`${skipped} symbol${skipped === 1 ? '' : 's'} NOT ASKED (identifier position unresolvable)`);
          if (capped > 0) bits.push(`${capped} hub${capped === 1 ? '' : 's'} truncated at the per-symbol reference cap`);
          codeIntel.coverageIsFloor = true;
          codeIntel.coverageFloorCause = 'not_asked_or_capped';
          verdicts.push(`⚠ lsp coverage ${codeIntel.lspVerifiedPctOfCalls}% is a FLOOR, not a rate — ${bits.join('; ')}.`
            + ' Those are absent from the numerator but present in the denominator; do not read the gap as "no callers".');
        }
      } finally { db2.close(); }
    } catch { /* best-effort */ }
  }
  if (codeIntel?.indexedCommit && head && codeIntel.indexedCommit !== head) {
    verdicts.push(`⚠ code-intel collection was indexed at ${String(codeIntel.indexedCommit).slice(0, 7)} but HEAD is ${head.slice(0, 7)}`
      + `${collectedDays != null ? ` (${collectedDays}d old)` : ''} — [lsp✓] evidence is stale and cannot attest exhaustiveness (re-run graph_collect_code_intel)`);
  }
  if (overlay.present) {
    if (overlayQuality.featureCount === 0) {
      verdicts.push('overlay=empty');
    } else {
    const qualityBits = [
      `tests ${overlayQuality.featuresWithTests}/${overlayQuality.featureCount}`,
      `docs ${overlayQuality.featuresWithDocs}/${overlayQuality.featureCount}`,
      `deps ${overlayQuality.featuresWithDependsOn}/${overlayQuality.featureCount}`,
      `related ${overlayQuality.featuresWithRelatedTo}/${overlayQuality.featureCount}`,
    ];
    if (overlayQuality.tasksTotal > 0) {
      qualityBits.push(`tasks ${overlayQuality.linkedTasks}/${overlayQuality.tasksTotal}`);
      const taskLinkSummary = [
        `${overlayQuality.strongTaskLinks ?? 0} strong`,
        `${overlayQuality.mixedTaskLinks ?? 0} mixed`,
        `${overlayQuality.broadTaskLinks ?? 0} broad`,
      ].filter(Boolean).join(', ');
      if (taskLinkSummary) qualityBits.push(`task-links ${taskLinkSummary}`);
    }
    verdicts.push(
      overlay.broken === 0
        ? `overlay=clean (${overlay.checked} features; ${qualityBits.join(', ')})`
        : `overlay=broken ${overlay.broken}/${overlay.checked} (${qualityBits.join(', ')})`,
    );
    }
    if (overlay.lintCount) verdicts.push(`overlay-lint=${overlay.lintCount} (legacy/invalid feature shape — see overlay.lint; e.g. ${overlay.lint[0]})`);
  } else {
    verdicts.push('overlay=none');
  }
  // Independent of whether an overlay exists: a DROPPED task→feature link is a
  // different failure from an absent one, and only this line distinguishes them.
  if (taskSchemaLint.length) {
    verdicts.push(`task-schema-lint=${taskSchemaLint.length} (feature links DROPPED, not absent — e.g. ${taskSchemaLint[0]})`);
  }
  if (dirtyFiles.length > 0) {
    if (dirtySeams.features.length > 0) {
      const preview = dirtySeams.features.slice(0, 3)
        .map((f) => `${f.id}(${f.file_count})`)
        .join(', ');
      const orphan = dirtySeams.orphanDirtyFiles > 0 ? `, orphan ${dirtySeams.orphanDirtyFiles}` : '';
      verdicts.push(`dirty-seams: ${preview}${orphan}`);
    } else {
      const untracked = untrackedDirtyCount > 0 ? ` (+${untrackedDirtyCount} untracked, not in graph)` : '';
      verdicts.push(`dirty=${trackedDirtyFiles.length} tracked${untracked}`);
    }
  }
  if (briefStaleVsManifest) {
    verdicts.push('brief-stale: regenerate with graph-brief.mjs');
  }
  if (unresolvedCategorizationStaleVsManifest) {
    verdicts.push('categorization-stale: regenerate via graph_index()');
  }

  const _nextActions = buildNextActions({
    codeIntel, overlay, overlayQuality, artifactAges, stale, trust,
    briefStaleVsManifest, trustUnresolvedEdges,
  });

  return {
    indexed: true,
    trust,
    unresolvedEdges,
    trustUnresolvedEdges,
    ...(stalenessImpact ? { stalenessImpact } : {}),
    ...(trustBasis ? { trustBasis } : {}),
    nodes,
    edges,
    // BOUNDED. These lists were emitted in full, and a 2804-file directory turned
    // a ~90-line health response into 2,916 lines / 294KB — past an agent client's
    // tool-result limit, so the primary diagnostic verb could not be read at all.
    //
    // ★ The trigger was OUR OWN ADVICE: "snapshot .aify-graph before touching it"
    // creates thousands of untracked files, so every user careful enough to follow
    // the safety practice broke health for themselves — and the failure surfaced as
    // a client token error, which looks like their problem rather than ours.
    // A diagnostic that degrades when the tree gets messy is useless exactly when
    // the tree is messy.
    //
    // The COUNTS are the decision-relevant part and are kept exact; the lists are a
    // sample. Truncation is reported, never silent.
    // ★ A COUNT NAMED LIKE A BOOLEAN. `dirtyFilesTruncated` held 2779 — a number —
    // while the {items,total,truncated,limit} envelope standardized elsewhere uses
    // `truncated` as a BOOLEAN. Truthiness made both work, so nothing broke; that
    // is exactly why it survived. Two meanings for one field name across sibling
    // verbs is how a reader learns to guess instead of read (ef-manager, on the
    // first health response from the new build).
    //
    // The count is the better datum, so it is kept — under a name that says what it
    // is — and the boolean is provided alongside so the shape matches its siblings.
    // trackedDirtyFiles was capped with NO truncation signal at all, which is the
    // same defect one step further along; it gets both fields too.
    // ★ WHEN NOTHING TRACKED IS DIRTY, THE SAMPLE IS PURE NOISE.
    //
    // Measured (ef-manager, 2026-08-09) on echoes: 25 sampled entries costing 537
    // tokens, EVERY one an untracked backup directory — .aify-graph.bak-*,
    // .aify-graph-PRE-RESTORE-* — out of 2824. Meanwhile trackedDirtyFiles was [],
    // one line, and that is the field carrying the signal. Both his calls paid the
    // 537 and neither used it.
    //
    // The sample earns its place when TRACKED files are dirty, because then it
    // names code that may have moved under the snapshot. When nothing tracked is
    // dirty it names build residue. So the count is always reported — a reader
    // must still be able to see that 2824 untracked files exist — and the list of
    // names is emitted only when the names could matter.
    ...(trackedDirtyFiles.length > 0
      ? {
        dirtyFiles: dirtyFiles.slice(0, DIRTY_LIST_CAP),
        dirtyFilesTruncated: dirtyFiles.length > DIRTY_LIST_CAP,
      }
      : {
        dirtyFilesNote: dirtyFiles.length > 0
          ? `${dirtyFiles.length} dirty file(s), none of them tracked by git — untracked build/backup residue, so the names are omitted. Nothing tracked has moved under the snapshot.`
          : undefined,
      }),
    dirtyFilesTotal: dirtyFiles.length,
    // ★ THE OMITTED-COUNT MUST MATCH WHAT WAS ACTUALLY PRINTED.
    //
    // Introduced by me the same day I suppressed the name list, and caught by
    // ef-manager one commit later: it kept subtracting DIRTY_LIST_CAP, so on echoes
    // it reported dirtyFilesOmitted 2799 of dirtyFilesTotal 2824 — arithmetic that
    // asserts 25 names were shown, in a response that shows none. A count that
    // disagrees with the payload beside it is worse than no count, because a reader
    // reconciles them and concludes the payload was truncated somewhere they cannot
    // see.
    //
    // Now derived from the list that was actually emitted, so the two cannot drift:
    // suppressed → everything is omitted; capped → the cap is what shows.
    ...(dirtyFiles.length > 0
      ? { dirtyFilesOmitted: dirtyFiles.length - (trackedDirtyFiles.length > 0 ? Math.min(dirtyFiles.length, DIRTY_LIST_CAP) : 0) }
      : {}),
    trackedDirtyFiles: trackedDirtyFiles.slice(0, DIRTY_LIST_CAP),
    trackedDirtyFilesTotal: trackedDirtyFiles.length,
    trackedDirtyFilesTruncated: trackedDirtyFiles.length > DIRTY_LIST_CAP,
    ...(trackedDirtyFiles.length > DIRTY_LIST_CAP
      ? { trackedDirtyFilesOmitted: trackedDirtyFiles.length - DIRTY_LIST_CAP } : {}),
    dirtySeams,
    commit: manifest?.commit ?? null,
    currentHead: head,
    stale,
    manifestStatus,
    briefStaleVsManifest,
    unresolvedCategorizationStaleVsManifest,
    overlay,
    overlayQuality,
    taskSchemaLint,
    codeIntel,
    // Age in days of the derived artifacts graph_index does NOT refresh
    // (functionality / tasks / codeIntel). LH-3.
    artifactAges,
    refreshMechanism,
    server: serverBuild(),
    // ★ ROUTE FROM THE VERB PEOPLE ACTUALLY CALL TO THE ONES THEY SHOULD.
    //
    // Field accounting (ef-manager, 2026-07-30): "I used 2 verbs out of ~17. I never
    // once called graph_packet or graph_pull — your documented front door — despite
    // returning to a repo I hadn't touched in seven weeks, where orientation was
    // literally my problem. Nothing in my workflow PULLED me toward them."
    //
    // That is a routing failure, not a capability failure, and no amount of
    // correctness work touches it. Documentation does not pull; a suggestion at the
    // moment of use does. graph_health is the one verb he DID reach for
    // unprompted — so it is the only place with the standing to route.
    //
    // Derived from THIS repo's actual state, never generic advice: recommending
    // graph_packet on a repo with no overlay would be noise, and noise here would
    // cost the routing its credibility on the repos where it is right.
    nextActions: _nextActions,
    // The routing must reach the SUMMARY, not only the JSON. A reader who scans one
    // string and stops is the common case — that is precisely how the 96-day-stale
    // briefs went unnoticed while their staleness sat in a field nobody read.
    summary: _nextActions.length
      ? `${verdicts.join(' · ')} · NEXT: ${_nextActions.map((a) => a.do).join(' | ')}`
      : verdicts.join(' · '),
  };
}
