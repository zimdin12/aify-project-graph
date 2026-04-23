import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../storage/db.js';
import { SCHEMA_VERSION } from '../storage/schema.js';
import { upsertNode, getNodesByFile, deleteNode, countNodes } from '../storage/nodes.js';
import { upsertEdge, deleteEdgesByFile, countEdges } from '../storage/edges.js';
import { getHeadCommit, getDirtyFileEntries, getChangedFiles } from './git.js';
import { loadManifest, writeManifest } from './manifest.js';
import { readDirtyEdgesSidecar, writeDirtyEdgesSidecar } from './dirty-edges-sidecar.js';
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
import { nodeWebPlugin } from '../ingest/frameworks/node_web.js';
import { nestjsPlugin } from '../ingest/frameworks/nestjs.js';
import { railsPlugin } from '../ingest/frameworks/rails.js';
import { springPlugin } from '../ingest/frameworks/spring.js';
import { cppFrameworksPlugin } from '../ingest/frameworks/cpp_frameworks.js';
import { resolveRefs } from '../ingest/resolver.js';
import { detectCommunities } from '../analysis/communities.js';
import { detectMentions } from '../analysis/mentions.js';

const EXTRACTOR_VERSION = '0.1.0';
const PARSER_BUNDLE_VERSION = '2026.04.16';
const SPECIAL_TYPES = ['Directory', 'Document', 'Config', 'Route', 'Entrypoint', 'Schema'];
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

