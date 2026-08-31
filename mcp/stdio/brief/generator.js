// Brief artifact generator. Emits five files at `.aify-graph/`:
//   brief.md        — human-readable orientation (~700-900 tokens budget)
//   brief.agent.md  — dense prompt substrate for agent context (~300-700 tokens; grows with public-API surface)
//   brief.onboard.md — trimmed variant for new-to-this-repo sessions (~250-500 tokens)
//   brief.plan.md   — feature-led + recent commits for change-planning (~300-600 tokens when functionality.json populated)
//   brief.json      — machine-readable equivalent
//
// Runs against an already-indexed graph. Reuses the same SQL patterns as
// graph_report and graph_onboard so the brief agrees with what live queries
// would show. The point of emitting it statically is to move that value from
// live-MCP tool calls (expensive) to ambient context the agent reads once.

import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isTaskOpen } from '../overlay/task-status.js';
// Non-graph brief inputs live in artifacts.js so the renderers can be split out without a
// cycle — see that file's header for why this slice had to come first.
import { computeCoverage, openTasksByFeature, completedTaskCountsByFeature, openTasksWithoutFeatures } from './artifacts.js';
// ⚠ RE-EXPORTED, because removing it was an API BREAK I hid from myself. At base this module
// exported both `computeCoverage` and `generateBrief`; the artifacts slice moved the first and
// I updated the test's import in the same commit — which masked the break rather than revealing
// it. A structural change that alters a module's public surface is not structural.
// review, hermes session: preserve the old named export or classify the change as breaking.
export { computeCoverage } from './artifacts.js';
// The five renderers live in render.js. generator.js orchestrates and hands each one a plain
// data object; nothing flows back. See render.js's header for why artifacts.js had to move first.
import { q, count, extractPaths, detectCanonicalEntries, subsystems, hubs, readFirst, linkedDocumentCandidates, testInventory, testAnchors, enrichFeaturesForPlanning, enrichRisksForPlanning, risks } from './graph-shape.js';
import { extractTooling, detectFromPackageJson, documentRecency, recentActivity, recentActivityWithFiles, summarizeUnresolvedFromManifest } from './extract.js';
import { buildDocumentView } from './document-view.js';
import { renderMarkdown, renderAgentMarkdown, renderOnboardAgentMarkdown, renderPlanAgentMarkdown, renderJson } from './render.js';
import { openDb } from '../storage/db.js';
import { computeTrustLevel } from '../query/verbs/health.js';
import { getDirtyFilesSync } from '../freshness/git.js';
import { getUnresolvedCounts } from '../freshness/unresolved-metrics.js';
import { ATTESTATION, classifyAttestation, readGraphPublication } from '../storage/publication-schema.js';
import { loadFunctionality, validateAnchors, hasOverlay, featuresForFile, validateFeatureEdges } from '../overlay/loader.js';
import { loadIntelligenceOverlays, summarizeArchitectureLayers } from '../intelligence/overlays.js';
import { loadTasksArtifact, summarizeDirtySeams, summarizeOverlayQuality, taskFeatureRefs, taskLinkStrength, taskLinkStrengthCounts } from '../overlay/quality.js';
import { buildPaths } from '../query/verbs/path.js';

const NOISE_LABELS = new Set([
  'requirements.txt', 'package-lock.json', 'yarn.lock', '.gitignore',
  '.eslintrc', '.prettierrc', 'tsconfig.json', '.editorconfig',
  'LICENSE', 'CHANGELOG', 'CHANGELOG.md',
]);
const NOISE_ENTRY_PATTERNS = [/^index\.(css|html)$/i, /^__init__\.py$/];



// ---------- data gatherers ----------

