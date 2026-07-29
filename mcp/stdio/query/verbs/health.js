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
import { readArtifactIndexedAt } from '../../freshness/unresolved-categorization.js';
import { getHeadCommit } from '../../freshness/git.js';
import { getUnresolvedCounts } from '../../freshness/unresolved-metrics.js';
import { loadFunctionality, validateAnchors, hasOverlay } from '../../overlay/loader.js';
import { loadTasksArtifact, lintTaskSchema, summarizeDirtySeams, summarizeOverlayQuality } from '../../overlay/quality.js';
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

// Which BUILD of the server is answering — not which commit of the target repo
// is indexed. An MCP server process is long-lived and does not hot-reload, so
// "pushed" and "in effect for this agent" are different states. A field tester
// hit exactly this: they could only tell their server predated a fix by probing
// for a behavioural side effect of that fix, which happens to work only when a
// change is observable in output. Reporting the build makes that a one-call check.
//
// Cached: the build cannot change while this process lives.
let _serverBuild;
function serverBuild() {
  if (_serverBuild) return _serverBuild;
  // .../mcp/stdio/query/verbs/health.js -> repo root
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', '..', '..', '..');
  let version = null;
  try { version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? null; } catch { /* ignore */ }
  let commit = null;
  let dirty = null;
  try {
    commit = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim() || null;
    dirty = execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim().length > 0;
  } catch { /* not a git checkout (installed copy) — version alone still identifies it */ }
  _serverBuild = { version, commit, dirty, startedAt: new Date().toISOString() };
  return _serverBuild;
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
        codeIntel.lspVerifiedPctOfCalls = calls > 0 ? Math.round((verified / calls) * 100) : 0;
        if (calls > 0 && verified === 0) {
          codeIntel.callerCompletenessTrustworthy = false;
          verdicts.push('⚠ trust spine EMPTY: 0 of ' + calls + ' CALLS edges are [lsp✓] verified — every caller answer is heuristic-only and CANNOT attest exhaustiveness. '
            + 'A full reindex drops verified edges; run graph_collect_code_intel to restore them.');
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

  return {
    indexed: true,
    trust,
    unresolvedEdges,
    trustUnresolvedEdges,
    nodes,
    edges,
    dirtyFiles,
    trackedDirtyFiles,
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
    server: serverBuild(),
    summary: verdicts.join(' · '),
  };
}
