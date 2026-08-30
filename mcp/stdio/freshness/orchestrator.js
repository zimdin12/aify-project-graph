import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDb } from '../storage/db.js';
import { RebuildTransaction } from '../storage/rebuild-transaction.js';
import { SCHEMA_VERSION } from '../storage/schema.js';
import { upsertNode, getNodesByFile, deleteNode, countNodes } from '../storage/nodes.js';
import { upsertEdge, deleteEdgesByFile, countEdges } from '../storage/edges.js';
import { getHeadCommit, getDirtyFileEntries, getChangedFiles } from './git.js';
import { appendAll } from '../util/append-all.js';
import { loadManifest, writeManifest } from './manifest.js';
import { readDirtyEdgesSidecar, writeDirtyEdgesSidecar } from './dirty-edges-sidecar.js';
import { readStructuralFpSidecar, writeStructuralFpSidecar } from './structural-fp-sidecar.js';
import { fileStructuralFingerprint } from '../ingest/fingerprint.js';
import { countTrustRelevantDirtyEdges } from './unresolved-metrics.js';
import { withWriteLock } from './lock.js';
import { getLanguageConfig } from '../ingest/languages/index.js';
import { extractFile } from '../ingest/extractors/generic.js';
import { sweepFilesystem } from '../ingest/sweep.js';
import {
  IGNORED_DIRS,
  isIgnoredDirName,
  loadEffectiveIgnoredDirs,
  normalizeRepoRelativePath,
  pathContainsIgnoredDir,
} from '../ingest/ignored-dirs.js';
import { applyFrameworkPlugins } from '../ingest/extractors/base.js';
import { laravelRoutesPlugin } from '../ingest/frameworks/laravel.js';
import { pythonWebPlugin } from '../ingest/frameworks/python_web.js';
import { djangoPlugin } from '../ingest/frameworks/django.js';
import { nodeWebPlugin } from '../ingest/frameworks/node_web.js';
import { nestjsPlugin } from '../ingest/frameworks/nestjs.js';
import { railsPlugin } from '../ingest/frameworks/rails.js';
import { springPlugin } from '../ingest/frameworks/spring.js';
import { cppFrameworksPlugin } from '../ingest/frameworks/cpp_frameworks.js';
import { shaderBindingsPlugin } from '../ingest/frameworks/shader_bindings.js';
import { cmakePlugin } from '../ingest/frameworks/cmake.js';
import { resolveRefs } from '../ingest/resolver.js';
import { getGitCandidateFiles } from '../ingest/git-candidates.js';
import { buildImportContext } from '../ingest/import-resolution.js';
import { synthesizeVirtualOverrides } from '../ingest/frameworks/virtual_overrides.js';
import { resynthesizeLspEdgesFromCollection } from '../ingest/code-intel/importer.js';
import { getLatestCollection } from '../code-intel/query.js';
import { detectCommunities } from '../analysis/communities.js';
import { detectDocRefs } from '../analysis/doc-refs.js';
import { detectDocLinks } from '../analysis/doc-links.js';
import { writeDocLinkMissSidecar } from './doc-link-miss-sidecar.js';

// 0.2.0 (audit Wave 3): NodeNext .js→.ts import rewrite, arrow/function-expression
// const symbols + TS enum/abstract-class, import-evidence-before-label resolver
// ordering, and `new Foo()` instantiation edges.
// 0.2.1 (echoes measurement): skip C++ forward-declaration class nodes — they
// spawned duplicate same-named classes and made out-of-line method owner
// resolution ambiguous (1072 unresolved CONTAINS).
// 0.2.2: reverse-CONTAINS owner resolution prefers a type/namespace over a
// same-named constructor Method (echoes Engine god-class).
// 0.2.3: extract TS/JS class arrow-FIELDS (handleSubmit = () => {}) as methods.
// 0.3.0 (doc foundation, Phase 1 slice 1): Document→File LINKS_TO edges, admitted only for an
// authored Markdown link or a path-shaped inline-code span that resolves to exactly one indexed
// file, and stored with the line it appears on. Minor bump rather than patch because it adds a
// relation to the taxonomy. Bumping is what makes deployed graphs actually GAIN the edges — a
// graph indexed under 0.2.3 would otherwise never re-derive documents that had not changed, and
// the new layer would be missing on precisely the long-lived repos it was built for.
// Bumping forces deployed graphs to re-extract/re-resolve once.
//
// ── 0.4.0 — DOCUMENT HEADINGS ────────────────────────────────────────────────────────────────
// `extractDocumentMeta` now stores `headings` on every Document node, and graph_search queries
// them. Over ten topics this repo discusses, name|title reached 3 documents and headings reach 52.
//
// ⛔ AND THE PARAGRAPH DIRECTLY ABOVE THIS ONE ALREADY SAID WHY THIS BUMP IS REQUIRED — I shipped
// the feature without it anyway. Measured immediately afterwards, on the three vendored corpora:
//
//     graphify                    363 documents,   0 with headings
//     agent-understand-anything   118 documents,   0 with headings
//     codegraph                    80 documents,   0 with headings
//
// A shipped feature, inert on every existing installation, because an unchanged file is never
// re-extracted and its `extra` keeps the old shape. That is the same failure the 0.3.0 note
// describes in its own words — correct, prominent, adjacent knowledge that did not stop the
// defect it described. The remedy for that is never a better comment; it is that the version and
// the extractor's OUTPUT SHAPE must move together, which is what this constant is for.
//
// ⚠ The cost is one full rebuild per repository on upgrade. That is the honest price of the
// change; the alternative is a feature that reports success and does nothing.
export const EXTRACTOR_VERSION = '0.4.0';
export const PARSER_BUNDLE_VERSION = '2026.04.16';
// Plugin-emitted node types that the per-file extraction loop must NOT reap.
// They're attributed to non-source files (a Route to routes/web.php, a
// BuildTarget to CMakeLists.txt) that the loop would otherwise delete-then-not-
// re-extract; clearSpecialNodes rebuilds the whole set each full index instead.
// ⚠ EXPORTED so a gate can observe the RUNTIME OBJECT rather than a regex approximation of this
// line's spelling. the reviewer: a source parse is intentionally weaker than structural
// ownership — a rename makes the parse vacuous and the test goes quietly green.
//
// These are the FILE-INDEPENDENT node types: a per-file delete must not touch them (they are not
// owned by any one file), and a full clear must remove them (nothing else will).
export const SPECIAL_TYPES = ['Directory', 'Document', 'Config', 'Route', 'Entrypoint', 'Schema', 'ShaderBinding', 'BuildTarget', 'BuildTest'];
const EXTRACTION_CHUNK_SIZE = 500;

// TTL cache: skip git checks if the graph was confirmed fresh within the last 5 seconds
const freshCache = new Map(); // repoRoot → { ts, result }
const FRESH_TTL_MS = 5000;

