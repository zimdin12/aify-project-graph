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
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { openExistingDb } from '../../storage/db.js';
import { loadManifest } from '../../freshness/manifest.js';
import { buildReceipt, receiptFor, currentPins, hashOverlayContent, hashWorktreeDirty } from '../receipt.js';
import { getUnresolvedCounts } from '../../freshness/unresolved-metrics.js';
import { loadFunctionality, hasOverlay } from '../../overlay/loader.js';
import { isTaskOpen } from '../../overlay/task-status.js';
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
    .filter((t) => isTaskOpen(t.status))
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

// Provenance lattice: a claim is only as strong as its weakest input. Computed so a
// derived field cannot silently outrank what it was derived from (ef-manager, D2).
const PROVENANCE_RANK = { observed: 2, inferred: 1 };
function weakestOf(values = []) {
  if (values.length === 0) return 'inferred'; // nothing to stand on
  return values.reduce((worst, v) => (
    (PROVENANCE_RANK[v] ?? 1) < (PROVENANCE_RANK[worst] ?? 1) ? v : worst
  ), values[0]);
}

function daysAgo(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr);
  if (Number.isNaN(then.getTime())) return null;
  const d = Math.floor((Date.now() - then.getTime()) / 86400000);
  return d;
}

function isTestLikePath(filePath) {
  return Boolean(filePath) && (
    filePath.includes('/test/')
    || filePath.includes('/tests/')
    || filePath.startsWith('test/')
    || filePath.startsWith('tests/')
    || /\.test\./i.test(filePath)
    || /\.spec\./i.test(filePath)
  );
}

function uniqueTestPaths(paths = []) {
  return [...new Set(paths.filter(isTestLikePath))];
}

function findMentioningTestFiles(db, repoRoot, symbols = []) {
  const needles = [...new Set(symbols.filter(Boolean))];
  if (needles.length === 0) return [];
  const candidateFiles = db.all(
    `SELECT DISTINCT file_path
     FROM nodes
     WHERE type = 'File'
       AND language != ''
       AND (
         file_path LIKE '%/test/%'
         OR file_path LIKE '%/tests/%'
         OR file_path LIKE 'test/%'
         OR file_path LIKE 'tests/%'
         OR file_path LIKE '%.test.%'
         OR file_path LIKE '%.spec.%'
       )`
  ).map((row) => row.file_path);
  if (candidateFiles.length === 0) return [];

  const hits = new Set();
  for (const needle of needles) {
    try {
      const out = execFileSync(
        'rg',
        ['-l', '-w', '--fixed-strings', needle, '--', ...candidateFiles],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          maxBuffer: 16 * 1024 * 1024,
          windowsHide: true,
        },
      );
      out.split('\n').map((line) => line.trim()).filter(Boolean).forEach((file) => hits.add(file));
    } catch (err) {
      if (!(typeof err?.status === 'number' && err.status === 1)) {
        return [...hits];
      }
    }
  }
  return [...hits];
}

function findImportLinkedTestFiles(db, matchedFiles = []) {
  if (matchedFiles.length === 0) return [];
  const rows = db.all(
    `SELECT DISTINCT COALESCE(NULLIF(fn.file_path, ''), NULLIF(e.source_file, '')) AS test_file
     FROM edges e
     LEFT JOIN nodes fn ON fn.id = e.from_id
     JOIN nodes tn ON tn.id = e.to_id
     WHERE e.relation = 'IMPORTS'
       AND tn.file_path IN (SELECT value FROM json_each($files))
       AND (
         fn.type = 'Test'
         OR fn.file_path LIKE '%/test/%'
         OR fn.file_path LIKE '%/tests/%'
         OR fn.file_path LIKE 'test/%'
         OR fn.file_path LIKE 'tests/%'
         OR fn.file_path LIKE '%.test.%'
         OR fn.file_path LIKE '%.spec.%'
         OR e.source_file LIKE '%/test/%'
         OR e.source_file LIKE '%/tests/%'
         OR e.source_file LIKE 'test/%'
         OR e.source_file LIKE 'tests/%'
         OR e.source_file LIKE '%.test.%'
         OR e.source_file LIKE '%.spec.%'
       )
     LIMIT 25`,
    { files: JSON.stringify(matchedFiles) },
  );
  return uniqueTestPaths(rows.map((row) => row.test_file));
}

async function loadTrustContext(repoRoot) {
  const { manifest } = await loadManifest(join(repoRoot, '.aify-graph'));
  const { total, trust } = getUnresolvedCounts(manifest);
  const level = computeTrustLevel(trust);
  return {
    level,
    trust_relevant_unresolved: trust,
    total_unresolved: total,
    // Emitted ONLY when it says something. It was null in every response a field
    // reviewer saw across three experiments — a key that is always present and
    // always empty trains readers to skip the block it lives in.
    ...(level === 'weak' ? {
      advisory: 'Weak graph trust: prefer graph_pull(node=...) for narrower live context and verify in source.',
    } : {}),
  };
}

