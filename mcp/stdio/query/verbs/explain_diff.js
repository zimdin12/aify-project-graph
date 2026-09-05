// graph_explain_diff — explain an EXISTING change/diff (P1-4).
//
// The reverse of graph_consequences. Where consequences is forward-from-a-
// symbol ("what breaks if I touch X?"), explain_diff is keyed on a git diff /
// PR: "this diff already touched these files — what symbols did it change,
// what's 1-hop downstream, which architecture layers does it span, how risky
// is it, and what tests cover it?"
//
// Fills the reviewer / PR-impact gap. Game-dev agents reviewing or fixing a
// change want the blast radius of an existing change, not a hypothetical one.
//
// Synthesis-only. No new data. Reuses:
//   - freshness/git.js          → changed-file resolution (windowsHide on)
//   - the impact 1-hop edge walk → callers/dependents of changed symbols
//   - lsp-evidence.js            → [lsp✓] provenance + trust banner
//   - intelligence overlays      → architecture-layer span
//   - consequences' risk_flags + tests-adjacent concepts (re-derived here on
//     the file set rather than a single symbol).

import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { openExistingDb } from '../../storage/db.js';
import { inspectReadFreshness, attachReadWarnings } from './read_freshness.js';
import { loadIntelligenceOverlays } from '../../intelligence/overlays.js';
import { buildTrustLine, hasLspVerifiedEdge, RESULTS_TRUST_UNAVAILABLE } from '../lsp-evidence.js';

// 1-hop incoming relations — same set graph_change_plan treats as "callers /
// dependents that break when the target changes". Kept narrow on purpose:
// these are the edges that point INTO a changed symbol.
const INCOMING_RELATIONS = ['CALLS', 'REFERENCES', 'INVOKES', 'PASSES_THROUGH', 'USES_TYPE'];
const SYMBOL_TYPES = ['Function', 'Method', 'Class', 'Interface', 'Type', 'Route', 'Entrypoint'];

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

function looksLikeContractPath(filePath) {
  return Boolean(filePath) && (
    /\bcontracts?\b/i.test(filePath)
    || /\.proto$/i.test(filePath)
    || /\.(thrift|graphql|gql)$/i.test(filePath)
    || /\bschema\b/i.test(filePath)
    || /\bapi\b.*\.(md|ya?ml|json)$/i.test(filePath)
  );
}

// Resolve the changed file list from a git range / staged / working-tree.
// Returns { files, mode, rangeLabel }. Reuses the same execFile shape as
// freshness/git.js (windowsHide, cwd=repoRoot) — no shell, no injection.
function resolveChangedFiles({ repoRoot, range, staged, files }) {
  // Explicit file list wins — caller already knows the scope.
  if (Array.isArray(files) && files.length > 0) {
    return {
      files: normalizeFileList(files),
      mode: 'explicit',
      rangeLabel: `${files.length} explicit file(s)`,
    };
  }

  const run = (args, label, mode) => {
    try {
      const out = execFileSync('git', ['-C', repoRoot, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      });
      return { files: normalizeFileList(out.split(/\r?\n/u)), mode, rangeLabel: label };
    } catch {
      return null;
    }
  };

  if (staged) {
    return run(['diff', '--name-only', '--cached'], 'staged (--cached)', 'staged')
      ?? { files: [], mode: 'staged', rangeLabel: 'staged (--cached)' };
  }

  if (range && String(range).trim()) {
    const r = String(range).trim();
    // Pass the range verbatim to `git diff` — it understands `A..B`,
    // `A...B`, `HEAD~3`, a bare sha, etc. `--` separates rev from paths.
    return run(['diff', '--name-only', r], r, 'range')
      ?? { files: [], mode: 'range', rangeLabel: r };
  }

  // Default: working-tree changes (uncommitted, tracked + untracked) — the
  // "what am I about to commit?" view. Reuse status --porcelain semantics
  // from the freshness observation, which is the same one every other read verb uses.
  return { files: null, mode: 'worktree', rangeLabel: 'working tree (uncommitted)' };
}

function normalizeFileList(lines) {
  return [...new Set(
    lines
      .map((l) => String(l || '').trim().replace(/\\/g, '/'))
      .filter(Boolean)
      .filter((p) => !p.startsWith('.aify-graph/')),
  )];
}

// Map each changed file → symbols defined in it (Function/Method/Class/...).
// One query, scoped to the changed file set.
function symbolsForFiles(db, changedFiles) {
  if (changedFiles.length === 0) return [];
  const typesClause = SYMBOL_TYPES.map((t) => `'${t}'`).join(',');
  return db.all(
    `SELECT id, label, type, file_path, start_line
     FROM nodes
     WHERE type IN (${typesClause})
       AND file_path IN (SELECT value FROM json_each($files))
     ORDER BY file_path, start_line`,
    { files: JSON.stringify(changedFiles) },
  );
}

