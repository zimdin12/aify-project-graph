import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../storage/db.js';
import { SCHEMA_VERSION } from '../storage/schema.js';
import { upsertNode, getNodesByFile, deleteNode, countNodes } from '../storage/nodes.js';
import { upsertEdge, deleteEdgesByFile, countEdges } from '../storage/edges.js';
import { getHeadCommit, getDirtyFiles, getChangedFiles } from './git.js';
import { loadManifest, writeManifest } from './manifest.js';
import { withWriteLock } from './lock.js';
import { getLanguageConfig } from '../ingest/languages/index.js';
import { extractFile } from '../ingest/extractors/generic.js';
import { sweepFilesystem } from '../ingest/sweep.js';
import { applyFrameworkPlugins } from '../ingest/extractors/base.js';
import { laravelRoutesPlugin } from '../ingest/frameworks/laravel.js';
import { resolveRefs } from '../ingest/resolver.js';
import { detectCommunities } from '../analysis/communities.js';
import { detectMentions } from '../analysis/mentions.js';

const EXTRACTOR_VERSION = '0.1.0';
const PARSER_BUNDLE_VERSION = '2026.04.16';
const SPECIAL_TYPES = ['Directory', 'Document', 'Config', 'Route', 'Entrypoint', 'Schema'];
const IGNORED_DIRS = new Set(['.git', '.aify-graph', 'node_modules']);

// TTL cache: skip git checks if the graph was confirmed fresh within the last 5 seconds
const freshCache = new Map(); // repoRoot → { ts, result }
const FRESH_TTL_MS = 5000;

export async function ensureFresh({ repoRoot, graphDir = join(repoRoot, '.aify-graph'), force = false }) {
  // Fast path: if we confirmed freshness recently and no force, return cached result
  if (!force) {
    const cached = freshCache.get(repoRoot);
    if (cached && Date.now() - cached.ts < FRESH_TTL_MS) {
      return cached.result;
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
    const dirtyFiles = [...new Set([
      ...(await getDirtyFiles(repoRoot)),
      ...(manifest.dirtyFiles ?? []),
    ])];
    const changedFromCommit = !force && manifest.commit && manifest.commit !== commit
      ? await getChangedFiles(repoRoot, manifest.commit, commit)
      : [];
    const initialChanged = [...new Set([...dirtyFiles, ...changedFromCommit])];

    const db = openDb(join(graphDir, 'graph.sqlite'));
    try {
      const fullRebuild = force || manifestState.status !== 'ok' || !manifest.commit || manifest.status === 'indexing';
      const filesToProcess = fullRebuild
        ? await listRepoFiles(repoRoot)
        : await expandAffectedFiles(db, repoRoot, initialChanged);

      // Noop path: if no files to process and not a full rebuild, return early
      if (!fullRebuild && filesToProcess.length === 0) {
        db.close();
        const noopResult = {
          indexed: true, commit, indexedAt: manifest.indexedAt,
          schemaVersion: SCHEMA_VERSION, extractorVersion: EXTRACTOR_VERSION,
          parserBundleVersion: PARSER_BUNDLE_VERSION,
          dirtyFiles: [], dirtyEdgeCount: (manifest.dirtyEdges ?? []).length,
          unresolvedEdges: (manifest.dirtyEdges ?? []).length,
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

      const special = await sweepFilesystem({ repoRoot });
      const specialPlugins = await applyFrameworkPlugins({
        repoRoot,
        result: { nodes: [], edges: [], refs: [] },
        plugins: [laravelRoutesPlugin],
      });

      // Batch all inserts in a transaction for performance
      const batchInsert = db.transaction(() => {
        for (const node of special.nodes) upsertNode(db, node);
        for (const edge of special.edges) upsertEdge(db, edge);
        for (const node of specialPlugins.nodes) upsertNode(db, node);
        for (const edge of specialPlugins.edges) upsertEdge(db, edge);
      });
      batchInsert();

      const refs = [...specialPlugins.refs, ...(manifest.dirtyEdges ?? [])];
      const existingFiles = [];

      // Wrap ALL per-file extraction in one transaction — 50-100x faster on large repos
      db.raw.exec('BEGIN');
      try {

      for (const relPath of filesToProcess) {
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

        try {
          const source = await readFile(absPath, 'utf8');
          const extracted = extractFile({ filePath: relPath, source, config });
          for (const node of extracted.nodes) upsertNode(db, node);
          for (const edge of extracted.edges) upsertEdge(db, edge);
          refs.push(...extracted.refs);
        } catch {
          // Skip files that fail to parse — non-fatal
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
        const batchResolvedEdges = db.transaction(() => {
          for (const edge of resolved.edges) upsertEdge(db, edge);
        });
        batchResolvedEdges();
      } catch (err) {
        // Resolution failed on large graph — proceed with partial edges
        resolved = { edges: [], unresolved: refs };
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
        // Cap dirty edges in manifest to prevent huge JSON serialization on large repos
        dirtyEdges: resolved.unresolved.length > 500
          ? resolved.unresolved.slice(0, 500)
          : resolved.unresolved,
        dirtyEdgeCount: resolved.unresolved.length,
      };
      await writeManifest(graphDir, nextManifest);

      return {
        indexed: true,
        commit,
        indexedAt: nextManifest.indexedAt,
        schemaVersion: SCHEMA_VERSION,
        extractorVersion: EXTRACTOR_VERSION,
        parserBundleVersion: PARSER_BUNDLE_VERSION,
        dirtyFiles: [],
        dirtyEdgeCount: resolved.unresolved.length,
        unresolvedEdges: resolved.unresolved.length,
        nodes: nodeCount,
        edges: edgeCount,
        processedFiles: existingFiles,
      };
    } finally {
      db.close();
    }
  });
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

async function listRepoFiles(repoRoot, currentDir = repoRoot) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      files.push(...await listRepoFiles(repoRoot, join(currentDir, entry.name)));
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
