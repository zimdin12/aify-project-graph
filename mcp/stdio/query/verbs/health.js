// graph_health — single trustable answer to "is the graph usable right now?"
//
// Echoes PM feedback 2026-04-21: "To answer 'is the graph usable right now?'
// an agent has to call graph_index, read brief.plan.md, parse the TRUST line,
// cross-reference. All three can disagree." This verb aggregates those signals
// into one response so a session can check health in a single call.
//
// Synthesis-only. No new data — just a coherent view of what graph_status +
// the overlay validator + the brief's trust logic already expose.

import { join } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { openExistingDb } from '../../storage/db.js';
import { loadManifest } from '../../freshness/manifest.js';
import { getDirtyFiles } from '../../freshness/git.js';
import { readArtifactIndexedAt } from '../../freshness/unresolved-categorization.js';
import { getHeadCommit } from '../../freshness/git.js';
import { getUnresolvedCounts } from '../../freshness/unresolved-metrics.js';
import { loadFunctionality, validateAnchors, hasOverlay } from '../../overlay/loader.js';
import { loadTasksArtifact, summarizeDirtySeams, summarizeOverlayQuality } from '../../overlay/quality.js';
import { getLatestCollection } from '../../code-intel/query.js';
import { prepareCompileDb } from '../../code-intel/compile-db.js';

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
  const dirtyFiles = await getDirtyFiles(repoRoot).catch(() => []);
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
          compileDbHash: latest.compileDbHash,
          indexedCommit: latest.indexedCommit,
          collectedAt: latest.collectedAt,
          operations: latest.operations,
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
          verdicts.push('⚠ compile-db FOREIGN (Linux/WSL) on a Windows host — clangd caller sets are silently TRUNCATED (even same-file refs); code_intel_references is NOT a completeness oracle here. FIX: generate a native Windows compile DB (Ninja+clang-cl: cmake -B build-win-clangd -G Ninja -DCMAKE_CXX_COMPILER=clang-cl -DCMAKE_EXPORT_COMPILE_COMMANDS=ON — APG auto-discovers it); fallback APG_CLANGD_WSL=1. Do NOT trust "no callers / safe to delete" until fixed.');
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
      : `trust=${trust} (${trustUnresolvedEdges} trust-relevant unresolved, ${unresolvedEdges} total)`,
  );
  if (manifestStatus !== 'ok') verdicts.push(`rebuild-incomplete: status=${manifestStatus} (run graph_index(force=true))`);
  if (stale) verdicts.push(`stale: indexed ${manifest.commit.slice(0,7)}, HEAD ${head.slice(0,7)}`);
  else verdicts.push('fresh');

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
  const STALE_ARTIFACT_DAYS = 14;
  try {
    for (const [name, file, fix] of [
      ['functionality', 'functionality.json', 'refresh with /graph-build-functionality'],
      ['tasks', 'tasks.json', 'refresh with /graph-build-tasks'],
    ]) {
      const p = join(repoRoot, '.aify-graph', file);
      if (!existsSync(p)) continue;
      const days = Math.floor((Date.now() - statSync(p).mtimeMs) / 86_400_000);
      artifactAges[name] = days;
      if (days >= STALE_ARTIFACT_DAYS) {
        verdicts.push(`⚠ ${file} is ${days} days old — graph_index does NOT refresh it (${fix})`);
      }
    }
  } catch { /* best-effort */ }
  // The code-intel collection is the trust spine; graph_index never refreshes it.
  const collectedDays = ageInDays(codeIntel?.collectedAt);
  if (collectedDays != null) {
    artifactAges.codeIntel = collectedDays;
    if (collectedDays >= STALE_ARTIFACT_DAYS) {
      verdicts.push(`⚠ code-intel collection is ${collectedDays} days old — [lsp✓] evidence is stale and cannot attest exhaustiveness (re-run graph_collect_code_intel)`);
    }
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
  if (dirtyFiles.length > 0) {
    if (dirtySeams.features.length > 0) {
      const preview = dirtySeams.features.slice(0, 3)
        .map((f) => `${f.id}(${f.file_count})`)
        .join(', ');
      const orphan = dirtySeams.orphanDirtyFiles > 0 ? `, orphan ${dirtySeams.orphanDirtyFiles}` : '';
      verdicts.push(`dirty-seams: ${preview}${orphan}`);
    } else {
      verdicts.push(`dirty=${dirtyFiles.length} files`);
    }
  }
  if (briefStaleVsManifest) {
    verdicts.push('brief-stale: regenerate with graph-brief.mjs');
  }
  if (unresolvedCategorizationStaleVsManifest) {
    verdicts.push('categorization-stale: regenerate via graph_index()');
  }

  return {
    indexed: true,
    trust,
    unresolvedEdges,
    trustUnresolvedEdges,
    nodes,
    edges,
    dirtyFiles,
    dirtySeams,
    commit: manifest?.commit ?? null,
    currentHead: head,
    stale,
    manifestStatus,
    briefStaleVsManifest,
    unresolvedCategorizationStaleVsManifest,
    overlay,
    overlayQuality,
    codeIntel,
    // Age in days of the derived artifacts graph_index does NOT refresh
    // (functionality / tasks / codeIntel). LH-3.
    artifactAges,
    summary: verdicts.join(' · '),
  };
}
