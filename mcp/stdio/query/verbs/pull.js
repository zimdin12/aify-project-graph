// graph_pull — canonical cross-layer precision verb.
//
// Given a node identifier (file path, feature id, symbol name, or task id)
// returns everything connected across layers: code graph neighbors +
// containing features + related tasks + recent commits + test/risk anchors.
//
// Selective `layers` param so callers don't explode context when they
// only need part of the picture. Default is compact cross-layer summary.
//
// Not a replacement for graph_impact/graph_path/graph_callers — those
// still exist for tight precision queries within the code layer. This
// verb is for "give me everything about X."

import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { openExistingDb } from '../../storage/db.js';
import { buildReceipt, currentPins, hashOverlayContent, hashWorktreeDirty } from '../receipt.js';

// Pin sources. Each returns null rather than a guess when unavailable — an
// unpinned input that LOOKS pinned converts a known gap into an invisible one,
// which is strictly worse than the gap.
function pinRepoCommit(repoRoot) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
    }).trim() || null;
  } catch { return null; }
}

function pinManifest(repoRoot) {
  try {
    return JSON.parse(readFileSync(join(repoRoot, '.aify-graph', 'manifest.json'), 'utf8'));
  } catch { return null; }
}

// Identity, not age — see receipt.js: an age is a clock reading and cannot serve
// as an invalidation condition.
function pinOverlayHash(repoRoot) {
  return hashOverlayContent(readFileSync, ['functionality.json', 'tasks.json'].map((f) => join(repoRoot, '.aify-graph', f)));
}

// Tracked modifications only. Untracked snapshot noise would drift this pin
// constantly for reasons that cannot change an answer.
function pinWorktreeDirty(repoRoot) {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
    });
    return hashWorktreeDirty(out.split(/\r?\n/).map((l) => l.slice(3).trim()).filter(Boolean));
  } catch { return null; }
}

function pinOverlayAge(repoRoot) {
  let newest = null;
  for (const f of ['functionality.json', 'tasks.json']) {
    const p = join(repoRoot, '.aify-graph', f);
    if (!existsSync(p)) continue;
    try {
      const days = Math.floor((Date.now() - statSync(p).mtimeMs) / 86_400_000);
      if (newest == null || days < newest) newest = days;
    } catch { /* unreadable — null beats a guess */ }
  }
  return newest;
}
import { loadFunctionality, featuresForFile } from '../../overlay/loader.js';
import { getDirtyFiles } from '../../freshness/git.js';
import { assessOverlayBuild, loadTasksArtifact, overlayNotBuiltHint, summarizeDirtySeams, summarizeOverlayQuality, taskFeatureRefs } from '../../overlay/quality.js';
import { attachReadWarnings, inspectReadFreshness } from './read_freshness.js';
import { getCodeIntelEvidenceForSymbol } from '../../code-intel/query.js';
import { CALL_FAMILY } from '../../storage/taxonomy.js';

// "Who touches this symbol" set for pull's relation rollups: the call family
// plus type-use. Composed from the registry rather than re-declared (review R2).
// USES_TYPE is appended (a type reference is still a touch worth surfacing in a
// cross-layer pull) but this stays narrower than IMPACT_FAMILY (no TESTS /
// OVERRIDDEN_BY) — pull.relations is a compact DIRECT-neighbor view.
const PULL_TOUCH_RELATIONS = [...CALL_FAMILY, 'USES_TYPE'];
const PULL_TOUCH_SQL_LIST = PULL_TOUCH_RELATIONS.map((r) => `'${r}'`).join(', ');

// Layer inventory:
//   code          — file/symbol neighborhood (files, symbols, callers)
//   functionality — feature membership, dependents
//   tasks         — tasks referencing this node
//   docs          — Documents that MENTION this node (via MENTIONS edges)
//   activity      — recent git commits
//   relations     — DIRECT graph neighbors (OPT-IN). Compact, local.
//                   symbol:  { callers, callees }
//                   file:    { imports, imported_by, defines }
//                   feature: { inputs, outputs } cross-feature-boundary, rolled up
//   transitive    — CLOSURE blast radius for features (OPT-IN, heavier).
//                   transitive_{dependencies,dependents} + {upstream,downstream}_files
//                   Separated from relations per dev review: truncation-prone,
//                   trust-sensitive, different tuning.
// Every capped list carries { items, total, truncated, limit } metadata.
// `code_intel` is opt-in only — keeps token budget controlled. Plan #3.
const ALL_LAYERS = ['code', 'functionality', 'tasks', 'docs', 'activity', 'relations', 'transitive', 'code_intel'];
const DEFAULT_LAYERS = ['code', 'functionality', 'tasks', 'activity'];

function emptyCodeIntelEvidence() {
  return { found: false, definitions: [], references: [], hovers: [], summary: { definitions: 0, references: 0, hovers: 0 } };
}