// 1-hop callers/dependents of the changed symbols. Same incoming-edge walk
// graph_change_plan uses, but seeded by the whole changed-symbol set instead
// of one symbol. Excludes edges that originate inside the changed files
// themselves (self-edges aren't "affected by" the diff — they ARE the diff).
function affectedOneHop(db, changedSymbolIds, changedFileSet) {
  if (changedSymbolIds.length === 0) return [];
  const relClause = INCOMING_RELATIONS.map((r) => `'${r}'`).join(',');
  const rows = db.all(
    `SELECT DISTINCT e.from_id, e.relation, e.provenance, e.confidence,
            n.label AS from_label, n.type AS from_type,
            n.file_path AS from_file, n.start_line AS from_line,
            t.label AS to_label, t.file_path AS to_file
     FROM edges e
     JOIN nodes n ON n.id = e.from_id
     LEFT JOIN nodes t ON t.id = e.to_id
     WHERE e.to_id IN (SELECT value FROM json_each($ids))
       AND e.relation IN (${relClause})
     LIMIT 400`,
    { ids: JSON.stringify(changedSymbolIds) },
  );
  // Drop edges whose source lives inside a changed file (intra-diff edges).
  return rows.filter((r) => r.from_file && !changedFileSet.has(r.from_file));
}

// Adjacent / covering tests for the changed symbols — TESTS edges plus
// test-file path heuristics, mirroring consequences' tests-adjacent logic but
// seeded on the changed-symbol id set.
function adjacentTests(db, changedSymbolIds, changedFiles) {
  const tests = new Set();
  // Any changed file that is itself a test counts as touched coverage.
  for (const f of changedFiles) if (isTestLikePath(f)) tests.add(f);

  if (changedSymbolIds.length > 0) {
    const rows = db.all(
      `SELECT DISTINCT COALESCE(NULLIF(n.file_path, ''), NULLIF(e.source_file, '')) AS test_file
       FROM edges e
       JOIN nodes n ON n.id = e.from_id
       WHERE e.to_id IN (SELECT value FROM json_each($ids))
         AND (e.relation = 'TESTS'
           OR n.type = 'Test'
           OR n.file_path LIKE '%/test/%'  OR n.file_path LIKE '%/tests/%'
           OR n.file_path LIKE 'test/%'    OR n.file_path LIKE 'tests/%'
           OR n.file_path LIKE '%.test.%'  OR n.file_path LIKE '%.spec.%'
           OR e.source_file LIKE '%/test/%' OR e.source_file LIKE '%/tests/%'
           OR e.source_file LIKE 'test/%'   OR e.source_file LIKE 'tests/%'
           OR e.source_file LIKE '%.test.%' OR e.source_file LIKE '%.spec.%')
       LIMIT 25`,
      { ids: JSON.stringify(changedSymbolIds) },
    );
    for (const r of rows) if (isTestLikePath(r.test_file)) tests.add(r.test_file);
  }
  return [...tests];
}

// Architecture-layer span. Reuse the intelligence overlay loader. Maps every
// changed file → its layer assignment; counts distinct layers touched.
// Cross-layer changes are higher risk.
function layerSpan(architecture, changedFiles) {
  if (!architecture?.assignments || !architecture?.layers) {
    return { available: false, layers: [], crossLayerCount: 0, unassigned: changedFiles.length };
  }
  const layerMeta = new Map(architecture.layers.map((l) => [l.id, l]));
  const perLayer = new Map();
  let unassigned = 0;
  for (const f of changedFiles) {
    const asg = architecture.assignments[f];
    if (!asg?.layerId) { unassigned += 1; continue; }
    if (!perLayer.has(asg.layerId)) perLayer.set(asg.layerId, []);
    perLayer.get(asg.layerId).push(f);
  }
  const layers = [...perLayer.entries()].map(([id, fileList]) => ({
    id,
    name: layerMeta.get(id)?.name ?? id,
    file_count: fileList.length,
    files: fileList.slice(0, 5),
  })).sort((a, b) => b.file_count - a.file_count);
  return { available: true, layers, crossLayerCount: layers.length, unassigned };
}