function buildDeferredPartialResumeResult({ db, manifest, commit }) {
  return {
    indexed: true,
    commit,
    indexedAt: manifest.indexedAt,
    schemaVersion: SCHEMA_VERSION,
    extractorVersion: EXTRACTOR_VERSION,
    parserBundleVersion: PARSER_BUNDLE_VERSION,
    dirtyFiles: [],
    dirtyEdgeCount: manifest.dirtyEdgeCount ?? (manifest.dirtyEdges ?? []).length,
    trustDirtyEdgeCount: manifest.trustDirtyEdgeCount
      ?? (manifest.dirtyEdgeCount ?? (manifest.dirtyEdges ?? []).length),
    unresolvedEdges: manifest.dirtyEdgeCount ?? (manifest.dirtyEdges ?? []).length,
    nodes: countNodes(db),
    edges: countEdges(db),
    processedFiles: [],
    resumedFromPartial: false,
    partialResumeDeferred: true,
    alreadyProcessedFiles: db.all(`SELECT DISTINCT file_path FROM nodes WHERE type = 'File'`).length,
    pendingFiles: null,
  };
}

// Line splitter for git plumbing output. Built from a character code so the pattern never has
// to survive a shell heredoc — five separate 0x08 incidents this session came from exactly that.
import { execFileSync } from 'node:child_process';

/**
 * Which of a collection's files still have valid evidence after HEAD moved.
 *
 * ⛔ FAILS CLOSED ON AN UNKNOWN CHANGE SET. `changedFiles` of null means the diff could not be
 * computed, and an unknown change set is NOT an empty one — returning everything there would
 * re-stamp evidence as compiler-verified on the strength of a failed command. Empty set, and the
 * caller reports `unavailable_diff_failed_closed` rather than salvaging silently.
 *
 * @param {string[]} collectionFiles  files the collection holds records for
 * @param {Set<string>|null} changedFiles  files git says changed between the two commits
 */
export function salvageableFiles(collectionFiles, changedFiles) {
  if (!changedFiles) return new Set();
  return new Set((collectionFiles ?? []).filter((f) => f && !changedFiles.has(f)));
}

const NEWLINE_RE = new RegExp(String.fromCharCode(92) + 'r?' + String.fromCharCode(92) + 'n');