function normalizeOverlayLookup(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

function parsePrefixedNode(node) {
  const raw = String(node || '');
  const match = raw.match(/^(feature|task)[:/](.+)$/i);
  if (!match) return { kind: null, value: raw };
  return { kind: match[1].toLowerCase(), value: match[2].trim() };
}

function resolveFeatureNode(node, features) {
  const parsed = parsePrefixedNode(node);
  const raw = parsed.kind === 'feature' ? parsed.value : String(node || '');
  const norm = normalizeOverlayLookup(raw);

  const exactId = features.find((f) => f.id === raw);
  if (exactId) return exactId;
  const ciId = features.find((f) => normalizeOverlayLookup(f.id) === norm);
  if (ciId) return ciId;
  if (parsed.kind !== 'feature') return null;
  const exactLabel = features.find((f) => String(f.label || '') === raw);
  if (exactLabel) return exactLabel;
  const ciLabel = features.find((f) => normalizeOverlayLookup(f.label || '') === norm);
  if (ciLabel) return ciLabel;
  return null;
}

function resolveTaskNode(node, allTasks) {
  const parsed = parsePrefixedNode(node);
  const raw = parsed.kind === 'task' ? parsed.value : String(node || '');
  const norm = normalizeOverlayLookup(raw);

  const exactId = allTasks.find((t) => t.id === raw);
  if (exactId) return exactId;
  const ciId = allTasks.find((t) => normalizeOverlayLookup(t.id) === norm);
  if (ciId) return ciId;
  return null;
}

function detectNodeKind(db, node) {
  if (!node) return { kind: 'unknown' };
  // Task id heuristic: any alphanumeric prefix + hyphen + id (CU-123, eng-42,
  // GH-1234). Kept broad because task exact match against tasks.json already
  // runs before this fallback — the heuristic only matters when tasks.json
  // is stale or missing the id.
  if (/^[A-Za-z]{1,5}-\w{2,}$/.test(node)) return { kind: 'task' };
  // File path: has a slash or ends in a known extension — but only if it
  // actually exists as a File node. Otherwise fall through so a path-shaped
  // string doesn't shadow a real symbol lookup.
  const looksFileish = /\//.test(node) || /\.(js|ts|py|php|cpp|h|go|rs|rb|java|md|json)$/i.test(node);
  if (looksFileish) {
    const fileHit = db.get(
      `SELECT file_path FROM nodes WHERE type = 'File' AND file_path = $p LIMIT 1`, { p: node });
    if (fileHit) return { kind: 'file', value: node };
  }
  // Symbol lookup
  const sym = db.get(
    `SELECT id, label, type, file_path, start_line FROM nodes
     WHERE label = $node AND type IN ('Function','Method','Class','Interface','Type')
     LIMIT 1`, { node });
  if (sym) return { kind: 'symbol', value: sym };
  return { kind: 'unknown', value: node };
}

// Helper: attach { total, truncated, limit } metadata to a capped collection
// so callers know when they're seeing a summary vs complete results.
function capped(items, limit) {
  const total = items.length;
  const truncated = total > limit;
  return { items: items.slice(0, limit), total, truncated, limit };
}

function loadTasksSafe(repoRoot) {
  return loadTasksArtifact(repoRoot).tasks || [];
}

function recentCommitsForFile(repoRoot, filePath, limit = 5) {
  try {
    const out = execFileSync('git',
      ['-C', repoRoot, 'log', '--pretty=format:%h|%ad|%s', '--date=short', '-n', String(limit), '--', filePath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    return out.trim().split('\n').filter(Boolean).map(l => {
      const [sha, date, subject] = l.split('|');
      return { sha, date, subject };
    });
  } catch { return []; }
}

// ---------- per-kind pulls ----------

// ---------- relations helpers (opt-in layer) ----------

// Symbol-level direct neighbors: callers + callees resolved by id (precision,
// not just label — matches the dev-review fix applied to code layer in f8feb6c).
function relationsForSymbol(db, sym, limit = 10) {
  const callersRaw = db.all(
    `SELECT DISTINCT fn.label, fn.type, fn.file_path, fn.start_line, e.relation, e.provenance
     FROM edges e
     JOIN nodes fn ON fn.id = e.from_id
     WHERE e.to_id = $id
       AND e.relation IN (${PULL_TOUCH_SQL_LIST})
     LIMIT 100`, { id: sym.id });
  const calleesRaw = db.all(
    `SELECT DISTINCT tn.label, tn.type, tn.file_path, tn.start_line, e.relation, e.provenance
     FROM edges e
     JOIN nodes tn ON tn.id = e.to_id
     WHERE e.from_id = $id
       AND e.relation IN (${PULL_TOUCH_SQL_LIST})
     LIMIT 100`, { id: sym.id });
  const withProv = (r) => ({ ...r, provenance: r.provenance ?? 'EXTRACTED' });
  return {
    callers: capped(callersRaw.map(withProv), limit),
    callees: capped(calleesRaw.map(withProv), limit),
  };
}

// File-level direct neighbors: imports + imported_by + defines.
// Per dev review: skip `initializers` and `used_by` — too easy to overclaim
// without a precise language-neutral definition.
function relationsForFile(db, filePath, limit = 10) {
  // imports: files THIS file imports
  const importsRaw = db.all(
    `SELECT DISTINCT tn.file_path
     FROM edges e
     JOIN nodes fn ON fn.id = e.from_id
     JOIN nodes tn ON tn.id = e.to_id
     WHERE fn.file_path = $p
       AND e.relation = 'IMPORTS'
       AND tn.file_path IS NOT NULL
       AND tn.file_path != $p
     LIMIT 50`, { p: filePath });
  // imported_by: files that IMPORT this file
  const importedByRaw = db.all(
    `SELECT DISTINCT fn.file_path
     FROM edges e
     JOIN nodes fn ON fn.id = e.from_id
     JOIN nodes tn ON tn.id = e.to_id
     WHERE tn.file_path = $p
       AND e.relation = 'IMPORTS'
       AND fn.file_path IS NOT NULL
       AND fn.file_path != $p
     LIMIT 50`, { p: filePath });
  // ★ THE RECOMPILE SURFACE IS TRANSITIVE, AND WE WERE STOPPING AT HOP 1.
  //
  // ef-manager, deleting a header (2026-07-31): "ChunkManager.h and
  // GpuTerrainGenerator.h are HEADERS, so the blast radius does not stop at the 10
  // direct includers. One more grep gave ~30 additional TUs at hop 2, and showed
  // propagation TERMINATES there because every hop-2 includer is a .cpp. For a
  // deletion question the transitive surface is the whole point — imported_by is
  // hop 1 only. You already have the edges; the walk is what is missing."
  //
  // He is right that it is a walk over edges we already hold, and right that hop 1
  // is the wrong answer to "what do I have to rebuild". Bounded by depth and by a
  // node cap so a hub header cannot produce an unbounded sweep, and the bound is
  // REPORTED — a truncated closure that looks complete would be the same
  // false-completeness failure this codebase exists to prevent.
  const TRANSITIVE_MAX_DEPTH = 4;
  const TRANSITIVE_MAX_FILES = 300;
  const transitiveImporters = (() => {
    const seen = new Set([filePath]);
    const byDepth = [];
    let frontier = [filePath];
    let truncated = false;
    for (let depth = 1; depth <= TRANSITIVE_MAX_DEPTH && frontier.length; depth += 1) {
      const rows = db.all(
        `SELECT DISTINCT fn.file_path
           FROM edges e
           JOIN nodes fn ON fn.id = e.from_id
           JOIN nodes tn ON tn.id = e.to_id
          WHERE tn.file_path IN (${frontier.map((_, i) => `$f${i}`).join(',')})
            AND e.relation = 'IMPORTS'
            AND fn.file_path IS NOT NULL
          LIMIT ${TRANSITIVE_MAX_FILES}`,
        Object.fromEntries(frontier.map((f, i) => [`f${i}`, f])),
      );
      // ★ THE SQL `LIMIT` IS ITSELF A TRUNCATION, AND IT WAS INVISIBLE.
      //
      // The old check only set `truncated` when `seen.size` crossed the cap. But
      // the LIMIT clips rows inside SQLite BEFORE we ever count them: a hop whose
      // returned rows are mostly already-seen discards real includers and leaves
      // seen.size far below the cap — so the closure reported `terminated: true`
      // while silently missing files. That is precisely the false-completeness
      // failure this whole surface exists to prevent, sitting inside the fix for
      // it. A full page of rows means "there may be more", always.
      if (rows.length >= TRANSITIVE_MAX_FILES) truncated = true;
      const next = [];
      for (const r of rows) {
        if (!r.file_path || seen.has(r.file_path)) continue;
        if (seen.size >= TRANSITIVE_MAX_FILES) { truncated = true; break; }
        seen.add(r.file_path);
        next.push(r.file_path);
      }
      if (next.length) byDepth.push({ depth, files: next });
      frontier = next;
    }
    // Ran out of depth budget with work still queued — the closure is a FLOOR for
    // a different reason than the file cap, and the caller deserves to know which.
    const depthCapped = frontier.length > 0;
    const total = seen.size - 1;
    return {
      total,
      byDepth,
      truncated,
      depth_capped: depthCapped,
      // TERMINATED means the walk ran out of INCLUDERS, not out of budget — the
      // frontier emptied on its own. That is the useful fact for a deletion, and
      // it is decided by the graph (a node with no incoming IMPORTS edge is
      // terminal), never by file extension. Extension-based terminality would be
      // defeated by the first .inl/.glsl/.tpp the walk met; this is not.
      terminated: !truncated && !depthCapped,
      note: truncated
        ? `recompile surface TRUNCATED at ${TRANSITIVE_MAX_FILES} files — this is a FLOOR, not the full closure`
        : depthCapped
          ? `recompile surface CUT OFF at depth ${TRANSITIVE_MAX_DEPTH} with includers still unexplored — this is a FLOOR, not the full closure`
          : `full transitive include closure: ${total} file(s) across ${byDepth.length} hop(s)`,
    };
  })();

  // defines: top symbols defined in this file
  const definesRaw = db.all(
    `SELECT label, type, start_line FROM nodes
     WHERE file_path = $p AND type IN ('Function','Method','Class','Interface','Type')
     ORDER BY start_line LIMIT 50`, { p: filePath });
  return {
    imports: capped(importsRaw.map(r => r.file_path), limit),
    imported_by: capped(importedByRaw.map(r => r.file_path), limit),
    // Hop 1 answers "who includes this"; the RECOMPILE surface is transitive, and
    // for a deletion question the transitive surface is the whole point.
    recompile_surface: transitiveImporters,
    defines: capped(definesRaw, limit),
  };
}

// Feature-level cross-boundary neighbors, rolled up by feature.
// inputs  = OTHER features whose symbols call into THIS feature's anchored symbols
// outputs = OTHER features whose symbols are called by THIS feature's anchored symbols
// "External" = no feature match for the other side.
function relationsForFeature(db, feature, features, limit = 10) {
  const symbols = feature.anchors.symbols || [];
  if (symbols.length === 0) {
    return { inputs: capped([], limit), outputs: capped([], limit) };
  }
  const symParams = Object.fromEntries(symbols.map((s, i) => [`s${i}`, s]));
  const placeholders = symbols.map((_, i) => `$s${i}`).join(',');

  // Callers (edges INTO this feature's symbols)
  const incoming = db.all(
    `SELECT DISTINCT fn.label AS caller_label, fn.file_path AS caller_file,
            e.relation, tn.label AS target_label
     FROM edges e
     JOIN nodes fn ON fn.id = e.from_id
     JOIN nodes tn ON tn.id = e.to_id
     WHERE tn.label IN (${placeholders})
       AND e.relation IN (${PULL_TOUCH_SQL_LIST})
       AND fn.file_path IS NOT NULL`,
    symParams);
  // Callees (edges FROM this feature's symbols)
  const outgoing = db.all(
    `SELECT DISTINCT fn.label AS source_label, tn.label AS callee_label,
            tn.file_path AS callee_file, e.relation
     FROM edges e
     JOIN nodes fn ON fn.id = e.from_id
     JOIN nodes tn ON tn.id = e.to_id
     WHERE fn.label IN (${placeholders})
       AND e.relation IN (${PULL_TOUCH_SQL_LIST})
       AND tn.file_path IS NOT NULL
       AND tn.file_path != ''`,
    symParams);

  // Roll up by the OTHER feature (or "external" if not in any feature)
  const inputTally = new Map(); // featureId -> { feature_id, count, evidence }
  const outputTally = new Map();

  const classify = (filePath, ownFeatureId) => {
    const matches = featuresForFile(features, filePath);
    const foreign = matches.filter(id => id !== ownFeatureId);
    return foreign.length > 0 ? foreign[0] : 'external';
  };

  for (const row of incoming) {
    const otherFeature = classify(row.caller_file, feature.id);
    if (otherFeature === feature.id) continue; // internal, skip
    if (!inputTally.has(otherFeature)) {
      inputTally.set(otherFeature, { feature: otherFeature, count: 0, sample: [] });
    }
    const entry = inputTally.get(otherFeature);
    entry.count++;
    if (entry.sample.length < 2) {
      entry.sample.push(`${row.caller_label}@${row.caller_file} → ${row.target_label}`);
    }
  }
  for (const row of outgoing) {
    const otherFeature = classify(row.callee_file, feature.id);
    if (otherFeature === feature.id) continue;
    if (!outputTally.has(otherFeature)) {
      outputTally.set(otherFeature, { feature: otherFeature, count: 0, sample: [] });
    }
    const entry = outputTally.get(otherFeature);
    entry.count++;
    if (entry.sample.length < 2) {
      entry.sample.push(`${row.source_label} → ${row.callee_label}@${row.callee_file}`);
    }
  }

  const sortTally = (tally) =>
    [...tally.values()].sort((a, b) => b.count - a.count);

  return {
    inputs: capped(sortTally(inputTally), limit),
    outputs: capped(sortTally(outputTally), limit),
  };
}

// Transitive closure of feature dependencies. Walks either direction via
// visited-set BFS, detects cycles and returns them explicitly. Cycle-safe:
// a feature already in `visited` is never re-expanded.
function walkFeatureClosure(startId, features, direction) {
  const byId = new Map(features.map(f => [f.id, f]));
  // Prebuild the reverse index once when direction='dependents'.
  // Previous version had dead broken code (`.get.bind(null)`) that would
  // throw if ever called AND re-computed the index on each call — bug
  // found in 2026-04-20 round-2 audit.
  const dependentsIdx = direction === 'dependents'
    ? features.reduce((acc, f) => {
        for (const dep of (f.depends_on || [])) {
          if (!acc.has(dep)) acc.set(dep, []);
          acc.get(dep).push(f.id);
        }
        return acc;
      }, new Map())
    : null;

  const visited = new Set();
  const cycles = [];
  const queue = [startId];
  const result = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    if (current !== startId) result.push(current);
    const feature = byId.get(current);
    if (!feature) continue;

    let nextIds;
    if (direction === 'dependencies') {
      nextIds = feature.depends_on || [];
    } else {
      nextIds = dependentsIdx.get(current) || [];
    }

    for (const n of nextIds) {
      if (visited.has(n)) {
        // Cycle — if n was already visited AND is in our walk ancestor chain
        if (result.includes(n) || n === startId) {
          const pair = [current, n].sort().join('↔');
          if (!cycles.includes(pair)) cycles.push(pair);
        }
        continue;
      }
      queue.push(n);
    }
  }

  return { features: result, cycles };
}

function filesForFeatures(db, features, featureIds, cap) {
  const selected = featureIds
    .map(id => features.find(f => f.id === id))
    .filter(Boolean);
  const allFiles = new Set();
  for (const f of selected) {
    for (const glob of (f.anchors.files || [])) {
      const rows = db.all(
        `SELECT file_path FROM nodes
         WHERE type IN ('File','Directory') AND file_path GLOB $g LIMIT 100`,
        { g: glob });
      for (const r of rows) allFiles.add(r.file_path);
      if (allFiles.size >= cap * 4) break; // short-circuit if we've got way more than cap
    }
  }
  return capped([...allFiles], cap);
}

// Transitive relations for features only. Direction can be 'downstream',
// 'upstream', or 'both' (default). Returns summary counts + capped lists.
// Returns a skip-reason if the feature is too weakly anchored for trust.
function transitiveForFeature(db, feature, features, opts = {}) {
  const { direction = 'both', featureCap = 20, fileCap = 50 } = opts;

  // Trust gate: if feature has no anchors AT ALL, skip transitive — dev
  // review: transitive compounds bad feature maps faster than direct.
  const anchorCount = (feature.anchors.symbols || []).length
    + (feature.anchors.files || []).length
    + (feature.anchors.routes || []).length;
  if (anchorCount === 0) {
    return { transitive_skipped: 'reason=weak_feature_no_anchors' };
  }

  const out = {};
  const allCycles = [];

  if (direction === 'upstream' || direction === 'both') {
    const { features: depIds, cycles } = walkFeatureClosure(feature.id, features, 'dependencies');
    out.transitive_dependencies = capped(depIds, featureCap);
    out.upstream_files = filesForFeatures(db, features, depIds, fileCap);
    for (const c of cycles) if (!allCycles.includes(c)) allCycles.push(c);
  }

  if (direction === 'downstream' || direction === 'both') {
    const { features: depIds, cycles } = walkFeatureClosure(feature.id, features, 'dependents');
    out.transitive_dependents = capped(depIds, featureCap);
    out.downstream_files = filesForFeatures(db, features, depIds, fileCap);
    for (const c of cycles) if (!allCycles.includes(c)) allCycles.push(c);
  }

  if (allCycles.length > 0) out.cycles_detected = allCycles;

  return out;
}

function pullFile({ db, filePath, features, allTasks, repoRoot, layers }) {
  const out = { node: { kind: 'file', path: filePath }, layers: {} };

  if (layers.has('code')) {
    const fileNode = db.get(
      `SELECT id, label, file_path FROM nodes WHERE type = 'File' AND file_path = $p LIMIT 1`, { p: filePath });
    if (!fileNode) {
      out.layers.code = { error: 'file not in graph', path: filePath };
    } else {
      const symbolsRaw = db.all(
        `SELECT label, type, start_line FROM nodes
         WHERE file_path = $p AND type IN ('Function','Method','Class','Interface','Type')
         ORDER BY start_line LIMIT 200`, { p: filePath });
      out.layers.code = { file: filePath, symbols: capped(symbolsRaw, 20) };
    }
  }

  if (layers.has('functionality')) {
    // ★ "ORPHAN" WAS A BROAD CLAIM MADE FROM A NARROW MECHANISM.
    //
    // featuresForFile matches ONLY `anchors.files` globs. graph_consequences also
    // reaches features through SYMBOL anchors and through tasks.json references —
    // so the two verbs answered "does this file map to a feature?" with flatly
    // opposite verdicts on the same file, same server, same minute (ef-manager,
    // 2026-07-31):
    //     graph_pull          → features: [], orphan: true
    //     graph_consequences  → features_touching: [world-buffer, chunk-management]
    //
    // And it mattered more than a cosmetic disagreement: that feature mapping is the
    // mechanism that produced the ONLY decisive graph win in his experiments — four
    // real dependents with zero textual mentions. One verb was reporting that the
    // winning mechanism did not apply.
    //
    // Neither computation is wrong; the CLAIM was. `orphan` now says what it was
    // derived from instead of asserting a global negative, which is the same
    // scoping fix applied to the trust-spine banner and to "stale".
    const matchedIds = featuresForFile(features, filePath);
    out.layers.functionality = {
      features: matchedIds,
      // Kept for back-compat, but read `orphanBasis` before acting on it.
      orphan: matchedIds.length === 0,
      orphanBasis: 'file_glob_anchors_only',
      ...(matchedIds.length === 0 ? {
        note: 'no feature FILE-GLOB anchor matches this path. That is not proof the file is unmapped: '
          + 'graph_consequences also resolves features via SYMBOL anchors and tasks.json references, and may map it. '
          + 'Check there before treating this file as orphaned.',
      } : {}),
    };
  }

  if (layers.has('tasks')) {
    const matched = allTasks.filter(t =>
      (t.files_hint || []).includes(filePath)
      || (t.features || []).some(fid => featuresForFile(features, filePath).includes(fid))
    );
    out.layers.tasks = capped(
      matched.map(t => ({ id: t.id, title: t.title, status: t.status, features: t.features })),
      10
    );
  }

  if (layers.has('activity')) {
    out.layers.activity = capped(recentCommitsForFile(repoRoot, filePath, 5), 5);
  }

  if (layers.has('docs')) {
    // Docs that MENTION any symbol defined in this file.
    const docs = db.all(
      `SELECT DISTINCT d.label, d.file_path
       FROM edges e
       JOIN nodes d ON d.id = e.from_id AND d.type = 'Document'
       JOIN nodes s ON s.id = e.to_id AND s.file_path = $p
       WHERE e.relation = 'MENTIONS'
       LIMIT 20`, { p: filePath });
    out.layers.docs = capped(
      docs.map(d => ({ label: d.label, file: d.file_path })),
      10
    );
  }

  if (layers.has('relations')) {
    out.layers.relations = relationsForFile(db, filePath);
  }

  // ★ RECEIPT ON graph_pull — ef-manager's stated priority over graph_impact,
  // because relations/docs are the layers that won his experiment 2 and the ones
  // he would most want handed to a teammate with a receipt attached.
  //
  // The claims here are almost entirely `observed`: these come from edges, not
  // from the curated overlay. That contrast IS the point — a teammate holding a
  // pull receipt and a consequences receipt for the same file can see which
  // fields survive without the overlay, and disagreement between them is itself
  // the signal.
  const rel = out.layers.relations;
  // `capped()` returns {items,total,truncated} — and a capped LIST is a floor in
  // exactly the way the closure cap is. Reading `.items` and ignoring `.truncated`
  // would put a silently-shortened list under an exhaustive receipt, which is the
  // same laundering this file already committed once inside `terminated`.
  const importedBy = rel?.imported_by ?? {};
  const docsLayer = out.layers.docs ?? {};
  const listTruncated = Boolean(importedBy.truncated) || Boolean(docsLayer.truncated);
  const pullClaims = [
    ...(importedBy.items ?? []).map((f) => ({ field: 'imported_by', value: f, provenance: 'observed', basis: 'IMPORTS edge, hop 1' })),
    ...(rel?.recompile_surface?.byDepth ?? []).flatMap((d) => d.files.map((f) => ({
      field: 'recompile_surface', value: f, provenance: 'observed', basis: `IMPORTS closure, hop ${d.depth}`,
    }))),
    ...(docsLayer.items ?? []).map((d) => ({ field: 'docs', value: d.file ?? d.label, provenance: 'observed', basis: 'MENTIONS edge' })),
  ];
  const surface = rel?.recompile_surface;
  out.receipt = buildReceipt({
    verb: 'graph_pull',
    args: { node: filePath, layers: [...layers] },
    pins: currentPins({
      repoCommit: pinRepoCommit(repoRoot),
      manifest: pinManifest(repoRoot),
      overlayContentHash: pinOverlayHash(repoRoot),
      worktreeDirtyHash: pinWorktreeDirty(repoRoot),
    }),
    reported_context: { overlay_age_days: pinOverlayAge(repoRoot) },
    claims: pullClaims,
    floor: {
      // Exhaustive ONLY when the closure genuinely terminated. A truncated or
      // depth-capped surface is a FLOOR, and a receipt that called it exhaustive
      // would launder that floor into a fact — the failure this file already had
      // once, in `terminated` itself.
      exhaustive: surface ? surface.terminated === true && !listTruncated : false,
      cause: listTruncated
        ? 'a returned list hit its display cap — the claim set is a subset of what was found'
        : surface?.terminated === true
          ? null
          : surface?.truncated
          ? 'recompile surface hit the file cap — closure is a floor, not the full set'
          : surface?.depth_capped
            ? 'recompile surface hit the depth cap with includers still unexplored — closure is a floor'
            : 'relations layer not requested, so no closure was computed',
      not_checked: [
        'includers reachable only through a build system rather than a source include',
        ...(surface?.truncated || surface?.depth_capped ? ['files beyond the traversal cap'] : []),
      ],
    },
    disconfirm: {
      verb: 'graph_consequences',
      args: { target: filePath },
      expect:
        'consequences reaches dependents through feature anchors rather than include edges. A file it '
        + 'lists as a co-consumer that is absent from recompile_surface is a real dependent with no '
        + 'include path — which means this receipt\'s structural closure is not the whole blast radius.',
    },
  });

  return out;
}

function pullFeature({ db, featureId, features, allTasks, repoRoot, layers, opts = {} }) {
  const feature = features.find(f => f.id === featureId);
  if (!feature) return { node: { kind: 'feature', id: featureId }, error: 'feature not found in functionality.json' };
  const out = { node: { kind: 'feature', id: featureId, label: feature.label, description: feature.description }, layers: {} };

  if (layers.has('code')) {
    // Files matched by this feature's anchors
    const hits = [];
    for (const glob of feature.anchors.files) {
      const rows = db.all(
        `SELECT file_path FROM nodes
         WHERE type IN ('File','Directory') AND file_path GLOB $g LIMIT 15`, { g: glob });
      for (const r of rows) if (!hits.includes(r.file_path)) hits.push(r.file_path);
    }
    const symbolsRaw = feature.anchors.symbols.length > 0 ? db.all(
      `SELECT label, type, file_path, start_line FROM nodes
       WHERE label IN (${feature.anchors.symbols.map((_, i) => `$s${i}`).join(',')})
       AND type IN ('Function','Method','Class','Interface','Type')`,
      Object.fromEntries(feature.anchors.symbols.map((s, i) => [`s${i}`, s]))
    ) : [];
    out.layers.code = { files: capped(hits, 15), symbols: capped(symbolsRaw, 20) };
  }

  if (layers.has('functionality')) {
    out.layers.functionality = {
      depends_on: feature.depends_on,
      related_to: feature.related_to,
      dependents: features.filter(f => f.depends_on.includes(featureId)).map(f => f.id),
    };
  }

  if (layers.has('tasks')) {
    const matched = allTasks
      .filter(t => (t.features || []).includes(featureId))
      .map(t => ({ id: t.id, title: t.title, status: t.status }));
    out.layers.tasks = capped(matched, 10);
  }

  if (layers.has('activity')) {
    // Walk feature's file anchors, get recent commits touching any of them.
    try {
      const globs = feature.anchors.files.filter(g => !g.includes('**')); // skip ** for subprocess arg safety
      if (globs.length > 0) {
        const args = ['-C', repoRoot, 'log', '--pretty=format:%h|%ad|%s', '--date=short', '-n', '8', '--', ...globs];
        const raw = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
        out.layers.activity = raw.trim().split('\n').filter(Boolean).map(l => {
          const [sha, date, subject] = l.split('|');
          return { sha, date, subject };
        });
      } else {
        out.layers.activity = [];
      }
    } catch { out.layers.activity = []; }
  }

  if (layers.has('relations')) {
    out.layers.relations = relationsForFeature(db, feature, features);
  }

  if (layers.has('transitive')) {
    out.layers.transitive = transitiveForFeature(db, feature, features, {
      direction: opts.direction || 'both',
    });
  }

  if (layers.has('docs')) {
    // Declared doc anchors + Docs that MENTION any symbol in this feature's
    // anchored files. Two sources merged so users see both what they
    // curated and what the graph observed.
    const fileGlobs = feature.anchors.files || [];
    const inferred = fileGlobs.length > 0 ? db.all(
      `SELECT DISTINCT d.label, d.file_path
       FROM edges e
       JOIN nodes d ON d.id = e.from_id AND d.type = 'Document'
       JOIN nodes s ON s.id = e.to_id
       WHERE e.relation = 'MENTIONS'
         AND (${fileGlobs.map((_, i) => `s.file_path GLOB $g${i}`).join(' OR ')})
       LIMIT 30`,
      Object.fromEntries(fileGlobs.map((g, i) => [`g${i}`, g]))
    ) : [];
    out.layers.docs = {
      declared: feature.anchors.docs,
      inferred: capped(inferred.map(d => ({ label: d.label, file: d.file_path })), 10),
    };
  }

  return out;
}

function pullSymbol({ db, sym, features, allTasks, repoRoot, layers }) {
  const out = { node: { kind: 'symbol', label: sym.label, type: sym.type, file: sym.file_path, line: sym.start_line }, layers: {} };

  if (layers.has('code')) {
    // Dev review: use resolved symbol id directly, not label. Same-named
    // methods across files would otherwise all match.
    const callersRaw = db.all(
      `SELECT DISTINCT fn.label, fn.file_path, fn.start_line
       FROM edges e JOIN nodes fn ON fn.id = e.from_id
       WHERE e.to_id = $id
         AND e.relation IN (${PULL_TOUCH_SQL_LIST})
       LIMIT 100`, { id: sym.id });
    out.layers.code = { callers: capped(callersRaw, 8), file: sym.file_path };
  }

  if (layers.has('functionality')) {
    const matched = features.filter(f => f.anchors.symbols.includes(sym.label) || featuresForFile([f], sym.file_path).length > 0);
    out.layers.functionality = { features: matched.map(f => f.id) };
  }

  if (layers.has('tasks')) {
    const matched = allTasks
      .filter(t =>
        (t.title || '').toLowerCase().includes(sym.label.toLowerCase())
        || (t.files_hint || []).includes(sym.file_path)
      )
      .map(t => ({ id: t.id, title: t.title, status: t.status }));
    out.layers.tasks = capped(matched, 10);
  }

  if (layers.has('activity')) {
    out.layers.activity = capped(recentCommitsForFile(repoRoot, sym.file_path, 5), 5);
  }

  if (layers.has('docs')) {
    // Docs that MENTION this specific symbol id.
    const docs = db.all(
      `SELECT DISTINCT d.label, d.file_path
       FROM edges e
       JOIN nodes d ON d.id = e.from_id AND d.type = 'Document'
       WHERE e.relation = 'MENTIONS' AND e.to_id = $id
       LIMIT 20`, { id: sym.id });
    out.layers.docs = capped(
      docs.map(d => ({ label: d.label, file: d.file_path })),
      10
    );
  }

  if (layers.has('relations')) {
    out.layers.relations = relationsForSymbol(db, sym);
  }

  return out;
}

function pullTask({ db, taskId, features, allTasks, repoRoot, layers }) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return { node: { kind: 'task', id: taskId }, error: 'task not found in tasks.json' };
  const out = { node: { kind: 'task', id: task.id, title: task.title, status: task.status, url: task.url }, layers: {} };

  if (layers.has('functionality')) {
    out.layers.functionality = {
      features: task.features || [],
      feature_labels: (task.features || []).map(fid => features.find(f => f.id === fid)?.label).filter(Boolean),
    };
  }

  if (layers.has('code')) {
    // task→feature→files chain: show both the task's own files_hint AND the
    // anchored files of every feature the task targets. Agent gets
    // "what files could contain this issue?" in one call instead of two.
    const featureFiles = new Set();
    for (const fid of (task.features || [])) {
      const f = features.find(x => x.id === fid);
      if (!f) continue;
      for (const glob of (f.anchors.files || [])) {
        // Resolve glob against graph file list
        const rows = db.all(
          `SELECT file_path FROM nodes
           WHERE type IN ('File','Directory') AND file_path GLOB $g LIMIT 30`,
          { g: glob });
        for (const r of rows) featureFiles.add(r.file_path);
      }
    }
    out.layers.code = {
      files_hint: task.files_hint || [],
      feature_files: capped([...featureFiles], 30),
    };
  }

  if (layers.has('activity')) {
    try {
      const raw = execFileSync('git',
        ['-C', repoRoot, 'log', `--grep=${task.id}`, '--pretty=format:%h|%ad|%s', '--date=short', '-n', '8'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      const items = raw.trim().split('\n').filter(Boolean).map(l => {
        const [sha, date, subject] = l.split('|');
        return { sha, date, subject };
      });
      out.layers.activity = capped(items, 8);
    } catch { out.layers.activity = capped([], 8); }
  }

  if (layers.has('docs')) {
    // Docs MENTIONing any symbol in a feature the task targets.
    const featureIds = task.features || [];
    if (featureIds.length > 0) {
      const globs = [];
      for (const fid of featureIds) {
        const f = features.find(x => x.id === fid);
        if (f) globs.push(...(f.anchors.files || []));
      }
      if (globs.length > 0) {
        const docs = db.all(
          `SELECT DISTINCT d.label, d.file_path
           FROM edges e
           JOIN nodes d ON d.id = e.from_id AND d.type = 'Document'
           JOIN nodes s ON s.id = e.to_id
           WHERE e.relation = 'MENTIONS'
             AND (${globs.map((_, i) => `s.file_path GLOB $g${i}`).join(' OR ')})
           LIMIT 20`,
          Object.fromEntries(globs.map((g, i) => [`g${i}`, g]))
        );
        out.layers.docs = capped(docs.map(d => ({ label: d.label, file: d.file_path })), 10);
      } else {
        out.layers.docs = capped([], 10);
      }
    } else {
      out.layers.docs = capped([], 10);
    }
  }

  return out;
}

function summarizeDirtyOverlapForNode({ kind, value, features, dirtyFiles }) {
  const seams = summarizeDirtySeams(features, dirtyFiles);
  let targetFiles = [];
  let targetFeatureIds = [];

  if (kind === 'file') {
    targetFiles = [value];
    targetFeatureIds = featuresForFile(features, value);
  } else if (kind === 'symbol') {
    targetFiles = value?.file_path ? [value.file_path] : [];
    targetFeatureIds = value?.file_path ? featuresForFile(features, value.file_path) : [];
  } else if (kind === 'feature') {
    targetFeatureIds = value?.id ? [value.id] : [];
  } else if (kind === 'task') {
    targetFeatureIds = taskFeatureRefs(value);
    targetFiles = value?.files_hint || [];
  }

  return {
    direct_files: targetFiles.filter((file) => dirtyFiles.includes(file)),
    affected_features: seams.features
      .filter((feature) => targetFeatureIds.includes(feature.id))
      .map((feature) => ({
        id: feature.id,
        label: feature.label,
        file_count: feature.file_count,
        files: feature.files.slice(0, 5),
      })),
  };
}

// ---------- main ----------

export async function graphPull({ repoRoot, node, layers, direction }) {
  if (!node) return 'ERROR: node parameter is required (file path, feature id, symbol name, or task id)';
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_pull' });
  if (freshness.blocker) return freshness.blocker;

  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  const layerSet = new Set(
    Array.isArray(layers) && layers.length > 0
      ? layers.filter(l => ALL_LAYERS.includes(l))
      : DEFAULT_LAYERS
  );
  // Top-level code-intel evidence (opt-in via 'code_intel' layer). Lives at
  // the top level (not under .layers) so consumers can grep result.code_intel
  // without knowing the rest of the shape. Plan #3.
  let codeIntelEvidence = null;
  if (layerSet.has('code_intel')) {
    try {
      codeIntelEvidence = getCodeIntelEvidenceForSymbol(db, { qname: String(node) });
    } catch {
      codeIntelEvidence = emptyCodeIntelEvidence();
    }
  }
  const withCodeIntel = (obj) => (codeIntelEvidence ? { ...obj, code_intel: codeIntelEvidence } : obj);

  try {
    const overlay = loadFunctionality(repoRoot);
    const allTasks = loadTasksSafe(repoRoot);
    const features = overlay.features;
    const overlayQuality = summarizeOverlayQuality(features, allTasks);
    const dirtyFiles = await getDirtyFiles(repoRoot).catch(() => []);
    const prefixed = parsePrefixedNode(node);

    // Resolve node kind. Feature/task prefixes are explicit routing hints:
    // `feature:chunk-management`, `task:CU-123`.
    const featureMatch = resolveFeatureNode(node, features);
    if (featureMatch) {
      const result = attachReadWarnings({
        ...pullFeature({ db, featureId: featureMatch.id, features, allTasks, repoRoot, layers: layerSet, opts: { direction } }),
        overlay_quality: overlayQuality,
        dirty_overlap: summarizeDirtyOverlapForNode({
          kind: 'feature',
          value: featureMatch,
          features,
          dirtyFiles,
        }),
      },
      freshness.warnings);
      return JSON.stringify(withCodeIntel(result), null, 2);
    }
    const taskMatch = resolveTaskNode(node, allTasks);
    if (taskMatch) {
      const result = attachReadWarnings({
        ...pullTask({ db, taskId: taskMatch.id, features, allTasks, repoRoot, layers: layerSet }),
        overlay_quality: overlayQuality,
        dirty_overlap: summarizeDirtyOverlapForNode({
          kind: 'task',
          value: taskMatch,
          features,
          dirtyFiles,
        }),
      }, freshness.warnings);
      return JSON.stringify(withCodeIntel(result), null, 2);
    }
    if (prefixed.kind === 'feature' || prefixed.kind === 'task') {
      // FIX B — overlay-empty hint. Before reporting "feature/task not found"
      // (which reads as "tool broken" when the overlay was never built), check
      // whether the overlay is actually built. Uses the DB so validateAnchors()
      // gives the authoritative "all anchors broken" (resolved:0) signal —
      // the exact sand_castle condition. When unbuilt, surface the recovery
      // hint instead of an empty not-found.
      const build = assessOverlayBuild(repoRoot, { features, tasks: allTasks, db });
      if (!build.built) {
        return JSON.stringify(withCodeIntel(attachReadWarnings({
          node: { kind: prefixed.kind, value: prefixed.value },
          error: 'overlay not built',
          hint: overlayNotBuiltHint(build.reason),
          overlay_quality: overlayQuality,
          dirty_overlap: { direct_files: [], affected_features: [] },
        }, freshness.warnings)), null, 2);
      }
      const suggestions = prefixed.kind === 'feature'
        ? features.slice(0, 5).map((f) => `feature:${f.id}`)
        : allTasks.slice(0, 5).map((t) => `task:${t.id}`);
      return JSON.stringify(withCodeIntel(attachReadWarnings({
        node: { kind: prefixed.kind, value: prefixed.value },
        error: `${prefixed.kind} not found`,
        hint: prefixed.kind === 'feature'
          ? 'use a valid feature id/label, e.g. feature:chunk-management or feature/chunk-management'
          : 'use a valid task id, e.g. task:CU-123, task/CU-123, or CU-123',
        suggestions,
        overlay_quality: overlayQuality,
        dirty_overlap: { direct_files: [], affected_features: [] },
      }, freshness.warnings)), null, 2);
    }
    // File or symbol?
    const detected = detectNodeKind(db, node);
    if (detected.kind === 'file') {
      const result = attachReadWarnings({
        ...pullFile({ db, filePath: detected.value, features, allTasks, repoRoot, layers: layerSet }),
        overlay_quality: overlayQuality,
        dirty_overlap: summarizeDirtyOverlapForNode({
          kind: 'file',
          value: detected.value,
          features,
          dirtyFiles,
        }),
      }, freshness.warnings);
      return JSON.stringify(withCodeIntel(result), null, 2);
    }
    if (detected.kind === 'symbol') {
      const result = attachReadWarnings({
        ...pullSymbol({ db, sym: detected.value, features, allTasks, repoRoot, layers: layerSet }),
        overlay_quality: overlayQuality,
        dirty_overlap: summarizeDirtyOverlapForNode({
          kind: 'symbol',
          value: detected.value,
          features,
          dirtyFiles,
        }),
      }, freshness.warnings);
      return JSON.stringify(withCodeIntel(result), null, 2);
    }
    return JSON.stringify(withCodeIntel(attachReadWarnings({
      node: { kind: 'unresolved', value: node },
      error: 'could not resolve as feature id, task id, file path, or symbol',
      hint: 'try feature:<id>, feature/<id>, task:<id>, task/<id>, graph_whereis(symbol=...), or graph_search(query=...) to find the right node identifier',
      overlay_quality: overlayQuality,
      dirty_overlap: { direct_files: [], affected_features: [] },
    }, freshness.warnings)), null, 2);
  } finally {
    db.close();
  }
}