function repoSnapshot(db, repoRoot) {
  const totalNodes = count(db, 'SELECT count(*) AS c FROM nodes');
  const totalEdges = count(db, 'SELECT count(*) AS c FROM edges');
  const totalFiles = count(db, "SELECT count(*) AS c FROM nodes WHERE type = 'File'");
  const langs = q(db,
    `SELECT language AS name, count(*) AS files FROM nodes
     WHERE type = 'File' AND language != ''
     GROUP BY language ORDER BY files DESC LIMIT 6`);
  // Trust signal: refs the resolver couldn't match to any node at ingest
  // time. Reads manifest.dirtyEdgeCount (set by freshness/orchestrator) —
  // same number reported by graph_status. Previously this counted
  // `edges WHERE confidence < 1.0` which is a DIFFERENT thing (heuristic
  // resolutions still produce real edges, just lower-confidence), and
  // diverged from the index's own count by ~3-4× on real repos. Echoes
  // bench 2026-04-21: brief said "19046 unresolved" while index said 5227;
  // this fix aligns the two.
  let unresolvedEdges = 0;
  // ⛔ THE REFUSING VALUE IS THE DEFAULT. A brief that could not read the manifest, or was built
  // over a graph whose publication cannot be checked, must not present its trust line as though it
  // had been verified. `unchecked_static` is reserved for a reader holding only ONE substrate;
  // this function has `db`, so it can do the real comparison and usually will.
  let generationState = ATTESTATION.LEGACY_UNATTESTED;
  try {
    const manifestPath = join(repoRoot, '.aify-graph', 'manifest.json');
    if (existsSync(manifestPath)) {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
      unresolvedEdges = getUnresolvedCounts(raw).trust;
      // ⭐ BOTH SUBSTRATES, SO THE CLAIM IS EARNED. Reviewer's rule: a manifest naming its own
      // generation is one side of a two-sided comparison, and a static reader must never
      // manufacture `attested` from it. This one has the database in hand.
      generationState = classifyAttestation({
        dbGeneration: readGraphPublication(db)?.generation ?? null,
        manifestGeneration: raw?.generation ?? null,
      });
    }
  } catch {
    // ⚠ NOT "fall through with 0 and say ok". A failed read leaves unresolvedEdges at 0, which the
    // trust threshold reads as HEALTHY — a fail-open default in the field that gates whether an
    // agent believes anything else. The state below carries the doubt the number cannot.
  }
  // Shared with graph_health — single source of truth for thresholds.
  const trustLevel = computeTrustLevel(unresolvedEdges);
  // ⚠ generationState TRAVELS WITH THE NUMBER IT QUALIFIES. A consumer that receives the count
  // without it is back to reading a figure whose graph cannot be checked.
  return { files: totalFiles, symbols: totalNodes, edges: totalEdges, languages: langs, unresolvedEdges, trustLevel, generationState };
}

