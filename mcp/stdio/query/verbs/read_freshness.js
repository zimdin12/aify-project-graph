import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureFresh } from '../../freshness/orchestrator.js';
import { getDirtyFileEntries, getHeadCommit } from '../../freshness/git.js';
import { loadManifest } from '../../freshness/manifest.js';
import { openExistingDb } from '../../storage/db.js';
import { SCHEMA_VERSION } from '../../storage/schema.js';

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
  if (!freshness || !freshness.stale) return '';
  const n = freshness.commitsBehind;
  const behind = n != null
    ? `${n} commit${n === 1 ? '' : 's'} behind HEAD`
    : 'behind HEAD';
  return [
    `NOTE: index is ${behind} — this symbol may be newly added but not yet indexed.`,
    'Run graph_index() and retry; a "not found" here is NOT proof the symbol does not exist.',
  ].join('\n');
}

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
  const dirtyEntries = await getDirtyFileEntries(repoRoot).catch(() => []);
  const dirtyFiles = dirtyEntries.map((e) => e.path);
  const stale = Boolean(manifest.commit && head && manifest.commit !== head);
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
  const trackedDirty = dirtyEntries.filter((e) => !e.untracked).map((e) => e.path);
  if (trackedDirty.length > 0) {
    warnings.push(`working tree has ${trackedDirty.length} modified tracked file${trackedDirty.length === 1 ? '' : 's'}; live reads use the last completed snapshot`);
  }

  return {
    blocker: null,
    warnings,
    head,
    dirtyFiles,
    stale,
    commitsBehind,
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
