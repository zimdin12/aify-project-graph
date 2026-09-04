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
import { graphCapabilities } from '../graph-capabilities.mjs';
import { getBackend } from '../../code-intel/backends.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// HOW MUCH OF THE COLLECTION'S EVIDENCE HAS ALREADY DECAYED.
//
// The salvage gate drops verified evidence per FILE: a covered file that changed since the
// collection loses it on the next rebuild. So the honest magnitude is "how many of the files this
// collection covered have changed", not "how many commits have passed" — 121 commits that touch no
// covered file destroy nothing, and one that rewrites forty covered files destroys a great deal.
//
// Returns nulls rather than zeros when it cannot tell. A zero here would read as "nothing decayed",
// which is the permissive answer, and this feeds the message a reader consults before deleting code.
//
// ⛔ THIS WAS ONE FUNCTION AND IT RAN GIT INSIDE A PINNED READ SNAPSHOT. graph_health called it
// from within captureExistingSnapshot, so the WAL reader stayed open across an execFileSync — the
// precise design this repository rejected, done in the function whose whole purpose was to read
// every authority input at one instant. The comment beside the call even justified it: reading
// these together IS the window being closed, so the fix looked deliberate and the cost was invisible.
//
// ⇒ Split by substrate. `collectionCoveredFiles` is pure database and is safe under a pin;
// `decayFromCoveredFiles` takes the list it produced and does the git work with no handle open.

/** The files a collection covered, straight from the graph. Pure DB — safe inside a pinned read. */
export function collectionCoveredFiles(db, latest) {
  if (!latest?.collectionId) return null;
  try {
    return db.all(
      'SELECT DISTINCT file FROM code_intel_records WHERE collection_id = $cid',
      { cid: latest.collectionId },
    ).map((r) => r.file).filter(Boolean);
  } catch {
    return null;
  }
}