// Universal public-API detector. Returns a list of {name, location, kind}
// describing what the codebase externally offers. Tries strategies in order:
//   1. MCP server tools/list style arrays (name: 'X', handler: Y)
//   2. Laravel routes/*.php (Route::method('uri', Handler::class) -> action)
//   3. Express / FastAPI style route calls (app.get/post, @app.route)
//   4. Python package __init__.py re-exports (from .x import Y)
//   5. Node package.json "exports" field
//   6. Graph fallback: top public symbols by fan-out (excluded from INTERNAL_HUBS)
//
// Bench 2026-04-20 found the brief HUBS section was consistently complained
// about by subagents as noise (4/4 in feedback experiment) because it ranks
// internal helpers higher than public API surface. EXPORTS is the missing
// "what does the codebase offer" signal.
function extractExports(repoRoot, db) {
  const out = [];
  const seen = new Set();
  const add = (name, location, kind) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({ name, location, kind });
  };

  // Strategy 1: MCP server tool arrays. Scan for `name: '...', handler: X` pairs.
  // Handles mcp/stdio/server.js with a TOOLS = [ { name, handler, ... }, ... ] shape.
  // ⛔ THIS SCAN BROKE WHEN THE TOOLS ARRAY MOVED, AND THE REFACTOR CLAIMED NO BEHAVIOUR CHANGE.
  //
  // Slice c8cc8eb extracted all 42 declarations to mcp/stdio/tools/schema.js. This function
  // scanned server.js only, found zero `{name, handler}` pairs, and generateBrief silently
  // stopped emitting the EXPORTS section for THIS repo — losing every public verb name and
  // starving extractPaths() of its input. tools/list stayed byte-identical, which is what I
  // measured and proved; the brief is a different surface and I proved nothing about it.
  //
  // review, hermes session caught it with a differential against exact git blobs: pre-refactor
  // server.js produced EXPORTS with `graph_status`; post-refactor produced neither. The unit
  // test manufactures the OLD inline server shape, so 33 generator tests passed while the real
  // architecture failed — a fixture pinning a shape the repo no longer has.
  //
  // ⇒ Discovery now FOLLOWS THE IMPORT rather than a hardcoded location list. A hardcoded
  // `tools/schema.js` entry would work for this repo today and break for the next layout; the
  // wiring is the thing that is actually true. Still pure source scanning — no target-repo code
  // is executed.
  const mcpCandidates = ['mcp/stdio/server.js', 'src/server.js', 'server.js'];
  const scanForVerbs = (text, rel) => [...text.matchAll(
    /\{\s*name:\s*['"`]([a-z][a-z0-9_]*)['"`][\s\S]{0,400}?handler:\s*([A-Za-z_][A-Za-z0-9_]*)/g,
  )].map((m) => ({ name: m[1], location: `${rel}:handler=${m[2]}` }));

  for (const rel of mcpCandidates) {
    const p = join(repoRoot, rel);
    if (!existsSync(p)) continue;
    try {
      const serverText = readFileSync(p, 'utf8');
      // Follow every relative import the server pulls a tool array from, one hop. The verbs
      // live wherever the server says they live.
      for (const m of serverText.matchAll(/import\s*\{[^}]*\bTOOLS\b[^}]*\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
        const schemaRel = join(rel, '..', m[1]).replace(/\\/g, '/');
        const schemaAbs = join(repoRoot, schemaRel);
        if (!existsSync(schemaAbs)) continue;
        try {
          for (const v of scanForVerbs(readFileSync(schemaAbs, 'utf8'), schemaRel)) {
            add(v.name, v.location, 'mcp_verb');
          }
        } catch { /* unreadable schema module — fall through to the inline scan */ }
      }
      if (out.length) return out;
      const text = serverText;
      // Match `name: 'foo',` ... `handler: bar` within a tight window (same object literal)
      const matches = [...text.matchAll(/\{\s*name:\s*['"`]([a-z][a-z0-9_]*)['"`][\s\S]{0,400}?handler:\s*([A-Za-z_][A-Za-z0-9_]*)/g)];
      for (const m of matches) {
        add(m[1], `${rel}:handler=${m[2]}`, 'mcp_verb');
      }
      // For MCP servers, return ALL detected verbs — they're the explicit
      // public API and subagents need to be able to find ANY of them by name.
      // MCP tool surfaces are bounded by design (~20-40 at the upper end),
      // so no cap is needed. Brief grows linearly with tool count, but every
      // verb line is load-bearing for search/trace tasks against this repo.
      if (out.length) return out;
    } catch {}
  }

  // Strategy 2: Laravel routes/*.php (most lc-api-like shape)
  const routesDir = join(repoRoot, 'routes');
  if (existsSync(routesDir)) {
    try {
      const files = readdirSync(routesDir).filter(f => f.endsWith('.php'));
      for (const f of files.slice(0, 8)) {
        const path = join(routesDir, f);
        const text = readFileSync(path, 'utf8');
        // Match both forms:
        //   Route::get('/x', Controller::class)                 → bare class
        //   Route::get('/x', [Controller::class, 'method'])     → array-call
        //   Route::apiResource('x', Controller::class)
        // Previous regex only caught the bare form — dev audit 11b90fb
        // flagged that array-form controllers were silently dropped, which
        // is the idiomatic Laravel 8+ routing shape.
        const routeRe = /Route::(get|post|put|patch|delete|apiResource)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(?:\[\s*([A-Za-z0-9_\\]+)::class\s*,\s*['"`]([A-Za-z0-9_]+)['"`]\s*\]|([A-Za-z0-9_\\]+))/g;
        const routeMatches = [...text.matchAll(routeRe)];
        for (const m of routeMatches) {
          const method = m[1].toUpperCase();
          const uri = m[2];
          let handler;
          if (m[3]) {
            // Array form: [Controller::class, 'method']
            handler = `${m[3].split('\\').pop()}@${m[4]}`;
          } else {
            handler = m[5].split('\\').pop();
          }
          add(`${method} ${uri}`, `routes/${f} → ${handler}`, 'route');
          if (out.length >= 16) break;
        }
        if (out.length >= 16) break;
      }
      if (out.length) return out.slice(0, 16);
    } catch {}
  }

  // Strategy 3: Express/FastAPI style route declarations in any JS/TS/Python file at repo root
  const jsCandidates = ['app.js', 'server.js', 'src/app.js', 'src/server.js'];
  for (const rel of jsCandidates) {
    const p = join(repoRoot, rel);
    if (!existsSync(p)) continue;
    try {
      const text = readFileSync(p, 'utf8');
      const exp = [...text.matchAll(/app\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g)];
      for (const m of exp.slice(0, 8)) {
        add(`${m[1].toUpperCase()} ${m[2]}`, rel, 'route');
      }
      if (out.length) return out;
    } catch {}
  }

  // Strategy 4: Python __init__.py re-exports (package public API)
  // Walk src-like roots looking for a top-level __init__.py with `from .x import Y`
  const pyCandidates = [];
  try {
    const items = readdirSync(repoRoot, { withFileTypes: true });
    for (const it of items) {
      if (it.isDirectory() && !it.name.startsWith('.') && !['node_modules', 'tests', 'test', 'vendor', 'build', 'dist'].includes(it.name)) {
        const init = join(repoRoot, it.name, '__init__.py');
        if (existsSync(init)) pyCandidates.push({ dir: it.name, path: init });
      }
    }
  } catch {}
  for (const { dir, path } of pyCandidates.slice(0, 3)) {
    try {
      const text = readFileSync(path, 'utf8');
      const imports = [...text.matchAll(/^from\s+\.[\w.]*\s+import\s+([\w,\s]+)/gm)];
      // `g` flag is REQUIRED for String.prototype.matchAll — without it,
      // matchAll throws TypeError at runtime which the outer try/catch
      // swallows, silently killing the whole strategy. Bug caught by
      // gap-closing test on 2026-04-20 late.
      const allNames = [...text.matchAll(/__all__\s*=\s*\[([\s\S]*?)\]/g)];
      if (allNames.length) {
        const names = [...allNames[0][1].matchAll(/['"]([\w]+)['"]/g)];
        for (const m of names.slice(0, 8)) add(m[1], `${dir}/__init__.py`, 'py_export');
      } else {
        for (const m of imports) {
          const names = m[1].split(',').map(n => n.trim()).filter(Boolean);
          for (const n of names) add(n, `${dir}/__init__.py`, 'py_export');
          if (out.length >= 8) break;
        }
      }
      if (out.length) return out.slice(0, 8);
    } catch {}
  }

  // Strategy 5: Fallback — top public Function/Class/Method nodes from the graph.
  // Ranks by outgoing edges (fan-out = called a lot internally = likely API surface).
  // Excludes underscore-prefixed (private) and ANON/constructor-like noise.
  try {
    const rows = q(db,
      `SELECT n.label, n.file_path, n.start_line, n.type, COUNT(e.to_id) AS fan_out
       FROM nodes n
       LEFT JOIN edges e ON e.from_id = n.id
       WHERE n.type IN ('Function', 'Class', 'Method')
         AND n.label NOT LIKE '\\_%' ESCAPE '\\'
         AND n.label NOT IN ('constructor','default','anonymous')
         AND n.file_path NOT LIKE 'tests/%'
         AND n.file_path NOT LIKE 'test/%'
         AND n.file_path NOT LIKE 'node_modules/%'
         AND n.file_path NOT LIKE 'vendor/%'
       GROUP BY n.id
       ORDER BY fan_out DESC
       LIMIT 12`);
    for (const r of rows.slice(0, 6)) {
      add(r.label, `${r.file_path}:${r.start_line}`, r.type.toLowerCase());
    }
  } catch {}

  return out.slice(0, 16);
}

// Pre-computed execution traces for top EXPORTS. Calls buildPaths from
// the graph_path verb at brief-gen time, then flattens each tree to the
// deepest single chain. Bench 2026-04-20 found trace tasks barely
// benefit from brief alone (-9% tokens / -20% duration on Claude Code,
// near-parity on Codex) because brief had subsystem map but no
// pre-computed execution chains. PATHS closes that gap by letting the
// agent answer "trace X to Y" straight from brief context.


// One-line "what does this brief actually cover" hint. Agent can use this to
// decide quickly whether to trust the brief or fall back to baseline shell
// exploration. Bench 2026-04-20 found the brief becomes pure overhead (+55%
// duration in worst case) when its content is task-irrelevant; this hint lets
// the agent abandon the brief faster.
// Returns { text, shown, total } — the COUNTS matter. Field report: this rendered
// the first 5 of 14 features in overlay-file order and the caller paired it with
// "fall back to direct file reads for topics not listed here". An arbitrary
// truncation was therefore published as a CAPABILITY CLAIM plus an explicit
// instruction to abandon the tool — for exactly the subsystems the repo lives in.
// The reporter acted on it himself, concluded the overlay didn't cover the sim
// domain, and published a wrong conclusion before catching it.
//
// A truncated list must never assert scope. The honest style already exists two
// lines below in EXPORTS ("6 listed — target missing from list? grep").
function briefCoverage(subs, overlayHealth) {
  if (overlayHealth?.valid?.length) {
    const all = overlayHealth.valid;
    return {
      text: all.slice(0, 5).map(v => v.feature.label || v.feature.id).join(', '),
      shown: Math.min(5, all.length),
      total: all.length,
    };
  }
  if (subs.length) {
    return {
      text: subs.slice(0, 4).map(s => {
        const segs = s.path.split('/').filter(Boolean);
        return segs[segs.length - 1] || s.path;
      }).join(', '),
      shown: Math.min(4, subs.length),
      total: subs.length,
    };
  }
  return null;
}

function entryPoints(db, repoRoot, limit = 5) {
  const out = [];
  const seen = new Set();
  const add = (entry) => {
    if (!entry || !entry.file) return;
    const key = entry.file.replaceAll('\\', '/');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label: entry.label || key.split('/').pop(), file: key, line: entry.line ?? 1, why: entry.why });
  };

  // 1. package.json main/bin (most authoritative)
  for (const e of detectFromPackageJson(repoRoot)) add(e);

  // 2. Canonical entry filenames (server.js, main.py, etc.) in non-noisy locations
  for (const e of detectCanonicalEntries(db)) add(e);

  // 3. Graph-declared Route nodes (Laravel routes etc.)
  const routes = q(db,
    `SELECT label, file_path AS file, start_line AS line FROM nodes
     WHERE type = 'Route' ORDER BY label LIMIT 3`);
  for (const r of routes) add({ ...r, why: 'declared route' });

  // 4. Fall back to graph Entrypoint nodes, minus obvious noise.
  const graphEntries = q(db,
    `SELECT label, file_path AS file, start_line AS line FROM nodes
     WHERE type = 'Entrypoint'
       AND file_path NOT LIKE 'tests/%'
       AND file_path NOT LIKE 'test/%'
       AND file_path NOT LIKE '%/__init__.py'
     LIMIT 10`);
  for (const r of graphEntries) {
    if (!NOISE_ENTRY_PATTERNS.some(p => p.test(r.label))) {
      add({ ...r, why: 'entry file' });
    }
  }

  return out.slice(0, limit);
}

// Primary language extension from snapshot, used to dedupe READ candidates.
// Bench 2026-04-20 found that mem0's READ list mixed Python and TypeScript
// paths, which wasted subagent attention — the agent had to mentally filter
// the wrong-language files.
function primaryLangExt(snapshot) {
  if (!snapshot?.languages?.length) return null;
  const top = String(snapshot.languages[0].name || '').toLowerCase();
  const map = {
    'python': 'py', 'py': 'py',
    'javascript': 'js', 'js': 'js', 'typescript': 'ts', 'ts': 'ts',
    'java': 'java', 'kotlin': 'kt',
    'php': 'php', 'go': 'go', 'rust': 'rs', 'ruby': 'rb',
    'c++': 'cpp', 'cpp': 'cpp', 'c': 'c',
    'css': 'css', 'glsl': 'glsl',
  };
  return map[top] || null;
}


// ---------- trust/health (A1 item #10) ----------

function trust(snapshot, entries, subs, hubsArr, overlayHealth, brokenFeatureEdges, unresolvedBy) {
  const issues = [];
  let tip = '';
  if (snapshot.unresolvedEdges > 2000) {
    // Coarse cause breakdown so agents know WHICH verbs are most affected:
    // CALLS-heavy means cross-file call graphs are unreliable; IMPORTS-heavy
    // means third-party/external deps dominate. No speculative cause labels.
    // ⛔ "MOSTLY" WAS FALSE, AND THE TWO NUMBERS BESIDE IT SAID SO. This printed
    // "2150 unresolved edges (mostly CALLS 199, REFERENCES 196)" — 395 of 2150, which is 18%.
    // the field test measured it worse in the field on echoes: 473 of 4392, 11%, with 3919 edges
    // unnamed. Their words: at 11% it is not a rounding problem, it is backwards.
    //
    // ★ The quantifier was hardcoded while the numbers were computed, so it could never be
    // right except by accident — the same defect as every capped list that called itself a
    // total, in the artifact agents read FIRST to orient.
    //
    // ⇒ Say the share, and name the remainder rather than leaving it silent. "top 2 of 9" plus
    // an explicit "others" is checkable by the reader against the numbers printed next to it.
    const suffix = describeUnresolvedBreakdown(unresolvedBy?.byRelation);
    issues.push(`${snapshot.unresolvedEdges} unresolved edges${suffix}`);
    tip = 'prefer direct file reads for cross-file impact questions';
  }
  if (overlayHealth?.broken?.length) {
    const ids = overlayHealth.broken.map(b => b.feature.id).slice(0, 3).join(', ');
    issues.push(`${overlayHealth.broken.length} features with stale anchors (${ids})`);
    tip = tip || 'functionality overlay may be out of date; verify feature→code links before trusting';
  }
  if (brokenFeatureEdges?.length) {
    const preview = brokenFeatureEdges.slice(0, 3).map(e => `${e.from}→${e.to}`).join(', ');
    issues.push(`${brokenFeatureEdges.length} feature edges point at missing features (${preview})`);
    tip = tip || 'clean up depends_on/related_to references in functionality.json';
  }
  if (entries.length === 0) {
    issues.push('no entrypoints detected');
    tip = tip || 'use README or package.json to find entry';
  }
  if (subs.length < 3) {
    issues.push('flat/small subsystem map');
  }
  if (hubsArr.length === 0) {
    issues.push('no hubs — repo may be too small to rank');
  }
  // ⛔ AN UNATTESTED GRAPH GETS AN ISSUE, NOT A SILENT PASS. `trustLevel` is computed from the
  // unresolved count alone, and that count comes from a manifest whose graph may not be the one it
  // describes. Reviewer's finding was that generationState was computed in repoSnapshot and then
  // discarded by every renderer, so the source comment claiming it "travels with the number" was
  // false and a legacy or torn brief printed ordinary trust.
  //
  // It joins `issues` rather than replacing `level` deliberately: the trust LEVEL is a real
  // measurement of resolution completeness and stays what it is. What changes is that the reader is
  // told the graph behind it cannot be checked.
  if (snapshot.generationState && snapshot.generationState !== 'attested') {
    issues.unshift(`publication ${snapshot.generationState} — this graph's contents could not be `
      + 'verified against the manifest describing it, so the trust figure is unattested');
    tip = tip || 'graph_index({ force: true }) to publish a generation this brief can be checked against';
  }
  return { level: snapshot.trustLevel, issues, tip, generationState: snapshot.generationState ?? null };
}

// ---------- renderers ----------

// ---------- main ----------

export function generateBrief({ repoRoot }) {
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const snapshot = repoSnapshot(db, repoRoot);
    const entries = entryPoints(db, repoRoot);
    const subs = subsystems(db);
    const hubsArr = hubs(db);
    const tests = testAnchors(db);
    const testInv = testInventory(db);
    const risksArr = risks(db);
    const recent = recentActivity(repoRoot);

    // L2 overlay: if functionality.json exists, ingest + validate against graph.
    const overlay = loadFunctionality(repoRoot);
    const overlayHealth = overlay.features.length > 0
      ? validateAnchors(overlay.features, db)
      : { valid: [], broken: [] };

    // readFirst depends on exports + overlayHealth + language — compute now.
    const tooling = extractTooling(repoRoot);
    const exports = extractExports(repoRoot, db);
    // PATHS: pre-computed execution traces from top EXPORTS. Async because
    // it dynamically imports the path verb (avoids cycle since path.js
    // imports openDb/ensureFresh which generator.js also uses).
    // Document recency is computed ONCE for every document path and handed in, rather than looked
    // up inside the ranking — `graph-shape.js` reads the database and must not shell out per row.
    const docPaths = q(db, "SELECT file_path AS f FROM nodes WHERE type = 'Document' AND file_path != ''")
      .map((r) => r.f);
    const docRecency = documentRecency(repoRoot, docPaths);
    // ⛔ COMPUTED ONCE, BY THE ONE PRODUCER THAT OWNS MEMBERSHIP. The candidate SQL is not
    // duplicated here: `readFirst` receives the same population the renderer is told the size of,
    // so the ranking and the disclosed denominator cannot disagree. Before this, anything counting
    // the returned array counted a RENDERED SAMPLE — 2 against a real population of 89.
    const documentCandidates = linkedDocumentCandidates(db, { docRecency });
    const readFirstArr = readFirst(db, 6, {
      docRecency,
      exports,
      overlayHealth,
      primaryExt: primaryLangExt(snapshot),
    });
    const brokenFeatureEdges = overlay.features.length > 0
      ? validateFeatureEdges(overlay.features)
      : [];
    // Recent commits with feature attribution — cheap L3 feeding brief.plan.md
    // without adding a live verb. Only computed if overlay exists, since
    // feature tags would be empty otherwise.
    const recentWithFiles = overlay.features.length > 0
      ? recentActivityWithFiles(repoRoot, overlay.features, 10)
      : [];
    // L3 tasks from external tracker (written by graph-map-tasks skill).
    const tasksArtifact = loadTasksArtifact(repoRoot);
    const overlayQuality = summarizeOverlayQuality(overlay.features, tasksArtifact.tasks, db);
    let dirtySeams = { totalDirtyFiles: 0, mappedDirtyFiles: 0, orphanDirtyFiles: 0, features: [], orphanFilesSample: [] };
    try {
      dirtySeams = summarizeDirtySeams(overlay.features, getDirtyFilesSync(repoRoot));
    } catch {}

    // Plan-brief enrichment: features get tests + callers count, risks get
    // feature attribution + nearest test. Computed here so renderers can
    // emit action-bearing lines instead of bare anchors.
    const enrichedValid = overlay.features.length > 0
      ? enrichFeaturesForPlanning(db, overlayHealth.valid)
      : [];
    const enrichedRisks = enrichRisksForPlanning(db, risksArr, overlay.features);

    const unresolvedBy = summarizeUnresolvedFromManifest(repoRoot);
    const health = trust(snapshot, entries, subs, hubsArr, overlayHealth, brokenFeatureEdges, unresolvedBy);
    const coverage = briefCoverage(subs, overlayHealth);
    const { paths, hiddenCount: pathsHiddenCount } = extractPaths(db, exports, 5);
    // Pull indexedAt + commit from the manifest so brief.json carries them
    // without forcing cache churn on unchanged regens.
    let manifestIndexedAt = null;
    let manifestCommit = null;
    try {
      const mPath = join(repoRoot, '.aify-graph', 'manifest.json');
      if (existsSync(mPath)) {
        const m = JSON.parse(readFileSync(mPath, 'utf8'));
        manifestIndexedAt = m.indexedAt ?? null;
        manifestCommit = m.commit ?? null;
      }
    } catch { /* ignore */ }
    // Cheap git rev-parse so brief.agent.md can show indexed-vs-HEAD drift
    // (M4a item — lets brief-only agents detect stale snapshots without a
    // live verb call).
    let headCommit = null;
    try {
      headCommit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
    } catch { /* ignore */ }

    // Plan #15 Step A5: load intelligence overlays if present. Silent
    // fallback — briefs render fine without them. Validators in the
    // loader refuse hallucinated / orphan / conflicting overlays.
    const intelligence = loadIntelligenceOverlays({ repoRoot, functionalityJson: overlay });
    const architectureLayers = summarizeArchitectureLayers(intelligence.architecture);

    // ⛔ AN EMPTY DOC SECTION MEANT TWO DIFFERENT THINGS AND SAID NEITHER. the field test found a repo
    // with 15,628 nodes, 50,527 edges and ZERO Document nodes, whose AGENTS.md, CLAUDE.md and
    // README.md all exist on disk. The section rendered empty — indistinguishable from a repo that
    // genuinely has no documents, when the real state was that the doc layer never ingested any.
    //
    // ⇒ The count travels with the candidates so the renderer can tell "this repo has no docs" from
    // "this graph was never given any". Those want opposite actions from a reader.
    const documentCount = q(db, "SELECT COUNT(*) AS c FROM nodes WHERE type = 'Document'")[0]?.c ?? 0;
    const documentCandidateCount = documentCandidates.total;
    const documentView = buildDocumentView({
      linkedCandidates: documentCandidates,
      positionalFallback: documentCandidates.positionalFallback ?? [],
      documentCount,
    });
    const data = {
      snapshot,
      entries,
      subs,
      hubsArr,
      readFirstArr,
      // ⇒ ONE CANONICAL MODEL, and the loose scalars are GONE from the render data. Leaving them
      // beside the view kept a second authority available to any renderer that reached for it — and
      // one did, through a `??` fallback that rebuilt a lossy carrier. One authority physically,
      // not by convention.
      documentView,
      tests,
      testInv,
      risksArr,
      recent,
      health,
      overlay,
      overlayHealth,
      overlayQuality,
      dirtySeams,
      brokenFeatureEdges,
      recentWithFiles,
      tasksArtifact,
      enrichedValid,
      enrichedRisks,
      tooling,
      coverage,
      exports,
      paths,
      pathsHiddenCount,
      manifestIndexedAt,
      manifestCommit,
      headCommit,
      intelligence,
      architectureLayers,
    };

    const md = renderMarkdown(data);
    const agentMd = renderAgentMarkdown(data);
    const onboardMd = renderOnboardAgentMarkdown(data);
    const planMd = renderPlanAgentMarkdown(data);
    const json = renderJson(data, repoRoot);
    const jsonStr = JSON.stringify(json, null, 2);

    // Cache-discipline: only write when content actually changed. Keeping the
    // file mtime stable when content is unchanged preserves downstream tool
    // prefix caches that may key on file contents/hashes.
    const outDir = join(repoRoot, '.aify-graph');
    const writes = {
      'brief.md': md,
      'brief.agent.md': agentMd,
      'brief.onboard.md': onboardMd,
      'brief.plan.md': planMd,
      'brief.json': jsonStr,
    };
    let changed = 0;
    for (const [name, content] of Object.entries(writes)) {
      const path = join(outDir, name);
      const prev = existsSync(path) ? readFileSync(path, 'utf8') : null;
      if (prev !== content) {
        writeFileSync(path, content);
        changed++;
      }
    }

    return {
      md_bytes: md.length,
      agent_bytes: agentMd.length,
      onboard_bytes: onboardMd.length,
      plan_bytes: planMd.length,
      json_bytes: jsonStr.length,
      md_tokens_est: Math.ceil(md.length / 4),
      agent_tokens_est: Math.ceil(agentMd.length / 4),
      onboard_tokens_est: Math.ceil(onboardMd.length / 4),
      plan_tokens_est: Math.ceil(planMd.length / 4),
      files_changed: changed,
      // Anchor validation summary so the CLI + callers can print a loud
      // warning when anchors are broken. Replaces the "silent `broken: []`"
      // failure mode that made "all good" indistinguishable from "not checked".
      anchorValidation: {
        checkedFeatures: overlayHealth.valid.length + overlayHealth.broken.length,
        brokenFeatures: overlayHealth.broken.length,
        sample: overlayHealth.broken.slice(0, 5).map((b) => ({
          feature: b.feature.id,
          resolved: b.totalResolved,
          declared: b.totalDeclared,
          missingSymbols: b.resolved.missing_symbols.slice(0, 3),
          missingFiles: b.resolved.missing_files.slice(0, 3),
        })),
      },
    };
  } finally {
    db.close();
  }
}

// ⛔ EXTRACTED SO IT CAN BE RUN, NOT READ. This computation lived inline in the brief builder,
// which is why nothing ever executed it and why "(mostly …)" could print a hardcoded quantifier
// over computed numbers for as long as it did. The repo has done this conversion before, for
// the coverage denominator, for the same reason: a statistic whose failure mode IS a wrong
// number must be tested by running it.
//
// ⛔ THE DEFECT: "2150 unresolved edges (mostly CALLS 199, REFERENCES 196)" — 395 of 2150 is
// 18%. the field test measured 473 of 4392 on echoes: 11%, with 3919 edges unnamed. At 11%,
// "mostly" is not a rounding problem, it is backwards.
//
// ⇒ State the share, and name the remainder. Both are checkable by a reader against the
// figures printed beside them, which "mostly" never was.
export function describeUnresolvedBreakdown(byRelation) {
  if (!byRelation) return '';
  const all = Object.entries(byRelation).sort((a, b) => b[1] - a[1]);
  if (all.length === 0) return '';
  const shown = all.slice(0, 2);
  const shownSum = shown.reduce((sum, [, n]) => sum + n, 0);
  const total = all.reduce((sum, [, n]) => sum + n, 0);
  if (total <= 0) return '';
  const pct = Math.round((shownSum / total) * 100);
  const rest = total - shownSum;
  return ` (top ${shown.length} of ${all.length} relations: `
    + `${shown.map(([rel, n]) => `${rel} ${n}`).join(', ')} — ${pct}% of ${total}`
    + `${rest > 0 ? `; ${rest} across ${all.length - shown.length} other relation(s)` : ''})`;
}
