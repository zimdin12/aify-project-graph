import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureFresh } from '../../freshness/orchestrator.js';
import { getDirtyFiles, getHeadCommit } from '../../freshness/git.js';
import { loadManifest } from '../../freshness/manifest.js';
import { openExistingDb } from '../../storage/db.js';
import { SCHEMA_VERSION } from '../../storage/schema.js';

function buildIncompleteMessage({ verbName, alreadyIndexedFiles = null, pendingFiles = null }) {
  const scope = pendingFiles == null
    ? (alreadyIndexedFiles == null
        ? 'The current graph snapshot is incomplete.'
        : `${alreadyIndexedFiles} files already indexed; pending file count skipped to keep this read fast.`)
    : `${alreadyIndexedFiles ?? 0} files already indexed, ${pendingFiles} still pending.`;

  return [
    `GRAPH REBUILD INCOMPLETE — ${verbName} is deferred to avoid mutating the graph during a read.`,
    scope,
    'Run graph_index(force=true) before relying on live cross-file graph answers on this repo.',
    'Until then, use briefs/static artifacts for orientation and verify in source files.',
  ].join('\n');
}

function buildSchemaMismatchMessage({ verbName, schemaVersion }) {
  return [
    `GRAPH SCHEMA MISMATCH — ${verbName} only reads completed snapshots and will not auto-migrate them.`,
    `Graph schema=${schemaVersion ?? 1}, runtime schema=${SCHEMA_VERSION}.`,
    'Run graph_index(force=true) to rebuild this repo on the current schema.',
  ].join('\n');
}

export async function inspectReadFreshness({ repoRoot, verbName }) {
  const graphDir = join(repoRoot, '.aify-graph');
  const dbPath = join(graphDir, 'graph.sqlite');

  if (!existsSync(dbPath)) {
    await ensureFresh({ repoRoot });
    return {
      blocker: null,
      warnings: [],
      graphDir,
      dbPath,
    };
  }

  const manifestState = await loadManifest(graphDir);
  const { manifest } = manifestState;
  if (manifestState.status !== 'ok') {
    return {
      blocker: null,
      warnings: ['graph manifest missing or corrupt; reading the current DB snapshot directly'],
      graphDir,
      dbPath,
      manifest,
    };
  }

  const schemaVersion = manifest.schemaVersion ?? 1;
  if (schemaVersion !== SCHEMA_VERSION) {
    return {
      blocker: buildSchemaMismatchMessage({ verbName, schemaVersion }),
      warnings: [],
      graphDir,
      dbPath,
      manifest,
    };
  }

  let alreadyIndexedFiles = null;
  try {
    const db = openExistingDb(dbPath);
    try {
      alreadyIndexedFiles = db.all(`SELECT DISTINCT file_path FROM nodes WHERE type = 'File'`).length;
    } finally {
      db.close();
    }
  } catch {
    // Leave null — the caller still gets the incomplete blocker below.
  }

  if (manifest.status === 'indexing') {
    return {
      blocker: buildIncompleteMessage({ verbName, alreadyIndexedFiles, pendingFiles: null }),
      warnings: [],
      graphDir,
      dbPath,
      manifest,
    };
  }

  const warnings = [];
  const head = await getHeadCommit(repoRoot).catch(() => null);
  const dirtyFiles = await getDirtyFiles(repoRoot).catch(() => []);
  if (manifest.commit && head && manifest.commit !== head) {
    warnings.push(`graph snapshot is stale: indexed ${manifest.commit.slice(0, 7)}, HEAD ${head.slice(0, 7)}`);
  }
  if (dirtyFiles.length > 0) {
    warnings.push(`working tree has ${dirtyFiles.length} dirty file${dirtyFiles.length === 1 ? '' : 's'}; live reads use the last completed snapshot`);
  }

  return {
    blocker: null,
    warnings,
    head,
    dirtyFiles,
    graphDir,
    dbPath,
    manifest,
  };
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