export async function ensureFresh({
  repoRoot: repoRootArg,
  graphDir: graphDirArg,
  force = false,
  allowLargePartialResume = true,
  partialResumeLimit = 250,
}) {
  // A RELATIVE repoRoot silently produced a near-empty graph. normalizeRelativePath
  // derives repo-relative paths with `absPath.slice(repoRoot.length + 1)`, so
  // repoRoot='.' (length 1) chopped the first TWO characters off every path
  // ('mcp/stdio/x.js' -> 'c/stdio/x.js'). Nothing matched a language config, every
  // file was skipped, and the rebuild "succeeded" with only Directory/Config nodes:
  // measured 3603 nodes / 398 files with an absolute root vs 562 nodes / 0 files
  // with '.'. Silent, total, and reported as success — so resolve it here, once,
  // at the entry point rather than trusting every caller.
  const repoRoot = resolve(repoRootArg ?? '.');
  const graphDir = graphDirArg ?? join(repoRoot, '.aify-graph');
  // Fast path: if we confirmed freshness recently and no force, return the
  // cached result — but only if HEAD hasn't moved since. P1-6 makes cosmetic
  // (body-only) edits resolve to a cached noop; without the commit guard, a
  // real structural change committed within the TTL window would be masked by
  // a stale cache entry. getHeadCommit is one cheap git call, far cheaper than
  // the dirty-scan + extraction it short-circuits.
  if (!force) {
    const cached = freshCache.get(repoRoot);
    if (cached && Date.now() - cached.ts < FRESH_TTL_MS) {
      const headNow = await getHeadCommit(repoRoot).catch(() => undefined);
      if (headNow === undefined || cached.commit === undefined || headNow === cached.commit) {
        return cached.result;
      }
    }
  }

  // Read-like callers should not queue behind a large/stuck rebuild just to
  // discover that the graph is partial. Do the cheap manifest/DB check before
  // taking the write lock and fail fast with a degraded-mode result.
  if (!force && !allowLargePartialResume) {
    const manifestState = await loadManifest(graphDir);
    const manifest = manifestState.manifest;
    const commit = await getHeadCommit(repoRoot).catch(() => null);
    const dbPath = join(graphDir, 'graph.sqlite');
    if (
      manifest.status === 'indexing'
      && manifest.commit
      && manifest.commit === commit
      && (manifest.schemaVersion ?? 1) === SCHEMA_VERSION
      && existsSync(dbPath)
      // NB: tooling-version drift is intentionally NOT gated here. This is the
      // transient "another process is mid-rebuild, don't block read callers"
      // fast path; once that rebuild flips status to 'ok', the next ensureFresh
      // hits the main decision which forces a full rebuild on toolingMismatch.
    ) {
      const db = openDb(dbPath);
      try {
        if (countNodes(db) > 0) {
          const deferredResult = buildDeferredPartialResumeResult({ db, manifest, commit });
          freshCache.set(repoRoot, { ts: Date.now(), commit: commit ?? undefined, result: deferredResult });
          return deferredResult;
        }
      } finally {
        db.close();
      }
    }
  }

  return withWriteLock(repoRoot, async () => {
    const manifestState = await loadManifest(graphDir);
    const manifest = manifestState.manifest;
    const commit = await getHeadCommit(repoRoot);

    // Double-check cache inside lock (another call may have populated it) —
    // but only trust it if it was recorded at the current HEAD.
    if (!force) {
      const cached = freshCache.get(repoRoot);
      if (cached && Date.now() - cached.ts < FRESH_TTL_MS
        && (cached.commit === undefined || cached.commit === commit)) {
        return cached.result;
      }
    }

    const dirtyEntries = await getDirtyFileEntries(repoRoot);
    const dirtyFiles = [...new Set([
      ...dirtyEntries.map((entry) => entry.path),
      ...(manifest.dirtyFiles ?? []),
    ])];
    // ⛔ THE `: []` IS LOAD-BEARING — DO NOT "TIDY" IT TO null FOR CONSISTENCY.
    //
    // This else covers the ORDINARY paths: force, no indexed commit, or the commit already matching.
    // `[]` there means "no delta was needed", which is true. `null` would mean "the delta could not
    // be computed", and since that forces a full rebuild below, EVERY ORDINARY RUN WOULD REBUILD.
    //
    // Flagged in field testing reviewing 9c94586: correct, but silently so. A reader making the two
    // branches "consistent" would introduce the exact over-correction the fix was written to avoid.
    const changedFromCommit = !force && manifest.commit && manifest.commit !== commit
      ? await getChangedFiles(repoRoot, manifest.commit, commit)
      : [];
    // ⛔ null MEANS THE DELTA COULD NOT BE COMPUTED — the indexed commit is no longer resolvable
    // (rebase, branch reset, force-push, a gc that pruned it, a shallow-clone boundary). Reading
    // that as "nothing changed" advanced the manifest over code that was never read.
    //
    // ⇒ An unresolvable indexed commit is morally identical to an ABSENT one, and `!manifest.commit`
    // ALREADY forces a full rebuild. So this folds one term into that existing, tested decision
    // rather than adding a new path — see `fullRebuild` below.
    // ⚠ WHY THE ANSWER IS A FULL REBUILD AND NOT SOMETHING CHEAPER. The next person to see a full
    // rebuild in a hot path will reach for file mtimes — the signal is free and already used as a
    // freshness basis elsewhere. It fails in the UNSAFE direction: a checkout or rebase does not
    // update mtime on every file whose content the graph now disagrees with, and archive extraction
    // or a restore carries old mtimes forward. Missing a changed file is silent incompleteness —
    // the exact class this code exists to eliminate.
    //
    // A content-addressed delta would be the honest cheap answer and IS NOT AVAILABLE: there is no
    // per-file hash in the manifest or the schema. `structural_fp` is per NODE and computable only
    // by re-parsing, so it cannot tell you WHICH files to re-parse. That is a schema addition, not
    // a tweak, and it must not ride along on a correctness fix.
    //
    // ⇒ Full rebuild is right here because nothing cheaper can currently be TRUSTED TO BE COMPLETE.
    const deltaUnavailable = changedFromCommit === null;
    const initialChanged = [...new Set([...dirtyFiles, ...(changedFromCommit ?? [])])];

    const db = openDb(join(graphDir, 'graph.sqlite'));
    try {
      const schemaMismatch = (manifest.schemaVersion ?? 1) !== SCHEMA_VERSION;
      // Audit 2026-06-12 (graphify 8401c50): the extractor + parser-grammar
      // versions are written to the manifest but were never compared, so a
      // shipped extractor/grammar fix never re-reached unchanged files without a
      // manual force=true. Treat a version drift like a schema drift — force a
      // clean full rebuild so corrected extraction applies across the repo. The
      // manifest defaults these to '0.0.0' when absent, so pre-versioning graphs
      // rebuild once on upgrade.
      const toolingMismatch = (manifest.extractorVersion ?? '0.0.0') !== EXTRACTOR_VERSION
        || (manifest.parserBundleVersion ?? '0.0.0') !== PARSER_BUNDLE_VERSION;

      // ⛔ PARTIAL RESUME IS DEAD, AND ITS PREMISE DIED WITH THE CHUNKED COMMITS.
      //
      // This used to read: "the chunked-commit code has already preserved some nodes in SQLite. We
      // can resume from that partial state instead of wiping and starting over." That was true while
      // the rebuild committed every 500 files. Since the rebuild became ONE transaction, a killed
      // run rolls back to the COMPLETE OLD GRAPH — there is no partial state to resume, and the old
      // graph's File rows are not "already processed chunks".
      //
      // Reviewer executed the consequence on the atomic build: recovery treated every old File row
      // as done, filtered them all out, and returned indexed:true with processedFiles:[] while the
      // manifest stayed `indexing` forever — a repository that can never re-index itself, reporting
      // success.
      //
      //     source now: newFn | DB after simulated killed atomic rebuild: oldFn
      //     recovery log: 1 files already indexed, 0 pending
      //     result: indexed:true, processedFiles:[]   manifest: still indexing
      //
      // ⇒ A `status: indexing` manifest now means exactly one thing: the last run did not finish,
      // so whatever is in the database is the PREVIOUS complete graph and the rebuild must be redone
      // from source. The clause is already in `fullRebuild` below; deleting the resume path is what
      // lets it fire.

      const fullRebuild = (force
        || manifestState.status !== 'ok'
        || !manifest.commit
        // An indexed commit git cannot resolve is no more usable than an absent one, directly above.
        || deltaUnavailable
        || manifest.status === 'indexing'
        || schemaMismatch
        || toolingMismatch);

      const effectiveIgnoredDirs = loadEffectiveIgnoredDirs(repoRoot);
      let filesToProcess;
      // Set when a full rebuild wiped the LSP trust spine and the stored
      // collection was too stale to restore — the agent must re-collect.
      let trustSpineDropped = null;
      // P1-6: files whose content changed but whose STRUCTURAL shape did not
      // (body/comment/whitespace/literal edits). These keep their existing
      // nodes/edges and are skipped from re-extraction + re-resolution.
      let cosmeticSkippedFiles = [];
      // Carry-forward fp map: stored structural fingerprints for files we did
      // NOT re-extract this run (cosmetic skips + untouched files), so the
      // sidecar stays complete after an incremental run.
      let preservedFingerprints = null;
      if (fullRebuild) {
        filesToProcess = await listRepoFiles(repoRoot, repoRoot, effectiveIgnoredDirs);
      } else {
        // P1-6 tiered rebuild: classify each DIRECTLY-changed file as
        // cosmetic (structural fingerprint unchanged → keep nodes/edges, skip
        // re-resolution) or structural (re-extract + re-resolve as today). The
        // content/mtime "did it change at all" decision already happened
        // upstream (git dirty/changed); this is the SECOND tier between
        // "unchanged" and "structurally changed".
        //
        // CONSERVATIVE by construction: we only mark a file cosmetic when we
        // have a STORED fingerprint to compare against AND the freshly-computed
        // one matches exactly. New files (no stored fp), deleted/missing files,
        // unparseable files, or any error → treated as structural (full handle).
        const storedFps = await readStructuralFpSidecar(graphDir);
        const dirtyEntryMap = new Map(dirtyEntries.map((entry) => [entry.path, entry]));
        const structuralChanged = [];
        const cosmetic = [];
        for (const relPath of initialChanged) {
          if (pathContainsIgnoredDir(relPath, effectiveIgnoredDirs)) continue;
          if (shouldDeferUntrackedFreshness(db, relPath, dirtyEntryMap.get(relPath))) continue;
          const classification = await classifyChangedFile({
            db, repoRoot, relPath, storedFp: storedFps.get(relPath),
          });
          if (classification === 'cosmetic') {
            cosmetic.push(relPath);
          } else {
            structuralChanged.push(relPath);
          }
        }
        cosmeticSkippedFiles = cosmetic;

        // Only structural changes pull in their callers for re-resolution — a
        // cosmetic edit can't have altered any edge, so dependents are safe.
        filesToProcess = await expandAffectedFiles(db, repoRoot, structuralChanged);
        // A cosmetic file may have been re-added as a caller of a structural
        // file; if so it must be re-resolved (its calls into the structural
        // file matter), so drop it from the cosmetic set in that case.
        const toProcessSet = new Set(filesToProcess);
        cosmeticSkippedFiles = cosmetic.filter((p) => !toProcessSet.has(p));
        filesToProcess = filesToProcess
          .filter((filePath) => !pathContainsIgnoredDir(filePath, effectiveIgnoredDirs))
          .filter((filePath) => {
            const entry = dirtyEntryMap.get(filePath);
            return !shouldDeferUntrackedFreshness(db, filePath, entry);
          });

        // Preserve stored fingerprints for the cosmetic-skipped files so the
        // rewritten sidecar stays complete (they keep their old, still-correct
        // structural fp).
        preservedFingerprints = storedFps;
      }

      // Noop path: if no files to process and not a full rebuild, return early.
      // This now also covers the all-cosmetic case: every changed file was a
      // body-only edit, so there is nothing to re-extract or re-resolve — we
      // just report how many we skipped.
      if (!fullRebuild && filesToProcess.length === 0) {
        const trustDirtyEdgeCount = manifest.trustDirtyEdgeCount
          ?? (manifest.dirtyEdgeCount ?? (manifest.dirtyEdges ?? []).length);
        const noopResult = {
          indexed: true, commit, indexedAt: manifest.indexedAt,
          schemaVersion: SCHEMA_VERSION, extractorVersion: EXTRACTOR_VERSION,
          parserBundleVersion: PARSER_BUNDLE_VERSION,
          dirtyFiles: [],
          // Prefer authoritative dirtyEdgeCount (unchanged by the 500-row
          // manifest sample cap); fall back to sample length for older
          // graphs written before dirtyEdgeCount existed.
          dirtyEdgeCount: manifest.dirtyEdgeCount ?? (manifest.dirtyEdges ?? []).length,
          trustDirtyEdgeCount,
          unresolvedEdges: manifest.dirtyEdgeCount ?? (manifest.dirtyEdges ?? []).length,
          nodes: manifest.nodes ?? 0, edges: manifest.edges ?? 0,
          processedFiles: [],
          cosmeticSkipped: cosmeticSkippedFiles.length,
        };
        // Commit may advance on a pure body-edit (HEAD moved). Refresh the
        // manifest commit so we don't re-diff the same range next call, but
        // leave node/edge state and fingerprints untouched.
        if (commit && manifest.commit !== commit) {
          await writeManifest(graphDir, { ...manifest, commit, status: 'ok' });
        }
        freshCache.set(repoRoot, { ts: Date.now(), commit: commit ?? undefined, result: noopResult });
        return noopResult;
      }

      // ⭐ ONE TRANSACTION FOR THE WHOLE REBUILD. Everything from here to the commit near the end
      // is unpublished: a concurrent reader keeps seeing the complete PREVIOUS graph under WAL
      // snapshot isolation, and sees the complete new one the instant this commits. The wipe used to
      // autocommit here, which is what let a reader observe zero edges and a verb report zero
      // callers. Applies to incremental runs too — a partially-reprocessed file set is just as wrong
      // to publish as a partially-rebuilt one, and one path is easier to keep honest than two.
      //
      // ⛔ ACQUIRE THE TRANSACTION BEFORE MARKING THE MANIFEST, AND BEGIN INSIDE THE TRY.
      // The manifest used to be written `indexing` first, with `begin()` outside the guarded block.
      // A BUSY or I/O failure on BEGIN then left the complete old database beside an `indexing`
      // manifest — a state nothing ever cleared, which fed straight into the stale-serving and
      // recovery paths. Nothing may claim a rebuild is under way until one actually is, and if
      // marking the manifest fails the transaction must not stay open.
      const rebuildTxn = new RebuildTransaction(db);
      try {
        rebuildTxn.begin();
        // Mark manifest as indexing only once the write lock is genuinely held — crash safety.
        await writeManifest(graphDir, { ...manifest, status: 'indexing' });
      if (fullRebuild) {
        db.exec('DELETE FROM edges; DELETE FROM nodes;');
      }

      clearSpecialNodes(db);

      const special = await sweepFilesystem({ repoRoot, ignoredDirs: effectiveIgnoredDirs });
      const specialPlugins = await applyFrameworkPlugins({
        repoRoot,
        result: { nodes: [], edges: [], refs: [] },
        plugins: [
          laravelRoutesPlugin,
          pythonWebPlugin,
          djangoPlugin,
          nodeWebPlugin,
          nestjsPlugin,
          railsPlugin,
          springPlugin,
          cppFrameworksPlugin,
          shaderBindingsPlugin,
          cmakePlugin,
        ],
      });

      // Batch all inserts in a transaction for performance
      const batchInsert = db.transaction(() => {
        for (const node of special.nodes) upsertNode(db, node);
        for (const edge of special.edges) upsertEdge(db, edge);
        for (const node of specialPlugins.nodes) upsertNode(db, node);
        for (const edge of specialPlugins.edges) upsertEdge(db, edge);
      });
      batchInsert();

      // Carry forward unresolved edges from the previous incremental run so
      // resolution can retry them. Full rebuilds intentionally start from
      // source truth only. Also drop stale refs whose source file is ignored,
      // missing, or being reprocessed in this run.
      const sidecarEdges = await readDirtyEdgesSidecar(graphDir);
      const carryForward = fullRebuild
        ? []
        : (sidecarEdges !== null ? sidecarEdges : (manifest.dirtyEdges ?? [])).filter((ref) => (
          shouldCarryForwardRef(ref, repoRoot, effectiveIgnoredDirs, filesToProcess)
        ));
      const refs = [...specialPlugins.refs, ...carryForward];
      const existingFiles = [];
      // P1-6: structural fingerprints computed for files we (re-)extract this
      // run. Merged with preserved fingerprints (cosmetic + untouched files)
      // before the sidecar is written.
      const computedFingerprints = new Map();
      // Files this run DELETED from the graph and then failed to re-extract. Not an
      // error log — a corpus attestation. See the comment at the read/parse catches.
      const skipped = [];

      // ★ TRANSACTION-LOCAL STATE. See the rollback catch below for why these exist.
      //
      // Anything derived from rows written inside the open transaction must live here
      // until COMMIT, because ROLLBACK unwinds SQL and leaves JavaScript untouched. The
      // rule that generalises past this loop: DURABLE STATE AND THE DATABASE MUST BE
      // PROMOTED BY THE SAME EVENT, or they can disagree and nothing will notice.
      let pendingRefs = [];
      let pendingFingerprints = new Map();
      let pendingFiles = [];
      const commitPending = () => {
        // ⛔ appendAll, NOT push(...). pendingRefs holds every unresolved reference from a whole
        // extraction chunk, so its length scales with the corpus. On reference/graphify it went
        // past the engine's ~125k argument limit and the entire index died with "Maximum call
        // stack size exceeded" — a message naming the stack, in code with no recursion in it.
        appendAll(refs, pendingRefs);
        for (const [f, fp] of pendingFingerprints) computedFingerprints.set(f, fp);
        pendingRefs = [];
        pendingFingerprints = new Map();
        pendingFiles = [];
      };
      const discardPending = () => {
        pendingRefs = [];
        pendingFingerprints = new Map();
        pendingFiles = [];
      };

      // Extract in bounded chunks so a mid-run failure only loses the current chunk.
      let chunkSize = 0;
      rebuildTxn.beginChunk();
      try {
      for (const relPath of filesToProcess) {
        try {
          const absPath = join(repoRoot, relPath);
          if (!existsSync(absPath)) {
            deleteNodesForFile(db, relPath);
            continue;
          }

          const config = maybeGetLanguageConfig(relPath);
          if (!config) {
            deleteNodesForFile(db, relPath);
            continue;
          }

          existingFiles.push(relPath);

          const fileStat = await stat(absPath);
          if (fileStat.size > 1_000_000) {
            // ★ A DELIBERATE SKIP IS STILL A HOLE. Found while building a fixture for
            // the read/parse failures below — this branch deletes the file's nodes and
            // continues, exactly like a failure, and it was the only one of the three
            // that looked intentional enough not to question.
            //
            // Intent does not change what the consumer sees. A 1.2 MB generated source
            // is absent from the graph, so "who calls X" returns nothing from it, and
            // that reads as a true negative. The cap is a reasonable engineering choice;
            // hiding it is not.
            deleteNodesForFile(db, relPath);
            skipped.push({
              file: relPath,
              phase: 'too_large',
              reason: `${Math.round(fileStat.size / 1024)} KB exceeds the 1000 KB per-file extraction cap`,
            });
            continue;
          }

          deleteNodesForFile(db, relPath);

          // ★ THE DELETE ABOVE ALREADY HAPPENED. A `continue` HERE IS NOT A SKIP.
          //
          // `deleteNodesForFile` runs before the read, so bailing out now does not leave
          // the file's previous graph state in place — it leaves the file ABSENT from the
          // graph, having been present a moment ago. "Skip files that fail to parse —
          // non-fatal" described the intent and not the effect.
          //
          // Combined with a success envelope that reports `indexed: true`, that is the
          // upstream failure the reviewer named from four separate projects
          // (codegraph #1502 "complete" with 0 files · #1361 lock failure → "up to date" ·
          // Understand #628 dropped cross-batch edges · graphify #2520 parse holes with
          // exit 0), and the generalisation is theirs: SUCCESS MUST ATTEST CORPUS AND
          // SCOPE. An index that cannot say what it failed to read is not reporting
          // success, it is reporting that it finished.
          //
          // Not made fatal: one unreadable file should not abandon a whole reindex, and a
          // partial graph is genuinely better than none. What must not happen is the
          // partiality being INVISIBLE — so every skip is now counted, named and carried
          // out to the manifest, where graph_health reads it.
          let source;
          try {
            source = await readFile(absPath, 'utf8');
          } catch (err) {
            skipped.push({ file: relPath, phase: 'read', reason: String(err?.code ?? err?.message ?? err).slice(0, 120) });
            continue;
          }

          let extracted;
          try {
            extracted = extractFile({ filePath: relPath, source, config });
          } catch (err) {
            skipped.push({ file: relPath, phase: 'parse', reason: String(err?.message ?? err).slice(0, 120) });
            continue;
          }

          for (const node of extracted.nodes) upsertNode(db, node);
          for (const edge of extracted.edges) upsertEdge(db, edge);
          // Transaction-local. Promoted to `refs` by commitPending() only after the
          // COMMIT that makes the matching nodes real — otherwise a rollback leaves refs
          // that resolve into edges pointing at nodes which no longer exist.
          // Same reason: one generated or vendored file can carry an enormous ref list.
          appendAll(pendingRefs, extracted.refs);
          pendingFiles.push(relPath);
          pendingFingerprints.set(relPath, fileStructuralFingerprint(extracted));
          chunkSize += 1;
          if (chunkSize >= EXTRACTION_CHUNK_SIZE) {
            // Releasing a savepoint keeps the rows without publishing them. commitPending() still
            // promotes the JS-side refs/fingerprints at the same event as the SQL, preserving the
            // invariant that durable state and the database cannot disagree.
            rebuildTxn.commitChunk();
            commitPending();
            rebuildTxn.beginChunk();
            chunkSize = 0;
          }
        } catch (err) {
          // ★ A ROLLBACK UNDOES SQL. IT DOES NOT UNDO JAVASCRIPT.
          //
          // the reviewer, executable probe with a SQLite trigger, 2026-08-11. The
          // old code rolled back the transaction and then kept the JS-side `refs`,
          // `computedFingerprints` and `existingFiles` accumulated inside it. Three
          // consequences, in ascending order of seriousness:
          //
          //   1. `skipped` recorded ONE entry — the file that threw — while the rollback
          //      had removed every file in the chunk. Health then reported "1 file
          //      deleted" over a corpus missing all three of three.
          //   2. `structural-fp.json` asserted current fingerprints for files with no
          //      rows in the DB, which can keep absent state alive through later
          //      cosmetic-fast-path decisions.
          //   3. ★ Retained `refs` from rolled-back files could later resolve into a
          //      CALLS edge whose `from_id` names no node. That is not a bad manifest —
          //      it is a STRUCTURALLY INCONSISTENT COMMITTED GRAPH.
          //
          // So all three are now transaction-local and merge only after COMMIT succeeds.
          // The durable state and the database can no longer disagree, because the same
          // event promotes both.
          //
          // ⚠ AND THE ATTESTATION NOW NAMES EVERY AFFECTED FILE, not just the thrower.
          // `skippedFileCount` counts impacted FILES, not caught exceptions — the
          // distinction that made the old count wrong by a factor of the chunk size.
          const reason = String(err?.message ?? err).slice(0, 120);
          for (const lost of pendingFiles) {
            skipped.push({
              file: lost,
              phase: 'chunk_rollback',
              reason: lost === relPath
                ? reason
                : `rolled back with the chunk containing ${relPath ?? '(unknown)'}: ${reason}`,
            });
          }
          if (!pendingFiles.includes(relPath) && relPath) {
            skipped.push({ file: relPath, phase: 'chunk_rollback', reason });
          }
          // ROLLBACK TO discards THIS CHUNK only; the rest of the rebuild survives, which is what
          // the old COMMIT/BEGIN pair bought at the price of publishing every 500 files.
          rebuildTxn.rollbackChunk();
          discardPending();
          rebuildTxn.beginChunk();
          chunkSize = 0;
        }
      }

      rebuildTxn.commitChunk();
      commitPending();
      } catch (err) {
        rebuildTxn.rollback();
        throw err;
      }

      // P3-1/P3-2: build the JS/TS import-resolution context (candidate fileset
      // + tsconfig path-aliases). Prefer git's gitignore-aware candidate set;
      // fall back to the File nodes already in the graph so extension-probe and
      // alias resolution still work in non-git checkouts. Best-effort — a
      // failure here just means the import-evidence passes are skipped.
      let importContext = null;
      try {
        let fileSet = getGitCandidateFiles(repoRoot);
        if (!fileSet) {
          fileSet = new Set(
            db.all(`SELECT DISTINCT file_path FROM nodes WHERE type = 'File' AND file_path != ''`)
              .map((row) => String(row.file_path).replace(/\\/g, '/')),
          );
        }
        importContext = buildImportContext({ repoRoot, fileSet });
      } catch {
        importContext = null;
      }

      let resolved = { edges: [], unresolved: [] };
      try {
        resolved = resolveRefs({ db, refs, importContext });
        const batchResolvedGraph = db.transaction(() => {
          for (const node of resolved.nodes ?? []) upsertNode(db, node);
          for (const edge of resolved.edges) upsertEdge(db, edge);
        });
        batchResolvedGraph();
        cleanupOrphanExternalNodes(db);
      } catch (err) {
        // Resolution failed on large graph — proceed with partial edges
        resolved = { nodes: [], edges: [], unresolved: refs };
      }

      // P0-5: synthesize C++ virtual-override edges (OVERRIDDEN_BY, INFERRED)
      // from the now-resolved graph (Method nodes + EXTENDS/IMPLEMENTS edges).
      // Runs every index, fully rebuilds its own edge set (idempotent), and
      // tags edges source_file='' so per-file reindex deletes don't reap them.
      // Non-fatal: a synthesis failure must never block the index.
      try {
        synthesizeVirtualOverrides(db, { upsertEdge });
      } catch (err) {
        // Virtual-override synthesis failed — non-fatal, skip silently.
      }

      // A — restore the LSP-verified trust spine after a full rebuild wiped it
      // (the `DELETE FROM edges` above). The clangd records persist in
      // code_intel_records, so when the rebuild was triggered by TOOLING (an
      // extractor-version bump, schema change, or forced reindex) and NOT by a
      // code change, the stored evidence is still exactly valid — re-synthesize
      // the identical LSP edges instead of forcing an expensive re-collect.
      //
      // HONESTY GATE: only when the latest collection's indexedCommit equals the
      // current HEAD (code unchanged since collection). If the commit moved, the
      // clangd line numbers could resolve onto shifted code, so we must NOT
      // re-stamp them LSP_VERIFIED — the user re-collects instead. Non-fatal.
      if (fullRebuild && commit) {
        try {
          const latest = getLatestCollection(db);
          if (latest && latest.indexedCommit && latest.indexedCommit === commit) {
            const r = resynthesizeLspEdgesFromCollection(db, { collectionId: latest.collectionId });
            if (r.edgesCreated > 0) {
              console.warn(`[aify-project-graph] restored ${r.edgesCreated} LSP-verified edge(s) from commit-current collection ${latest.collectionId} (rebuild preserved the trust spine)`);
            }
          } else if (latest && latest.indexedCommit) {
            // ⛔ ALL-OR-NOTHING DROPPED EVIDENCE THAT WAS STILL TRUE.
            //
            // The gate above is right about WHY — line numbers from an older commit can resolve
            // onto shifted code — and wrong about the GRANULARITY. A record is stale only if ITS
            // OWN file changed. On a repo that commits often, requiring HEAD to equal the
            // collection's commit means the spine dies on the next commit, every time, which is
            // why LSP_VERIFIED read 0 here for the life of the repo while collections had
            // genuinely run. That zero was produced by the workflow, not by an omission.
            //
            // ⇒ Salvage per file: restore evidence for files git says did not change between the
            // collection's commit and HEAD, drop the rest. More honest than dropping everything,
            // because dropping true evidence is also a wrong answer — it just fails in the
            // direction that looks careful.
            //
            // ⚠ FAILS CLOSED. If the diff cannot be computed we do NOT salvage: an unknown change
            // set is not an empty one, and guessing here re-stamps evidence as compiler-verified.
            let changed = null;
            try {
              const out = execFileSync('git', ['-C', repoRoot, 'diff', '--name-only',
                `${latest.indexedCommit}..${commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
              changed = new Set(out.split(NEWLINE_RE).map((l) => l.trim()).filter(Boolean));
            } catch { changed = null; }

            let salvaged = null;
            if (changed) {
              const files = db.all(
                'SELECT DISTINCT file FROM code_intel_records WHERE collection_id = $cid',
                { cid: latest.collectionId },
              ).map((r) => r.file).filter(Boolean);
              const unchanged = salvageableFiles(files, changed);
              if (unchanged.size > 0) {
                salvaged = resynthesizeLspEdgesFromCollection(db, {
                  collectionId: latest.collectionId, onlyFiles: unchanged,
                });
                if (salvaged.edgesCreated > 0) {
                  console.warn(`[aify-project-graph] salvaged ${salvaged.edgesCreated} LSP-verified edge(s) from `
                    + `${unchanged.size} of ${files.length} file(s) unchanged since ${String(latest.indexedCommit).slice(0, 7)}; `
                    + `evidence for ${files.length - unchanged.size} changed file(s) was NOT re-stamped`);
                }
              }
            }
            trustSpineDropped = {
              collectionId: latest.collectionId,
              collectedAt: latest.collectedAt ?? null,
              indexedCommit: latest.indexedCommit ?? null,
              currentCommit: commit,
              // ⚠ PARTIAL, and named as such. A salvage that reported "restored" would let a
              // reader infer the spine is whole; one that reported nothing would hide that most
              // of it survived. Both numbers, always.
              salvagedEdges: salvaged?.edgesCreated ?? 0,
              salvageBasis: changed ? 'per_file_diff' : 'unavailable_diff_failed_closed',
              hint: salvaged?.edgesCreated
                ? 'evidence for files that changed since the collection was NOT re-stamped — run graph_collect_code_intel to cover them; until then those symbols are heuristic-only'
                : 'run graph_collect_code_intel to rebuild the [lsp✓] trust spine — until then caller sets are heuristic-only and cannot attest exhaustiveness',
            };
          } else if (latest) {
            // The honesty gate correctly refused to re-stamp stale evidence — but
            // refusing SILENTLY is how a repo ends up running at 0% trust spine
            // without anyone noticing. Measured on a real project: a reindex after
            // HEAD moved left 0 LSP_VERIFIED edges of 17544 CALLS, so every
            // "who calls X" answer fell back to the heuristic layer and the tool's
            // whole differentiator was gone. Say it, and say the one command back.
            trustSpineDropped = {
              collectionId: latest.collectionId,
              collectedAt: latest.collectedAt ?? null,
              indexedCommit: latest.indexedCommit ?? null,
              currentCommit: commit,
              hint: 'run graph_collect_code_intel to rebuild the [lsp✓] trust spine — until then caller sets are heuristic-only and cannot attest exhaustiveness',
            };
            console.warn('[aify-project-graph] this rebuild DROPPED the LSP-verified trust spine: '
              + `the stored collection was indexed at ${String(latest.indexedCommit ?? '?').slice(0, 7)} but HEAD is ${commit.slice(0, 7)}, `
              + 'so its evidence cannot be re-stamped as verified. Run graph_collect_code_intel to restore it — '
              + 'until then caller sets are heuristic-only.');
          }
        } catch {
          // Re-synthesis is best-effort; a failure just leaves the spine to a
          // manual re-collect, never blocks the index.
        }
      }

      // Post-indexing analysis (skip on very large graphs to avoid OOM)
      const nodeCount0 = countNodes(db);

      // ⭐ DOC→FILE LINKS RUN OUTSIDE THE 20k GATE, ON PURPOSE. The gate exists because
      // detectMentions builds a map of every symbol label in the graph; doc-links indexes File
      // nodes only, which are orders of magnitude fewer, and scans documents. Putting it under
      // the same gate would make the doc layer VANISH SILENTLY on exactly the large repos where
      // "where is the design doc?" is hardest to answer by hand — an absence produced by a
      // resource guard and reported as if the repo had no doc links.
      //
      // ⚠ AND THE OUTCOME IS RECORDED RATHER THAN SWALLOWED. The catch below keeps a failure
      // non-fatal, but a caught-and-forgotten failure is indistinguishable from a repo with no
      // documents. The stats reach the manifest so the absence has a stated cause.
      let pendingDocLinkMisses = null;
      let docLinkResult = { added: 0, documents: 0 };
      try {
        const r = await detectDocLinks(db, repoRoot);
        // ⛔ THE FULL LEDGER NEVER ENTERS THE MANIFEST. ~1,200 miss records on this repo would
        // balloon a file that every verb reads on every call — the same reason `dirtyEdges` is
        // capped with an UNCAPPED count beside it. Full list to a sidecar, a small sample and the
        // true total to the manifest, so the cap can never make the loss look smaller than it is.
        const { misses, ...counts } = r;
        // ⛔ DEFERRED PAST THE COMMIT. Written here it would describe doc links that a rollback
        // later discards — a durable file asserting a state the database never reached. The
        // database and the artifacts beside it must be promoted by the SAME event.
        pendingDocLinkMisses = misses;
        docLinkResult = {
          ...counts,
          missCount: misses.length,
          missSample: misses.slice(0, 25),
          missLedger: '.aify-graph/doc-link-misses.json',
        };
      } catch (err) {
        docLinkResult = { added: 0, documents: 0, failed: String(err?.message ?? err) };
      }

      // ⭐ DOC->SYMBOL REFERENCES ALSO RUN OUTSIDE THE 20k GATE, AND THE REASON IS THE DELETE.
      //
      // The legacy `mentions` extractor ran INSIDE the gate. Rule 2 replaces it, and its first act
      // is to remove every edge that extractor ever wrote. If that retirement stayed gated, a repo
      // over 20k nodes would keep its 2,533 line-0 word-collision edges FOREVER: the rule that
      // would delete them is the rule that never runs there. A cleanup conditioned on the same
      // resource limit as the thing it cleans up is not a cleanup.
      //
      // The cost objection that justified the gate does not transfer. detectMentions built a map
      // of every symbol label in the graph; buildSymbolIndex is capped at MAX_CHAIN_SEGMENTS
      // suffixes per symbol, so it is O(symbols) with a small constant.
      let docRefResult = { added: 0, documents: 0 };
      try {
        const r = await detectDocRefs(db, repoRoot);
        const { misses, ...counts } = r;
        docRefResult = {
          ...counts,
          missCount: misses.length,
          missSample: misses.slice(0, 25),
        };
      } catch (err) {
        docRefResult = { added: 0, documents: 0, failed: String(err?.message ?? err) };
      }

      let communityResult = { communities: 0 };
      if (nodeCount0 <= 20000) {
        try {
          communityResult = detectCommunities(db);
        } catch (err) {
          // Community detection failed (OOM on large graphs) — non-fatal
        }
      }

      const nodeCount = countNodes(db);
      const edgeCount = countEdges(db);
      const trustDirtyEdgeCount = countTrustRelevantDirtyEdges(resolved.unresolved);

      const skippedPaths = new Set(skipped.map((s) => s.file));
      const nextManifest = {
        // ⚠ 'ok' MEANS THE RUN FINISHED, NOT THAT THE CORPUS IS COMPLETE. Deliberate,
        // and the field test flagged it as arguable: a status that goes non-ok on any skip
        // would make one 4 MB vendored header look like a failed rebuild, and callers
        // would learn to ignore it. The completeness signal is skippedFileCount, which
        // is precise, and graph_health leads with it. Revisit if 'ok' is ever read as
        // "complete" by something that cannot see the count.
        status: 'ok',  // Clear the 'indexing' marker — rebuild succeeded
        commit,
        indexedAt: new Date().toISOString(),
        nodes: nodeCount,
        edges: edgeCount,
        schemaVersion: SCHEMA_VERSION,
        extractorVersion: EXTRACTOR_VERSION,
        parserBundleVersion: PARSER_BUNDLE_VERSION,
        dirtyFiles: [],
        // Manifest keeps a 500-row SAMPLE for breakdown queries (status/health).
        // The full authoritative list goes to the sidecar below — this prevents
        // the manifest from ballooning on huge unresolved backlogs while still
        // preserving all state for next-run carry-forward.
        dirtyEdges: resolved.unresolved.length > 500
          ? resolved.unresolved.slice(0, 500)
          : resolved.unresolved,
        dirtyEdgeCount: resolved.unresolved.length,
        trustDirtyEdgeCount,
        // ★ SUCCESS MUST ATTEST CORPUS AND SCOPE. `status: 'ok'` above says the run
        // finished; these say what it finished WITHOUT. Zero-length is the normal case
        // and costs 2 fields — the cost is paid only by indexes that actually lost
        // files, which are exactly the ones where it changes what an agent should do.
        //
        // Capped at 50 for the same reason dirtyEdges is capped: a pathological repo
        // must not balloon the manifest. The COUNT is uncapped, so the cap can never
        // make the loss look smaller than it is — the failure mode that made
        // `dirtyEdgeCount` necessary next to `dirtyEdges` in the first place.
        skippedFileCount: skipped.length,
        skippedFiles: skipped.slice(0, 50),
        // ⭐ THE CORPUS DENOMINATOR, FROM THE CODE THAT OWNS THE DECISION.
        // the field test measured 52.7% of this repo's markdown never becoming a Document node — by
        // running `git ls-files` from OUTSIDE, because the sweep published no number. Their
        // caveat is why this comes from here rather than from their instrument: the sweep's
        // candidate set is git candidates layered over the ignore parser, minus binary and minus
        // the size cap, which is NOT the same set as `git ls-files`. Two instruments disagreeing
        // by an unattributable amount is how a measurement becomes an argument.
        // `seen` is the input, so `admitted` + `declined` reconcile against it or the gap is a
        // finding in its own right.
        sweepCounts: special.counts ?? null,
        // ⚠ `unresolved` IS A REPO-SHAPED PATH WE COULD NOT RESOLVE — a real gap, and the
        // number worth acting on. `external` is a deliberate link out of the repo and is NOT a
        // gap. They are reported separately because one figure covering both can only be read as
        // the wrong one, and the wrong reading hides real misses inside expected noise.
        docLinks: docLinkResult,
        docRefs: docRefResult,
      };
      // ⭐ CLEARED BEFORE the manifest says 'ok', not after. A reader that sees a finished manifest
      // must never then be refused by a marker still standing; the opposite order — refusing for a
      // few extra milliseconds after the graph is whole — is the safe one to get wrong.
      // A rebuild that THREW leaves the marker set on purpose: the graph really is half-built, and
      // the refusal names graph_index(force=true) as the way out.
      // ⭐ THE ONLY MOMENT THE NEW GRAPH BECOMES VISIBLE. Everything above was unpublished, so a
      // reader was seeing the complete previous graph the whole time rather than a torn one.
      // Ordered before the manifest and the sidecars deliberately: durable file state must never
      // describe a graph the database has not committed, and a rollback below writes neither.
      rebuildTxn.commit();
      if (pendingDocLinkMisses !== null) await writeDocLinkMissSidecar(graphDir, pendingDocLinkMisses);
      await writeManifest(graphDir, nextManifest);
      await writeDirtyEdgesSidecar(graphDir, resolved.unresolved);

      // P1-6: persist the per-file structural fingerprints. On a full rebuild
      // the freshly-computed set is authoritative. On an incremental run we
      // start from the preserved (stored) map — keeping fingerprints for
      // cosmetic-skipped and untouched files — and overlay the files we just
      // re-extracted, pruning any that were deleted this run.
      try {
        const nextFingerprints = preservedFingerprints
          ? new Map(preservedFingerprints)
          : new Map();
        for (const [filePath, fp] of computedFingerprints) {
          nextFingerprints.set(filePath, fp);
        }
        if (!fullRebuild) {
          // Drop fingerprints for files that no longer have a File node (the
          // loop deletes nodes for missing/ignored files as it goes).
          const liveFiles = new Set(
            db.all(`SELECT DISTINCT file_path FROM nodes WHERE type = 'File' AND file_path != ''`)
              .map((row) => row.file_path),
          );
          for (const filePath of [...nextFingerprints.keys()]) {
            if (!liveFiles.has(filePath)) nextFingerprints.delete(filePath);
          }
        }
        await writeStructuralFpSidecar(graphDir, nextFingerprints);
      } catch {
        // Sidecar write is best-effort: a failure just disables the cosmetic
        // fast-path next run (everything treated structural) — never fatal.
      }

      const result = {
        indexed: true,
        commit,
        indexedAt: nextManifest.indexedAt,
        schemaVersion: SCHEMA_VERSION,
        extractorVersion: EXTRACTOR_VERSION,
        parserBundleVersion: PARSER_BUNDLE_VERSION,
        dirtyFiles: [],
        dirtyEdgeCount: resolved.unresolved.length,
        trustDirtyEdgeCount,
        unresolvedEdges: resolved.unresolved.length,
        nodes: nodeCount,
        edges: edgeCount,
        // ★ A DROPPED FILE MUST NOT BE NAMED AS PROCESSED.
        //
        // `existingFiles` is populated BEFORE the size/read/parse checks, so
        // `processedFiles` was listing files the run had deleted and failed to
        // re-extract. Found in field testing on a 4.1 MB miniaudio.h, 2026-08-11: the file
        // appeared in processedFiles, `graph_whereis("ma_device_init")` returned NO
        // MATCH, and the response carried no disclosure at all.
        //
        // That is worse than an omission. `graph_health` had the attestation and was
        // correct — but this is the response the REINDEXING agent reads, at the exact
        // moment it learns what the index did, and it affirmatively asserted the
        // opposite. A caller who checks the thing designed to be checked was misled.
        processedFiles: existingFiles.filter((f) => !skippedPaths.has(f)),
        // The same attestation the manifest carries, at the call site that needs it.
        // Success must attest corpus AND SCOPE — the manifest was the scope half; this
        // is the half a caller sees without being told to go look somewhere else.
        skippedFileCount: skipped.length,
        skippedFiles: skipped.slice(0, 50),
        sweepCounts: special.counts ?? null,
        docLinks: docLinkResult,
        docRefs: docRefResult,
        // Always false: partial resume was removed when the rebuild became atomic.
        resumedFromPartial: false,
        trustSpineDropped,
        cosmeticSkipped: cosmeticSkippedFiles.length,
      };
      return result;
      } catch (err) {
        // A rebuild that throws publishes NOTHING: the previous graph survives intact, and no
        // manifest or sidecar is written to claim otherwise. rollback() is a no-op once committed,
        // so a failure in a post-commit step still propagates without discarding the new graph.
        rebuildTxn.rollback();
        throw err;
      }
    } finally {
      db.close();
    }
  });
}

function shouldCarryForwardRef(ref, repoRoot, ignoredDirs, filesToProcess) {
  const sourceFile = normalizeRepoRelativePath(ref?.source_file);
  if (!sourceFile) return false;
  if (filesToProcess.includes(sourceFile)) return false;
  if (pathContainsIgnoredDir(sourceFile, ignoredDirs)) return false;
  return existsSync(join(repoRoot, sourceFile));
}

function shouldDeferUntrackedFreshness(db, filePath, entry) {
  return Boolean(entry?.untracked);
}

function clearSpecialNodes(db) {
  const placeholders = SPECIAL_TYPES.map((_, index) => `$type${index}`);
  const params = Object.fromEntries(SPECIAL_TYPES.map((type, index) => [`type${index}`, type]));

  db.run(
    `DELETE FROM edges
     WHERE from_id IN (SELECT id FROM nodes WHERE type IN (${placeholders.join(', ')}))
        OR to_id IN (SELECT id FROM nodes WHERE type IN (${placeholders.join(', ')}))`,
    params,
  );
  db.run(`DELETE FROM nodes WHERE type IN (${placeholders.join(', ')})`, params);
}

function deleteNodesForFile(db, filePath) {
  deleteEdgesByFile(db, filePath);
  const existing = getNodesByFile(db, filePath);
  for (const node of existing) {
    if (SPECIAL_TYPES.includes(node.type)) continue;
    deleteNode(db, node.id);
  }
}

function maybeGetLanguageConfig(filePath) {
  try {
    return getLanguageConfig(filePath);
  } catch {
    return null;
  }
}

// P1-6: classify a directly-changed file as 'cosmetic' or 'structural'.
// Returns 'cosmetic' ONLY when we have a stored fingerprint AND the file still
// parses to the identical structural shape (signatures + members + imports +
// the full outgoing call/ref target set). Everything else — no stored fp (new
// file), missing/oversize/unparseable file, or any mismatch — is 'structural',
// the safe default. The file must also already exist in the graph for a skip
// to be meaningful (otherwise there are no existing nodes/edges to keep).
async function classifyChangedFile({ db, repoRoot, relPath, storedFp }) {
  if (!storedFp) return 'structural';

  const absPath = join(repoRoot, relPath);
  if (!existsSync(absPath)) return 'structural'; // deleted → full handle

  const config = maybeGetLanguageConfig(relPath);
  if (!config) return 'structural';

  // The file must already be in the graph for a cosmetic skip to preserve
  // anything; if it isn't (somehow), re-extract it.
  if (getNodesByFile(db, relPath).length === 0) return 'structural';

  let fileStat;
  try {
    fileStat = await stat(absPath);
  } catch {
    return 'structural';
  }
  if (fileStat.size > 1_000_000) return 'structural';

  let source;
  try {
    source = await readFile(absPath, 'utf8');
  } catch {
    return 'structural';
  }

  let extracted;
  try {
    extracted = extractFile({ filePath: relPath, source, config });
  } catch {
    return 'structural';
  }

  const freshFp = fileStructuralFingerprint(extracted);
  return freshFp === storedFp ? 'cosmetic' : 'structural';
}

async function expandAffectedFiles(db, repoRoot, changedFiles) {
  const affected = new Set();

  for (const filePath of changedFiles) {
    affected.add(filePath);

    const existingNodes = getNodesByFile(db, filePath);
    if (existingNodes.length === 0) {
      continue;
    }

    const ids = existingNodes.map((node) => node.id);
    const placeholders = ids.map((_, index) => `$id${index}`);
    const params = Object.fromEntries(ids.map((id, index) => [`id${index}`, id]));
    const callers = db.all(
      `SELECT DISTINCT source_file
       FROM edges
       WHERE to_id IN (${placeholders.join(', ')})
         AND source_file != ''`,
      params,
    );

    for (const caller of callers) {
      if (caller.source_file && existsSync(join(repoRoot, caller.source_file))) {
        affected.add(caller.source_file);
      }
    }
  }

  return [...affected];
}

async function listRepoFiles(repoRoot, currentDir = repoRoot, ignoredDirs = IGNORED_DIRS) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const relPath = normalizeRelativePath(repoRoot, join(currentDir, entry.name));
      if (isIgnoredDirName(entry.name, ignoredDirs) || pathContainsIgnoredDir(relPath, ignoredDirs)) continue;
      // ⚠ THE RECURSIVE ONE, AND THE WORST SHAPE OF THE THREE: each directory spreads its ENTIRE
      // subtree into an argument list, so the deepest node is fine and the ROOT is what breaks.
      // It has not fired in the field, which is exactly why it is fixed here rather than after.
      appendAll(files, await listRepoFiles(repoRoot, join(currentDir, entry.name), ignoredDirs));
      continue;
    }

    const absPath = join(currentDir, entry.name);
    const relPath = normalizeRelativePath(repoRoot, absPath);
    if (pathContainsIgnoredDir(relPath, ignoredDirs)) continue;
    const fileStat = await stat(absPath);
    if (!fileStat.isFile()) continue;
    files.push(relPath);
  }

  return files;
}

function normalizeRelativePath(repoRoot, absPath) {
  return absPath
    .slice(repoRoot.length + 1)
    .replace(/\\/g, '/');
}

function cleanupOrphanExternalNodes(db) {
  db.run(`
    DELETE FROM nodes
    WHERE type = 'External'
      AND id NOT IN (
        SELECT from_id FROM edges
        UNION
        SELECT to_id FROM edges
      )
  `);
}
