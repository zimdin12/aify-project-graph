// graph_consequences — the flagship traversal verb.
//
// Answers "what breaks if I touch X?" by walking across every layer the
// graph stores: code → feature → contract → task → test → recent activity.
// Per echoes PM 2026-04-21: "none of the 8 test agents asked for this
// because the verb doesn't exist; they all reached for find/whereis
// instead. graph_consequences is what a planning or debugging agent
// actually needs."
//
// Input: symbol name OR file path.
// Output: ranked list — contracts potentially affected, features touching
// this symbol, open tasks on those features, adjacent tests, last touched.
//
// Synthesis-only. No new data. Pulls from existing code graph + overlays
// + git log.

import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { openExistingDb } from '../../storage/db.js';
import { loadManifest } from '../../freshness/manifest.js';
import { getUnresolvedCounts } from '../../freshness/unresolved-metrics.js';
import { loadFunctionality, hasOverlay } from '../../overlay/loader.js';
import { summarizeDirtySeams, taskLinkStrength } from '../../overlay/quality.js';
import { getDirtyFiles } from '../../freshness/git.js';
import { computeTrustLevel } from './health.js';
import { buildAmbiguousMatchMessage, resolveSymbol } from './symbol_lookup.js';
import { attachReadWarnings, inspectReadFreshness } from './read_freshness.js';

// Class names often appear multiple times — forward declarations in
// headers + the definition body in a .cpp/.ts. Prefer non-header files
// when any exist, otherwise take the lowest-line match (first declaration).
// Cap at 3 primary matches — if there's real ambiguity, we want to see it.
function pickPrimarySymbol(nodes) {
  if (nodes.length === 0) return [];
  const nonHeader = nodes.filter((n) => !/\.(h|hpp|hxx|d\.ts)$/i.test(n.file_path || ''));
  const pool = nonHeader.length > 0 ? nonHeader : nodes;
  return pool.slice(0, 3);
}

// Rank open tasks by rough priority signal — explicit priority field first,
// then status (in-progress > open > todo), then id string desc (newer IDs
// usually sort later in trackers like ClickUp). Agents need the top-N, not
// a 22-item flat list.
function rankTasks(tasks) {
  const priorityWeight = { urgent: 4, high: 3, normal: 2, low: 1 };
  const statusWeight = { in_progress: 3, 'in-progress': 3, progress: 3, active: 2, open: 1, todo: 1 };
  return [...tasks].sort((a, b) => {
    const pa = priorityWeight[(a.priority ?? '').toLowerCase()] ?? 0;
    const pb = priorityWeight[(b.priority ?? '').toLowerCase()] ?? 0;
    if (pa !== pb) return pb - pa;
    const sa = statusWeight[(a.status ?? '').toLowerCase()] ?? 0;
    const sb = statusWeight[(b.status ?? '').toLowerCase()] ?? 0;
    if (sa !== sb) return sb - sa;
    return (b.id ?? '').localeCompare(a.id ?? '');
  });
}