export async function graphConsequences({ repoRoot, target, symbol, receipt: receiptMode }) {
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
    // Age of the curated overlay, in days — travels with every INFERRED field
    // below rather than living only in graph_health where nobody reads it at the
    // moment they act. Newest of the two overlay files: if either was refreshed,
    // the anchoring is that fresh.
    // Pinned separately from the health path's manifest — this is a different
    // function scope, and reaching for a binding that happens to exist elsewhere
    // is how a receipt ends up pinning the wrong run's commit.
    const { manifest: pinManifest } = await loadManifest(join(repoRoot, '.aify-graph')).catch(() => ({ manifest: null }));
    // The single most load-bearing pin: without it a receipt cannot prove the
    // tree it described is the tree you are looking at. Cheap, so there is no
    // excuse for leaving it null and warning about it instead.
    const pinRepoCommit = (() => {
      try {
        return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
          cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
        }).trim() || null;
      } catch { return null; }
    })();
    const overlayAgeDays = (() => {
      let newest = null;
      for (const f of ['functionality.json', 'tasks.json']) {
        const p = join(repoRoot, '.aify-graph', f);
        if (!existsSync(p)) continue;
        try {
          const days = Math.floor((Date.now() - statSync(p).mtimeMs) / 86_400_000);
          if (newest == null || days < newest) newest = days;
        } catch { /* unreadable — leave null rather than guess */ }
      }
      return newest;
    })();
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

    // ★ THE SAFETY VERB MISSED THE BINDING CONTRACT THE BROWSE VERB FOUND.
    //
    // Measured (ef-manager, 2026-07-31): asked what a change to ChunkDataCache.h
    // could break, graph_consequences listed two contracts with ZERO textual
    // mention of the file — and MISSED worldbuffer-authority.md, which names it
    // 22 times. graph_pull's docs layer found it immediately, from the same DB,
    // same minute. The gap is mechanism, not data: contracts came only from
    // feature.contracts (a curated, feature-level field), while the MENTIONS
    // edge Document→node was sitting right there unqueried.
    //
    // Feature-level curation is the right DEFAULT — it encodes intent that text
    // cannot. But a contract that names the file two dozen times is not a
    // judgement call, and missing it on the verb whose entire job is "what could
    // this break" is the worst place to be quietly incomplete. So we UNION the
    // observed mentions in, and label where each one came from rather than
    // blending them: `declared` survives curation, `mentions` is observed from
    // document text.
    // Widen to the LABELS declared in the matched files, not just nodes whose
    // file_path is one of them. A contract discusses a type by NAME, and the
    // node a MENTIONS edge lands on is often the forward decl / External /
    // re-declaration living in a different file. Matching only on file_path
    // collapsed every doc to a single mention and destroyed the ranking —
    // the fix and the bug it caused were both invisible without checking.
    const fileLabelRows = matchedFiles.size > 0
      ? db.all(
        `SELECT DISTINCT label FROM nodes
          WHERE file_path IN (${[...matchedFiles].map((_, i) => `$fl${i}`).join(',')})
            AND label IS NOT NULL AND label != '' LIMIT 200`,
        Object.fromEntries([...matchedFiles].map((v, i) => [`fl${i}`, v])),
      )
      : [];
    const mentionLabels = new Set([...matchedSymbols, ...fileLabelRows.map((r) => r.label)]);

    const mentionParams = {};
    const fileKeys = [...matchedFiles].map((v, i) => { mentionParams[`mf${i}`] = v; return `$mf${i}`; });
    const symKeys = [...mentionLabels].map((v, i) => { mentionParams[`ms${i}`] = v; return `$ms${i}`; });
    const mentionedDocs = (fileKeys.length > 0 || symKeys.length > 0)
      ? db.all(
        // COUNT(DISTINCT n.id), not COUNT(*): MENTIONS is deduped per
        // (document, node) pair, so a raw row count is 1 for every doc and the
        // ranking carries no signal. Distinct mentioned nodes IS the breadth
        // measure — the binding contract names the type AND its methods, a
        // passing reference names it once. On the case that motivated this,
        // that separates worldbuffer-authority.md (8) from the field (≤3).
        `SELECT d.label, d.file_path, COUNT(DISTINCT n.id) AS mention_count
           FROM edges e
           JOIN nodes d ON d.id = e.from_id AND d.type = 'Document'
           JOIN nodes n ON n.id = e.to_id
          WHERE e.relation = 'MENTIONS'
            AND (${[
          fileKeys.length ? `n.file_path IN (${fileKeys.join(',')})` : null,
          symKeys.length ? `n.label IN (${symKeys.join(',')})` : null,
        ].filter(Boolean).join(' OR ')})
          GROUP BY d.id
          ORDER BY mention_count DESC
          LIMIT 15`,
        mentionParams,
      )
      : [];

    // A doc already named by a feature is DECLARED; don't double-report it.
    const declaredDocSet = new Set([...contracts, ...specDocs].map((d) => String(d).toLowerCase()));
    const documentsMentioning = mentionedDocs
      .filter((d) => {
        const p = String(d.file_path || '').toLowerCase();
        const l = String(d.label || '').toLowerCase();
        return ![...declaredDocSet].some((known) => p.endsWith(known) || l === known || p.includes(known));
      })
      // ★ NAME THE METRIC WHERE IT IS READ, not only in the receipt.
      //
      // `mentions: 10` next to a grep that returns 22 reads as a discrepancy, and a
      // field reviewer was one step from filing a false bug on exactly that. What
      // stopped him was the receipt's per-claim `basis` string — "MENTIONS edge, 10
      // DISTINCT NODES" — a different metric, correctly labelled. Moving the receipt
      // body behind an opt-in took that away from the default response.
      //
      // Fixing it in the receipt would ship 5KB to rescue one word. The field itself
      // should say what it counts, so the number is self-describing wherever it is
      // read and the receipt is not load-bearing for basic comprehension.
      .map((d) => ({
        label: d.label,
        file: d.file_path,
        distinct_nodes_mentioned: d.mention_count,
      }));

    // ★ A ONE- OR TWO-NODE MENTION IS NOISE, BUT DROPPING IT SILENTLY IS WORSE.
    //
    // Measured (ef-manager, 2026-08-09): 14 entries, 10 of them with ≤2 distinct
    // nodes mentioned — a long tail of documents that happen to name one symbol,
    // in a response the reader was skimming for two fields.
    //
    // So the tail is filtered, and the filtering ANNOUNCES ITSELF. A quietly
    // shortened list is indistinguishable from a short one, which is the defect
    // this codebase keeps finding in itself; a reader who needs the tail has to be
    // able to see that it existed and how to get it back.
    const DOC_MENTION_FLOOR = 3;
    const docsStrong = documentsMentioning.filter((d) => (d.distinct_nodes_mentioned ?? 0) >= DOC_MENTION_FLOOR);
    const docsWeakCount = documentsMentioning.length - docsStrong.length;
    const documentsMentioningNote = docsWeakCount > 0
      ? `${docsWeakCount} document(s) mentioning this in fewer than ${DOC_MENTION_FLOOR} distinct nodes were omitted as a weak-signal tail — not absent, just thin. graph_pull(node="…", layers:["docs"]) returns all of them.`
      : null;

    // 4. Open tasks bound to affected features. Reuse the tasks.json already
    // loaded above (if present) instead of re-reading/re-parsing.
    const tasks = [];
    if (tasksRaw?.tasks) {
      for (const t of tasksRaw.tasks) {
        if (!isTaskOpen(t.status)) continue;
        const featureRefs = t.features ?? t.related_features ?? [];
        if (!featureRefs.some((f) => affectedFeatureIds.has(f))) continue;
        tasks.push({
          id: t.id,
          title: t.title ?? '',
          status: t.status ?? null,
          priority: t.priority ?? null,
          // ★ THE TRACKER LINK IS A POINTER TO AUTHORITY — CARRY IT.
          //
          // tasks.json stores `url` (real example from echoes:
          // "https://app.clickup.com/t/869cm99z3"), and graph_pull surfaces it.
          // This verb — the one that answers "what breaks if I touch X" — dropped
          // it, leaving the reader an id like `CU-869cm99z3` and no way to reach
          // the thing it names.
          //
          // An id is only decodable by someone who already knows that tracker's URL
          // scheme. APG is source-agnostic by design (ClickUp, Asana, Linear, Jira,
          // Plane, GitHub Issues, plaintext), so the id prefix is exactly what
          // cannot be relied on — while `url` is portable across every one of them.
          //
          // sc-manager's category applies: `spec_docs` was kept out of the deletion
          // list because it is a POINTER TO AUTHORITY rather than a derived summary,
          // and their failure mode this session was not retrieving authority they
          // already had. A tracker link is the same kind of object, and cheaper.
          ...(t.url ? { url: t.url } : {}),
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
    // ★ ATTACK SEVEN — THIS LIST WAS CAPPED AT 10 AND DROPPED ITS TRUNCATION STATE.
    //
    // ef-manager found it in his own experiment-2 transcript, without a running
    // build, from a single observation: co_consumer_files came back with EXACTLY
    // 10 entries and — alone among every list in the response — carried no total,
    // no truncated, no limit. Every neighbour had them (docs 19/true/10,
    // defines 29/true/10, imports 3/false/10). A bare array whose length equals
    // the neighbouring limit.
    //
    // He named why it stings, and he is right: co_consumer_files is the field that
    // WON experiment 2. The four dependents with zero textual mention are the
    // strongest evidence for this tool in the record — and they were computed from
    // a list that stopped at 10 without saying so, on a DELETION question, which is
    // exactly where a silently-short list does the most damage. Neither of us
    // noticed.
    //
    // His framing of the fix is the one that matters: 10 might well be the true
    // count (6 + 4 is a legitimate answer). THAT is why the missing flag is the bug
    // rather than the number — with total/truncated you can tell those apart, and
    // without it you cannot. The whole pattern in one field.
    const CO_CONSUMER_LIMIT = 10;
    const coConsumerAll = [];
    if (affectedFeatureIds.size > 0 && functionality.features.length > 0) {
      const seen = new Set([...matchedFiles]);
      for (const f of functionality.features ?? []) {
        if (!affectedFeatureIds.has(f.id)) continue;
        for (const anchor of f.anchors?.files ?? []) {
          if (anchor.endsWith('/*')) continue; // skip globs — agents can expand themselves
          if (seen.has(anchor)) continue;
          seen.add(anchor);
          // Collect the TRUE total, then cap for display. Breaking early is what
          // made the count unknowable — you cannot report what you refused to count.
          coConsumerAll.push({ file: anchor, via_feature: f.id });
        }
      }
    }
    const coConsumerFiles = {
      items: coConsumerAll.slice(0, CO_CONSUMER_LIMIT),
      total: coConsumerAll.length,
      truncated: coConsumerAll.length > CO_CONSUMER_LIMIT,
      limit: CO_CONSUMER_LIMIT,
    };

    // 5. Adjacent tests — test files that reference the matched symbols/files
    const tests = [];
    // ★ A DIRECT EDGE TO THE TARGET SYMBOL IS NOT AN IMPORT, AND MUST NOT SAY IT IS.
    //
    // Found 2026-08-10 by the first test that RAN this code instead of grepping its
    // source (tier-identity-behaviour.test.js). A test file whose only edge is
    // `CALLS test_target.cpp -> targetSymbol`, with no IMPORTS edge anywhere in the
    // database, came back `tests_adjacent_provenance: "import_linked"`.
    //
    // The EVIDENCE was real — a test calls the exact symbol asked about. The LABEL
    // was false: it asserted a structural include that did not exist. Same class as
    // the vec3 defect directly below, and the mirror image of it — there a weak
    // basis wore a strong tier's name; here the STRONGEST basis wears a DIFFERENT
    // claim's name, so an agent auditing the import graph is told an edge is there.
    //
    // It also mattered more than a naming nit: `import_linked` is the tier that
    // clears `tests_unverified_for_symbol` and reports `observed`. The one tier that
    // genuinely verifies the SYMBOL was borrowing that clearance from a tier that
    // only verifies the FILE — and `import_linked` on a 2,000-line file says almost
    // nothing about one function in it, while a direct CALLS edge says everything.
    // The weaker claim was outranking the stronger one and lending it its name.
    const directSymbolEdges = [];
    const fileAdjacencyImports = [];   // IMPORTS edges — structural
    const fileAdjacencyRefs = [];      // every other relation — a reference to ONE symbol
    if (symbolNodes.length > 0) {
      const directTestRows = db.all(
        `SELECT DISTINCT COALESCE(NULLIF(n.file_path, ''), NULLIF(e.source_file, '')) AS test_file,
                e.relation AS relation
         FROM edges e
         JOIN nodes n ON n.id = e.from_id
         WHERE e.to_id IN (SELECT value FROM json_each($ids))
           AND (n.type = 'Test'
             OR n.file_path LIKE '%/test/%'
             OR n.file_path LIKE '%/tests/%'
             OR n.file_path LIKE 'test/%'
             OR n.file_path LIKE 'tests/%'
             OR n.file_path LIKE '%.test.%'
             OR n.file_path LIKE '%.spec.%'
             OR e.source_file LIKE '%/test/%'
             OR e.source_file LIKE '%/tests/%'
             OR e.source_file LIKE 'test/%'
             OR e.source_file LIKE 'tests/%'
             OR e.source_file LIKE '%.test.%'
             OR e.source_file LIKE '%.spec.%')
         LIMIT 10`,
        { ids: JSON.stringify(symbolNodes.map((n) => n.id)) });
      tests.push(...directTestRows.map((r) => r.test_file));
      directSymbolEdges.push(...directTestRows);
    }
    if (matchedFiles.size > 0) {
      // ★ THIS QUERY HAD NO `e.relation` FILTER, so ANY edge of ANY type from a
      // test-ish file to ANY symbol attributed to the target file counted as test
      // adjacency. Measured on ef-manager's case: the single edge that made
      // graph_consequences claim tests/test_main.cpp covers CylindricalPosition.h
      // was `CALLS test_main.cpp -> vec3`. The test calls a math-type constructor,
      // `vec3` is one of 15 symbols the graph attributes to that header, and the
      // flagship safety verb reported test coverage on that basis — stamped
      // `linked`/`observed` after my provenance fix.
      //
      // Relation and matched symbol are now BOTH carried out, because the fix is not
      // just narrowing the filter: `vec3` is self-evidently vacuous the moment you
      // can see it, and no threshold I pick will beat showing the reader the symbol.
      const fileAdjacencyRows = db.all(
        `SELECT DISTINCT COALESCE(NULLIF(fn.file_path, ''), NULLIF(e.source_file, '')) AS test_file,
                e.relation AS relation, tn.label AS via_symbol
         FROM edges e
         JOIN nodes fn ON fn.id = e.from_id
         JOIN nodes tn ON tn.id = e.to_id
         WHERE (
             fn.type = 'Test'
             OR fn.file_path LIKE '%/test/%'
             OR fn.file_path LIKE '%/tests/%'
             OR fn.file_path LIKE 'test/%'
             OR fn.file_path LIKE 'tests/%'
             OR fn.file_path LIKE '%.test.%'
             OR fn.file_path LIKE '%.spec.%'
             OR e.source_file LIKE '%/test/%'
             OR e.source_file LIKE '%/tests/%'
             OR e.source_file LIKE 'test/%'
             OR e.source_file LIKE 'tests/%'
             OR e.source_file LIKE '%.test.%'
             OR e.source_file LIKE '%.spec.%'
           )
           AND tn.file_path IN (SELECT value FROM json_each($files))
         LIMIT 10`,
        { files: JSON.stringify([...matchedFiles]) },
      );
      // IMPORTS is structural test adjacency. Everything else (CALLS, USES_TYPE, …)
      // is a REFERENCE to one symbol — real information, but a much weaker claim,
      // and it must travel with the symbol that produced it.
      fileAdjacencyImports.push(...fileAdjacencyRows.filter((r) => r.relation === 'IMPORTS').map((r) => r.test_file));
      // ★ `symbol_referenced` CLAIMS THE TARGET IS REFERENCED. CHECK THAT IT IS.
      //
      // Measured (ef-manager, echoes, 8e09c67 — i.e. WITH the four-tier split
      // already in place, so this is not a pre-tier wound):
      //
      //   cylindricalLatBandsForBody → tests_adjacent ["tests/test_main.cpp"]
      //   provenance symbol_referenced, basis: relation CALLS, via_symbol "vec3"
      //   ground truth: grep -c cylindricalLatBandsForBody tests/test_main.cpp = 0
      //
      // The tier predicate accepted ANY symbol edge between the test file and
      // anything at all, then labelled it as though the TARGET were the referent.
      // `vec3` is a math type used by nearly every C++ file in that repo, so the
      // claim was true about vec3 and false about the symbol the caller asked
      // about.
      //
      // This is not a correctly-labelled weak tier — those are the mechanism
      // working. It is a STRONG TIER LABELLED FALSELY, which is a different and
      // much more fixable thing. Same root shape as the original fileAdjacency
      // defect: an unfiltered edge in, a confidently-tiered claim out.
      //
      // If via_symbol is not the target, the tier is not "weaker" — it is nothing,
      // and the file must not be listed at all.
      fileAdjacencyRefs.push(...fileAdjacencyRows.filter((r) => (
        r.relation !== 'IMPORTS' && r.via_symbol && matchedSymbols.has(r.via_symbol)
      )));
    }
    const importLinkedTests = matchedFiles.size > 0 ? findImportLinkedTestFiles(db, [...matchedFiles]) : [];

    // ★ NOTHING EVER #INCLUDES A .cpp.
    //
    // Field report (sc-manager, Sand Castle, 2026-08-04→05). graph_consequences on
    // sim/fields/UnifiedFluidWriteback.cpp returned tests_adjacent []. The same
    // call on UnifiedFluidWriteback.h returned the test, provenance import_linked.
    // The structural tier was working perfectly and answering a question nobody
    // asks: tests include the HEADER, so an implementation file has no incoming
    // include edges from tests and the honest structural answer is zero.
    //
    // Technically correct, practically useless — a reviewer asking "what tests
    // this implementation file" is asking the right question. In C++ the
    // declaration and the definition are one unit split across two files, and the
    // test's include of the header IS test adjacency for the .cpp.
    //
    // Kept as a NAMED basis rather than folded in silently: the test imports the
    // header, not this file, and a reader deciding whether coverage is real should
    // see which of those two things was established.
    const companionHeaders = (() => {
      const impl = [...matchedFiles].filter((f) => /\.(cpp|cc|cxx|c\+\+|m|mm)$/i.test(f));
      if (impl.length === 0) return [];
      const stems = impl.map((f) => f.replace(/\.[^.]+$/, ''));
      const rows = db.all(
        `SELECT DISTINCT file_path FROM nodes
          WHERE file_path IS NOT NULL AND file_path != ''
            AND (file_path LIKE '%.h' OR file_path LIKE '%.hpp' OR file_path LIKE '%.hh' OR file_path LIKE '%.hxx')
          LIMIT 5000`,
      );
      const want = new Set(stems);
      return rows
        .map((r) => r.file_path)
        .filter((p) => want.has(p.replace(/\.[^.]+$/, '')));
    })();
    const companionHeaderTests = companionHeaders.length > 0
      ? uniqueTestPaths(findImportLinkedTestFiles(db, companionHeaders))
      : [];

    const directUniqueTests = uniqueTestPaths([
      ...tests, ...fileAdjacencyImports, ...importLinkedTests, ...companionHeaderTests,
    ]);
    // ⛔ `refTests` no longer contributes to the listing. It was the input to the deleted
    // `symbol_referenced` tier, and keeping it in `uniqueTests` after removing the tier
    // would list those files under whatever OTHER tier happened to win — a file
    // attributed to `text_mentioned` when nothing mentioned it, which is precisely the
    // mislabelling this week has been spent removing. Retained only so the identity
    // filter below stays measurable; nothing downstream reads it.
    const refTests = uniqueTestPaths(fileAdjacencyRefs.map((r) => r.test_file))
      .filter((t) => !directUniqueTests.includes(t));
    const mentionTests = directUniqueTests.length === 0 && symbolNodes.length > 0
      ? findMentioningTestFiles(db, repoRoot, symbolNodes.map((node) => node.label))
      : [];
    // M4a: feature.tests[] fallback. When all the above heuristics return
    // nothing, use the curated tests[] array from each touching feature.
    // The overlay is the source of truth when graph extraction misses;
    // ignoring it produced false `no_test_coverage` flags on repos with
    // shared test entrypoints (e.g. monolithic tests/test_main.cpp).
    // ★ A WORD MATCH IS NOT A LINK — and this one was labelled `linked`/`observed`.
    //
    // ef-manager carried tests_adjacent as a defect, correctly, and diagnosed it as
    // transitive-include reachability standing in for coverage. Measured, the real
    // mechanism is worse than his hypothesis: for CylindricalPosition.h there is NO
    // import path to tests/test_main.cpp at all (0 direct edges; its actual imports
    // are 12 unrelated headers). The linkage came from findMentioningTestFiles
    // word-matching two symbols defined in that header — `tesseract` (the project
    // NAMESPACE) and `vec3` (a math type) — anywhere in the test file.
    //
    // So the field claimed observed test adjacency on the strength of a namespace
    // name appearing in a test. `vec3` matches nearly any C++ file in this repo,
    // which is why the proxy is near-vacuous exactly as he said — just for a
    // different and more embarrassing reason.
    //
    // ★ This is his own mention-vs-edge error, committed in my code, and my
    // provenance fix stamped it `observed`. He is right that correct provenance on
    // a badly-scoped field is worse than no provenance: it launders a text
    // coincidence into evidence. Text matches are kept — they are a real hint when
    // the identifier is distinctive — but they are a SEPARATE, weaker tier that
    // names the matching symbol so a reader can judge it.
    const inferredTests = uniqueTestPaths(directUniqueTests);
    const featureTests = inferredTests.length === 0
      ? features.flatMap((f) => f.tests || []).filter(Boolean)
      : [];
    const uniqueTests = uniqueTestPaths([...inferredTests, ...mentionTests, ...featureTests]);

    // ★ ADJACENCY MUST NOT BE ASSERTED WHEN IT WAS NOT ESTABLISHED.
    //
    // The featureTests fallback above exists for a good reason — a monolithic
    // tests/test_main.cpp defeats import/mention linkage — but it converts "no test
    // linkage found" into "here is a test", and the caller cannot tell which they
    // received.
    //
    // Measured cost (ef-manager, 2026-07-31). He asked, in a written-down
    // experiment: "is there any mechanism that would tell me if I got this wrong?"
    // graph_consequences answered tests_adjacent: ["tests/test_main.cpp"]. He
    // hand-verified that file: ZERO matches for the symbol, for cylindrical, for
    // LatBands, for glsl. The truth was that NO verification mechanism exists — and
    // the flagship safety verb said one did, on the safety axis the tool exists to
    // serve.
    //
    // Unearned confidence spends the credibility the honest parts depend on. So the
    // list keeps the overlay's declaration — it is real curation and often right —
    // but says which kind of claim it is.
    // Four tiers now, because `linked` was covering two things with opposite
    // evidential value — a real import edge, and a bare word match on a namespace.
    //   symbol_direct     the test file has an edge straight to THIS symbol. The
    //                     strongest tier, and the only one that verifies the symbol
    //                     rather than the file it lives in.
    //   import_linked     the test file IMPORTS the code. A structural edge — a
    //                     claim about the FILE, which on a large file says little
    //                     about any one symbol in it.
    //   text_mentioned    a symbol name appears in the test file. A HINT: strong for
    //                     a distinctive identifier, worthless for `vec3`.
    //   feature_declared  the curated overlay says so; unverified against this symbol.
    //   none              nothing found, and nothing claimed.
    // `companion_header_linked` is a real import edge like `import_linked`, but the
    // edge lands on the paired header rather than on the queried file — so it is
    // named separately instead of being laundered into the stronger tier. It only
    // claims the top spot when NOTHING imports the queried file directly.
    const onlyViaCompanionHeader = companionHeaderTests.length > 0
      && tests.length === 0 && fileAdjacencyImports.length === 0 && importLinkedTests.length === 0;
    const testsProvenance = onlyViaCompanionHeader
      ? 'companion_header_linked'
      // `symbol_direct` outranks `import_linked` because it answers the question
      // actually asked. "A test imports the file this symbol lives in" is a claim
      // about the FILE; "a test has an edge to this symbol" is a claim about the
      // SYMBOL. Ranking the file-level claim first meant the precise answer was
      // reported under the vaguer one's name.
      : tests.length > 0
      ? 'symbol_direct'
      : inferredTests.length > 0
      ? 'import_linked'
      // ⛔ `symbol_referenced` DELETED 2026-08-11. Both reviewers reached it separately.
      //
      // After the identity check, the tier required `via_symbol` to BE the target — but
      // any edge satisfying that is also a direct edge to the target symbol, so
      // `symbol_direct` takes it first. For FILE targets `matchedSymbols` is empty, so it
      // could not fire at all.
      //
      // graph-senior-dev then corrected their own "structurally unreachable" claim, which
      // is the version worth keeping: it IS reachable, via exactly one path — create four
      // nodes sharing a symbol label, `pickPrimarySymbol()` caps selection at three, and a
      // test edge to the omitted fourth escapes `symbol_direct` while still matching the
      // label. So the enum survived only as an artefact of an unrelated cap.
      //
      // ★ That strengthens the deletion rather than weakening it. A tier whose sole
      // reachable case is a duplicate-node-cap escape hatch does not denote a coherent
      // evidence class — it denotes a bug in a different function. And its six green
      // tests proved the winning behaviour and the old false positive, never reachability
      // of the enum itself.
      //
      // ⚠ NOT restored under its old meaning. "A test references some OTHER symbol in the
      // target's file" is not coverage of the target symbol; that reading is what let a
      // `vec3` edge delete a `no_test_coverage` warning. If that weaker relation is ever
      // wanted it must arrive under its own name and must not be able to clear the flag.
      : (mentionTests.length > 0 ? 'text_mentioned'
        : (featureTests.length > 0 ? 'feature_declared' : 'none'));
    // ★ A CAVEAT MAY BE CLEARED ONLY BY EVIDENCE AT THE SAME GRANULARITY AS THE CLAIM
    // IT QUALIFIES. (ef-manager, 2026-08-10, deciding a question I raised and did not
    // decide myself.)
    //
    // `import_linked` used to clear this flag and no longer does. The reason is NOT
    // that its warrant became small once `symbol_direct` outranked it — ranking does
    // not fix granularity. "This test file includes that header" is a claim about a
    // FILE. "No test verifies this SYMBOL" is a claim about a SYMBOL. File-level
    // evidence cannot discharge a symbol-level caveat at ANY file size; a 2,000-line
    // file makes it obvious and a 20-line file has the same defect in miniature. Size
    // is what made it noticeable; granularity is what makes it wrong.
    //
    // This is the caveat-same-source rule with a second axis, and it generalises past
    // this tier — it is the same reason a file-level "indexed successfully" cannot
    // attest per-symbol coverage.
    //
    // ⚠ EXPECT THIS TO FIRE MUCH MORE OFTEN. That is correct, and it will look like a
    // regression in exactly the way the tests_adjacent tightening did.
    const testsUnverifiedForSymbol = testsProvenance !== 'symbol_direct'
      && testsProvenance !== 'none';
    // The symbol that produced a weak adjacency claim, so the reader can dismiss it
    // in one glance — `vec3` needs no threshold to be recognised as vacuous.
    const testsAdjacencyBasis = testsProvenance === 'symbol_direct'
      ? directSymbolEdges
        .filter((r) => r.test_file)
        .slice(0, 5)
        .map((r) => ({ test_file: r.test_file, relation: r.relation, via_symbol: symbolNodes[0]?.label ?? target }))
      : (testsProvenance === 'companion_header_linked'
        ? companionHeaderTests.slice(0, 5).map((t) => ({
          test_file: t,
          relation: 'IMPORTS',
          via_header: companionHeaders[0],
          note: 'the test includes the paired HEADER, not this implementation file — real structural adjacency for the .cpp/.h unit, one edge removed from this path.',
        }))
        : null);

    // 6. Last-touched: git log for the matched files
    let lastTouched = [];
    if (matchedFiles.size > 0) {
      try {
        const fileArgs = [...matchedFiles].slice(0, 5);
        const raw = execFileSync('git',
          ['-C', repoRoot, 'log', '--pretty=format:%h|%an|%ad|%s', '--date=short', '-n', '3', '--', ...fileArgs],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
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
    if (uniqueTests.length === 0 && symbolNodes.length > 0) riskFlags.push('no_test_coverage — no adjacent tests, regression risk');
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
      // Observed counterpart to the two fields above: docs whose TEXT names this
      // target, ranked by how often. Curation misses; 22 mentions does not.
      documents_mentioning: docsStrong,
      ...(documentsMentioningNote ? { documents_mentioning_note: documentsMentioningNote } : {}),
      features_touching: features,
      // ★ WHY THE OVERLAY FIELDS ARE EMPTY — unmapped is not unaffected.
      //
      // Field report (sc-manager, Sand Castle, 2026-08-04): graph_consequences on
      // the file at the centre of five slices and two nights of work returned
      // features/contracts/open_tasks/co_consumers ALL EMPTY. The code layer was
      // fine — 12,130 nodes, freshly indexed. Every empty field was overlay-derived,
      // and the overlay simply had no feature anchoring that subsystem. The agent
      // had to work that out by hand, then reported internalising "it doesn't help"
      // without ever learning why it didn't.
      //
      // field_provenance already said these fields were `inferred`. That names
      // where a field COMES FROM; it does not say the overlay HAS NO ENTRY FOR
      // THIS TARGET, and only the second fact explains an empty list. An empty
      // curated field is the same shape whether the curation says "nothing here"
      // or was never written — so the verb has to say which.
      overlay_coverage: (() => {
        const featureCount = functionality.features?.length ?? 0;
        const base = { overlay_features_total: featureCount, overlay_age_days: overlayAgeDays };
        if (featureCount === 0) {
          return {
            ...base,
            target_is_mapped: false,
            cause: hasOverlay(repoRoot) ? 'overlay_empty' : 'no_overlay',
            consequence:
              'features_touching, contracts_potentially_affected and open_tasks are empty because NO feature map exists — '
              + 'NOT because this target has no features, contracts or tasks. Do not read them as clean.',
            remedy: 'run /graph-build-functionality to create the feature map.',
          };
        }
        if (features.length === 0) {
          return {
            ...base,
            target_is_mapped: false,
            cause: 'no_feature_anchors_this_target',
            consequence:
              `The overlay has ${featureCount} feature(s) and NONE of them anchor this target. `
              + 'The empty overlay fields mean this region is UNMAPPED, not that it is unaffected. '
              + 'An absence here is evidence about the MAP, not about the code.',
            remedy:
              'run /graph-build-functionality to add a feature anchoring this path, then re-run. '
              + 'Until then, treat the observed fields (callers, importers, documents_mentioning, tests_adjacent) as the whole answer.',
          };
        }
        return {
          ...base,
          target_is_mapped: true,
          cause: null,
          consequence:
            `This target is anchored by ${features.length} mapped feature(s), so an empty contracts/tasks list is a curated `
            + 'statement about it rather than a gap in the map — as fresh as overlay_age_days, and no fresher.',
          remedy: null,
        };
      })(),
      co_consumer_files: coConsumerFiles,
      open_tasks_on_those_features: tasks,
      // ★ ONLY WHEN IT SAYS SOMETHING open_tasks DOES NOT.
      //
      // Measured (ef-manager, 2026-08-09) on a real call: this field and
      // open_tasks_on_those_features were BYTE-FOR-BYTE identical, 233 tokens
      // each, in a response whose actual answer — matched + features_touching —
      // was 66 tokens. The same task object printed twice.
      //
      // It is a ranked top-3, so it only carries information when there are MORE
      // than 3 tasks to rank. At or below 3 it is the same set in a different
      // order, and the reader pays full price for a reordering they cannot use.
      // Emitting it unconditionally was the cost of never checking.
      ...(tasks.length > 3 ? { top_related_tasks: rankedTasks.slice(0, 3) } : {}),
      // ★ WHICH FIELDS ARE OBSERVED AND WHICH ARE INFERRED.
      //
      // ef-manager's request after two measured experiments, and it is the
      // generalisation of the tests_adjacent fix rather than a new idea:
      //
      //   "Criterion 3's win and criterion 4's miss came from the SAME inferential
      //    mechanism; I could not tell them apart from the output."
      //
      // Feature anchoring produced this verb's single decisive win — four
      // co-consumer files with ZERO textual mention of the target, unreachable by
      // grep at any skill. The same mechanism then listed two contracts with no
      // textual mention while MISSING the one that names the file 22 times.
      //
      // Both behaviours are correct for what they are: inference over a curated
      // overlay. What was missing is any way for the reader to know which kind of
      // claim they are holding — and he only trusted the win because he verified it
      // by hand, which is the cost this field removes.
      //
      //   observed — derived from graph structure or file text (imports, symbols)
      //   inferred — reached through feature/task anchoring; as good as the overlay
      field_provenance: ((base) => {
        // Two-pass: base fields first, then derived fields resolve against them so
        // the lattice is enforced by construction rather than by remembering.
        const weakestProvenance = (inputs) => weakestOf(inputs.map((k) => base[k]).filter(Boolean));
        return {
          ...base,
          risk_flags: weakestProvenance(['contracts_potentially_affected', 'tests_adjacent', 'features_touching']),
          spec_docs: weakestProvenance(['features_touching']),
        };
      })({
        co_consumer_files: 'inferred',   // via shared feature anchors — the differentiated win, and unverifiable by text
        features_touching: 'inferred',
        contracts_potentially_affected: 'inferred',
        documents_mentioning: 'observed',   // MENTIONS edges from document text — catches what curation missed
        open_tasks_on_those_features: 'inferred',
        // Only a real import EDGE is observed. A text match is a hint, not structure —
        // it was labelled `observed` on the strength of `vec3` appearing in a test.
        tests_adjacent: (testsProvenance === 'symbol_direct' || testsProvenance === 'import_linked')
          ? 'observed' : 'inferred',
        // ★ D2 — A DERIVED FIELD INHERITED AN INFERRED FIELD'S ERROR WITHOUT ITS LABEL.
        //
        // ef-manager: risk_flags and spec_docs were not in this map at all, and
        // risk_flags says "contract_binding — 2 contract(s) may be affected" counting
        // ONLY the two inferred, 97-day-stale overlay contracts with zero textual
        // mention — while worldbuffer-authority.md, the contract that actually makes
        // the file undeletable, is not counted because it arrived via the observed
        // path. One level of derivation stripped the provenance and displayed
        // authority exceeded evidentiary basis.
        //
        // His rule, and it is the right one because it cannot be forgotten the next
        // time a derived field is added: provenance = the WEAKEST of the inputs,
        // COMPUTED, never hand-assigned. (Resolved in the wrapper above, so a new
        // derived field cannot be added without going through the lattice.)
        callers: 'observed',
        importers: 'observed',
        dirty_overlap: 'observed',
      }),
      provenance_note:
        'INFERRED fields come from the feature/task overlay, not from code structure. They surface real '
        + 'dependents that text search cannot reach — and they are only as complete as the overlay is. '
        + 'An absent entry is NOT evidence of no relationship; verify before acting on absence.'
        + (overlayAgeDays != null ? ` OVERLAY IS ${overlayAgeDays} DAYS OLD — every INFERRED field above is exactly that stale.` : ''),
      // ★ THE MOST VALUABLE LAYER IS THE ONE WHOSE STALENESS IS LEAST VISIBLE.
      //
      // ef-manager's unflattering read, and he is right: the feature-anchoring
      // layer that WON his experiment is also the most staleness-sensitive thing
      // in the product, and it won partly by luck. The overlay was 96 days old;
      // it still described the code because THIS REPO IS MOTHBALLED. On an active
      // repo the same confident output would have been wrong and nothing in the
      // response would have said so. graph_health does report artifactAges — but
      // co_consumer_files does not carry that age WITH it, and point of use is
      // the only place it can actually stop someone.
      //
      // So the age travels with the claim now, the same way tests_adjacent's
      // provenance does.
      overlay_age_days: overlayAgeDays,
      // ★ THE CLAIM, PORTABLE — see receipt.js for why this shape and not prose.
      //
      // This verb is why the receipt exists: one response held the best answer of
      // ef-manager's engagement (four co-consumers unreachable by grep) and a
      // wrong one (the contracts), from the SAME mechanism, and nothing in the
      // output let him tell them apart. field_provenance fixed that for a reader.
      // The receipt fixes it for a TEAMMATE, who otherwise gets prose and must
      // either re-derive the work or — the actual failure mode — not bother.
      receipt: receiptFor(buildReceipt({
        verb: 'graph_consequences',
        args: { target: input, repoRoot },
        pins: currentPins({
          repoCommit: pinRepoCommit,
          manifest: pinManifest,
          // Identity, not age — an age cannot be an invalidation condition.
          overlayContentHash: hashOverlayContent(readFileSync, ['functionality.json', 'tasks.json'].map((f) => join(repoRoot, '.aify-graph', f))),
          worktreeDirtyHash: (() => {
            try {
              const out = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
                cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
              });
              return hashWorktreeDirty(out.split(/\r?\n/).map((l) => l.slice(3).trim()).filter(Boolean));
            } catch { return null; }
          })(),
          indexReady: freshness?.ready ?? null,
        }),
        // Still reported — it drives the 30-day warning — but it can never validate.
        reported_context: { overlay_age_days: overlayAgeDays },
        claims: [
          ...contracts.map((c) => ({ field: 'contracts_potentially_affected', value: c, provenance: 'inferred', basis: 'feature.contracts overlay anchor', source_age_days: overlayAgeDays })),
          ...documentsMentioning.map((d) => ({ field: 'documents_mentioning', value: d.file, provenance: 'observed', basis: `MENTIONS edge, ${d.distinct_nodes_mentioned} distinct nodes` })),
          ...coConsumerFiles.items.map((f) => ({ field: 'co_consumer_files', value: typeof f === 'string' ? f : f.file ?? f, provenance: 'inferred', basis: 'shared feature anchor', source_age_days: overlayAgeDays })),
        ],
        floor: {
          // Never exhaustive: the inferred fields are only as complete as a
          // curated overlay, and saying otherwise is the failure this repo exists
          // to prevent. An absent entry is not evidence of absence.
          exhaustive: false,
          // Named so the door can check them. Even though this verb never claims
          // exhaustive, wiring the sources means a future edit that DOES claim it
          // gets refused rather than believed.
          sources: [['co_consumer_files', coConsumerFiles], ['documents_mentioning', documentsMentioning]],
          cause: 'inferred fields derive from a curated feature/task overlay; absence is not evidence of absence',
          not_checked: [
            'features with no anchor covering this target',
            'documents that discuss the target without naming any indexed node',
            ...(overlayAgeDays != null && overlayAgeDays > 30 ? [`code changes since the overlay was written ${overlayAgeDays} days ago`] : []),
          ],
        },
        disconfirm: {
          verb: 'graph_pull',
          args: { node: input, layers: ['docs', 'relations'] },
          expect:
            'docs layer should agree with documents_mentioning, and relations.recompile_surface bounds the '
            + 'structural blast radius independently of the overlay. A document present there and absent here '
            + 'means the overlay-derived fields are incomplete — which is the cheapest single call that refutes this.',
        },
      }), receiptMode),
      ...(overlayAgeDays != null && overlayAgeDays > 30 ? {
        overlay_age_warning:
          `The feature/task overlay was last updated ${overlayAgeDays} days ago. Every field marked `
          + 'INFERRED above is derived from it and is that stale. On a repo whose code has moved since, '
          + 'these fields can be confidently wrong — re-run graph_index before trusting them for a '
          + 'delete/rename decision.',
      } : {}),
      tests_adjacent: uniqueTests,
      ...(testsAdjacencyBasis ? { tests_adjacent_basis: testsAdjacencyBasis } : {}),
      // 'linked'           — the test imports or mentions this code; adjacency established.
      // 'feature_declared' — taken from the overlay's curated tests[] for a touching
      //                      feature. NOT verified against this symbol; it may be a
      //                      monolithic entrypoint that never exercises it.
      // 'none'             — nothing found, and nothing claimed.
      tests_adjacent_provenance: testsProvenance,
      // ★ THE WARNING MUST DESCRIBE THE TIER THAT ACTUALLY FIRED.
      //
      // Measured (ef-manager, echoes, 8e09c67): provenance came back
      // `symbol_referenced` while this warning read "DECLARED by the touching
      // feature". "Declared by the touching feature" is the feature_declared
      // mechanism — a different tier entirely. The text was hardcoded for one
      // tier and printed on another.
      //
      // A third form of the caveat-must-match-its-number rule, and the nastiest:
      // not a caveat outliving its number, and not a number outliving its caveat,
      // but a caveat DESCRIBING A MECHANISM THAT DID NOT RUN. A reader who
      // believes it goes looking for a feature declaration that was never
      // involved, and finds nothing — which reads as the tool being vague rather
      // than wrong.
      //
      // The suppression logic was already correct (import_linked emitted no
      // warning); only the wording was not tier-selected.
      ...(testsUnverifiedForSymbol ? {
        tests_adjacent_warning: (
          testsProvenance === 'companion_header_linked'
            ? 'these tests import the PAIRED HEADER, not this implementation file — real structural '
              + 'adjacency for the .cpp/.h unit, but one edge removed from the file you asked about. '
              + 'Confirm the test exercises this file\'s code before relying on it.'
            : testsProvenance === 'text_mentioned'
                ? 'this symbol\'s NAME appears in these tests as text, with no structural edge — the '
                  + 'weakest tier, and a common-word name can match anything. Verify in source before '
                  + 'reading this as coverage at all.'
                : 'these tests are DECLARED by the touching feature, not verified against this symbol — '
                  + 'do NOT read them as proof that a change here is covered. Confirm the test actually '
                  + 'exercises it before relying on it.'
        ),
      } : {}),
      last_touched: lastTouched,
      dirty_overlap: dirtyOverlap,
      risk_flags: riskFlags,
    }, freshness.warnings);
  } finally {
    db.close();
  }
}
