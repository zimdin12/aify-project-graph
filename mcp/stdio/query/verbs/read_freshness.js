import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureFresh } from '../../freshness/orchestrator.js';
import { WorktreeState } from '../../freshness/worktree-state.js';
import { loadManifest } from '../../freshness/manifest.js';
import { openExistingDb, captureExistingSnapshot } from '../../storage/db.js';
import { ATTESTATION, classifyAttestation, readGraphPublication } from '../../storage/publication-schema.js';
import { SCHEMA_VERSION } from '../../storage/schema.js';
import { staleProcessWarning, staleProcessBlocker } from '../../server-build.js';
import { hasLanguageConfig } from '../../ingest/languages/index.js';

// Count commits between the indexed snapshot and current HEAD using the same
// indexed-commit → HEAD basis graph_health uses for its `stale` verdict. We
// shell `git rev-list --count <indexed>..HEAD` (windowsHide, stderr ignored)
// rather than re-deriving from the manifest. Returns null when the count can't
// be computed (no git, unknown commit, shallow clone) — callers then fall back
// to a count-free "behind HEAD" caveat rather than a wrong number.
export function commitsBehindHead(repoRoot, indexedCommit, head) {
  if (!indexedCommit || !head || indexedCommit === head) return null;
  try {
    const out = execFileSync(
      'git',
      ['-C', repoRoot, 'rev-list', '--count', `${indexedCommit}..${head}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    ).trim();
    const n = Number.parseInt(out, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

// Build the loud staleness caveat appended to a NOT-FOUND result when the index
// is behind HEAD. Ties the absence to staleness so agents don't read a stale
// "not found" as proof a symbol doesn't exist. Kept to two lines. Returns ''
// when the index is fresh (no caveat → no noise on the happy path).
export function staleNotFoundCaveat(freshness) {
  if (!freshness) return '';
  // ⛔ THE UNKNOWN GETS ITS OWN CAVEAT, and it is NOT the stale one. `stale === null` means the git
  // query that would have established staleness never ran, so this verb cannot say the index is
  // behind — and equally cannot let a not-found stand unqualified. Falling through to `return ''`
  // here (what `!freshness.stale` used to do, since `!null` is true) hands the reader a bare
  // "not found" backed by a check that did not happen.
  if (freshness.stale === null || freshness.stale === undefined) {
    return [
      'NOTE: index staleness could NOT be determined (the git query failed), so this "not found" is',
      'not proof the symbol does not exist. Run graph_health() to see why, then graph_index().',
    ].join('\n');
  }
  const uncommitted = uncommittedSourceClause(freshness);
  if (!freshness.stale) return uncommitted;
  const n = freshness.commitsBehind;
  const behind = n != null
    ? `${n} commit${n === 1 ? '' : 's'} behind HEAD`
    : 'behind HEAD';
  return [
    `NOTE: index is ${behind} — this symbol may be newly added but not yet indexed.`,
    'Run graph_index() and retry; a "not found" here is NOT proof the symbol does not exist.',
    // Both facts, never one standing in for the other: a repo can be behind HEAD AND hold
    // uncommitted sources, and they are fixed by different actions.
    uncommitted,
  ].filter(Boolean).join('\n');
}

/**
 * The uncommitted-source half of a not-found caveat.
 *
 * ⛔ THE GAP THIS CLOSES, MEASURED 2026-09-03. A `graph_callers` for a symbol that does not resolve
 * returns `NO MATCH for "X". Try graph_search(...)` and NOTHING else — the freshness warnings that
 * every non-empty result carries are dropped on the absence path in callers/callees/impact, which
 * return the caveat directly without prefixReadWarnings. Verified against running code with a
 * positive control: the same repo, same dirty tree, queried for a symbol that EXISTS, returned
 * "SNAPSHOT WARNINGS - working tree has 1 modified tracked file"; the not-found returned none.
 *
 * So an agent that writes a file and asks about a symbol in it is told the symbol does not exist,
 * with no hint that its own uncommitted work is outside the snapshot. Grep would have found it —
 * this is one of the few places the graph is strictly WORSE than the tool it competes with, which
 * is why it earns its bytes.
 *
 * ⚠ ONLY ON AN ABSENCE. This is not a staleness warning and must not become one: the 592-untracked
 * field report is what taught this repo that a warning on every read is noise. It is silent unless
 * a not-found is being returned AND uncommitted SOURCE files exist to explain it.
 *
 * ⛔ SILENT ON UNKNOWN, not reassuring. `uncommittedSources === null` means the tree was never
 * observed; saying nothing is honest, and the stale===null branch above already tells the reader
 * that a check did not happen.
 */
export function uncommittedSourceClause(freshness) {
  const files = freshness.uncommittedSources;
  // ⛔ null IS A MEASUREMENT THAT FAILED, AND IT USED TO READ AS SILENCE. A mutant that made an
  // unobserved tree report `[]` instead of `null` SURVIVED the first version of this test file,
  // because both produced the same empty string — the distinction the producer works to preserve
  // died one function later.
  //
  // ⚠ AND THE SILENCE WAS WRONG ON ITS OWN TERMS. `git status` and `git rev-parse HEAD` fail
  // INDEPENDENTLY: status can break on an index.lock while HEAD answers fine. Then `stale` is a
  // measured `false`, the staleness branch above stays quiet, and the "dirty state unknown" warning
  // does not reach this path either — warnings are dropped on a not-found. A reader got a bare
  // NO MATCH backed by a check that never ran, which is the same defect this whole clause exists
  // to remove, one level further in.
  //
  // `undefined` stays silent: that is a caller who never set the field, not a failed observation.
  if (files === null) {
    return 'NOTE: the working tree could not be read (the git query failed), so uncommitted files '
      + 'cannot be ruled out as the reason this was not found. Run graph_health() to see why.';
  }
  if (!Array.isArray(files) || files.length === 0) return '';
  const SHOWN = 3;
  const shown = files.slice(0, SHOWN).map((f) => `${f.path} (${f.why})`).join(', ');
  const more = files.length > SHOWN ? `, +${files.length - SHOWN} more` : '';
  // ⛔ THIS WAS 359 BYTES AND I MEASURED IT ONLY AFTER SHIPPING IT. Against a 96-byte NO MATCH the
  // caveat was 78.9% of the answer, and 41-46% of an empty-set answer — next to the 445-byte
  // warning wall this project already had to tear out, whose lesson was that a caveat everyone
  // skims protects nobody. I had argued at length that it was TRUE and never asked what it COST.
  //
  // ⇒ Three things are load-bearing and all three survive: WHICH files (the part that turns a doubt
  // into something checkable), their state, and a remedy that can change the answer. What went is
  // the sentence explaining the mechanism — an agent does not need to know why an untracked file is
  // not indexed, only that it is not. Compressed to four words.
  return `NOT COVERED: ${shown}${more} — uncommitted, so not indexed. `
    + 'Commit or graph_index({force:true}) before treating this as absent.';
}

// ⛔ A BLOCKER RETURNED AS A STRING IS INDISTINGUISHABLE FROM DATA, AND A CONSUMER WILL LAUNDER IT.
//
// Reviewer executed this against an EMPTY graph with manifest status:indexing — a first index in
// flight. `graph_packet` bypasses inspectReadFreshness, called `graph_consequences`, received the
// GRAPH REBUILD INCOMPLETE text, and filed it down the "any informative string is ambiguity" branch:
//
//     SYMBOL: newSymbol
//     STATUS: known to graph; AMBIGUOUS — feature mapping NOT CHECKED
//
// There is no such symbol. A refusal became a positive existence claim, at the moment the graph knew
// least. This repository has now hit that exact shape twice, so the predicate lives HERE, beside the
// banners it matches, and both sides share one literal instead of a copy that drifts.
export const FRESHNESS_BLOCKER_BANNERS = Object.freeze([
  'GRAPH REBUILD INCOMPLETE',
  'GRAPH SCHEMA MISMATCH',
  // ⛔ A DISTINCT BANNER, NOT A REUSED ONE. `graph_packet` files a refusal it cannot parse as a
  // FINDING — the defect that produced "STATUS: known to graph" from a refusal — so every blocker
  // has to be recognisable by `isFreshnessBlockerText`. Adding a message without adding its banner
  // is how a refusal becomes data again.
  'GRAPH UNATTESTED DURING REBUILD',
]);

export function isFreshnessBlockerText(value) {
  return typeof value === 'string'
    && FRESHNESS_BLOCKER_BANNERS.some((banner) => value.includes(banner));
}

// ⚠ EACH STATE KEEPS ITS OWN WORDING, because each says something different about what the reader
// would have been handed. Collapsing them would tell a reader with a torn publication that their
// graph is merely old.
function buildUnattestedRebuildMessage({ verbName, attestation, alreadyIndexedFiles = null }) {
  const why = attestation === ATTESTATION.LEGACY_UNATTESTED
    ? 'this graph has no publication record, so the snapshot underneath the rebuild cannot be '
      + 'confirmed complete — it was last written by an ordering that could leave a partial graph behind'
    : attestation === ATTESTATION.NEVER_COMPLETED
      ? 'this graph has never completed a publication (generation 0), so there is no previous '
        + 'snapshot to serve — only an empty one'
      : attestation === ATTESTATION.GENERATION_MISMATCH
        ? 'the database and the manifest name DIFFERENT generations, so the snapshot underneath the '
          + 'rebuild is not the one the manifest describes'
        : attestation === ATTESTATION.MANIFEST_UNUSABLE
          ? 'the graph manifest could not be read (missing or corrupt), so the snapshot underneath '
            + 'the rebuild cannot be compared against anything that claims to describe it'
          : 'the publication state of this graph could not be established, so the snapshot underneath '
            + 'the rebuild cannot be confirmed complete';
  const scope = alreadyIndexedFiles == null
    ? ''
    : ` The previous snapshot holds ${alreadyIndexedFiles} files, but its completeness is exactly what cannot be checked.`;
  return [
    `${FRESHNESS_BLOCKER_BANNERS[2]} — ${verbName} is deferred until the rebuild finishes.`,
    `${why}.${scope}`,
    'An ATTESTED graph is served from its previous snapshot during a rebuild, so this is not a '
      + 'blanket refusal: it lifts permanently as soon as one rebuild publishes a generation.',
    'Retry after the rebuild completes.',
  ].join('\n');
}

function buildIncompleteMessage({ verbName, alreadyIndexedFiles = null, pendingFiles = null }) {
  const scope = pendingFiles == null
    ? (alreadyIndexedFiles == null
        ? 'The current graph snapshot is incomplete.'
        : `${alreadyIndexedFiles} files already indexed; pending file count skipped to keep this read fast.`)
    : `${alreadyIndexedFiles ?? 0} files already indexed, ${pendingFiles} still pending.`;

  return [
    `${FRESHNESS_BLOCKER_BANNERS[0]} — ${verbName} is deferred to avoid mutating the graph during a read.`,
    scope,
    'Run graph_index(force=true) before relying on live cross-file graph answers on this repo.',
    'Until then, use briefs/static artifacts for orientation and verify in source files.',
  ].join('\n');
}

function buildSchemaMismatchMessage({ verbName, schemaVersion }) {
  return [
    `${FRESHNESS_BLOCKER_BANNERS[1]} — ${verbName} only reads completed snapshots and will not auto-migrate them.`,
    `Graph schema=${schemaVersion ?? 1}, runtime schema=${SCHEMA_VERSION}.`,
    'Run graph_index(force=true) to rebuild this repo on the current schema.',
  ].join('\n');
}

// ⛔ EVERY RETURN FROM inspectReadFreshness HAS THE SAME SHAPE, BECAUSE THE ALTERNATIVE ALREADY
// BROKE. This function has five exits. Two of them carry a `blocker`, so callers stop and never
// look further. The other three set `blocker: null` and callers PROCEED — and those three used to
// omit `dirtyFiles`, `dirtyFilesKnown` and `stale` entirely.
//
// That was survivable only while each verb ran its own `git status`. The moment four of them
// switched to reading the shared observation, `freshness.dirtyFiles.includes(...)` on a repo with
// no graph.sqlite became a TypeError. Caught by a control on the first run, not in the field.
//
// ⇒ The defaults are not padding, they are the honest values for those paths: git was NEVER RUN
// there, so `dirtyFilesKnown` is false and `stale` is null. A caller that lands on one of those
// exits is correctly told the tree was not observed, rather than handed a confident empty list.
function freshnessResult(fields) {
  return {
    blocker: null,
    warnings: [],
    head: null,
    dirtyFiles: [],
    // false, not true: these exits do no git work at all. See the note above.
    dirtyFilesKnown: false,
    stale: null,
    commitsBehind: null,
    // ⛔ null, NOT []. Same rule as `dirtyFilesKnown`: these exits ran no git query, so they cannot
    // report that nothing uncommitted exists. `staleNotFoundCaveat` treats null as "unknown" and
    // stays silent rather than certifying an absence it never measured.
    uncommittedSources: null,
    manifest: null,
    ...fields,
  };
}

export async function inspectReadFreshness({ repoRoot, verbName }) {
  const graphDir = join(repoRoot, '.aify-graph');
  const dbPath = join(graphDir, 'graph.sqlite');

  // ⛔ FIRST, BEFORE THE GRAPH IS TOUCHED AT ALL. A stale process is not a condition on this
  // repository, it is a condition on the running code — including the code that decides whether the
  // graph is fresh. Checking it after the manifest and schema branches would let a stale build
  // adjudicate its own trustworthiness, and would answer some reads (the early-return paths) from
  // bytes that are no longer on disk.
  //
  // ⚠ This REFUSES where the warning below only warns, and the warning is kept for the case the
  // blocker deliberately lets through — a delta known to be docs-only. See staleProcessBlocker for
  // why "unknown" refuses and why one doc does not.
  const staleBlocker = staleProcessBlocker();
  if (staleBlocker) {
    return freshnessResult({ blocker: staleBlocker, graphDir, dbPath });
  }

  if (!existsSync(dbPath)) {
    await ensureFresh({ repoRoot });
    return freshnessResult({ graphDir, dbPath });
  }

  const manifestState = await loadManifest(graphDir);
  const { manifest } = manifestState;
  if (manifestState.status !== 'ok') {
    return freshnessResult({
      warnings: ['graph manifest missing or corrupt; reading the current DB snapshot directly'],
      graphDir,
      dbPath,
      manifest,
    });
  }

  const schemaVersion = manifest.schemaVersion ?? 1;
  if (schemaVersion !== SCHEMA_VERSION) {
    return freshnessResult({
      blocker: buildSchemaMismatchMessage({ verbName, schemaVersion }),
      graphDir,
      dbPath,
      manifest,
    });
  }

  // ⭐ ONE OPEN, TWO FACTS. The file count and the publication generation are read from the SAME
  // handle, so they describe the same database. A second open would have been a second observation
  // with a race between them — and its error branch would have been unreachable dead code, because
  // the first open already gates on the file being readable. A mutant that flipped that branch to
  // fail-open SURVIVED the suite, which is how the second open was found and removed.
  let alreadyIndexedFiles = null;
  let attestation = ATTESTATION.LEGACY_UNATTESTED;
  try {
    // ⭐ PINNED, NOT MERELY SHARED. One handle already meant the two facts came from one connection;
    // it did NOT stop a rebuild committing between the two statements, which is the whole
    // check-then-act window. Under a capture they are one observation of one instant.
    //
    // ⚠ The manifest was read ABOVE, before this — deliberately. A commit landing between the
    // manifest read and this pin shows up as a generation mismatch and refuses, rather than being
    // absorbed by two reads that straddle it.
    const captured = captureExistingSnapshot(dbPath, (db) => ({
      files: db.all(`SELECT DISTINCT file_path FROM nodes WHERE type = 'File'`).length,
      publication: readGraphPublication(db),
    }));
    alreadyIndexedFiles = captured.files;
    // ⛔ THE GENERATION COMPARISON, NOT THE FULL INTEGRITY VERDICT — and the difference is the
    // question this gate asks. Here it is "is the snapshot underneath the rebuild the graph the
    // manifest describes?", which the generation answers completely. Whether the manifest's COPIED
    // COUNTS still match the committed aggregates is a different property, and it bears on claims
    // made FROM those numbers, not on whether the snapshot is coherent.
    //
    // I wired classifyPublication here first and it refused a perfectly good graph whose publishing
    // run predated the aggregate columns: unrecorded counts are unknown, unknown denies, and a
    // reader lost a complete previous snapshot over a property this decision does not depend on.
    // Over-denial is not the safe direction when the cost is refusing correct answers.
    //
    // ⇒ Authority consumers (absenceAuthority, preflight SAFE) call classifyPublication because
    // they act on the numbers. This one calls classifyAttestation because it acts on identity.
    attestation = classifyAttestation({
      dbGeneration: captured.publication === null ? null : captured.publication.generation,
      manifestGeneration: manifest?.generation ?? null,
    });
  } catch {
    // ⛔ UNREADABLE LEAVES BOTH AT THEIR REFUSING VALUES: the count stays null (not a number greater
    // than zero) and the attestation stays LEGACY_UNATTESTED. A database we could not open is not an
    // attested one, and the caller gets a blocker below either way.
  }

  // ⭐ A REBUILD RUNNING SOMEWHERE ELSE IS NOT A REASON TO REFUSE A COMPLETE ANSWER.
  //
  // This branch used to defer every verb for the whole rebuild. That was right when a rebuild
  // published in pieces: a reader could land on an emptied table and render zero callers, measured
  // in 2 of 3 runs. Since `a36b770` the rebuild commits exactly once, so a concurrent reader holds
  // the complete PREVIOUS graph under WAL snapshot isolation — measured across a real rebuild as
  // [8317, 8324] with no intermediate value ever observed.
  //
  // ⇒ The refusal was triggered by an event that changes nothing about the data being read. One
  // second before the rebuild began, this same snapshot was served without complaint, and it is no
  // less true now. Staleness is still computed below against the manifest's commit — which is still
  // the OLD commit until the rebuild commits — so a graph that is genuinely behind HEAD is reported
  // behind, and `staleNotFoundCaveat` still qualifies every "not found" built on it.
  //
  // ⛔ EXCEPT WHEN THERE IS NO PREVIOUS GRAPH TO SERVE. A first-ever index has nothing committed
  // yet, so the snapshot a reader would get is EMPTY — and answering "no callers" out of an empty
  // graph is precisely the false absence this whole change exists to prevent. That case still
  // refuses, and it fails closed: `alreadyIndexedFiles` is null when the count could not be taken,
  // and null is not a number greater than zero.
  const rebuildInProgress = manifest.status === 'indexing';

  // ⚠ ORDERED BEFORE THE ATTESTATION GATE BELOW, and this is the third time in this unit that a new
  // denial had to be moved behind a more specific one. An empty graph mid-rebuild is BOTH unattested
  // and empty; "there is no previous snapshot at all" is the sharper fact and the one a first index
  // needs to hear, so the provenance message must not take its place.
  if (rebuildInProgress && !(alreadyIndexedFiles > 0)) {
    return freshnessResult({
      blocker: buildIncompleteMessage({ verbName, alreadyIndexedFiles, pendingFiles: null }),
      graphDir,
      dbPath,
      manifest,
    });
  }


  // ⛔ AND EXCEPT WHEN WE CANNOT ATTEST WHAT WE WOULD BE SERVING.
  //
  // The permission above rests entirely on "the previous graph is COMPLETE, because a rebuild
  // commits exactly once". That is a property of graphs this code published. A graph with no
  // publication record was last written by the three-event ordering — commit, then sidecars, then
  // manifest — and may itself be a torn state from a run that died between two of those events.
  // Nothing on disk can tell us, which is precisely what `legacy_unattested` means.
  //
  // ⇒ Serving it while a rebuild is running would be answering out of a snapshot we cannot check,
  // at the one moment when a checkable answer is minutes away. Outside a rebuild we still serve
  // legacy graphs — refusing always would make the tool unusable on every graph that exists today —
  // but here the refusal is cheap, temporary, and the remedy is guaranteed to produce an attested
  // graph rather than merely a different unattested one.
  //
  // ⚠ THE POSITIVE CONTROL MATTERS MORE THAN THE DENIAL. An attested graph mid-rebuild still
  // serves its previous snapshot, exactly as it did before this clause. A gate that closed for
  // every rebuild would be the old blanket refusal wearing a new reason.
  if (rebuildInProgress && attestation !== ATTESTATION.ATTESTED) {
    return freshnessResult({
      blocker: buildUnattestedRebuildMessage({ verbName, attestation, alreadyIndexedFiles }),
      graphDir,
      dbPath,
      manifest,
    });
  }

  const warnings = [];
  if (rebuildInProgress) {
    // One more VALUE in the field a reader already consults, not one more field to learn.
    warnings.push(
      `a rebuild is in progress; this answer comes from the completed previous snapshot `
      + `(${alreadyIndexedFiles} files), which is consistent but predates the rebuild — `
      + 'retry after it finishes if you are about to act on it.',
    );
  }
  // STALE PROCESS FIRST. If this server is executing code that is no longer on
  // disk, every answer below is suspect — including the freshness answers. It used
  // to be reported only by graph_health, so a reader who never called that verb
  // could act on stale-build output indefinitely; the field fleet lost a verification
  // window to exactly that (2026-07-30). A stale process is not a graph condition,
  // it is a condition on the whole session, so it belongs on the shared channel
  // every read verb already prints through.
  const staleBuild = staleProcessWarning();
  if (staleBuild) warnings.push(staleBuild);
  // ⛔ ONE OBSERVATION, AND IT MAY BE "I COULD NOT LOOK". This used to be two independent
  // `.catch()` clauses: HEAD fell back to null (honest) and the dirty query fell back to `[]`
  // (not honest — indistinguishable from a clean tree). A failed `git status` therefore silenced
  // the tracked-modification warning eleven lines below, whose own comment calls it the only thing
  // standing between a user and a stale answer.
  const worktree = await WorktreeState.observe(repoRoot);
  const head = worktree.head;
  const dirtyFiles = worktree.allDirty ?? [];
  // ⛔ TRI-STATE. `null` means staleness was never determined — NOT that the snapshot is current.
  // Callers that want to claim freshness must test `=== false`; see graph_search's "Ruled out"
  // line, which asserted exactly that from an unknown and is the reason this is not a boolean.
  const stale = worktree.stalenessAgainst(manifest.commit);
  // The disclosure goes FIRST among the freshness warnings: it tells the reader how to read the
  // silence that follows it. Empty on the healthy path, which is asserted by a control.
  warnings.push(...worktree.disclosures());
  // Reuse graph_health's indexed-commit → HEAD basis so the loud not-found
  // staleness caveat reports the SAME "N commits behind" agents see from health.
  const commitsBehind = stale ? commitsBehindHead(repoRoot, manifest.commit, head) : null;
  if (stale) {
    // Surface the commits-behind count (already computed above) AND the refresh
    // call-to-action on the SAME line every read verb prints via
    // prefixReadWarnings — a stale count with no next step reads as noise
    // (Sand Castle field report 2026-07-10, #1: staleness is the top value
    // killer when the fix isn't spelled out). APG_AUTO_REINDEX is named here for
    // discoverability without changing its opt-in default.
    const behind = commitsBehind != null
      ? `${commitsBehind} commit${commitsBehind === 1 ? '' : 's'} behind`
      : 'behind';
    warnings.push(
      `graph snapshot is stale (${behind} HEAD): indexed ${manifest.commit.slice(0, 7)}, HEAD ${head.slice(0, 7)} — run graph_index() to refresh (or set APG_AUTO_REINDEX=1 for auto-refresh on read).`,
    );
  }
  // The stale-read guard must key on TRACKED modifications. Field report: on a
  // repo with 0 tracked modifications and 592 untracked files, one verb warned
  // "592 dirty" and another "4 dirty" for the same tree at the same commit —
  // and the decision-relevant number was 0. Untracked files were never in the
  // graph, so they cannot make the snapshot stale relative to indexed source;
  // warning about them tells the user to distrust a snapshot that is current.
  // This warning is the only thing standing between a user and a stale answer,
  // so it keys on the one number that means drift.
  //
  // ⛔ `trackedDirty` is null when the query failed, never []. The `> 0` test below then simply
  // does not fire — correctly, because there is nothing to report — and the disclosure pushed
  // above is what tells the reader that this silence is an unknown rather than a clean tree.
  const trackedDirty = worktree.trackedDirty;
  if (trackedDirty !== null && trackedDirty.length > 0) {
    warnings.push(`working tree has ${trackedDirty.length} modified tracked file${trackedDirty.length === 1 ? '' : 's'}; live reads use the last completed snapshot`);
  }

  return freshnessResult({
    warnings,
    head,
    dirtyFiles,
    // ⛔ WITHOUT THIS FLAG `dirtyFiles: []` IS TWO DIFFERENT ANSWERS WEARING ONE SHAPE. Four verbs
    // read this list to compute dirty seams, and a caller cannot tell a measured empty tree from a
    // git query that failed. The warning above says so in prose; this says so to code.
    dirtyFilesKnown: worktree.dirtyKnown,
    stale,
    commitsBehind,
    // ⭐ THE SAME TWO NUMBERS AS ABOVE, ASKED A DIFFERENT QUESTION. Staleness asks "is the snapshot
    // behind the source it indexed?" and correctly ignores untracked files — they were never in
    // the graph, so they cannot make it stale. A NOT-FOUND asks something else: "does this symbol
    // exist in the repository?" For THAT question, "never in the graph" is precisely the reason
    // the answer can be false, and a modified tracked file is behind for its own reason.
    //
    // ⇒ So the sentence that justifies excluding untracked files from staleness is the sentence
    // that makes them relevant here. Same measurement, different noun, and the noun decides.
    uncommittedSources: uncommittedSourceFiles(worktree),
    graphDir,
    dbPath,
    manifest,
  });
}

/**
 * Uncommitted files the extractor WOULD have read symbols from — the ones that can make a
 * "not found" false.
 *
 * Two populations, both already measured by the worktree observation above:
 *   - UNTRACKED: never indexed at all (an incremental run defers them by design).
 *   - MODIFIED TRACKED: indexed at the snapshot's state, not the state on disk right now.
 *
 * ⛔ RETURNS null WHEN THE TREE WAS NOT OBSERVED, never []. An unobserved tree cannot certify that
 * nothing uncommitted explains an absence.
 *
 * ⚠ Filtered by `hasLanguageConfig`, not counted. See that predicate for the field population that
 * killed the count-based version. Ignored directories (.aify-graph, node_modules, build/...) are
 * already excluded upstream by getDirtyFileEntriesSync, so this does not re-apply them.
 */
export function uncommittedSourceFiles(worktree) {
  const untracked = worktree.untrackedPaths;
  const trackedDirty = worktree.trackedDirty;
  if (untracked === null && trackedDirty === null) return null;
  const seen = new Set();
  const out = [];
  for (const [paths, why] of [[untracked, 'untracked'], [trackedDirty, 'modified']]) {
    for (const p of paths ?? []) {
      if (seen.has(p) || !hasLanguageConfig(p)) continue;
      seen.add(p);
      out.push({ path: p, why });
    }
  }
  return out;
}

export async function ensureFreshForReadVerb({ repoRoot, verbName }) {
  const { blocker } = await inspectReadFreshness({ repoRoot, verbName });
  return blocker;
}

export function prefixReadWarnings(text, warnings = []) {
  if (!warnings || warnings.length === 0) return text;
  return [
    'SNAPSHOT WARNINGS',
    ...warnings.map((warning) => `- ${warning}`),
    '',
    text,
  ].join('\n');
}

export function attachReadWarnings(payload, warnings = []) {
  if (!warnings || warnings.length === 0) return payload;
  return { ...payload, _warnings: warnings };
}