// Group affected edges by their source file (the file that would break).
function groupAffectedByFile(affectedEdges) {
  const byFile = new Map();
  for (const e of affectedEdges) {
    const file = e.from_file;
    if (!file) continue;
    const entry = byFile.get(file) ?? {
      file, count: 0, symbols: new Set(), relations: new Set(), lsp_verified: false,
    };
    entry.count += 1;
    if (e.from_label) entry.symbols.add(e.from_label);
    if (e.relation) entry.relations.add(e.relation);
    if (e.provenance === 'LSP_VERIFIED') entry.lsp_verified = true;
    byFile.set(file, entry);
  }
  return [...byFile.values()]
    .map((e) => ({
      file: e.file,
      provenance: e.lsp_verified ? 'lsp✓' : 'heuristic',
      affected_symbols: [...e.symbols].slice(0, 8),
      relations: [...e.relations],
      edge_count: e.count,
    }))
    .sort((a, b) => b.edge_count - a.edge_count);
}

export async function graphExplainDiff({ repoRoot, range, staged = false, files, overlay = false, top_k = 30 }) {
  const freshness = await inspectReadFreshness({ repoRoot, verbName: 'graph_explain_diff' });
  if (freshness.blocker) return freshness.blocker;

  // 1. Resolve the changed-file list (range / staged / explicit / working-tree).
  const resolved = resolveChangedFiles({ repoRoot, range, staged, files });
  let changedFiles = resolved.files;
  if (changedFiles == null) {
    // Working-tree default — reuse the shared dirty-file helper.
    // ⛔ ONE GIT OBSERVATION PER READ, NOT TWO. inspectReadFreshness above already ran
    // `git status` and printed a warning about the result; this line ran it AGAIN, moments later,
    // and swallowed a failure into []. Two queries for one question is the shape of the field
    // report this whole area exists to answer — one verb said "592 dirty" and another "4 dirty"
    // for the same tree at the same commit, and the reader could not tell which was lying. Sharing
    // the observation makes disagreement unconstructible rather than merely unlikely.
    //
    // ⚠ This is `changedFiles`, the fallback used when no explicit diff range was given. An
    // unreadable tree yields an empty change set and the freshness warning above says why, which
    // is the whole disclosure for a verb whose output is prose.
    changedFiles = freshness.dirtyFiles;
  }
  changedFiles = normalizeFileList(changedFiles);

  if (changedFiles.length === 0) {
    return [
      `graph_explain_diff — no changed files for ${resolved.rangeLabel}.`,
      resolved.mode === 'worktree'
        ? 'Working tree is clean. Pass range="main...HEAD" / "HEAD~3" / "<sha>~1..<sha>", or staged=true.'
        : 'The range resolved to zero files. Check the rev range is valid in this repo.',
    ].join('\n');
  }

  const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const changedFileSet = new Set(changedFiles);

    // 2. CHANGED — symbols defined in the changed files.
    const changedSymbols = symbolsForFiles(db, changedFiles);
    const changedSymbolIds = changedSymbols.map((s) => s.id);
    const filesWithNoSymbols = changedFiles.filter(
      (f) => !changedSymbols.some((s) => s.file_path === f),
    );

    // 3. AFFECTED (1-hop) — callers/dependents of the changed symbols.
    const affectedEdges = affectedOneHop(db, changedSymbolIds, changedFileSet);
    const affectedByFile = groupAffectedByFile(affectedEdges);
    const affectedNodeIds = [...new Set(affectedEdges.map((e) => e.from_id))];

    // 4. LAYERS — architecture-layer span (intelligence overlay).
    const { architecture, warnings: overlayWarnings } = loadIntelligenceOverlays({ repoRoot });
    const layers = layerSpan(architecture, changedFiles);

    // 5. TESTS — adjacent / covering tests for the changed symbols.
    const tests = adjacentTests(db, changedSymbolIds, changedFiles);

    // 6. RISK — honest, labeled heuristic. cross-layer × affected × contract/test.
    const contractFilesTouched = changedFiles.filter(looksLikeContractPath);
    const touchedTestFiles = changedFiles.filter(isTestLikePath);
    const riskFlags = [];
    if (layers.available && layers.crossLayerCount > 1) {
      riskFlags.push(`cross_layer — change spans ${layers.crossLayerCount} architecture layers (${layers.layers.map((l) => l.id).join(', ')})`);
    }
    if (affectedByFile.length > 0) {
      riskFlags.push(`fan_out — ${affectedNodeIds.length} dependent symbol(s) across ${affectedByFile.length} file(s) reference the changed code`);
    }
    if (contractFilesTouched.length > 0) {
      riskFlags.push(`contract_touch — ${contractFilesTouched.length} contract/schema file(s) changed; downstream consumers may need updates`);
    }
    if (tests.length === 0 && changedSymbols.length > 0) {
      riskFlags.push('no_test_coverage — no adjacent tests for the changed symbols; regression risk');
    }
    if (touchedTestFiles.length === 0 && changedSymbols.length > 0) {
      riskFlags.push('no_test_in_diff — the diff changes code but no test file; consider adding/adjusting tests');
    }

    // Heuristic risk score (labeled, bounded). Deliberately simple + honest:
    //   layerWeight  = max(crossLayer-1, 0)          (single-layer change = 0)
    //   fanWeight    = log2(1 + affected symbols)
    //   contractWt   = 2 per touched contract file
    //   testRelief   = -1 if the diff includes a test file
    const layerWeight = layers.available ? Math.max(layers.crossLayerCount - 1, 0) : 0;
    const fanWeight = Math.log2(1 + affectedNodeIds.length);
    const contractWeight = contractFilesTouched.length * 2;
    const testRelief = touchedTestFiles.length > 0 ? -1 : 0;
    const rawScore = (layerWeight * 1.5) + fanWeight + contractWeight + testRelief;
    const score = Math.max(0, Math.round(rawScore * 10) / 10);
    const band = score >= 6 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW';

    // Trust banner — reuse the shared lsp-evidence line. The affected set is
    // heuristic unless clangd edges back it; say so explicitly.
    let trustLine = '';
    try {
      // ⛔ THE SET OF CHANGED SYMBOLS, not a single queried one. This verb enumerates the callers of
      // the changed symbols (`affected_1hop.by_file`), so an uncommitted caller makes that
      // enumeration short — measured, on the verb whose job is to say what a change will break.
      // I first excluded it for having "no single symbol", which generalised from the shape of the
      // argument to the absence of the data: the names are right there in `changedSymbols`.
      trustLine = await buildTrustLine({
        edges: affectedEdges, db, repoRoot,
        freshness, symbol: changedSymbols.map((s) => s.label).filter(Boolean),
      });
    } catch { trustLine = RESULTS_TRUST_UNAVAILABLE; }
    const affectedIsHeuristic = !hasLspVerifiedEdge(affectedEdges);

    // 7. Optional diff-overlay.json for the dashboard (P2-2 blast-radius).
    let overlayWritten = null;
    if (overlay) {
      try {
        const changedNodeIds = changedSymbolIds;
        const graphDir = join(repoRoot, '.aify-graph');
        if (!existsSync(graphDir)) mkdirSync(graphDir, { recursive: true });
        const overlayPath = join(graphDir, 'diff-overlay.json');
        writeFileSync(overlayPath, JSON.stringify({
          schema_version: '0.1',
          generatedAt: new Date().toISOString(),
          range: resolved.rangeLabel,
          changedNodeIds,
          affectedNodeIds,
        }, null, 2));
        overlayWritten = '.aify-graph/diff-overlay.json';
      } catch { /* best-effort — never block the result on overlay write */ }
    }

    // Compact, budgeted, cohesive output. Object form (other planning verbs
    // return objects too); the server JSON-stringifies it. Lists are capped.
    const changedSection = {};
    for (const s of changedSymbols) {
      (changedSection[s.file_path] ??= []).push(`${s.label} (${(s.type || '').toLowerCase()}:${s.start_line ?? 0})`);
    }

    const result = {
      verb: 'graph_explain_diff',
      range: resolved.rangeLabel,
      mode: resolved.mode,
      changed: {
        file_count: changedFiles.length,
        files_with_symbols: changedSection,
        files_no_indexed_symbols: filesWithNoSymbols.slice(0, 20),
        symbol_count: changedSymbols.length,
      },
      affected_1hop: {
        symbol_count: affectedNodeIds.length,
        file_count: affectedByFile.length,
        by_file: affectedByFile.slice(0, top_k),
        // ⛔ SAID "(clangd)" FOR EVERY LANGUAGE. A diff can span C++, TypeScript and Python in one
        // answer, so naming a single engine here is wrong whatever is in scope — and unlike the
        // banners there is no per-result language to derive from. The honest form names the
        // PROPERTY (compiler-verified) rather than guessing which compiler.
        provenance: affectedIsHeuristic ? 'heuristic (tree-sitter)' : 'compiler-verified where [lsp✓]',
      },
      layers: layers.available
        ? {
            available: true,
            spans: layers.crossLayerCount,
            layers: layers.layers,
            unassigned_files: layers.unassigned,
          }
        : { available: false, note: 'No architecture.json intelligence overlay — run /graph-build-intelligence to enable layer-span analysis.' },
      tests_adjacent: tests,
      risk: {
        score,
        band,
        heuristic: true,
        formula: 'max(crossLayer-1,0)*1.5 + log2(1+affected) + 2*contractFiles - (1 if test in diff)',
        flags: riskFlags,
      },
      trust: trustLine || null,
      overlay_written: overlayWritten,
    };
    if (overlayWarnings.length > 0) result._overlay_warnings = overlayWarnings;

    return attachReadWarnings(result, freshness.warnings);
  } finally {
    db.close();
  }
}