export async function ensureFresh({
  repoRoot,
  graphDir = join(repoRoot, '.aify-graph'),
  force = false,
  allowLargePartialResume = true,
  partialResumeLimit = 250,
}) {
  // Fast path: if we confirmed freshness recently and no force, return cached result
  if (!force) {
    const cached = freshCache.get(repoRoot);
    if (cached && Date.now() - cached.ts < FRESH_TTL_MS) {
      return cached.result;
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
    ) {
      const db = openDb(dbPath);
      try {
        if (countNodes(db) > 0) {
          const deferredResult = buildDeferredPartialResumeResult({ db, manifest, commit });
          freshCache.set(repoRoot, { ts: Date.now(), result: deferredResult });
          return deferredResult;
        }
      } finally {
        db.close();
      }
    }
  }

  return withWriteLock(repoRoot, async () => {
    // Double-check cache inside lock (another call may have populated it)
    if (!force) {
      const cached = freshCache.get(repoRoot);
      if (cached && Date.now() - cached.ts < FRESH_TTL_MS) {
        return cached.result;
      }
    }

    const manifestState = await loadManifest(graphDir);
    const manifest = manifestState.manifest;
    const commit = await getHeadCommit(repoRoot);
    const dirtyEntries = await getDirtyFileEntries(repoRoot);
    const dirtyFiles = [...new Set([
      ...dirtyEntries.map((entry) => entry.path),
      ...(manifest.dirtyFiles ?? []),
    ])];
    const changedFromCommit = !force && manifest.commit && manifest.commit !== commit
      ? await getChangedFiles(repoRoot, manifest.commit, commit)
      : [];
    const initialChanged = [...new Set([...dirtyFiles, ...changedFromCommit])];

    const db = openDb(join(graphDir, 'graph.sqlite'));
    try {
      const schemaMismatch = (manifest.schemaVersion ?? 1) !== SCHEMA_VERSION;

      // Crash-recovery: if the previous run wrote `status: 'indexing'` and
      // crashed before flipping to `'ok'`, the chunked-commit code has
      // already preserved some nodes in SQLite. We can resume from that
      // partial state instead of wiping and starting over — but only when
      // the schema/commit still match. Cross-file refs emitted by
      // previously-processed files were held in JS at crash time and are
      // lost, so the resumed graph will have complete nodes/DEFINES/CONTAINS
      // but potentially incomplete CALLS/IMPORTS/EXTENDS for pre-crash
      // files. A follow-up `force=true` gives a clean graph.
      const existingNodeCount = countNodes(db);
      const canResumeFromPartial = !force
        && !schemaMismatch
        && manifest.status === 'indexing'
        && manifest.commit
        && manifest.commit === commit
        && existingNodeCount > 0;

      const fullRebuild = !canResumeFromPartial && (force
        || manifestState.status !== 'ok'
        || !manifest.commit
        || manifest.status === 'indexing'
        || schemaMismatch);

      const effectiveIgnoredDirs = loadEffectiveIgnoredDirs(repoRoot);
      let filesToProcess;
      let resumedFromPartial = false;
      if (fullRebuild) {
        filesToProcess = await listRepoFiles(repoRoot, repoRoot, effectiveIgnoredDirs);
      } else if (canResumeFromPartial) {
        const alreadyProcessed = new Set(
          db.all(`SELECT DISTINCT file_path FROM nodes WHERE type = 'File'`).map((row) => row.file_path),
        );
        if (!allowLargePartialResume) {
          const deferredResult = buildDeferredPartialResumeResult({ db, manifest, commit });
          deferredResult.alreadyProcessedFiles = alreadyProcessed.size;
          freshCache.set(repoRoot, { ts: Date.now(), result: deferredResult });
          return deferredResult;
        }
        const allFiles = await listRepoFiles(repoRoot, repoRoot, effectiveIgnoredDirs);
        filesToProcess = allFiles.filter((relPath) => !alreadyProcessed.has(relPath));
        resumedFromPartial = true;
        // Intentional console warning: callers/agents should know cross-file
        // refs for pre-crash files may be incomplete until next force rebuild.
        console.warn(`[aify-project-graph] Resuming crashed rebuild: ${alreadyProcessed.size} files already indexed, ${filesToProcess.length} pending. Run graph_index(force=true) for a clean rebuild if cross-file edges look incomplete.`);
      } else {
        filesToProcess = await expandAffectedFiles(db, repoRoot, initialChanged);
        const dirtyEntryMap = new Map(dirtyEntries.map((entry) => [entry.path, entry]));
        filesToProcess = filesToProcess.filter((filePath) => {
          const entry = dirtyEntryMap.get(filePath);
          return !shouldDeferUntrackedFreshness(db, filePath, entry);
        });
      }

      // Noop path: if no files to process and not a full rebuild, return early
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
        };
        freshCache.set(repoRoot, { ts: Date.now(), result: noopResult });
        return noopResult;
      }

      // Mark manifest as indexing BEFORE mutating DB — crash safety
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
          nodeWebPlugin,
          nestjsPlugin,
          railsPlugin,
          springPlugin,
          cppFrameworksPlugin,
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

      // Extract in bounded chunks so a mid-run failure only loses the current chunk.
      let chunkSize = 0;
      db.raw.exec('BEGIN');
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
            deleteNodesForFile(db, relPath);
            continue;
          }

          deleteNodesForFile(db, relPath);

          let source;
          try {
            source = await readFile(absPath, 'utf8');
          } catch {
            // Skip files that fail to read — non-fatal
            continue;
          }

          let extracted;
          try {
            extracted = extractFile({ filePath: relPath, source, config });
          } catch {
            // Skip files that fail to parse — non-fatal
            continue;
          }

          for (const node of extracted.nodes) upsertNode(db, node);
          for (const edge of extracted.edges) upsertEdge(db, edge);
          refs.push(...extracted.refs);
          chunkSize += 1;
          if (chunkSize >= EXTRACTION_CHUNK_SIZE) {
            db.raw.exec('COMMIT');
            db.raw.exec('BEGIN');
            chunkSize = 0;
          }
        } catch {
          // File-scope failure: discard the current chunk and keep going.
          try { db.raw.exec('ROLLBACK'); } catch {}
          db.raw.exec('BEGIN');
          chunkSize = 0;
        }
      }

      db.raw.exec('COMMIT');
      } catch (err) {
        try { db.raw.exec('ROLLBACK'); } catch {}
        throw err;
      }

      let resolved = { edges: [], unresolved: [] };
      try {
        resolved = resolveRefs({ db, refs });
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

      // Post-indexing analysis (skip on very large graphs to avoid OOM)
      const nodeCount0 = countNodes(db);
      let communityResult = { communities: 0 };
      if (nodeCount0 <= 20000) {
        try {
          communityResult = detectCommunities(db);
        } catch (err) {
          // Community detection failed (OOM on large graphs) — non-fatal
        }
        try {
          await detectMentions(db, repoRoot);
        } catch (err) {
          // Mentions detection failed — non-fatal
        }
      }

      const nodeCount = countNodes(db);
      const edgeCount = countEdges(db);
      const trustDirtyEdgeCount = countTrustRelevantDirtyEdges(resolved.unresolved);

      const nextManifest = {
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
      };
      await writeManifest(graphDir, nextManifest);
      await writeDirtyEdgesSidecar(graphDir, resolved.unresolved);

      return {
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
        processedFiles: existingFiles,
        resumedFromPartial,
      };
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
      if (isIgnoredDirName(entry.name, ignoredDirs)) continue;
      files.push(...await listRepoFiles(repoRoot, join(currentDir, entry.name), ignoredDirs));
      continue;
    }

    const absPath = join(currentDir, entry.name);
    const fileStat = await stat(absPath);
    if (!fileStat.isFile()) continue;
    files.push(normalizeRelativePath(repoRoot, absPath));
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