// Relative-age string — "2 days ago", "3 weeks ago" — more actionable than
// a raw ISO date for recency-as-signal questions. Echoes PM ask #9.
// Resolve a task-id target → its feature bindings → sibling tasks on those
// features + affected contracts. Returns null if no task matches.
function resolveTaskTarget(repoRoot, target) {
  const tasksPath = join(repoRoot, '.aify-graph', 'tasks.json');
  const funcPath = join(repoRoot, '.aify-graph', 'functionality.json');
  if (!existsSync(tasksPath)) return null;
  let tasksRaw;
  try { tasksRaw = JSON.parse(readFileSync(tasksPath, 'utf8')); } catch { return null; }
  const task = (tasksRaw.tasks ?? []).find((t) => t.id === target);
  if (!task) return null;
  const featureIds = task.features ?? task.related_features ?? [];
  let features = [];
  let contracts = [];
  if (existsSync(funcPath)) {
    try {
      const funcRaw = JSON.parse(readFileSync(funcPath, 'utf8'));
      features = (funcRaw.features ?? [])
        .filter((f) => featureIds.includes(f.id))
        .map((f) => ({ id: f.id, label: f.label, contracts: f.contracts ?? [] }));
      contracts = [...new Set(features.flatMap((f) => f.contracts))].filter(Boolean);
    } catch {
      // ignore
    }
  }
  const siblingTasks = (tasksRaw.tasks ?? [])
    .filter((t) => t.id !== target)
    .filter((t) => t.status && /open|progress|active|todo|in_progress/i.test(t.status))
    .filter((t) => {
      const refs = t.features ?? t.related_features ?? [];
      return refs.some((f) => featureIds.includes(f));
    })
    .map((t) => ({
      id: t.id,
      title: t.title ?? '',
      status: t.status,
      priority: t.priority ?? null,
      features: t.features ?? t.related_features ?? [],
      link_strength: taskLinkStrength(t),
      evidence: t.evidence ?? null,
    }));
  return {
    task: {
      id: task.id,
      title: task.title ?? '',
      status: task.status,
      features: featureIds,
      link_strength: taskLinkStrength(task),
      evidence: task.evidence ?? null,
    },
    features,
    contracts,
    siblingTasks,
  };
}

function daysAgo(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr);
  if (Number.isNaN(then.getTime())) return null;
  const d = Math.floor((Date.now() - then.getTime()) / 86400000);
  return d;
}

async function loadTrustContext(repoRoot) {
  const { manifest } = await loadManifest(join(repoRoot, '.aify-graph'));
  const { total, trust } = getUnresolvedCounts(manifest);
  const level = computeTrustLevel(trust);
  return {
    level,
    trust_relevant_unresolved: trust,
    total_unresolved: total,
    advisory: level === 'weak'
      ? 'Weak graph trust: prefer graph_pull(node=...) for narrower live context and verify in source.'
      : null,
  };
}