/** git diff plus arithmetic over an ALREADY-READ file list. Takes no database handle, by design. */
export function decayFromCoveredFiles(covered, latest, head, repoRoot) {
  const unknown = { filesCovered: null, filesChangedSinceCollection: null };
  if (!latest?.indexedCommit || !head || !repoRoot) return unknown;
  try {
    if (!Array.isArray(covered) || covered.length === 0) return unknown;
    const out = execFileSync(
      'git',
      ['-C', repoRoot, 'diff', '--name-only', `${latest.indexedCommit}..${head}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const changed = new Set(out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    // Records may store OS-native separators; git always reports forward slashes.
    const norm = (f) => String(f).replace(/\\/gu, '/');
    return {
      filesCovered: covered.length,
      filesChangedSinceCollection: covered.filter((f) => changed.has(norm(f))).length,
    };
  } catch {
    return unknown;
  }
}

import { computeCoverage, isLspVerifiableLanguage } from '../coverage-denominator.js';
import { openExistingDb, captureExistingSnapshot } from '../../storage/db.js';
import { readTrustClassificationInputs } from '../../storage/unresolved-refs.js';
import { classifyPublication, readGraphPublication, ATTESTATION } from '../../storage/publication-schema.js';
import { loadManifest } from '../../freshness/manifest.js';
import { WorktreeState } from '../../freshness/worktree-state.js';
import { serverBuildInfo } from '../../server-build.js';
import { readArtifactIndexedAt } from '../../freshness/unresolved-categorization.js';
import { getUnresolvedCounts, explainTrustExclusions } from '../../freshness/unresolved-metrics.js';
// ⚠ IMPORTED, never restated. A second copy of this rule is a second chance to disagree with the
// resolver that enforces it — a re-typed regex already flagged a legitimate PHP namespaced class.
import { isPlausibleExternalName } from '../../ingest/resolver.js';
import { loadFunctionality, validateAnchors, hasOverlay } from '../../overlay/loader.js';
import { loadTasksArtifact, lintTaskSchema, summarizeDirtySeams, summarizeOverlayQuality } from '../../overlay/quality.js';
import { getLatestCollection } from '../../code-intel/query.js';
import { prepareCompileDb } from '../../code-intel/compile-db.js';
import { resolveClangCl } from '../../code-intel/resolve-clangd.js';
import { refreshMechanismVerdict } from '../../freshness/refresh-verdict.js';
import { SEARCH_TYPES } from './whereis.js';
import { eligibleFilePaths, coveredFilePaths, countInCorpus,
  LANGUAGE_FILE_EXTENSIONS } from './collect_code_intel.js';

// Cap for file lists in the health response. The counts stay exact; only the
// sample is bounded. See the dirtyFiles comment below for why this exists.
const DIRTY_LIST_CAP = 25;

// Single source of truth for trust-level thresholds. graph_health and the
// brief's trust() both consume this so they can't drift. Echoes bench
// 2026-04-21 showed them disagreeing (brief said "strong" while health said
// "weak (5421 unresolved)" on the same state) — fixed by centralizing.
// Does this language have a language server in THIS server build?
//
// ⛔ DERIVED FROM THE REAL BACKEND REGISTRY, never a parallel list. `getBackend` is the same
// registry the collector uses, so adding a PHP backend later flips this automatically — there is no
// second table to remember, which is how the two compile-DB allowlists drifted apart.
//
// ⚠ It also corrected a hand-written map I nearly shipped: the registry aliases `c -> cpp`, so C
// DOES have clangd. My own table had called it heuristic.
//
// PHP is the case that matters: extractor, no server. Its graphs can never earn a verified edge, so
// it must never be told to run a collection to get one.
/**
 * The language most of this graph's CODE nodes are written in.
 *
 * ⚠ Code nodes only. Counting every node would let a repository's markdown and config outvote its
 * source, and the question here is which language server could verify its EDGES.
 *
 * Returns null when the graph cannot say — and null must never be read as "has a server", which is
 * why the caller treats an unknown language as "do not invent a permanent limit".
 */
// ⛔ ONE OWNER. This list decides both the primary language and whether the graph still holds any
// code at all; two copies would drift and the integrity check would quietly stop firing.
const CODE_NODE_TYPES = Object.freeze(['Function', 'Method', 'Class', 'Interface', 'Type', 'Symbol', 'Test']);
const CODE_NODE_TYPE_SET = new Set(CODE_NODE_TYPES);

// ⚠ SHAPE, NOT A REBUILD. Whether a node is reproducible by a full index cannot be known without
// running one, which health must never do. But the residue is 98.8% fragment-labelled, so the
// label shape is a cheap and honest proxy — and it is the part that is actually harmful.
// ⚠ The predicate is IMPORTED from the resolver, never restated: a second copy of a rule is a
// second chance to disagree with it, which a re-typed regex already did once this session.
//
// ⛔ THIS RETURNED 0 ON EVERY FAILURE, AND 0 IS ALSO THE HEALTHY ANSWER. Its only consumer is
// `if (fragmentExternals > 0)`, so an unopenable graph, a missing `nodes` table and a genuinely
// clean graph all produced the same output: silence, in the verdict list a reader consults to
// decide whether anything is wrong. A zero that cannot fail is not a measurement. The catch also
// carried a stray `console.error('COUNT THREW:', ...)` left over from debugging.
//
// @returns {{measured: true, count: number}}    counted, from the graph
// @returns {{measured: false, reason: string}}  the read failed — NOT a count of zero
function countFragmentExternals(dbPath) {
  try {
    const db = openExistingDb(dbPath);
    try {
      const rows = db.all("SELECT label FROM nodes WHERE type = 'External' AND label <> ''");
      return {
        measured: true,
        count: rows.reduce((n, r) => (isPlausibleExternalName(r.label) ? n : n + 1), 0),
      };
    } finally { db.close(); }
  } catch (e) {
    return { measured: false, reason: e?.message ?? 'unknown error' };
  }
}

function dominantGraphLanguage(dbPath) {
  try {
    const db = openExistingDb(dbPath);
    try {
      const row = db.get(`SELECT language, COUNT(*) c FROM nodes
        WHERE language IS NOT NULL AND language <> ''
          AND type IN (${CODE_NODE_TYPES.map((t) => `'${t}'`).join(',')})
        GROUP BY language ORDER BY c DESC LIMIT 1`);
      return row?.language ?? null;
    } finally { db.close(); }
  } catch { return null; }
}

function languageHasLspBackend(language) {
  if (!language) return true;            // unknown language: do not invent a permanent limit
  try { return Boolean(getBackend(language)); } catch { return true; }
}

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
// ⛔ A GRAPH CAN BE 70x ITS OWN CONTENT AND NOTHING SAID SO.
//
// the field fleet reported sand_castle's graph.sqlite at 2.87 GB for 12,478 nodes / 49,229
// edges and correctly refused to call it a diagnosis. Measured read-only: 689,127 of
// 699,568 pages were FREE — 2.69 GB of empty space around ~41 MB of real content.
//
// Cause: the per-collect auto-prune DELETEs old code_intel collections (it had already
// taken that graph from 1.03M rows to 7,411), `auto_vacuum` is 0/NONE, and DELETE frees
// pages for REUSE without returning them to the OS. importer.js said "Caller is
// responsible for VACUUM afterward". No caller was. A duty assigned to nobody is not a
// safeguard, and the growth was completely silent — the one property that made a 2.87 GB
// file survive for months.
//
// ⇒ So the ratio is REPORTED ALWAYS, not only when it trips. A reader must be able to see
// the basis for "your storage is fine" as readily as the warning; a check that only speaks
// up when it is unhappy cannot be distinguished from one that is broken.
//
// ⚠ The threshold below decides only whether a REMEDY is offered, never whether the
// numbers appear. 25% is not measured from a population of repos — it is the point at
// which VACUUM buys back something worth the minutes it costs, and the 50 MB floor stops
// small graphs from being nagged about a few reclaimable megabytes. Stated because an
// unexplained constant gets read as a finding.
// Exported so the trip branch can be exercised without manufacturing 50 MB of waste in a
// test, and so the shipped values can be pinned by name rather than re-typed as literals in
// an assertion — which is how a threshold and its test drift apart while both look right.
export const STORAGE_RECLAIM_MIN_BYTES = 52_428_800;   // 50 MB
export const STORAGE_RECLAIM_MIN_RATIO = 0.25;

export function inspectStorage(db, dbPath, {
  minFreeBytes = STORAGE_RECLAIM_MIN_BYTES,
  minFreeRatio = STORAGE_RECLAIM_MIN_RATIO,
} = {}) {
  // Both the wrapDb() facade and a bare better-sqlite3 handle reach this codebase's
  // storage helpers; accept either rather than silently measuring nothing.
  const h = typeof db?.pragma === 'function' ? db : db?.raw;
  if (typeof h?.pragma !== 'function') return { measured: false, reason: 'no_db_handle' };
  const pageSize = h.pragma('page_size', { simple: true });
  const pageCount = h.pragma('page_count', { simple: true });
  const freeCount = h.pragma('freelist_count', { simple: true });
  if (!Number.isInteger(pageSize) || !Number.isInteger(pageCount) || !Number.isInteger(freeCount)) {
    // Fail closed and say so, rather than reporting a ratio derived from a missing pragma.
    return { measured: false, reason: 'pragma_unavailable' };
  }
  const fileBytes = pageSize * pageCount;
  const freeBytes = pageSize * freeCount;
  const freeRatio = pageCount > 0 ? freeCount / pageCount : 0;
  const mb = (n) => Math.round(n / 1048576);
  const autoVacuum = h.pragma('auto_vacuum', { simple: true });
  const reclaimable = freeBytes >= minFreeBytes && freeRatio >= minFreeRatio;
  // Both commands below take a REPO ROOT; pasting the .sqlite path just fails. Derived once
  // — it was written twice, and two copies of a path transform is how one of them rots.
  const repoRoot = dbPath.replace(/[\\/]\.aify-graph[\\/]graph\.sqlite$/, '');
  return {
    measured: true,
    fileMb: mb(fileBytes),
    contentMb: mb(fileBytes - freeBytes),
    freeMb: mb(freeBytes),
    freePercent: Math.round(freeRatio * 100),
    autoVacuum,
    // ⛔ A COMPACTED LEGACY GRAPH LOOKS PERFECT AND IS STILL PRIMED TO REFILL.
    // sand_castle after compaction: 36 MB, 0% free, reclaimable false — nothing to warn
    // about on any size measure, while the file was still on auto_vacuum=NONE and would
    // rebuild the same high-water mark over time. They spotted that themselves and asked;
    // a diagnostic that needed the user to notice the latent half is not doing its job.
    // Reported independently of `reclaimable` because the two are different questions:
    // "is space wasted right now" vs "can this file ever give space back on its own".
    canReclaimInPlace: autoVacuum === 2,
    ...(autoVacuum === 2 ? {} : {
      upgrade: `node scripts/compact-graph.mjs ${repoRoot} — converts this file to `
        + 'incremental auto-vacuum so freed pages return by themselves. The mode cannot be '
        + 'changed in place, and a bare VACUUM does NOT convert it.',
    }),
    reclaimable,
    ...(reclaimable ? {
      note: `${mb(freeBytes)} MB of this ${mb(fileBytes)} MB file is free pages, not data. `
        + 'DELETE frees pages for reuse but does not shrink the file; nothing reclaims them automatically.',
      remedy: `node scripts/compact-graph.mjs ${repoRoot}`,
    } : {}),
  };
}

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
  } else if (s.codeIntel?.available && s.codeIntel.coverage?.complete !== true) {
    // ⛔ THIS BRANCH DID NOT EXIST, AND ITS ABSENCE SILENCED THE ONLY CODE-INTEL WARNING.
    //
    // Found by running the first collection this repo has ever had. It covered THREE files of
    // 484. Afterwards `available` was true and `lspVerifiedEdges` was 68, so BOTH existing
    // branches were satisfied and `nextActions` went EMPTY — which this verb documents as
    // meaning a healthy repo, and is the property that makes a populated list worth reading.
    //
    // The collection response had said `filesProcessed 3 · filesTotal 3`. That is 100%, because
    // filesTotal was the SCOPE's denominator rather than the repo's. 3 of 3 is complete; 3 of
    // 484 is 0.6%.
    //
    // ⚠ AND `complete !== true` IS DELIBERATE, NOT `=== false`. Three states: complete,
    // incomplete, and UNKNOWN — a collection stored before the coverage columns existed reports
    // null, and null must warn. An unknown coverage is not a clean one, and this repo has found
    // that same collapse seven times tonight in other places.
    const cov = s.codeIntel.coverage ?? {};
    const known = cov.filesProcessed != null && cov.filesEligible != null;
    // ⛔ THIS SENTENCE COUNTED RECORDS AND CLAIMED EDGES, AND THE JOIN WAS THE WORD "so".
    //
    // It read "covers N of M eligible file(s), SO [lsp✓] evidence exists for part of the repo
    // only". N is `filesProcessed` — DISTINCT file in code_intel_records across every live
    // collection (`coveredFilePaths`, source "all_live_collections"). `[lsp✓]` renders from
    // `edges.provenance = 'LSP_VERIFIED'` and from nothing else. Two populations, and on this
    // repository they were 624 files and 31.
    //
    // The two diverge by construction, not by accident: a complete unscoped `ok` collection
    // DELETES the prior verified edges for its language (importer.js) and leaves their records
    // standing. So the union numerator keeps counting files whose verified evidence a later run
    // threw away, and the reader's obvious ratio — 624/854, 73% — described a compiler-verified
    // surface of 3.6%.
    //
    // ⚠ THE UNION NUMERATOR IS NOT THE DEFECT AND IS NOT CHANGED. It was introduced to stop a
    // 3-file targeted collect reporting "3 of 557", and that argument still holds for the question
    // it answers, which is a records question. What changes is that the [lsp✓] claim now carries
    // the edge-derived count instead of borrowing this one.
    //
    // ⚠ UNKNOWN RATHER THAN OPTIMISTIC when the file count is unreadable. An absent verified count
    // must not silently restore the old reading in which the records figure stands for coverage.
    const verifiedFiles = s.codeIntel.lspVerifiedFiles;
    const verifiedClause = typeof verifiedFiles === 'number'
      ? `live [lsp✓] edges reach only ${verifiedFiles} file${verifiedFiles === 1 ? '' : 's'}`
      : 'how many files live [lsp✓] edges reach is UNKNOWN';
    out.push({
      why: known
        ? `code-intel records cover ${cov.filesProcessed} of ${cov.filesEligible} eligible `
          + `file(s), but ${verifiedClause} — a later complete collection deletes earlier verified `
          + 'edges and keeps their records, so the record count OVERSTATES the compiler-verified '
          + 'surface; a symbol outside it gets heuristic answers with no signal saying so'
        : 'the code-intel collection does not record how much of the repo it covered, so its '
          + 'coverage is UNKNOWN rather than complete — treat [lsp✓] absence as uninformative '
          + 'until a scoped collection records its own scope',
      do: 'graph_collect_code_intel({ scope: "all" }) to cover the repo; per-symbol, read '
        + 'evidence.exhaustive on code_intel_references rather than inferring from this summary',
    });
  } else if (!s.codeIntel?.available) {
    out.push({
      // ⛔ THIS NAMED A NARROWER CLASS THAN THE CONDITION AFFECTS. It used to read
      // "caller/deletion answers will be heuristic only". The efficacy run's augmented arm hit
      // the gap: it was asked for a definition COUNT, saw this line, and correctly noted that
      // absence of code-intel undermines definition counts just as much — the graph layer is
      // tree-sitter-derived either way — while the consequence text pointed only at callers and
      // deletes. A reader checking whether this warning applies to THEIR question was told no.
      // ⛔ THIS LINE HAS NOW BEEN WRONG IN BOTH DIRECTIONS, AND THE SECOND ONE WAS MINE.
      //
      // It first read "caller/deletion answers will be heuristic only" — too NARROW, so a reader
      // asking about definition counts was told the warning did not apply (efficacy run 1). I
      // widened it to say definition counts "cannot be treated as exhaustive" — too BROAD, and
      // it then contradicted graph_whereis's own attestation on the same server. Run 2 on that
      // build spent 21 tool calls against run 1's 15: one surface licensed the claim, the other
      // de-licensed it, and the arm re-derived everything from a compiler API instead.
      //
      // ★ "An unwarranted DOUBT costs the reader exactly as much as an unwarranted claim,
      // because they go and check either way." That is the arm's sentence, and it is the rule.
      //
      // ⇒ SCOPE THE DOUBT TO ITS CAUSE. Code-intel resolves CROSS-REFERENCES; without it caller
      // sets, deletion safety and override/overload resolution are heuristic. A definition COUNT
      // is a different question, settled by extraction over a fresh index — two independent
      // parsers (tree-sitter, and the TypeScript compiler API) agreed with graph_whereis on all
      // 16 sites across 6 symbols on a repo with no collection at all. What bounds a count is
      // what the PARSER can see, so that limit is named as itself instead of folded in here.
      why: 'no code-intel collection on this repo — CROSS-REFERENCE answers (caller sets, '
        + 'deletion safety, override/overload resolution) are tree-sitter heuristic rather than '
        + 'compiler-verified and must not be treated as exhaustive. Definition counts and '
        + 'locations are a separate question: settled by extraction, and bounded by what the '
        + 'parser can see — a computed or generated definition is invisible to it',
      // ⚠ THE ACTION HAS TO MATCH THE QUESTION THE READER ASKED. This offered only
      // code_intel_references — a CALLER verb — while the efficacy pilot's arm was asking about
      // definition locations and counts. A remedy pointed at the wrong question costs a call to
      // discover it was not for you, which is the same defect as advice not conditioned on
      // whether it applies (fixed in the packet's NEXT lines earlier the same day).
      // ⛔ AND THEN IT NAMED A DOOR THE READER CANNOT OPEN. `code_intel_definitions` is not in
      // the 17-name default tools/list profile; in a managed session, where tools are deferred
      // behind a search step, it is not callable at all (the field test executed the lookup and got
      // "No matching deferred tools found"). The comment above DEFAULT_TOOL_NAMES already
      // records this exact failure — graph_index was ADDED to the profile because workers could
      // not act on a warning naming a verb outside their surface — and I reproduced it anyway.
      //
      // ⇒ It was also inconsistent with the `why` directly above, which says definition counts
      // are settled by EXTRACTION. So the remedy for the definition half is the extraction verb,
      // `graph_whereis`: listed, callable, and the one that actually answers the question.
      do: 'graph_collect_code_intel({ scope: "all" }) for the whole repo; or for ONE bounded '
        + 'symbol: graph_whereis (where/how many it is defined — extraction settles this, and it '
        + 'now states which declaration types are unpopulated in this graph) or '
        + 'code_intel_references (who calls it / is it safe to delete) — read evidence.exhaustive '
        + 'on the latter, since a collection merely existing does not make a result exhaustive',
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
  // a field reviewer took it apart precisely (the field test, 2026-07-31):
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


// The publication comparison, in one place, with the handle closed. Returns a typed state rather
// than a boolean so a denial can say WHICH of the four it is — legacy, never completed, torn, or a
// caller that never asked.
function attestationFrom(publication, manifest, manifestUsable = true) {
  // ⛔ NO HANDLE OF ITS OWN. This opened the database a second time, so the attestation described a
  // different instant from the evidence it was authorising — reviewer's exact finding. The
  // publication now arrives from the single authority capture taken above.
  return classifyPublication({
    dbGeneration: publication === null || publication === undefined ? null : publication.generation,
    manifestGeneration: manifest?.generation ?? null,
    manifestUsable,
    dbCounts: publication?.counts ?? null,
    manifestCounts: {
      unresolved: manifest?.dirtyEdgeCount ?? null,
      trustUnresolved: manifest?.trustDirtyEdgeCount ?? null,
    },
  });
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

  // ⚠ THE LOAD STATUS IS KEPT, and the name collision below is why it was not.
  // `manifestLoad.status` is whether the FILE could be read; `manifest.status` a line later is the
  // manifest's own ok/indexing field. Two different facts one line apart sharing a word, and
  // discarding the first meant a corrupt manifest was classified as a torn publication.
  const manifestLoad = await loadManifest(graphDir);
  const { manifest } = manifestLoad;
  const manifestStatus = manifest?.status ?? 'ok';
  // ⛔ THE DIAGNOSTIC VERB IS THE LAST PLACE A FAILED QUERY MAY READ AS A MEASUREMENT. This is the
  // verb an agent calls to decide whether to trust everything else, and it used to answer a failed
  // `git status` with "0 tracked, 0 untracked" — a clean bill of health sourced from a query that
  // never ran. One observation now, carrying which half of it failed.
  const worktree = await WorktreeState.observe(repoRoot);
  const head = worktree.head;
  // health is the diagnostic verb, so it keeps BOTH numbers and labels them.
  // `dirtyFiles` (tracked + untracked) still feeds dirty-seam analysis — a new
  // untracked source file is a genuine seam signal — but the count reported in
  // the verdict line distinguishes the trust-relevant tracked number from
  // untracked noise. Unlabelled, a large untracked count reads as snapshot drift
  // (field report: 592 untracked, 0 tracked modifications).
  //
  // ⚠ THE `?? []` IS DELIBERATE AND IS NOT THE DEFENCE. Downstream this file counts, slices and
  // caps these lists in a dozen places; handing them null would only move the failure to a
  // TypeError inside report assembly. So the arithmetic gets an empty list and stays total, and
  // the honesty is carried separately by `worktreeObservationFailed` in the result and the
  // `worktree-unobserved:` verdict line — the two things a reader actually sees. Neither is
  // derived from these counts, so neither can be silenced by them.
  const dirtyFiles = worktree.allDirty ?? [];
  const trackedDirtyFiles = worktree.trackedDirty ?? [];
  const untrackedDirtyCount = worktree.untrackedCount ?? 0;
  // Tri-state: null means staleness was never established. `if (s.stale)` below is correct on
  // null (no claim either way); the unknown is reported by its own verdict line instead.
  const stale = worktree.stalenessAgainst(manifest?.commit);
  const { total: unresolvedEdges, trust: trustUnresolvedEdges } = getUnresolvedCounts(manifest);

  // Live counts agree with graph_status + graph_report
  let nodes = manifest?.nodes ?? 0;
  let census = [];
  let edges = manifest?.edges ?? 0;
  // ⛔ A CONTROL THAT PASSES FOR THE WRONG REASON. Below, `nodes`/`edges` fall back to the MANIFEST
  // when the database cannot be opened — so comparing them to the manifest would compare it to
  // itself and always agree. The integrity check must only run on counts genuinely read from the
  // database, and this flag is the difference.
  // ⛔ EVERY INPUT TO absenceAuthority FROM ONE PINNED SNAPSHOT.
  //
  // These reads used to come from three separate opens: the counts here, the collection and
  // verified-edge total further down, the publication in its own capture. Attestation was pinned
  // and the evidence it authorised was not, so a rebuild committing between them let health certify
  // evidence from generation N with an attestation from N+1.
  //
  // ⚠ I HAD WRITTEN THAT THIS WAS TOLERABLE "because health REPORTS rather than claims absence".
  // That was a rationalisation and the reviewer was right to reject it: graphCapabilities
  // .absenceAuthority IS the repository-level absence claim, the field consulted before someone
  // deletes code. Rendering something does not lower the authority of the field being rendered.
  //
  // Presentation-only reads (overlay anchors, storage size) stay outside — pinning them would hold
  // a WAL reader open across work that gates nothing.
  let dbCountsRead = false;
  let authority = null;
  try {
    authority = captureExistingSnapshot(dbPath, (db) => ({
      nodes: db.get('SELECT count(*) AS c FROM nodes').c,
      edges: db.get('SELECT count(*) AS c FROM edges').c,
      census: db.all('SELECT type, count(*) AS c FROM nodes GROUP BY type ORDER BY c DESC'),
      // ⭐ THE COLLECTION AND EVERY ROW DERIVED FROM IT, TOGETHER — BUT ROWS ONLY.
      //
      // ⛔ THIS BLOCK USED TO CALL collectionDecay, eligibleFileCount and coveredFileCount, and all
      // three do external work: the first shells out to `git diff`, the other two walk the
      // filesystem through loadEffectiveIgnoredDirs. That held the WAL reader open across a
      // subprocess and a directory walk — the design captureExistingSnapshot exists to avoid, done
      // inside the very consolidation meant to make the authority reads safe. The comment here made
      // it look deliberate, because the property it named (one instant) was real; the property it
      // broke (nothing external under a pin) was not mentioned, so nothing prompted a check.
      //
      // ⇒ Take the ROWS here. The git diff, the ignore-rule filtering and the arithmetic all happen
      // after this snapshot closes, over these immutable lists.
      ...(() => {
        let latest = null;
        try { latest = getLatestCollection(db); } catch { return { latestCollection: null }; }
        if (!latest) return { latestCollection: null };
        const exts = LANGUAGE_FILE_EXTENSIONS[latest.language] ?? [];
        let collectionFiles = null;
        let eligiblePaths = null;
        let coveredPaths = null;
        try { collectionFiles = collectionCoveredFiles(db, latest); } catch { collectionFiles = null; }
        try { eligiblePaths = eligibleFilePaths(db, { exts }); } catch { eligiblePaths = null; }
        try { coveredPaths = coveredFilePaths(db); } catch { coveredPaths = null; }
        return { latestCollection: latest, exts, collectionFiles, eligiblePaths, coveredPaths };
      })(),
      language: (() => {
        try {
          return db.get(
            "SELECT language, count(*) AS c FROM nodes WHERE language IS NOT NULL AND language != ''"
            + ' GROUP BY language ORDER BY c DESC LIMIT 1',
          )?.language ?? null;
        } catch { return null; }
      })(),
      publication: readGraphPublication(db),
      // ⭐ THE TRUST DENOMINATOR'S EVIDENCE, FROM THE SAME INSTANT AS THE VERDICT THAT USES IT.
      //
      // ⚠ A DELIBERATE CATCH, and it must not launder. readTrustClassificationInputs returns null
      // ONLY for an established absence (no table — a legacy graph) and THROWS when the table is
      // present but unreadable. Those are different facts, and health must not report a corrupt
      // table as a legacy one. A throw here would lose the whole capture — every count, the
      // publication — over one diagnostic, so it is caught and typed instead.
      // ⛔ THREE STATES, AND MY FIRST VERSION COLLAPSED TWO OF THEM. It caught the throw and
      // returned null — but null MEANS "no table, a legacy graph", so a corrupt table would have
      // fallen through to a message telling the reader this graph was indexed before the table
      // existed. That is a read failure wearing the known-good case's clothes, in the exact place
      // this unit exists to prevent it, written directly beneath a comment saying not to.
      trustRefs: (() => {
        try { return readTrustClassificationInputs(db); } catch (e) { return { unreadable: e?.message ?? 'unknown error' }; }
      })(),
    }));
    // ⭐ THE SNAPSHOT IS CLOSED HERE. Everything below runs against the lists it returned, never
    // against the database — the git diff, the ignore-rule filtering, the coverage arithmetic. The
    // authority object is CONSTRUCTED from that immutable carrier rather than being read across it,
    // so no reopened handle can contribute a fact from a different graph.
    const { collectionFiles, eligiblePaths, coveredPaths, exts, ...captured } = authority;
    authority = {
      ...captured,
      ...(captured.latestCollection
        ? {
          collectionDecayFacts:
            decayFromCoveredFiles(collectionFiles, captured.latestCollection, head, repoRoot) ?? {},
          liveEligible: eligiblePaths === null ? null : countInCorpus(eligiblePaths, { repoRoot }),
          // ⚠ EMPTY EXTENSIONS MEANS UNANSWERABLE, NOT ZERO — the same rule countInCorpus keeps.
          // `coveredFileCount` refused an empty `exts` before doing anything, and dropping that
          // guard here would turn "we cannot say which files count" into "none of them do".
          covered: (coveredPaths === null || !Array.isArray(exts) || exts.length === 0)
            ? null
            : countInCorpus(coveredPaths, { repoRoot, exts }),
        }
        : {}),
    };
    nodes = authority.nodes;
    edges = authority.edges;
    census = authority.census;
    dbCountsRead = true;
  } catch {
    // fall through with manifest values
  }

  // ⛔ NOTHING COMPARED THE MANIFEST TO THE DATABASE. `writeManifest` renames atomically at the END
  // of a successful index, so an interrupted run leaves the manifest describing the LAST GOOD state
  // while the database holds whatever the killed run managed to write. Observed: click left with 90
  // nodes — Document 43, Directory 25, Config 22 — and zero code nodes, with the file present,
  // opening cleanly, carrying a plausible count, and health reporting it indexed. Every check
  // available read one side or the other, which is several checks sharing one blind spot.
  //
  // ⚠ Positive control, taken on the pinned corpus in the same pass: healthy graphs agree EXACTLY —
  // fmt 6735/14855, click 2572/13618, fast-route 489/1343, p-queue 184/384. A mismatch is signal.
  const capabilitiesIntegrity = dbCountsRead && manifest
    ? {
      manifestNodes: Number.isInteger(manifest.nodes) ? manifest.nodes : null,
      dbNodes: nodes,
      manifestEdges: Number.isInteger(manifest.edges) ? manifest.edges : null,
      dbEdges: edges,
      codeNodes: census.reduce((a, r) => a + (CODE_NODE_TYPE_SET.has(r.type) ? r.c : 0), 0),
    }
    : null;

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
    {
      // ⭐ THE COLLECTION COMES FROM THE AUTHORITY CAPTURE, not a fresh open. lspVerifiedEdges and
      // coverage feed absenceAuthority directly, so reading them at a different instant from the
      // attestation is the exact window this consolidation closes.
      const latest = authority?.latestCollection ?? null;
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
          // From the same pinned instant as the collection itself — see the authority capture.
          ...(authority?.collectionDecayFacts ?? {}),
          collectedAt: latest.collectedAt,
          // ⛔ SCOPE, BECAUSE A COLLECTION EXISTING IS NOT A COLLECTION COVERING ANYTHING.
          // Three states, and `unknown` must never read as `complete`: a collection stored
          // before these columns existed returns null, and null is not evidence of coverage.
          // ⛔ THE DENOMINATOR IS A PROPERTY OF THE CORPUS NOW, NOT OF THE COLLECTION — and
          // storing it froze a moving number. the field test caught this an hour after the fix that
          // corrected it: `eligibleFileCount` was repaired (594 -> 556) and the STORED row still
          // read 593, because the fix reaches rows written AFTER it and health reads the row.
          //
          // ⇒ "A fix is not a rebuild", landing on the artifact corrected an hour earlier. So the
          // ratio is computed against a LIVE count and the stored value is kept beside it as what
          // was true when the collection ran. `filesProcessed` genuinely belongs to the collection;
          // eligibility never did.
          //
          // ⚠ Live count NULL on failure, never 0, and the stored value is the fallback — a
          // denominator we cannot establish is UNKNOWN, and `complete` stays null so health warns
          // rather than asserting coverage over a number it could not compute.
          coverage: (() => {
            const liveEligible = authority?.liveEligible ?? null;
            const eligible = liveEligible ?? latest.filesEligible ?? null;
            // ⛔ AND THE NUMERATOR HAD THE SAME PROBLEM, INTRODUCED BY MY OWN PRUNE GUARDS.
            // `latest.filesProcessed` was a fair proxy while the prune left exactly ONE collection
            // standing — latest WAS everything. Once a continuation and a file-scoped run were both
            // correctly forbidden from superseding, collections accumulated (8 here) and "latest"
            // became the last thing that ran rather than the sum of what is known:
            //
            //     reported     3 of 557     the 3-file targeted collect, which is the latest
            //     actual     553 of 557     across every live collection
            //
            // A true statement about a collection read as a statement about the repository — the
            // same noun error as `filesTotal` being the scope's denominator, three commits after
            // fixing the denominator half of this very ratio.
            const covered = authority?.covered ?? null;
            const processed = covered ?? latest.filesProcessed ?? null;
            return {
              filesProcessed: processed,
              // Kept and named, because "this run did 3" and "the repo has 553" are different
              // facts and a reader chasing a partial collection needs the first one.
              // ⛔ `null` HERE MEANT TWO DIFFERENT THINGS AND A READER COULD NOT TELL THEM APART.
              //
              // the field test, field-testing v0.7.0 on echoes: "filesProcessedLatestCollection null
              // and filesInScopeLatestCollection null. A per-collection disclosure that reads null
              // tells a reader nothing about whether supersession ran."
              //
              // `latest.filesProcessed ?? null` collapses "this collection predates the column, so
              // the value was never stored" into the same `null` a reader would read as "nothing
              // was processed" — while a collection that genuinely processed nothing stores a real
              // 0. Two states, one appearance; and three collections in THIS repo do store 0, so
              // both values occur in practice.
              //
              // ⇒ The distinction goes in the EXISTING Source field rather than a new one.
              // the field test on my last fix: "two booleans to ignore instead of one" — a defect gets
              // one more VALUE in a field a reader already consults, never one more field.
              filesProcessedLatestCollection: latest.filesProcessed ?? null,
              filesProcessedSource: latest.filesProcessed == null
                ? 'unrecorded_at_collection'
                : (covered != null ? 'all_live_collections' : 'latest_collection'),
              // ⚠ RENAMED, NOT ANNOTATED. the field test: three populations now live in five fields —
              // all-live-collections (553), latest-collection (3, twice) and the corpus (557) — and
              // `filesInScope` was the only one not saying which. It is the LATEST collection's
              // scope sitting immediately above a repo-wide `filesEligible`, so the obvious ratio a
              // reader computes is 553/3.
              //
              // ⇒ The name carries it rather than a companion field, because a `Source` string is
              // something a reader has to look up and a suffix is something they cannot miss. Same
              // fix I had just shipped for the other two fields, applied to the third — it was two
              // out of three, which is how a rule ends up half-applied inside its own commit.
              filesInScopeLatestCollection: latest.filesInScope ?? null,
              filesEligible: eligible,
              // Both, always. A single number cannot say whether the corpus grew since the
              // collection or the collection under-covered it, and those want different actions.
              filesEligibleAtCollection: latest.filesEligible ?? null,
              filesEligibleSource: liveEligible != null ? 'measured_now' : 'stored_at_collection',
              complete: (eligible == null || processed == null)
                ? null
                : processed >= eligible,
            };
          })(),
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
    }
  } catch { /* leave codeIntel as not-available */ }

  let storage = { measured: false, reason: 'open_failed' };
  try {
    const db = openExistingDb(dbPath);
    try { storage = inspectStorage(db, dbPath); } finally { db.close(); }
  } catch { /* keep the stated reason — never report a size we could not read */ }

  const trust = computeTrustLevel(trustUnresolvedEdges);

  // Brief-vs-live staleness check. Echoes 2026-04-22 bench saw
  // brief.plan.md say "TRUST weak: 5424 unresolved" while graph_health
  // said "trust=strong (500 unresolved)" at the same moment. Same
  // thresholds, different inputs — brief was cached with an older
  // manifest snapshot. Fix: compare brief's recorded graph_indexed_at
  // against the current manifest.indexedAt; warn when they diverge so
  // consumers know the brief needs regen.
  // ⛔ TWO FACTS, NOT ONE, AND THE SECOND ONE USED TO VANISH.
  //
  // `briefStaleVsManifest` answers "is the brief behind the graph". A parse failure cannot answer
  // it, and the empty catch left `false` standing — so a brief.json that could not be read produced
  // output IDENTICAL to a brief that was perfectly current: no verdict, no next action, nothing.
  //
  // ⚠ THE FLAG ITSELF STAYS FALSE ON A FAILURE, DELIBERATELY. The brief is not KNOWN to be stale,
  // and flipping it would fabricate a fact — the same trap `lsp-evidence.js` records as "a probe
  // failure must not fabricate staleness", which is right about TRUTH. The repair is not to
  // overload one boolean; it is to report the separate fact that the check could not run.
  //
  // ⚠ AND MISSING IS NOT MALFORMED. `existsSync` gates the try, so the catch only ever sees a file
  // that exists and would not parse. A repo that never generated a brief has nothing to report, and
  // saying otherwise would fire on every such repo — the warning wall this project already removed.
  // The old comment said "missing or malformed" and only one of those reaches here.
  let briefStaleVsManifest = false;
  let briefUnreadable = false;
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
    // The file exists and could not be read or parsed — a truncated write is what a full disk
    // leaves behind. Unknown staleness, and an orientation artifact a reader should not rely on.
    briefUnreadable = true;
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
  // ★ A POINTER, NOT THE TEXT. Measured in field testing on e8c8d61: the full warning
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

  // ── POPULATION CENSUS ────────────────────────────────────────────────────────────────────
  //
  // the field test hand-wrote `SELECT type, count(*) FROM nodes GROUP BY type` in THREE separate
  // rounds and it produced a finding every time — four dead declaration types, a 67%-unreachable
  // share, and a repo where 183 `Symbol` nodes existed that whereis can never return. Their
  // verdict on what this verb gave them instead: "nodes=4624 edges=15788 — two numbers that have
  // never once told me anything actionable."
  //
  // ⚠ NOT A NEW VERB (dev's roadmap ruling) and NOT A RAW DUMP. The rule this project measured
  // is that behaviour changes when a field CONTRADICTS the agent's confidence, never when it
  // adds data. `nodes=4624` invites "it knows about 4624 things". The contradiction is the share
  // of the graph the search verbs CANNOT return, and which declaration types are empty. The long
  // tail is counted, not listed, because this verb is called at every session start.
  if (census.length > 0) {
    const TOP = 5;
    const shown = census.slice(0, TOP).map((r) => `${r.type} ${r.c}`).join(' · ');
    const tail = census.length - Math.min(TOP, census.length);
    verdicts.push(`POPULATION: ${census.length} node types — ${shown}${tail > 0 ? ` · +${tail} more` : ''}`);

    // ⛔ GARBAGE A REBUILD CLEARS AT ONCE, and nothing said so.
    //
    // Some External nodes carry parse-fragment labels — `entries()]`, `replace(/g,`,
    // `join(dirOf(docPath),`. A guard refuses to create them.
    //
    // ⭐ THE CAUSE IS NOW ESTABLISHED, AND THIS COMMENT USED TO SAY IT WAS NOT. Two explanations were
    // tested and both failed ("an older extractor left them"; "incremental runs re-mint them from
    // carried-forward refs" — 814 of 818 implausible carried targets are IMPORTS, which never
    // materialise as External nodes). Declining to guess was right, and the third answer came from a
    // different question — not *where did these come from* but *what path reaches them*:
    //
    //   resolveRefs consulted the creation guard ONLY when resolveTarget found nothing, and
    //   buildResolvers queries the nodes table with no type restriction. So refs RE-BOUND to
    //   fragments already present, which refreshed their edges, which starved the orphan sweep.
    //   The residue was self-perpetuating, and a fragment was stickier than a legitimate node.
    //
    // Closed in c0dae75, proven through the real pipeline with the resolver as the only variable.
    // See docs/2026-08-26-a-gate-on-creation-is-not-a-gate-on-the-edge.md.
    //
    // ⛔ AND THE FIX WAS REVERTED THE SAME DAY AFTER REVIEW. The re-binding CAUSE above stands and is
    // proven; the GATE that acted on it did not, because it refused edges on a label pattern that
    // also rejects `operator()`, `save!` and `#private`, and on that path a wrong rejection deletes a
    // real edge. So the residue is self-perpetuating again, by choice: a known bounded defect in
    // place of an unbounded one. The successor must define one admission policy covering creation
    // AND binding, and must not decide it from a stripped label.
    //
    // ⭐ MEASURED 2026-08-26, BEFORE c0dae75 — a dated reading, not a live one, and the numbers have
    // since moved as the residue drains (1,097 / 329 later the same day). With the guard held
    // constant on both sides, so the comparison isolates one
    // variable: this repository's incrementally-maintained graph held 1,104 External nodes with 334
    // fragment labels, while a FULL REBUILD of the same commit produced 769 with ZERO. 338 nodes
    // existed only because the graph had been maintained incrementally, and 334 of those were
    // fragments. Every other node type was reproduced exactly — 0 residue across 4,525 nodes.
    //
    // ⇒ So this is not general staleness; it is confined to External, it is nearly all garbage, and
    // one forced index clears it. Reported as a VALUE in the verdict line a reader already consults,
    // never as a new field, and counted cheaply by label shape rather than by rebuilding anything.
    const fragmentExternals = countFragmentExternals(dbPath);
    if (!fragmentExternals.measured) {
      // ⛔ UNKNOWN UNDER ITS OWN WORDING, never wearing the clean answer's clothes. Silence here is
      // indistinguishable from "this graph has none", and that is the reading a verdict list
      // invites. Say what failed, and say plainly that it is a fact about the read.
      verdicts.push(`stale-externals: NOT MEASURED — the External-label scan could not read this `
        + `graph (${fragmentExternals.reason}). That is a fact about the read, not about the graph: `
        + `it is not evidence that there are none.`);
    } else if (fragmentExternals.count > 0) {
      // ⛔ THIS SENTENCE HAS NOW BEEN WRONG IN BOTH DIRECTIONS, WHICH IS THE LESSON. It first said
      // incremental reindexing does not remove them (true). c0dae75 made that false and it was
      // corrected. That fix was then reverted after review, so it is true again. A claim about
      // behaviour is only as durable as the behaviour, and this one changed twice in a day.
      //
      // ⚠ AND THE NOUN IS NOW WEAKER ON PURPOSE. The count is a LABEL-SHAPE classification, and
      // review showed the same pattern rejects `operator()`, `save!`, `#private` and `@scope/pkg`.
      // Most of what it counts here is genuine parse residue, but "parse-fragment labels ... can
      // never resolve" asserted more than a shape check can support, so the wording now says what
      // was actually measured and admits what it cannot separate.
      verdicts.push(`stale-externals: ${fragmentExternals.count} External nodes carry labels that are not `
        + `plausible symbol names (e.g. "entries()]"). A full rebuild of this same commit produces `
        + `none, so they inflate counts without adding reach. Incremental reindexing does NOT remove `
        + `them — run graph_index(force=true) to clear. `
        + `⚠ Counted by label shape, which can also flag legal names such as C++ operator() or Ruby `
        + `save! — on a C++ or Ruby repository treat this as a pointer to check, not a defect count.`);
    }

    const searchable = new Set(SEARCH_TYPES);
    const unreachable = census.filter((r) => !searchable.has(r.type)).reduce((a, r) => a + r.c, 0);
    const totalNodes = census.reduce((a, r) => a + r.c, 0);
    if (unreachable > 0 && totalNodes > 0) {
      const pct = Math.round((unreachable / totalNodes) * 100);
      verdicts.push(`⚠ ${unreachable} of ${totalNodes} nodes (${pct}%) are in types graph_whereis `
        + 'cannot return — it matches declaration types only, so those are reachable via '
        + 'graph_search(kind="all") or graph_packet, never by name lookup');
    }

    // Scoped to its cause, like every other disclosure here: a searched type with zero nodes
    // cannot match, so asking about one is guaranteed to fail. When none is empty this says
    // nothing, because a census that always warns is a census nobody reads.
    const present = new Set(census.map((r) => r.type));
    const emptyDecl = SEARCH_TYPES.filter((t) => !present.has(t));
    if (emptyDecl.length > 0) {
      verdicts.push(`⛔ ${emptyDecl.length} of ${SEARCH_TYPES.length} declaration types have zero `
        + `nodes here (${emptyDecl.join(', ')}) — a symbol of those kinds cannot be found by name`);
    }
  }

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
          // (the field test, echoes, 2026-07-30). Same defect family the zero-result
          // work removed — we told someone to do something without checking they
          // could — just on the ACTION side rather than the diagnosis side.
          //
          // So the recipe is now offered only when its toolchain exists, and the
          // WSL fallback is promoted to primary when it does not.
          // THE RECIPE MUST BE RUNNABLE AS WRITTEN, not merely correct in outline.
          //
          // The earlier one-liner (`-DCMAKE_CXX_COMPILER=clang-cl` alone) FAILS on a
          // standard Windows host, for two reasons a field tester hit in sequence
          // (the field test, echoes, 2026-07-30):
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
          // the hard way (the field test, echoes, 2026-07-30):
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
            // Field-walked end to end (the field test, echoes, 2026-07-30). A Ninja
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
          // reasonably assumed they were the same thing (the field test, 2026-07-30).
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
      : `trust=${trust} (${trustUnresolvedEdges} trust-relevant unresolved of ${unresolvedEdges} total — see trustBasis.basis)`,
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
    // ⛔ THIS READ THE SIDECAR BY PATH, NOT THROUGH THE SIDECAR MODULE. A search for consumers by
    // import name found three call sites and missed this one entirely, so it would have been left
    // reading a file nothing writes any more — enumerate by FILENAME, not by importer.
    //
    // ⭐ AND `edges.length > 0` WAS A REAL DEFECT. A full set that is legitimately EMPTY fell
    // through to the sample path and was reported with "dirty-edges.full.json is missing" — a
    // file-absence story told about a graph with genuinely zero unresolved refs. null (legacy, we
    // do not know) and [] (committed, nothing unresolved) are different answers, and the table is
    // the first thing here able to tell them apart.
    // ⛔ THIS OPENED ITS OWN HANDLE, AFTER THE PINNED CAPTURE HAD CLOSED. One health response could
    // then carry an authority verdict read at generation N beside the explanation of its own trust
    // denominator read at N+1 — two true statements about two graphs, printed as one. The rows now
    // come from the same capture as the publication that attests them, and the CLASSIFICATION runs
    // here, outside the snapshot: nothing is classified while pinned.
    //
    // ⚠ `undefined` is not `null` here. `authority.trustRefs` is null for a legacy graph (no table)
    // and an ARRAY for any graph that has one, including an empty one. undefined means the capture
    // itself failed, which is the manifest-fallback path below, not a legacy graph.
    const storedRefs = authority?.trustRefs ?? null;
    if (storedRefs && !Array.isArray(storedRefs)) {
      // Present and unreadable. Under its OWN wording — not the legacy story below, which would
      // tell the reader this graph predates a table it demonstrably has.
      return {
        total_unresolved: null,
        trust_relevant: null,
        excluded: null,
        classification: 'UNREADABLE',
        consequence: `the unresolved_refs table EXISTS but could not be read (${storedRefs.unreadable}), `
          + 'so none of the unresolved refs could be classified and the trust verdict above is a '
          + 'FLOOR, not a measurement. This is a fact about the read, not about the graph, and it is '
          + 'NOT the same as a graph indexed before the table existed.',
        remedy: 'run graph_index({ force: true }) to rewrite the table, then re-read this field.',
      };
    }
    if (storedRefs !== null) return explainTrustExclusions(storedRefs);
    const sample = manifest?.dirtyEdges ?? [];
    const basis = explainTrustExclusions(sample);
    if (!basis) return null;
    return {
      ...basis,
      computed_over: 'SAMPLE',
      sample_size: sample.length,
      true_total: unresolvedEdges,
      // ⚠ THE REASON HAD TO CHANGE WITH THE MECHANISM. This said "dirty-edges.full.json is
      // missing", naming a file that is no longer written — a reader who went looking for it would
      // have found a stale one or nothing, and either way learned the wrong thing about why the
      // number is a floor. The population now lives in the graph, so the honest reason is that this
      // graph predates the table.
      sample_warning:
        'this graph has no unresolved_refs table (indexed before it existed), so this breakdown was '
        + `computed over the manifest's ${sample.length}-edge SAMPLE of ${unresolvedEdges} — the `
        + 'proportions may not hold and the counts definitely do not. '
        + 'Re-run graph_index to publish the full set into the graph.',
    };
  })();
  // ★ status:'ok' MEANS THE RUN FINISHED, NOT THAT IT READ EVERYTHING.
  //
  // The indexer deletes a file's nodes BEFORE re-extracting it, so a read or parse
  // failure leaves that file ABSENT from the graph rather than merely un-updated —
  // and the run still reports ok. An agent then asks "who calls X", gets a confident
  // answer computed over a corpus missing those files, and has no way to know.
  //
  // This is the one verdict that must not be conditional on `stale`: a fresh index
  // with holes is MORE dangerous than a stale one, because staleness is already
  // reported and holes were not.
  const skippedCount = Number(manifest.skippedFileCount ?? 0);
  if (skippedCount > 0) {
    // ⛔ THE CODE IS RENDERED, NOT JUST THE PHASE. An extractor REFUSAL (a duplicate symbol site —
    // our defect, and one an agent must not read as normal) and a syntax error in a vendored file
    // are both "extract" phase. Without the code they are the same line to a reader, which is the
    // typed reason dying one frame short of anyone who could act on it.
    const sample = (manifest.skippedFiles ?? []).slice(0, 3)
      .map((s) => `${s.file} (${s.phase}${s.code ? `: ${s.code}` : ''})`).join(', ');
    verdicts.push(
      `⛔ INCOMPLETE CORPUS — ${skippedCount} file(s) were DELETED from the graph and could not be re-extracted, `
      + `so any "not found" / "no callers" result may be an artefact of the hole rather than a fact about the code. `
      + `First: ${sample}${skippedCount > 3 ? ` (+${skippedCount - 3} more, see manifest.skippedFiles)` : ''}. `
      + `Fix the file(s) or re-run graph_index; do NOT treat exhaustive results as exhaustive until this is zero.`,
    );
  }
  // ★ RENAMED FROM `rebuild-incomplete`, WHICH IT NEVER DETECTED.
  //
  // the field test, 2026-08-11, meeting a falsifier I had written for myself: this verdict is
  // keyed on `manifestStatus` ALONE and cannot see `skippedFileCount`. On a genuinely
  // incomplete corpus — a file deleted from the graph and not re-extracted, its symbols
  // unfindable — status was 'ok', so the one line whose name promises to report an
  // incomplete rebuild said nothing.
  //
  // The field is not wrong; the CONSUMER was. `status` reports whether the run FINISHED,
  // and I had defended keeping it that way. But a field named `rebuild-incomplete`
  // reading a build-completion flag is exactly the stand-in this project keeps producing:
  // the name promised corpus completeness and the value only ever meant process
  // completion. Renamed to what it actually detects, so nothing can misread it again.
  // Corpus completeness is the INCOMPLETE CORPUS verdict above, which is precise.
  //
  // ⚠ Two other consumers read status without the count — read_freshness.js and
  // status.js, which re-exports it as `manifestStatus` for anyone downstream. Neither
  // claims completeness in its name, so neither is renamed; flagged here so the next
  // reader knows the audit happened rather than was skipped.
  if (manifestStatus !== 'ok') verdicts.push(`previous-run-did-not-finish: status=${manifestStatus} (run graph_index(force=true))`);
  // ⛔ THE CASE THE LINE ABOVE CANNOT SEE. `manifestStatus` comes from the manifest, and an
  // interrupted index never rewrites the manifest — so the run that failed hardest is the one that
  // leaves status='ok'. This reads the DATABASE instead and reports the disagreement.
  if (capabilitiesIntegrity && graphCapabilities({ indexed: true, integrity: capabilitiesIntegrity }).reason === 'index_incomplete') {
    verdicts.push(`index-incomplete: the manifest describes ${capabilitiesIntegrity.manifestNodes} nodes `
      + `but the database holds ${capabilitiesIntegrity.dbNodes}, and none of them is code. A previous `
      + `index did not finish writing. Run graph_index(force=true); until then every answer, `
      + `orientation included, is a floor.`);
  }
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
  // the field fleet, field-testing on a repo nobody tuned this against: "It told me the
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
    // How far behind, in commits — the number the field fleet was given ("44 commits
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
        // ⛔ THE FILE COUNT IS A DIFFERENT POPULATION FROM THE EDGE COUNT, and the coverage warning
        // was answering an EDGES question with a RECORDS number for want of it. `[lsp✓]` renders
        // from `edges.provenance` alone (renderer.js, trace.js), so the files carrying a verified
        // edge are the only files the marker can ever appear on. Read from the SAME handle at the
        // SAME instant as `verified` above — a second open is a second graph.
        //
        // ⚠ NULL WOULD BE A LIE HERE AND ZERO WOULD NOT: this block runs only when a collection is
        // available, and the COUNT cannot fail without the query beside it failing too, in which
        // case the catch below leaves the field undefined and the sentence says UNKNOWN.
        codeIntel.lspVerifiedFiles = db2.get(
          "SELECT COUNT(DISTINCT source_file) AS c FROM edges WHERE provenance = 'LSP_VERIFIED'",
        ).c ?? 0;

        // ★ ATTACK EIGHT — THE DENOMINATOR WAS CONTAMINATED WITH EDGES THAT ARE
        //   UNVERIFIABLE IN PRINCIPLE.
        //
        // the field test, on the headline coverage number I had been quoting to him
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
        // the field test caught this in the attack-eight FIX, one commit old. Making
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

        // ⛔ THE NUMERATOR AND DENOMINATOR ARE COUNTED FROM THE SAME ROWS, DELIBERATELY.
        //
        // They used to come from separate queries: `verified` was every LSP_VERIFIED edge in the
        // database (any relation, repo-wide) while the denominator was in-scope C++ CALLS edges.
        // graph_health then published `lspVerifiedPctOfVerifiableInScopeCalls: 4995` — 949/19.
        //
        // Counting `v` here makes the numerator a SUBSET of the denominator by construction rather
        // than by agreement between two queries nobody diffed. The bad state is unconstructible
        // instead of merely guarded, and the guard in computeCoverage is the second line of defence.
        const byLang = db2.all(
          `SELECT COALESCE(NULLIF(n.language, ''), '(unknown)') AS lang,
                  COALESCE(NULLIF(n.file_path, ''), '') AS fp,
                  COUNT(*) AS c,
                  SUM(CASE WHEN e.provenance = 'LSP_VERIFIED' THEN 1 ELSE 0 END) AS v
             FROM edges e JOIN nodes n ON n.id = e.from_id
            WHERE e.relation = 'CALLS' GROUP BY lang, fp`,
        ).reduce((acc, r) => {
          // Unknown tracking state is NOT in-scope — same fail-closed default as
          // truncation and worktree cleanliness. If git could not be read we say
          // scope is unknown rather than assuming everything counts.
          const inScope = trackedFiles == null ? null : trackedFiles.has(r.fp);
          const key = `${r.lang}\x00${inScope}`;
          acc.set(key, { lang: r.lang, inScope,
            c: (acc.get(key)?.c ?? 0) + r.c,
            v: (acc.get(key)?.v ?? 0) + (r.v ?? 0) });
          return acc;
        }, new Map());
        const langScopeRows = [...byLang.values()];
        const outOfScope = langScopeRows.filter((r) => r.inScope === false);
        const inScopeRows = langScopeRows.filter((r) => r.inScope !== false);
        // ⛔ THIS WAS A SECOND, HAND-MAINTAINED COPY of the verifiable-language set, and it drifted
        // exactly as a duplicate does: hardcoded to C++ while the server grew TypeScript and Python
        // backends. Now imported from coverage-denominator.js, which derives it from BACKENDS.
        // Verifiable AND in-scope. Out-of-scope edges never enter the denominator,
        // and — the point of attack nine — never MIGRATE into it when a backend
        // for their language lands.
        const verifiable = inScopeRows.filter((r) => isLspVerifiableLanguage(r.lang)).reduce((a, r) => a + r.c, 0);
        const unverifiable = inScopeRows.filter((r) => !isLspVerifiableLanguage(r.lang));

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
        // the field test, 2026-08-09, from having made the mistake himself: a caveat
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
        // ★ Computed by the extracted, unit-tested `computeCoverage`. It was inline here,
        // which is why the only guard on it was eight regexes over this file — every one
        // asserting spelling, none able to fail on a wrong number, on a statistic whose
        // entire failure mode IS a wrong number.
        // The verified count for THIS population — in-scope, LSP-verifiable, CALLS — not the
        // repo-wide edge total, which is a different noun and is reported separately as
        // `lspVerifiedEdges`.
        const verifiedInScopeCalls = inScopeRows
          .filter((r) => isLspVerifiableLanguage(r.lang))
          .reduce((a, r) => a + (r.v ?? 0), 0);
        const coverage = computeCoverage(langScopeRows, verifiedInScopeCalls);
        const verifiedPct = coverage.pct;
        codeIntel.lspVerifiedInScopeCalls = verifiedInScopeCalls;
        if (coverage.pctUnavailableReason) {
          codeIntel.lspVerifiedPctUnavailableReason = coverage.pctUnavailableReason;
        }
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
              .map((r) => ({ language: r.lang, edges: r.c, reason: 'no_lsp_backend_for_language — no LSP backend in this server can verify it' })),
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
          // server (the field test, echoes, 2026-07-30):
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
        // the field test watched this happen with a before-image (2026-07-31). An
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
        // the field test measured it on the fresh collect: coverageFloorCause reported
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
  // ⛔ FIRST among the verdicts, because it says how to read the ones after it. `dirty=0` and a
  // missing `stale` verdict are the healthy tree's output; they are also the failed query's
  // output. This is the only line that separates them.
  for (const disclosure of worktree.disclosures()) {
    verdicts.push(`worktree-unobserved: ${disclosure}`);
  }
  if (briefStaleVsManifest) {
    verdicts.push('brief-stale: regenerate with graph-brief.mjs');
  }
  // Beside its sibling on purpose: the two answer the same question about the same file and
  // splitting them across the function is how one of them drifts back to silence.
  if (briefUnreadable) {
    verdicts.push('brief-unreadable: brief.json exists but could not be parsed — its staleness is UNKNOWN; regenerate with graph-brief.mjs');
  }
  if (unresolvedCategorizationStaleVsManifest) {
    verdicts.push('categorization-stale: regenerate via graph_index()');
  }

  const _nextActions = buildNextActions({
    codeIntel, overlay, overlayQuality, artifactAges, stale, trust,
    briefStaleVsManifest, trustUnresolvedEdges,
  });

  // ⛔ `trust` DOES NOT MEAN "AN EDGE WAS COMPILER-CHECKED", AND THE HEADLINE WAS CONTRADICTING THE
  // WARNING BELOW IT. Measured on third-party repositories:
  //
  //     fast-route (PHP)  0 verified edges       -> trust "strong"
  //     fmt (C++)         0 verified edges       -> trust "ok"
  //     click (Python)    1,410 verified (10.4%) -> trust "weak"
  //
  // `computeTrustLevel` is a function of unresolved-edge count alone — a real measure of how
  // completely extraction resolved its own references, and silent on evidence tier. So the repo
  // with no spine reports the strongest trust, and PHP reports "strong" permanently because no PHP
  // language server exists for it to fail.
  //
  // `nextActions` already carries the correct warning. But a reader who believes the headline never
  // reaches the correction, and this project's own finding is that behaviour changes only when a
  // field CONTRADICTS an agent's confidence — here the contradiction pointed the wrong way.
  //
  // ⇒ Capabilities are reported SEPARATELY rather than folded into one word. `trust` keeps its
  // meaning; `capabilities.absenceAuthority` answers the question that deletes code.
  // ⛔ THE LANGUAGE MUST COME FROM THE GRAPH, NOT THE COLLECTION RECORD, AND EXECUTING THIS CAUGHT
  // IT. `codeIntel.language` is only populated AFTER a collection has run — so on a fresh PHP repo
  // it is null, the "no language server" branch never fires, and the reader is told to run a
  // collection that cannot possibly help them.
  //
  // ⇒ The fact that matters BEFORE a collection was only knowable AFTER one. The graph already
  // holds a language per node, so it can answer before anything is collected.
  // From the same capture as the evidence it describes. dominantGraphLanguage(dbPath) opened its own
  // handle, so the language qualifying a caller set could come from a different graph than the set.
  const primaryLanguage = codeIntel?.language ?? authority?.language ?? null;
  const capabilities = graphCapabilities({
    integrity: capabilitiesIntegrity,
    indexed: true,
    compilerVerifiedEdges: codeIntel?.lspVerifiedEdges ?? 0,
    collectionAvailable: codeIntel?.available === true,
    coverage: codeIntel?.coverage ?? null,
    // The collection's own commit against HEAD. Null when either is unknown, which denies absence
    // authority rather than assuming currency.
    collectionCurrent: (codeIntel?.indexedCommit && head)
      ? codeIntel.indexedCommit === head
      : null,
    collectionFilesCovered: codeIntel?.filesCovered ?? null,
    collectionFilesChanged: codeIntel?.filesChangedSinceCollection ?? null,
    language: primaryLanguage,
    languageHasServer: languageHasLspBackend(primaryLanguage),
    // ⭐ THE PUBLICATION COMPARISON — one integer from the database against one from the manifest.
    //
    // ⚠ THE ORDER IS THE POINT. The manifest was read before this database read, so a rebuild
    // committing in between shows up as a MISMATCH and denies authority. Reading the manifest AFTER
    // the database would silently absorb that commit and report a graph that agrees with itself
    // only because the two reads straddled the publication.
    //
    // ⚠ AND THE LIMIT, STATED. This pins nothing but its own read: graph_health opens a fresh
    // handle for each of its sections, so its counts elsewhere are not inside this snapshot. That
    // is tolerable HERE because health reports rather than claims absence — the verbs that answer
    // "no callers" are the ones that must wrap their whole read in withExistingSnapshot, and they
    // are a separate change. Saying so beats implying a consistency this call does not provide.
    // ⚠ When the capture itself failed there is no publication to compare, and that is not an
    // attested graph. undefined flows to LEGACY_UNATTESTED, which denies.
    attestation: attestationFrom(authority?.publication, manifest, manifestLoad.status === 'ok'),
  });

  return {
    indexed: true,
    trust,
    // ⚠ Placed immediately after `trust` on purpose: the two are read together or the separation
    // achieves nothing.
    capabilities,
    unresolvedEdges,
    trustUnresolvedEdges,
    ...(stalenessImpact ? { stalenessImpact } : {}),
    ...(trustBasis ? { trustBasis } : {}),
    // Always present, trip or no trip — see inspectStorage() for why the quiet case is
    // reported too.
    storage,
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
    // verbs is how a reader learns to guess instead of read (the field test, on the
    // first health response from the new build).
    //
    // The count is the better datum, so it is kept — under a name that says what it
    // is — and the boolean is provided alongside so the shape matches its siblings.
    // trackedDirtyFiles was capped with NO truncation signal at all, which is the
    // same defect one step further along; it gets both fields too.
    // ★ WHEN NOTHING TRACKED IS DIRTY, THE SAMPLE IS PURE NOISE.
    //
    // Measured (the field test, 2026-08-09) on echoes: 25 sampled entries costing 537
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
          // ⛔ IT USED TO CALL THEM "untracked build/backup residue" — a claim about what these
          // files ARE, made without looking at one of them. Measured 2026-09-03: an agent that
          // writes three new SOURCE files and has not committed them yet lands in exactly this
          // branch and is told its own work is residue, with the names withheld.
          //
          // ⚠ AND THE ACTIONABLE FACT WAS MISSING. Untracked files are deliberately NOT indexed by
          // an incremental run (`shouldDeferUntrackedFreshness`), so those three files are absent
          // from the graph — and a query about one answers a bare `NO MATCH`. "trust: strong" with
          // a new source file invisible is exactly the shape this verb exists to prevent.
          //
          // Names stay omitted: that part was right, an untracked set can run to thousands.
          //
          // ⚠ THE LENGTH IS DELIBERATE AND WAS MEASURED — do not trim it on sight. 383B rendered,
          // which looks alarming next to the 359B absence clause that had to be cut on this same
          // day. It is not comparable: measured 2026-09-03, this note is 8.0% of a 4,760B health
          // response, against 79% of a 96-byte NO MATCH. Controls in the same pass: a clean tree
          // emits no note at all (0B), and the note rendered when dirty.
          // ⇒ Absolute size was the wrong noun here. A diagnostic verb's job is detail, and 8% of
          // it is not the warning wall.
          ? `${dirtyFiles.length} dirty file(s), none of them tracked by git — names omitted because an untracked set is often build output and can run to thousands. ⚠ UNTRACKED FILES ARE NOT INDEXED until committed, so a source file you have just created is counted here and is NOT in the graph; commit it, or run graph_index({ force: true }), before asking about it. Nothing tracked has moved under the snapshot.`
          : undefined,
      }),
    dirtyFilesTotal: dirtyFiles.length,
    // ★ THE OMITTED-COUNT MUST MATCH WHAT WAS ACTUALLY PRINTED.
    //
    // Introduced by me the same day I suppressed the name list, and caught by
    // the field test one commit later: it kept subtracting DIRTY_LIST_CAP, so on echoes
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
    // ⛔ WITHOUT THIS FIELD EVERY COUNT ABOVE IS A LIE ON THE FAILURE PATH. dirtyFilesTotal: 0 and
    // trackedDirtyFilesTotal: 0 are the exact bytes a genuinely clean tree produces, so a reader —
    // human or agent — cannot tell a measured zero from a query that never ran. Present ONLY when
    // something could not be observed, so the healthy response is byte-identical to before.
    ...(worktree.disclosures().length > 0
      ? { worktreeObservationFailed: worktree.disclosures() }
      : {}),
    commit: manifest?.commit ?? null,
    currentHead: head,
    stale,
    manifestStatus,
    briefStaleVsManifest,
    briefUnreadable,
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
    // Field accounting (the field test, 2026-07-30): "I used 2 verbs out of ~17. I never
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