export async function graphConsequences({ repoRoot, target, symbol }) {
  const input = target ?? symbol;
  if (!input) return 'ERROR: target (symbol or file path) is required';
  const trust = await loadTrustContext(repoRoot);

  // Task-id targets are overlay-native. Resolve them before freshness so
  // task-centric planning doesn't pay a whole-graph refresh cost just to
  // read tasks.json + functionality.json.
  const taskMatch = resolveTaskTarget(repoRoot, input);
  if (taskMatch) {
    return {
      target: input,
      resolved_from_task: taskMatch.task,
      trust,
      features_touching: taskMatch.features,
      contracts_potentially_affected: taskMatch.contracts,
      open_tasks_on_those_features: taskMatch.siblingTasks,
      top_related_tasks: rankTasks(taskMatch.siblingTasks).slice(0, 3),
      note: 'Input matched a task id. For per-symbol/file consequences, pass a symbol or file path.',
    };
  }

  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_consequences' });
  if (freshness.blocker) return freshness.blocker;
  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const functionality = hasOverlay(repoRoot) ? loadFunctionality(repoRoot) : { features: [] };
    const dirtyFiles = await getDirtyFiles(repoRoot).catch(() => []);

    // 1. Resolve input to concrete code nodes (symbol match OR file match).
    // For a class name that exists in multiple files (forward decls in
    // headers + the definition in a .cpp/.ts), prefer the one with a real
    // body. `start_line` is populated for definitions; forward decls often
    // still have one but come from headers. Heuristic: pick the node whose
    // file is NOT a header (.h/.hpp) when a non-header definition exists.
    const allSymbolMatches = resolveSymbol(
      db,
      input,
      "'Function','Method','Class','Interface','Type'",
    );
    const ambiguity = buildAmbiguousMatchMessage(input, allSymbolMatches);
    if (ambiguity) return ambiguity;
    const symbolNodes = pickPrimarySymbol(allSymbolMatches);
    const referencedIn = allSymbolMatches
      .filter((n) => !symbolNodes.some((s) => s.id === n.id))
      .map((n) => n.file_path)
      .filter(Boolean);

    const fileNodes = db.all(
      `SELECT id, label, type, file_path FROM nodes
       WHERE type IN ('File','Directory') AND (file_path = $t OR file_path LIKE $p)
       LIMIT 10`, { t: input, p: `%/${input}` });
    const matches = [...symbolNodes, ...fileNodes];
    if (matches.length === 0) {
      return `NO MATCH for "${input}". Try graph_search(query="${input}") to find similar names, or pass a repo-relative file path.`;
    }

    const matchedFiles = new Set(matches.map((n) => n.file_path).filter(Boolean));
    const matchedSymbols = new Set(symbolNodes.map((n) => n.label));

    // 2. Features touching this symbol/file. Three paths to a hit, in order:
    //   (a) anchor_match=symbol — feature.anchors.symbols contains the symbol
    //   (b) anchor_match=file   — feature.anchors.files contains the file (or dir glob)
    //   (c) anchor_match=task   — a task in tasks.json references this file
    //                             (via files_hint OR title substring on basename)
    //                             and that task is bound to the feature.
    // Path (c) was missing before 2026-04-22; echoes manager found that
    // `graph_consequences("engine/voxel/ChunkTimeSkip.cpp")` returned empty
    // features despite `tasks.json` mapping the file to chunk-management via
    // a task. The verb now surfaces that link explicitly.
    const features = [];
    const affectedFeatureIds = new Set();
    // Pre-compute task-based reverse lookup before iterating features so
    // we know which features are reached by task references to matchedFiles.
    const featureIdsReachedViaTasks = new Map(); // featureId → [taskId, ...]
    const tasksPath = join(repoRoot, '.aify-graph', 'tasks.json');
    let tasksRaw = null;
    if (existsSync(tasksPath) && matchedFiles.size > 0) {
      try {
        tasksRaw = JSON.parse(readFileSync(tasksPath, 'utf8'));
        // Precompute basenames for two confidence tiers:
        //   high — task.files_hint[] exact match (clean contract)
        //   low  — task.title substring-matches a file basename, but ONLY
        //          if the basename is >=8 chars OR contains uppercase
        //          (CamelCase convention: "ChunkTimeSkip" ok;
        //          "helpers" rejected). Reduces false-positives on short
        //          common words while catching real identifier references.
        const fileBasenames = [...matchedFiles].map((p) => {
          const slash = p.lastIndexOf('/');
          const raw = slash >= 0 ? p.slice(slash + 1) : p;
          const dot = raw.lastIndexOf('.');
          return dot > 0 ? raw.slice(0, dot) : raw;
        });
        const titleMatchBasenames = fileBasenames.filter((b) => b.length >= 8 || /[A-Z]/.test(b));
        for (const t of tasksRaw.tasks ?? []) {
          const fileHintHit = Array.isArray(t.files_hint)
            && t.files_hint.some((h) => matchedFiles.has(h) || [...matchedFiles].some((p) => p.endsWith('/' + h)));
          const titleHit = !fileHintHit
            && typeof t.title === 'string'
            && titleMatchBasenames.some((b) => t.title.toLowerCase().includes(b.toLowerCase()));
          if (!fileHintHit && !titleHit) continue;
          const refs = t.features ?? t.related_features ?? [];
          for (const fid of refs) {
            if (!featureIdsReachedViaTasks.has(fid)) featureIdsReachedViaTasks.set(fid, []);
            featureIdsReachedViaTasks.get(fid).push({
              id: t.id,
              match: fileHintHit ? 'files_hint' : 'title_substring',
            });
          }
        }
      } catch {
        // malformed tasks.json — skip reverse lookup
      }
    }
    if (functionality.features.length > 0) {
      for (const f of functionality.features ?? []) {
        const symbolHit = (f.anchors?.symbols ?? []).some((s) => matchedSymbols.has(s));
        const fileHit = (f.anchors?.files ?? []).some((pattern) => {
          // Cheap glob: `foo/*` → matches any file under foo/
          if (pattern.endsWith('/*')) return [...matchedFiles].some((p) => p.startsWith(pattern.slice(0, -1)));
          return matchedFiles.has(pattern);
        });
        const taskHit = featureIdsReachedViaTasks.has(f.id);
        if (symbolHit || fileHit || taskHit) {
          features.push({
            id: f.id,
            label: f.label,
            anchor_match: symbolHit ? 'symbol' : fileHit ? 'file' : 'task',
            reached_via_tasks: taskHit ? featureIdsReachedViaTasks.get(f.id) : undefined,
            contracts: f.contracts ?? [],
            anchor_docs: f.anchors?.docs ?? [],
            depends_on: f.depends_on ?? [],
            related_to: f.related_to ?? [],
          });
          affectedFeatureIds.add(f.id);
        }
      }
    }

    // 3. Contracts + spec docs union across features. Spec docs are any
    // docs[] anchors on the feature — echoes PM Tier B #10: "Currently
    // shows contracts + features, missing SPEC docs referenced by any
    // bound task's files_hint or feature.docs." We surface feature.anchors.docs
    // here; task-files_hint will fold in when that overlay field matures.
    const contracts = [...new Set(features.flatMap((f) => f.contracts))].filter(Boolean);
    const specDocs = [...new Set(features.flatMap((f) => f.anchor_docs ?? []))].filter(Boolean);

    // 4. Open tasks bound to affected features. Reuse the tasks.json already
    // loaded above (if present) instead of re-reading/re-parsing.
    const tasks = [];
    if (tasksRaw?.tasks) {
      for (const t of tasksRaw.tasks) {
        if (t.status && !/open|progress|active|todo|in_progress/i.test(t.status)) continue;
        const featureRefs = t.features ?? t.related_features ?? [];
        if (!featureRefs.some((f) => affectedFeatureIds.has(f))) continue;
        tasks.push({
          id: t.id,
          title: t.title ?? '',
          status: t.status ?? null,
          priority: t.priority ?? null,
          features: featureRefs.filter((f) => affectedFeatureIds.has(f)),
          link_strength: taskLinkStrength(t),
          evidence: t.evidence ?? null,
        });
      }
    }

    // 4b. Co-consumer files — other files anchored by the same feature(s).
    // Echoes manager: `graph_consequences("sharc_update.comp.glsl")` missed
    // `sharc_resolve.comp.glsl` as a co-consumer; both live under the same
    // feature but the verb only surfaced the queried file. Fix: surface the
    // peer set explicitly so refactor planners see the full blast radius.
    const coConsumerFiles = [];
    if (affectedFeatureIds.size > 0 && functionality.features.length > 0) {
      const seen = new Set([...matchedFiles]);
      for (const f of functionality.features ?? []) {
        if (!affectedFeatureIds.has(f.id)) continue;
        for (const anchor of f.anchors?.files ?? []) {
          if (anchor.endsWith('/*')) continue; // skip globs — agents can expand themselves
          if (seen.has(anchor)) continue;
          seen.add(anchor);
          coConsumerFiles.push({ file: anchor, via_feature: f.id });
          if (coConsumerFiles.length >= 10) break;
        }
        if (coConsumerFiles.length >= 10) break;
      }
    }

    // 5. Adjacent tests — test files that reference the matched symbols/files
    const tests = [];
    if (symbolNodes.length > 0) {
      const testRows = db.all(
        `SELECT DISTINCT n.file_path
         FROM edges e
         JOIN nodes n ON n.id = e.from_id
         WHERE e.to_id IN (SELECT value FROM json_each($ids))
           AND (n.file_path LIKE '%/test/%' OR n.file_path LIKE '%/tests/%' OR n.file_path LIKE '%.test.%' OR n.file_path LIKE '%.spec.%')
         LIMIT 10`,
        { ids: JSON.stringify(symbolNodes.map((n) => n.id)) });
      tests.push(...testRows.map((r) => r.file_path));
    }

    // 6. Last-touched: git log for the matched files
    let lastTouched = [];
    if (matchedFiles.size > 0) {
      try {
        const fileArgs = [...matchedFiles].slice(0, 5);
        const raw = execFileSync('git',
          ['-C', repoRoot, 'log', '--pretty=format:%h|%an|%ad|%s', '--date=short', '-n', '3', '--', ...fileArgs],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        lastTouched = raw.split('\n').filter(Boolean).map((line) => {
          const [sha, author, date, subject] = line.split('|');
          return { sha, author, date, days_ago: daysAgo(date), subject };
        });
      } catch {
        // non-git or no history — skip
      }
    }

    // Task ranking: top_related is the first 3 after priority/status sort.
    // Full list stays in open_tasks_on_those_features for completeness, but
    // top_related saves agents from scanning 22-item flat arrays.
    const rankedTasks = rankTasks(tasks);
    const dirtySeams = summarizeDirtySeams(functionality.features ?? [], dirtyFiles);
    const dirtyOverlap = {
      direct_files: dirtyFiles.filter((file) => matchedFiles.has(file)),
      affected_features: dirtySeams.features
        .filter((feature) => affectedFeatureIds.has(feature.id))
        .map((feature) => ({
          id: feature.id,
          label: feature.label,
          file_count: feature.file_count,
          files: feature.files.slice(0, 5),
        })),
      orphan_dirty_files: dirtySeams.orphanFilesSample.filter((file) => matchedFiles.has(file)),
    };

    const riskFlags = [];
    if (tests.length === 0 && symbolNodes.length > 0) riskFlags.push('no_test_coverage — no adjacent tests, regression risk');
    if (features.length === 0 && symbolNodes.length > 0) riskFlags.push('orphan_anchor — no feature maps this symbol');
    if (contracts.length > 0) riskFlags.push(`contract_binding — ${contracts.length} contract(s) may be affected`);
    if (features.length > 1) riskFlags.push(`cross_feature_boundary — touches ${features.length} features`);
    if (tasks.length > 20) riskFlags.push(`task_overhang — ${tasks.length} open tasks on affected features`);
    if (referencedIn.length > 5) riskFlags.push(`high_fan_in — symbol appears in ${referencedIn.length + symbolNodes.length} files`);
    if (trust.level === 'weak') {
      riskFlags.push('weak_graph_trust — prefer graph_pull(node=...) for narrower live context and verify in source');
    }
    const dirtyOverlapCount = dirtyOverlap.direct_files.length
      + dirtyOverlap.affected_features.reduce((sum, feature) => sum + feature.file_count, 0);
    if (dirtyOverlapCount > 0) {
      riskFlags.push(`dirty_local_seam — ${dirtyOverlapCount} dirty file(s) intersect this target or its mapped features`);
    }

    return attachReadWarnings({
      target: input,
      trust,
      matched: {
        symbols: symbolNodes.map((n) => ({ label: n.label, type: n.type, file: n.file_path, line: n.start_line })),
        files: fileNodes.map((n) => n.file_path).filter(Boolean),
        // Other places where this label appears (forward decls in headers
        // for C++ classes, re-exports, etc.). Echoes PM Tier A #3: class
        // names were returning 10 "primary" entries; we now pick the
        // definition file(s) and list the rest here.
        referenced_in: referencedIn,
      },
      contracts_potentially_affected: contracts,
      spec_docs: specDocs,
      features_touching: features,
      co_consumer_files: coConsumerFiles,
      open_tasks_on_those_features: tasks,
      top_related_tasks: rankedTasks.slice(0, 3), // highest-signal subset
      tests_adjacent: tests,
      last_touched: lastTouched,
      dirty_overlap: dirtyOverlap,
      risk_flags: riskFlags,
    }, freshness.warnings);
  } finally {
    db.close();
  }
}
