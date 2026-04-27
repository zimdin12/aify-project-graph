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
import { openDb } from '../storage/db.js';
import { computeTrustLevel } from '../query/verbs/health.js';
import { getDirtyFilesSync } from '../freshness/git.js';
import { getUnresolvedCounts } from '../freshness/unresolved-metrics.js';
import { loadFunctionality, validateAnchors, hasOverlay, featuresForFile, validateFeatureEdges } from '../overlay/loader.js';
import { loadTasksArtifact, summarizeDirtySeams, summarizeOverlayQuality, taskFeatureRefs, taskLinkStrength, taskLinkStrengthCounts } from '../overlay/quality.js';
import { buildPaths } from '../query/verbs/path.js';

const NOISE_LABELS = new Set([
  'requirements.txt', 'package-lock.json', 'yarn.lock', '.gitignore',
  '.eslintrc', '.prettierrc', 'tsconfig.json', '.editorconfig',
  'LICENSE', 'CHANGELOG', 'CHANGELOG.md',
]);
const NOISE_ENTRY_PATTERNS = [/^index\.(css|html)$/i, /^__init__\.py$/];

// Single-header amalgamation libraries and vendored code that dominate
// hub ranking without being meaningful subsystems.
const NOISE_FILE_PATTERNS = [
  /vk_mem_alloc/i, /stb_/i, /thirdparty\//, /vendor\//, /node_modules\//,
  /__snapshots__\//, /\.min\.(js|css)$/,
];

const STOPWORD_LABELS = new Set([
  'close','open','read','write','get','set','json','log','print','send',
  'parse','init','run','test','str','int','len','__init__','__str__',
  '__repr__','raise_for_status','toString','handle','make','build','map',
  'filter','reduce','push','pop','pipe','next','prev',
]);

function isNoisyFile(path) {
  return NOISE_FILE_PATTERNS.some(p => p.test(path));
}

function q(db, sql, params = {}) {
  return db.all(sql, params);
}

function count(db, sql, params = {}) {
  return db.get(sql, params).c;
}

// ---------- data gatherers ----------

// Composite feature-health tier. Synthesis-only — no new data:
//   🟢 healthy — all anchors resolve, has contract(s), task overhang under control
//   🟡 watch   — anchors resolve but thin (no contract OR task overhang 10-20)
//   🔴 risk    — broken anchors OR severe task overhang (>20)
// Per echoes PM 2026-04-21: "features are binary today (resolved/not).
// pcas-simulation (22 tasks, 0 tests) and world-buffer (1 contract, strong
// test coverage) both read ✓." This tier fixes that binary reading.
export function computeCoverage({ resolved, declared, taskCount, contractCount }) {
  const anchorRatio = declared === 0 ? 1 : resolved / declared;
  if (anchorRatio < 1) return { tier: '🔴', label: 'risk', reason: 'broken anchors' };
  if (taskCount > 20) return { tier: '🔴', label: 'risk', reason: `${taskCount} open tasks` };
  if (taskCount > 10) return { tier: '🟡', label: 'watch', reason: `${taskCount} open tasks` };
  if (contractCount === 0) return { tier: '🟡', label: 'watch', reason: 'no contract binding' };
  return { tier: '🟢', label: 'healthy', reason: 'anchors resolve · has contract · low task overhang' };
}

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
  try {
    const manifestPath = join(repoRoot, '.aify-graph', 'manifest.json');
    if (existsSync(manifestPath)) {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
      unresolvedEdges = getUnresolvedCounts(raw).trust;
    }
  } catch {
    // Fall through with 0; the trust line will then say "ok".
  }
  // Shared with graph_health — single source of truth for thresholds.
  const trustLevel = computeTrustLevel(unresolvedEdges);
  return { files: totalFiles, symbols: totalNodes, edges: totalEdges, languages: langs, unresolvedEdges, trustLevel };
}

// Canonical "real entry" detection: combines filesystem evidence (package.json
// main/bin, shebang lines, well-known entry filenames) with graph-indexed
// Entrypoint/Route nodes. Filesystem findings rank above graph-heuristic
// entries because graph Entrypoint classification fires on any `index.*`,
// which frequently misses the actual program entry (e.g., server.js / app.py).
// Extract major libraries/runtimes from package manifests so the brief can
// emit a TOOLING line. Bench 2026-04-20 found that orient-style answers were
// downgraded when the brief never named the underlying tool (e.g. tree-sitter
// for an extraction subsystem). This is cheap deterministic signal pulled
// from manifests at brief-gen time.
function extractTooling(repoRoot) {
  const tooling = [];
  const seen = new Set();
  const add = (name) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    tooling.push(name);
  };

  const pkg = readJsonSafe(join(repoRoot, 'package.json'));
  if (pkg?.dependencies) {
    for (const name of Object.keys(pkg.dependencies)) {
      if (name.startsWith('@types/')) continue;
      add(name);
    }
  }

  const reqPath = join(repoRoot, 'requirements.txt');
  if (existsSync(reqPath)) {
    try {
      const lines = readFileSync(reqPath, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
        const name = trimmed.split(/[<>=!~;\s]/)[0].trim();
        if (name) add(name);
      }
    } catch {}
  }

  const pyproj = join(repoRoot, 'pyproject.toml');
  if (existsSync(pyproj)) {
    try {
      const text = readFileSync(pyproj, 'utf8');
      // Poetry / uv table form: [tool.poetry.dependencies] qdrant-client = "^1.9"
      const tableBlock = text.match(/\[(?:tool\.poetry\.dependencies|tool\.uv\.dependencies)\][\s\S]*?(?=\n\[|$)/);
      if (tableBlock) {
        const matches = [...tableBlock[0].matchAll(/^\s*"?([a-zA-Z][a-zA-Z0-9_.-]+)"?\s*[=:]/gm)];
        for (const m of matches) {
          if (m[1].toLowerCase() !== 'python') add(m[1]);
        }
      }
      // PEP-621 array form: dependencies = [ "qdrant-client>=1.9", "openai>=1.0" ]
      const arrMatch = text.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m);
      if (arrMatch) {
        const items = [...arrMatch[1].matchAll(/"\s*([a-zA-Z][a-zA-Z0-9_.-]+)/g)];
        for (const m of items) add(m[1]);
      }
    } catch {}
  }

  const cargoPath = join(repoRoot, 'Cargo.toml');
  if (existsSync(cargoPath)) {
    try {
      const text = readFileSync(cargoPath, 'utf8');
      const depBlock = text.match(/\[dependencies\][\s\S]*?(?=\n\[|$)/);
      if (depBlock) {
        const matches = [...depBlock[0].matchAll(/^\s*([a-zA-Z][a-zA-Z0-9_-]+)\s*=/gm)];
        for (const m of matches) add(m[1]);
      }
    } catch {}
  }

  const goMod = join(repoRoot, 'go.mod');
  if (existsSync(goMod)) {
    try {
      const text = readFileSync(goMod, 'utf8');
      const requires = [...text.matchAll(/^\s*([a-z0-9.\-/]+)\s+v[\d.]+/gm)];
      for (const m of requires) {
        const path = m[1];
        const name = path.split('/').pop();
        add(name);
      }
    } catch {}
  }

  const composer = readJsonSafe(join(repoRoot, 'composer.json'));
  if (composer?.require) {
    for (const dep of Object.keys(composer.require)) {
      if (dep === 'php' || dep.startsWith('ext-')) continue;
      add(dep.split('/').pop());
    }
  }

  return tooling.slice(0, 6);
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
  const mcpCandidates = ['mcp/stdio/server.js', 'src/server.js', 'server.js'];
  for (const rel of mcpCandidates) {
    const p = join(repoRoot, rel);
    if (!existsSync(p)) continue;
    try {
      const text = readFileSync(p, 'utf8');
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

// M4b: filter out vendor-include traversal and type-name "calls" that
// pollute PATHS on C++/GLSL repos. Echoes brief showed examples like
// `main → vec4 :0` (GLSL type) and `draw → vk_mem_alloc erase` (vendor
// include). These damage trust without adding navigational value.
const VENDOR_PATH_PATTERNS = [
  /\/vendor\//, /\/third[_-]?party\//, /\/external\//, /\/deps\//,
  /\/node_modules\//, /\/vk_mem_alloc/, /\/glm\//, /\/stb_/,
  /\/imgui/, /\/SDL/, /\/Vulkan/i, /\/eigen/,
];
const TYPE_NAME_PATTERNS = [
  // GLSL primitive types
  /^(vec|mat|ivec|uvec|bvec|dvec)[2-4]$/,
  /^(int|uint|float|double|bool|void)$/,
  /^(sampler\w*|image\w*|texture\w*)$/,
  // C++ STL containers (often called as constructors)
  /^(string|vector|map|set|array|pair|tuple|optional|unique_ptr|shared_ptr|weak_ptr)$/,
];

function isPathNoise(node) {
  if (!node) return false;
  // Empty/zero line is suspicious (tree-sitter assigning fallback)
  if (node.file && /:0$/.test(`${node.file}:${node.line}`)) {
    if (TYPE_NAME_PATTERNS.some((re) => re.test(node.symbol || ''))) return true;
  }
  if (TYPE_NAME_PATTERNS.some((re) => re.test(node.symbol || ''))) return true;
  if (VENDOR_PATH_PATTERNS.some((re) => re.test(node.file || ''))) return true;
  return false;
}

function extractPaths(db, exportsArr, limit = 5) {
  if (!exportsArr || exportsArr.length === 0) return { paths: [], hiddenCount: 0 };
  const out = [];
  let hiddenCount = 0;
  // Deepest-chain flattener: pick the longest descendant branch at each level.
  function deepestChain(tree) {
    if (!tree) return [];
    const node = { name: tree.symbol, file: tree.file, line: tree.line };
    if (!tree.children || tree.children.length === 0) return [node];
    // Pick child with the deepest subtree, skipping noise
    let bestChild = null;
    let bestDepth = -1;
    for (const c of tree.children) {
      if (isPathNoise({ symbol: c.symbol, file: c.file, line: c.line })) {
        hiddenCount += 1;
        continue;
      }
      const d = subtreeDepth(c);
      if (d > bestDepth) {
        bestDepth = d;
        bestChild = c;
      }
    }
    return [node, ...deepestChain(bestChild)];
  }
  function subtreeDepth(t) {
    if (!t || !t.children || t.children.length === 0) return 1;
    return 1 + Math.max(...t.children.map(subtreeDepth));
  }

  for (const ex of exportsArr.slice(0, limit)) {
    // Resolve the EXPORT to a graph node. For MCP verbs the location is
    // `mcp/stdio/server.js:handler=graphX` — we want graphX, not graph_x.
    let symbol = ex.name;
    const handlerMatch = String(ex.location || '').match(/handler=([A-Za-z_][A-Za-z0-9_]*)/);
    if (handlerMatch) symbol = handlerMatch[1];

    const sources = db.all(
      `SELECT id, label, type, file_path, start_line, confidence
       FROM nodes WHERE label = $label
         AND type IN ('Function','Method','Class','Route','Entrypoint')
       LIMIT 1`, { label: symbol });
    if (sources.length === 0) continue;
    const root = sources[0];

    try {
      const tree = buildPaths(db, root, {
        direction: 'out',
        maxDepth: 5,
        explorationWidth: 12,
        relations: ['PASSES_THROUGH', 'INVOKES', 'CALLS'],
        visited: new Set(),
      });
      if (!tree) continue;
      const chain = deepestChain(tree);
      if (chain.length < 2) continue; // single-node path is not informative
      out.push({ entry: ex.name, chain });
    } catch {}
  }

  return { paths: out, hiddenCount };
}

// One-line "what does this brief actually cover" hint. Agent can use this to
// decide quickly whether to trust the brief or fall back to baseline shell
// exploration. Bench 2026-04-20 found the brief becomes pure overhead (+55%
// duration in worst case) when its content is task-irrelevant; this hint lets
// the agent abandon the brief faster.
function briefCoverage(subs, overlayHealth) {
  if (overlayHealth?.valid?.length) {
    return overlayHealth.valid.slice(0, 5).map(v => v.feature.label || v.feature.id).join(', ');
  }
  if (subs.length) {
    return subs.slice(0, 4).map(s => {
      const segs = s.path.split('/').filter(Boolean);
      return segs[segs.length - 1] || s.path;
    }).join(', ');
  }
  return '';
}

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function detectFromPackageJson(repoRoot) {
  const pkg = readJsonSafe(join(repoRoot, 'package.json'));
  if (!pkg) return [];
  const out = [];
  if (typeof pkg.main === 'string') out.push({ file: pkg.main, why: 'package.json main', source: 'pkg' });
  if (pkg.bin) {
    const bins = typeof pkg.bin === 'string' ? [['bin', pkg.bin]] : Object.entries(pkg.bin);
    for (const [name, file] of bins) out.push({ file, why: `bin: ${name}`, source: 'pkg' });
  }
  return out;
}

function detectCanonicalEntries(db) {
  // Canonical filenames in project-root-ish locations. Scoped tight to avoid
  // bringing in tests/fixtures/ and nested third-party copies.
  const rows = q(db,
    `SELECT label, file_path AS file FROM nodes
     WHERE type = 'File'
       AND label IN ('server.js', 'main.py', 'app.py', 'index.php',
                     'main.go', 'main.rs', 'main.cpp', 'app.js',
                     'cli.js', 'cli.ts', 'artisan')
       AND file_path NOT LIKE 'tests/%'
       AND file_path NOT LIKE 'test/%'
       AND file_path NOT LIKE 'node_modules/%'
       AND file_path NOT LIKE 'vendor/%'
     LIMIT 10`);
  // Prefer shallower paths first (root-level server.js beats nested ones).
  return rows
    .map(r => ({ file: r.file, why: `canonical entry: ${r.label}`, source: 'canonical', depth: r.file.split('/').length }))
    .sort((a, b) => a.depth - b.depth);
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

function subsystems(db, limit = 6) {
  // For each Directory node, count File nodes whose parent is exactly this
  // dir (path = `<dir>/<basename>` with no further slashes). Also count
  // outgoing edges sourced from files inside this directory (edge weight)
  // so architecturally important but small subsystems still surface.
  //
  // Bench 2026-04-20 found that ranking SUBSYS by file count alone dropped
  // echoes_of_the_fallen's engine/ecs subsystem from the brief — small
  // directory, but structurally central. Composite score fixes this.
  const rows = q(db,
    `SELECT n.file_path AS path,
            (SELECT COUNT(*) FROM nodes f
             WHERE f.type = 'File'
               AND f.file_path LIKE n.file_path || '/%'
               AND instr(substr(f.file_path, length(n.file_path) + 2), '/') = 0
            ) AS file_count,
            (SELECT COUNT(*) FROM edges e
             WHERE e.source_file LIKE n.file_path || '/%'
            ) AS edge_count
     FROM nodes n
     WHERE n.type = 'Directory'
       AND n.file_path != '.'
       AND n.file_path != ''
       AND n.file_path NOT LIKE 'tests/%'
       AND n.file_path NOT LIKE 'test/%'
       AND n.file_path NOT LIKE 'node_modules/%'
       AND n.file_path NOT LIKE 'vendor/%'
       AND n.file_path NOT LIKE '.%'
       AND n.file_path NOT LIKE '%/thirdparty/%'
       AND n.file_path NOT LIKE '%/third_party/%'
       AND n.file_path NOT LIKE 'thirdparty/%'
       AND n.file_path NOT LIKE 'third_party/%'
       AND n.file_path NOT LIKE '%/deps/%'
       AND n.file_path NOT LIKE '%/external/%'
       AND n.file_path NOT LIKE '%/thirdparty'
       AND n.file_path NOT LIKE '%/third_party'
       AND n.file_path NOT IN ('tests', 'test', 'vendor', 'node_modules', 'docs', 'scripts', 'thirdparty', 'third_party', 'deps', 'external')`);
  // Composite score: file_count (primary) + edge_count / 5 (structural density
  // signal). A subsystem with 10 files and 500 edges beats one with 30 files
  // and 20 edges. Keeps primary file-count ranking intact for most repos but
  // rescues structurally-central small directories.
  const scored = rows
    // Drop 0-file parent directories — they crowd out leaf subsystems with
    // redundant aggregated edge counts. Bench 2026-04-20: echoes "engine (0f
    // 15489e)" crowded out engine/ecs at top-4.
    // Rescue structurally-central small directories: allow file_count >= 2
    // OR (file_count >= 1 AND high edge density) to surface 1-2 file dirs
    // that punch above their size (e.g. engine/ecs with few files but many
    // consumers).
    .filter(r => r.file_count >= 2 || (r.file_count >= 1 && r.edge_count >= 50))
    .map(r => ({
      path: r.path,
      file_count: r.file_count,
      edge_count: r.edge_count,
      score: r.file_count + Math.floor((r.edge_count || 0) / 5),
    }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(r => ({
    path: r.path,
    why: `${r.file_count} files, ${r.edge_count} edges`,
    score: r.score,
    file_count: r.file_count,
    edge_count: r.edge_count,
  }));
}

// Role inference from file path + symbol name. The point is to help agents
// pick the RIGHT hub for the task shape, not just the highest-fan one.
// On lc-api, brief-only Run 1 got misled because `Application` (an entity
// hub) was the top hub — the model anchored on it for "change request
// handling safely" even though entity hubs aren't the right surface for
// that question. Role hints let the agent disambiguate.
// Matches segments like `DomainRepository.php` where the role word is
// glued to other PascalCase words. Uses substring match, not word boundary.
function classifyRole(label, file, type) {
  const f = String(file || '').toLowerCase();
  const l = String(label || '').toLowerCase();
  const fileOrLabelHas = (needles) => needles.some(n => f.includes(n) || l.includes(n));
  if (fileOrLabelHas(['middleware', 'kernel'])) return 'middleware';
  if (fileOrLabelHas(['controller'])) return 'handler';
  if (fileOrLabelHas(['/route', 'router', '/routes/'])) return 'routing';
  if (fileOrLabelHas(['/entity/', '/entities/', '/models/', 'entity.', 'model.', 'record.'])
      || /entity$|model$|record$/.test(l)) return 'entity';
  if (fileOrLabelHas(['factory', 'builder', 'provider'])) return 'factory';
  if (fileOrLabelHas(['repository', 'repo.', 'dao'])) return 'repository';
  if (fileOrLabelHas(['/request', 'formrequest']) && type === 'Class') return 'request/validation';
  if (fileOrLabelHas(['/service', '/processor', '/command', '/job', '/task'])) return 'service';
  if (/render|format|serializ/.test(l)) return 'renderer';
  if (fileOrLabelHas(['/storage/', '/database/', '/db.', 'storage.', '/store/'])) return 'storage';
  if (fileOrLabelHas(['resolve', 'orchestr', 'freshness', 'pipeline', 'ingest'])) return 'pipeline';
  if (type === 'Class') return 'class';
  if (type === 'Method') return 'method';
  if (type === 'Function') return 'fn';
  return (type || 'symbol').toLowerCase();
}

function hubs(db, limit = 5) {
  const stop = [...STOPWORD_LABELS].map(s => `'${s.replace(/'/g, "''")}'`).join(',');
  const rows = q(db,
    `SELECT n.label, n.type, n.file_path AS file, n.start_line AS line,
            count(e.from_id) AS fan_in
     FROM nodes n JOIN edges e ON e.to_id = n.id
     WHERE n.type IN ('Function', 'Method', 'Class', 'Interface')
       AND e.relation IN ('CALLS', 'REFERENCES')
       AND n.label NOT IN (${stop})
     GROUP BY n.id
     ORDER BY fan_in DESC LIMIT $limit`, { limit: limit * 3 });
  return rows
    .filter(r => !isNoisyFile(r.file))
    .slice(0, limit)
    .map(r => ({ ...r, role: classifyRole(r.label, r.file, r.type) }));
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

function readFirst(db, limit = 6, opts = {}) {
  // Non-obvious "read first" targets. Priority order:
  //   1. Architecture docs
  //   2. Files that back an EXPORTS entry (if passed in)
  //   3. Files with anchored feature overlays (if passed in)
  //   4. High-degree source files as fallback, filtered by dominant language
  const { exports: exportsArr = [], overlayHealth, primaryExt = null } = opts;

  const docs = q(db,
    `SELECT label, file_path AS file FROM nodes
     WHERE type = 'Document' AND label IN ('ARCHITECTURE.md','DESIGN.md','DEVELOPMENT.md')
     LIMIT 2`);
  const files = q(db,
    `SELECT n.label, n.file_path AS file, count(e.from_id) AS deg
     FROM nodes n JOIN edges e ON e.to_id = n.id OR e.from_id = n.id
     WHERE n.type = 'File'
     GROUP BY n.id
     ORDER BY deg DESC LIMIT $limit`, { limit: limit * 4 });

  const out = [];
  const seen = new Set();
  const push = (file, why, kind) => {
    if (!file || seen.has(file) || isNoisyFile(file)) return;
    seen.add(file);
    out.push({ file, why, kind });
  };

  for (const d of docs) push(d.file, 'architecture doc', 'doc');

  // EXPORTS-backed files: parse "<file>:<line>" or "<file> → handler" forms
  for (const ex of (exportsArr || [])) {
    const m = String(ex.location || '').match(/^([^:→]+?)(?::|\s→|$)/);
    const file = m ? m[1].trim() : null;
    if (file && !file.includes('=')) {
      push(file, `backs EXPORT: ${ex.name}`, 'export');
    }
    if (out.length >= limit) break;
  }

  // Feature-anchored files (from overlay) — skip glob entries
  if (overlayHealth?.valid?.length) {
    for (const { feature } of overlayHealth.valid.slice(0, 5)) {
      const fsrc = Array.isArray(feature.anchors?.files) ? feature.anchors.files : [];
      for (const f of fsrc.slice(0, 2)) {
        if (!f.includes('*') && !f.includes('?')) {
          push(f, `anchors feature: ${feature.id}`, 'feature-anchor');
        }
      }
      if (out.length >= limit) break;
    }
  }

  // Fallback: high-degree files, prefer dominant language
  const ranked = files
    .filter(f => {
      if (isNoisyFile(f.file)) return false;
      if (/^(README|AGENTS|CONTRIBUTING)\.md$/i.test(f.label)) return false;
      return true;
    })
    .sort((a, b) => {
      if (!primaryExt) return b.deg - a.deg;
      const aMatch = a.file.endsWith('.' + primaryExt) ? 1 : 0;
      const bMatch = b.file.endsWith('.' + primaryExt) ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      return b.deg - a.deg;
    });

  for (const f of ranked) {
    push(f.file, `${f.deg} connections`, 'high-degree');
    if (out.length >= limit) break;
  }

  return out;
}

function testAnchors(db, limit = 3) {
  // Prefer Test-typed nodes. Fall back to files under conventional test dirs.
  // Exclude doc/markdown paths that coincidentally contain "test" or "spec".
  const rows = q(db,
    `SELECT file_path AS file FROM nodes
     WHERE (type = 'Test'
            OR file_path LIKE 'tests/%'
            OR file_path LIKE 'test/%'
            OR file_path LIKE '%/__tests__/%'
            OR file_path LIKE '%.test.js'
            OR file_path LIKE '%.test.ts'
            OR file_path LIKE '%.spec.js'
            OR file_path LIKE '%_test.py'
            OR file_path LIKE 'tests/%_test.py')
       AND file_path NOT LIKE '%.md'
     GROUP BY file_path
     LIMIT $limit`, { limit });
  return rows.map(r => ({ file: r.file, why: 'test file' }));
}

// For each valid feature, precompute action-bearing data the plan brief
// needs: test files anchored under the feature's file globs, + a rough
// callers count summed across feature symbols. This is what makes
// brief.plan.md say "open these tests, N callers" instead of just listing
// anchors. Convergent audit finding (subagent + dev, both 6.5/10): plan
// brief was too orient-shaped; this is the highest-leverage fix.
function enrichFeaturesForPlanning(db, validFeatures) {
  const enriched = [];
  for (const entry of validFeatures) {
    const { feature } = entry;
    const fileGlobs = feature.anchors.files || [];

    // Tests related to this feature. Three signals, applied in order:
    //   1. Symbol-reference edges (test files that CALL/REFERENCE anchored symbols)
    //   2. Path-token match (tests whose path shares a dir token with the feature's files)
    //   3. Glob match under feature's file anchors (covers projects that keep tests co-located)
    let tests = (feature.tests || []).map((file_path) => ({ file_path }));
    const symbols = feature.anchors.symbols || [];
    if (tests.length === 0 && symbols.length > 0) {
      tests = db.all(
        `SELECT DISTINCT f.file_path FROM nodes f
         JOIN edges e ON e.from_id = f.id
         JOIN nodes s ON s.id = e.to_id
         WHERE s.label IN (${symbols.map((_, i) => `$s${i}`).join(',')})
           AND e.relation IN ('CALLS', 'REFERENCES', 'TESTS', 'USES_TYPE')
           AND (f.file_path LIKE 'tests/%' OR f.file_path LIKE 'test/%'
                OR f.file_path LIKE '%/__tests__/%' OR f.file_path LIKE '%.test.%'
                OR f.file_path LIKE '%.spec.%' OR f.file_path LIKE '%_test.py')
         LIMIT 10`,
        Object.fromEntries(symbols.map((s, i) => [`s${i}`, s]))
      );
    }
    // Path-token fallback: extract meaningful tokens from feature's file globs
    // (e.g. `mcp/stdio/freshness/*` → "freshness") and find tests whose path
    // contains any of them.
    if (tests.length === 0 && fileGlobs.length > 0) {
      const tokens = new Set();
      for (const glob of fileGlobs) {
        for (const part of glob.split(/[/*]+/)) {
          if (part.length >= 4 && !['mcp', 'src', 'app', 'lib', 'app/', 'tests'].includes(part)) {
            tokens.add(part);
          }
        }
      }
      if (tokens.size > 0) {
        const likes = [...tokens].map((_, i) => `file_path LIKE $t${i}`).join(' OR ');
        const params = Object.fromEntries([...tokens].map((t, i) => [`t${i}`, `%${t}%`]));
        tests = db.all(
          `SELECT DISTINCT file_path FROM nodes
           WHERE type = 'File'
             AND (file_path LIKE 'tests/%' OR file_path LIKE 'test/%'
                  OR file_path LIKE '%.test.%' OR file_path LIKE '%.spec.%'
                  OR file_path LIKE '%_test.py')
             AND (${likes})
           LIMIT 5`, params);
      }
    }
    // Final fallback: direct glob match (covers co-located tests)
    if (tests.length === 0 && fileGlobs.length > 0) {
      tests = db.all(
        `SELECT DISTINCT file_path FROM nodes
         WHERE type = 'File'
           AND (file_path LIKE 'tests/%' OR file_path LIKE 'test/%'
                OR file_path LIKE '%.test.%' OR file_path LIKE '%.spec.%')
           AND (${fileGlobs.map((_, i) => `file_path GLOB $g${i}`).join(' OR ')})
         LIMIT 5`,
        Object.fromEntries(fileGlobs.map((g, i) => [`g${i}`, g]))
      );
    }

    // Callers count: sum of incoming edges to every anchored symbol. This
    // gives a single "how load-bearing is this feature?" number.
    // M4b: extended with INVOKES + PASSES_THROUGH so framework-driven call
    // chains count, and with file-anchored callers (incoming edges to any
    // node in feature.anchors.files) so C++ class methods that don't share
    // a label with the anchored symbol still register. The previous shape
    // produced 0 for major C++ features even when their files had clear
    // inbound traffic — validation gate / echoes tester finding.
    let callersTotal = 0;
    const anchoredFiles = entry.feature?.anchors?.files ?? [];
    if (symbols.length > 0) {
      const row = db.get(
        `SELECT COUNT(*) AS c FROM edges e
         JOIN nodes n ON n.id = e.to_id
         WHERE n.label IN (${symbols.map((_, i) => `$s${i}`).join(',')})
           AND e.relation IN ('CALLS', 'REFERENCES', 'USES_TYPE', 'INVOKES', 'PASSES_THROUGH')`,
        Object.fromEntries(symbols.map((s, i) => [`s${i}`, s]))
      );
      callersTotal += row?.c ?? 0;
    }
    if (anchoredFiles.length > 0) {
      const row = db.get(
        `SELECT COUNT(*) AS c FROM edges e
         JOIN nodes tn ON tn.id = e.to_id
         WHERE e.relation IN ('CALLS', 'REFERENCES', 'USES_TYPE', 'INVOKES', 'PASSES_THROUGH')
           AND e.source_file NOT IN (SELECT file_path FROM nodes WHERE type='File' AND (${anchoredFiles.map((_, i) => `file_path GLOB $f${i}`).join(' OR ')}))
           AND (${anchoredFiles.map((_, i) => `tn.file_path GLOB $f${i}`).join(' OR ')})`,
        Object.fromEntries(anchoredFiles.map((g, i) => [`f${i}`, g]))
      );
      callersTotal += row?.c ?? 0;
    }

    enriched.push({
      ...entry,
      tests: tests.map(t => t.file_path),
      callers_total: callersTotal,
    });
  }
  return enriched;
}

// For each RISK file, compute: which features anchor it + how many callers
// its symbols have + the closest test file. Answers "if I touch this, what
// context matters?" without requiring a separate graph_impact call.
function enrichRisksForPlanning(db, risksArr, features) {
  return risksArr.map(r => {
    const matchedFeatures = features
      .filter(f => (f.anchors.files || []).some(g => globMatchesPath(g, r.file)))
      .map(f => f.id);
    // Nearest test: file in same dir or one of the feature's test files
    const dir = r.file.split('/').slice(0, -1).join('/') || '.';
    const nearestTest = db.get(
      `SELECT file_path FROM nodes
       WHERE type = 'File' AND file_path LIKE 'tests/%'
         AND file_path LIKE $pattern
       LIMIT 1`, { pattern: `%${dir.split('/').pop()}%` });
    return {
      ...r,
      features: matchedFeatures,
      nearest_test: nearestTest?.file_path ?? null,
    };
  });
}

function globMatchesPath(glob, path) {
  if (glob === path) return true;
  const regex = glob
    .replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\*\*/g, '§§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§§/g, '.*');
  return new RegExp(`^${regex}$`).test(path);
}

function risks(db, limit = 3) {
  // Files with high fan-in. Skip noisy files and empty/root file_paths
  // (some aggregate rows slip through without a real path).
  const rows = q(db,
    `SELECT n.file_path AS file, count(e.from_id) AS fan
     FROM nodes n JOIN edges e ON e.to_id = n.id
     WHERE e.relation IN ('CALLS', 'REFERENCES')
       AND n.file_path IS NOT NULL
       AND n.file_path != ''
       AND n.file_path != '.'
     GROUP BY n.file_path
     ORDER BY fan DESC LIMIT $limit`, { limit: limit * 3 });
  return rows.filter(r => r.file && !isNoisyFile(r.file)).slice(0, limit)
    .map(r => ({ file: r.file, why: `${r.fan} inbound refs` }));
}

// ---------- L3 lite: recent-activity from git log (A1 item #9) ----------
//
// Cache-discipline: use fixed commit count (not --since=30.days) so the same
// repo HEAD produces the same output regardless of when the brief is
// regenerated. Prompt-cache survives as long as HEAD doesn't move.
function recentActivity(repoRoot, limit = 5) {
  try {
    const out = execFileSync('git',
      ['-C', repoRoot, 'log', '--pretty=format:%h|%an|%ad|%s', '--date=short', '-n', String(limit)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim().split('\n').filter(Boolean).map(line => {
      const [sha, author, date, subject] = line.split('|');
      return { sha, author, date, subject };
    });
  } catch {
    return []; // Not a git repo — skip section
  }
}

function openTasksByFeature(tasksArtifact) {
  const byFeature = new Map();
  for (const t of tasksArtifact?.tasks || []) {
    if (t.status && !/open|progress|active|todo|in_progress/i.test(t.status)) continue;
    const featureRefs = taskFeatureRefs(t);
    if (featureRefs.length === 0) continue;
    for (const fid of featureRefs) {
      if (!byFeature.has(fid)) byFeature.set(fid, []);
      byFeature.get(fid).push(t);
    }
  }
  for (const [fid, tasks] of byFeature.entries()) {
    byFeature.set(fid, [...tasks].sort((a, b) => {
      const rank = { strong: 0, mixed: 1, broad: 2, unlinked: 3 };
      const diff = rank[taskLinkStrength(a)] - rank[taskLinkStrength(b)];
      if (diff !== 0) return diff;
      return String(a.id || '').localeCompare(String(b.id || ''));
    }));
  }
  return byFeature;
}

// M4a: count completed tasks per feature so brief.plan.md can show
// progress without listing them all. Open/in-progress are the noisy
// rows; completed counts are a single number.
function completedTaskCountsByFeature(tasksArtifact) {
  const counts = new Map();
  for (const t of tasksArtifact?.tasks || []) {
    if (!t.status || !/done|complete|closed|resolved|merged|shipped/i.test(t.status)) continue;
    for (const fid of taskFeatureRefs(t)) {
      counts.set(fid, (counts.get(fid) ?? 0) + 1);
    }
  }
  return counts;
}

// Separate accessor for tasks with no feature attribution — brief.plan.md
// surfaces them in their own section instead of silently dropping them
// (dev audit 11b90fb). Shape mirrors openTasksByFeature's filter.
function openTasksWithoutFeatures(tasksArtifact) {
  const out = [];
  for (const t of tasksArtifact?.tasks || []) {
    if (t.status && !/open|progress|active|todo|in_progress/i.test(t.status)) continue;
    if (taskFeatureRefs(t).length === 0) out.push(t);
  }
  return out;
}

function formatTaskLinkSummary(counts = {}, { includeZeros = false } = {}) {
  const parts = [];
  if (includeZeros || counts.strong > 0) parts.push(`${counts.strong ?? 0} strong`);
  if (includeZeros || counts.mixed > 0) parts.push(`${counts.mixed ?? 0} mixed`);
  if (includeZeros || counts.broad > 0) parts.push(`${counts.broad ?? 0} broad`);
  return parts.join(', ');
}

// Recent commits with touched-files + feature attribution. Used by
// brief.plan.md to show "what's been changing where." Fixed commit count
// keeps prompt-cache stable.
function recentActivityWithFiles(repoRoot, features, limit = 10) {
  try {
    const raw = execFileSync('git',
      ['-C', repoRoot, 'log', '--name-only', '--pretty=format:===%h|%an|%ad|%s', '--date=short', '-n', String(limit)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const commits = [];
    let current = null;
    for (const line of raw.split('\n')) {
      if (line.startsWith('===')) {
        if (current) commits.push(current);
        const [sha, author, date, subject] = line.slice(3).split('|');
        current = { sha, author, date, subject, files: [], features: new Set() };
      } else if (line.trim() && current) {
        current.files.push(line.trim());
        const featureIds = featuresForFile(features, line.trim());
        for (const id of featureIds) current.features.add(id);
      }
    }
    if (current) commits.push(current);
    return commits.map(c => ({
      sha: c.sha, author: c.author, date: c.date, subject: c.subject,
      files: c.files, features: [...c.features],
    }));
  } catch {
    return [];
  }
}

// ---------- trust/health (A1 item #10) ----------

// Trust/health signal. Must be a ROUTING line, not comfort text — the agent
// should change strategy when trust is weak (e.g., prefer direct file reads
// over graph queries). Issues are phrased actionably.
// Read manifest.dirtyEdges and group by relation + extractor. Coarse, honest
// breakdown — no speculative cause labels. Returns null if the manifest isn't
// readable (e.g. before first index).
function summarizeUnresolvedFromManifest(repoRoot) {
  try {
    const path = join(repoRoot, '.aify-graph', 'manifest.json');
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const refs = raw.dirtyEdges ?? [];
    if (refs.length === 0) return { total: 0, byRelation: {}, byLanguage: {} };
    const byRelation = {};
    const byLanguage = {};
    for (const ref of refs) {
      const rel = ref.relation || 'UNKNOWN';
      const lang = ref.extractor || 'unknown';
      byRelation[rel] = (byRelation[rel] ?? 0) + 1;
      byLanguage[lang] = (byLanguage[lang] ?? 0) + 1;
    }
    return { total: refs.length, byRelation, byLanguage };
  } catch {
    return null;
  }
}

function trust(snapshot, entries, subs, hubsArr, overlayHealth, brokenFeatureEdges, unresolvedBy) {
  const issues = [];
  let tip = '';
  if (snapshot.unresolvedEdges > 2000) {
    // Coarse cause breakdown so agents know WHICH verbs are most affected:
    // CALLS-heavy means cross-file call graphs are unreliable; IMPORTS-heavy
    // means third-party/external deps dominate. No speculative cause labels.
    let suffix = '';
    if (unresolvedBy?.byRelation) {
      const top = Object.entries(unresolvedBy.byRelation)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([rel, n]) => `${rel} ${n}`)
        .join(', ');
      if (top) suffix = ` (mostly ${top})`;
    }
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
  return { level: snapshot.trustLevel, issues, tip };
}

// ---------- renderers ----------

function renderMarkdown(data) {
  const { snapshot, entries, subs, hubsArr, readFirstArr, tests, risksArr, recent, health, overlayHealth } = data;
  const lines = [];
  lines.push('# Project Brief');
  lines.push('');
  lines.push('## Snapshot');
  const langStr = snapshot.languages.map(l => `${l.name} (${l.files})`).join(', ');
  lines.push(`- ${snapshot.files} files, ${snapshot.symbols} symbols, ${snapshot.edges} edges`);
  if (langStr) lines.push(`- Languages: ${langStr}`);
  lines.push(`- Trust: **${health.level}**${health.issues.length ? ' — ' + health.issues[0] : ''}`);
  lines.push('');

  if (entries.length) {
    lines.push('## Entry points');
    for (const e of entries) lines.push(`- \`${e.file}:${e.line}\` — ${e.label} (${e.why})`);
    lines.push('');
  }

  if (subs.length) {
    lines.push('## Subsystems');
    for (const s of subs) lines.push(`- \`${s.path}\` — ${s.score} files`);
    lines.push('');
  }

  if (overlayHealth?.valid?.length) {
    lines.push('## Features');
    for (const { feature } of overlayHealth.valid) {
      const anchors = [...feature.anchors.symbols, ...feature.anchors.files].slice(0, 3).join(', ');
      lines.push(`- **${feature.label || feature.id}** (\`${feature.id}\`) — ${feature.description}${anchors ? ` · anchors: ${anchors}` : ''}`);
    }
    lines.push('');
  }

  if (hubsArr.length) {
    lines.push('## Key symbols');
    for (const h of hubsArr) {
      lines.push(`- \`${h.label}\` (${h.role}) \`${h.file}:${h.line}\` — ${h.fan_in} incoming`);
    }
    lines.push('');
  }

  if (readFirstArr.length) {
    lines.push('## Read first');
    for (const r of readFirstArr) lines.push(`- \`${r.file}\` — ${r.why}`);
    lines.push('');
  }

  if (tests.length || risksArr.length) {
    lines.push('## Tests & risk');
    for (const t of tests) lines.push(`- test: \`${t.file}\``);
    for (const r of risksArr) lines.push(`- risk: \`${r.file}\` (${r.why})`);
    lines.push('');
  }

  if (recent.length) {
    lines.push('## Recent activity');
    for (const c of recent) lines.push(`- ${c.date} \`${c.sha}\` ${c.author}: ${c.subject}`);
    lines.push('');
  }

  if (health.issues.length > 1) {
    lines.push('## Health notes');
    for (const issue of health.issues) lines.push(`- ${issue}`);
    lines.push('');
  }

  return lines.join('\n');
}

// Dense prompt substrate. Target ~300-450 tokens. No prose, key/value shape.
function renderAgentMarkdown(data) {
  const {
    snapshot, entries, subs, hubsArr, readFirstArr, tests, risksArr, recent, health,
    overlayHealth, tooling, coverage, exports: exportsArr, paths, pathsHiddenCount = 0,
    overlayQuality, dirtySeams, manifestCommit, headCommit,
  } = data;
  const lines = [];
  lines.push(`REPO: ${snapshot.files}f ${snapshot.symbols}s ${snapshot.edges}e trust=${health.level}`);
  // SNAPSHOT line: lets brief-only agents see indexed-vs-HEAD drift without
  // a live verb call. STALE marker when commits diverge.
  if (manifestCommit) {
    const idx = manifestCommit.slice(0, 7);
    const head = headCommit ? headCommit.slice(0, 7) : '?';
    const stale = headCommit && manifestCommit !== headCommit ? ' STALE' : '';
    lines.push(`SNAPSHOT: indexed=${idx} head=${head}${stale}`);
  }
  const langStr = snapshot.languages.slice(0, 3).map(l => l.name).join(',');
  if (langStr) lines.push(`LANG: ${langStr}`);
  if (tooling && tooling.length) lines.push(`TOOLING: ${tooling.join(', ')}`);
  if (coverage) lines.push(`COVERS: ${coverage} — fall back to direct file reads for topics not listed here`);
  if (entries.length) {
    lines.push('ENTRY:');
    for (const e of entries.slice(0, 3)) lines.push(`  ${e.file}:${e.line} ${e.label}`);
  }
  if (exportsArr && exportsArr.length) {
    // NOT_INDEXED hint: header includes total count so agent knows whether
    // the EXPORTS list is COMPLETE (e.g. 19/19 for MCP servers) or a
    // sampled top-N (fallback mode). If the agent's target isn't in this
    // list, they should grep rather than assume it doesn't exist.
    // Bench 2026-04-20 feedback: lc-trace agent asked for explicit
    // "what's NOT in the index" signal to fail fast on wrong premises.
    lines.push(`EXPORTS (${exportsArr.length} listed — target missing from list? grep):`);
    for (const ex of exportsArr) {
      lines.push(`  ${ex.name} ${ex.location}`);
    }
  }
  if (subs.length) {
    lines.push('SUBSYS:');
    for (const s of subs.slice(0, 4)) {
      const detail = s.edge_count !== undefined ? `${s.file_count}f ${s.edge_count}e` : `${s.score} files`;
      lines.push(`  ${s.path} (${detail})`);
    }
  }
  // FEATURES only if the user-authored overlay exists. Keeps briefs clean on
  // repos that haven't adopted functionality.json yet.
  if (overlayHealth?.valid?.length) {
    const total = overlayHealth.valid.length;
    const shown = Math.min(total, 5);
    const indicator = total > shown ? ` (showing ${shown}/${total} — see brief.plan.md or brief.json)` : '';
    lines.push(`FEATURES${indicator}:`);
    for (const { feature } of overlayHealth.valid.slice(0, 5)) {
      const label = feature.label || feature.id;
      const anchors = feature.anchors.symbols.slice(0, 2).join(',');
      const deps = feature.depends_on.length ? ` deps=[${feature.depends_on.slice(0, 3).join(',')}]` : '';
      lines.push(`  ${feature.id}: ${label}${anchors ? ' [' + anchors + ']' : ''}${deps}`);
    }
  }
  if (overlayQuality?.featureCount) {
    const parts = [
      `tests=${overlayQuality.featuresWithTests}/${overlayQuality.featureCount}`,
      `docs=${overlayQuality.featuresWithDocs}/${overlayQuality.featureCount}`,
      `deps=${overlayQuality.featuresWithDependsOn}/${overlayQuality.featureCount}`,
      `related=${overlayQuality.featuresWithRelatedTo}/${overlayQuality.featureCount}`,
    ];
    if (overlayQuality.tasksTotal > 0) parts.push(`tasks=${overlayQuality.linkedTasks}/${overlayQuality.tasksTotal}`);
    const taskStrengthSummary = formatTaskLinkSummary({
      strong: overlayQuality.strongTaskLinks,
      mixed: overlayQuality.mixedTaskLinks,
      broad: overlayQuality.broadTaskLinks,
    }, { includeZeros: overlayQuality.tasksTotal > 0 });
    if (taskStrengthSummary) parts.push(`task-links=${taskStrengthSummary}`);
    lines.push(`OVERLAY: ${parts.join(' ')}`);
  }
  if (hubsArr.length) {
    lines.push('INTERNAL_HUBS:');
    for (const h of hubsArr.slice(0, 4)) {
      lines.push(`  [${h.role}] ${h.label} ${h.file}:${h.line} fan=${h.fan_in}`);
    }
  }
  if (paths && paths.length) {
    // PATHS: pre-computed execution traces for top EXPORTS. Each line is
    // entry → file:line → file:line ... so trace tasks can answer from
    // brief without grep-chasing across files.
    lines.push('PATHS:');
    for (const p of paths.slice(0, 5)) {
      const chainStr = p.chain.map(n => `${n.name} ${n.file}:${n.line}`).join(' → ');
      lines.push(`  ${p.entry}: ${chainStr}`);
    }
    // Surface the noise filter count so a missing legitimate symbol is at
    // least visible. Vendor / type-name patterns can hide real call sites
    // on languages where the filter heuristic over-matches (e.g. a domain
    // class actually named `Vec4`). Without this line the omission was
    // silent — agents had no way to know the trace was filtered.
    if (pathsHiddenCount > 0) {
      lines.push(`  (PATHS HIDDEN: ${pathsHiddenCount} vendor/type-name nodes filtered — set GRAPH_PATHS_NOISE_DEBUG=1 to inspect)`);
    }
  }
  if (readFirstArr.length) {
    lines.push('READ:');
    for (const r of readFirstArr.slice(0, 4)) lines.push(`  ${r.file}`);
  }
  if (tests.length) {
    lines.push('TESTS:');
    for (const t of tests.slice(0, 3)) lines.push(`  ${t.file}`);
  }
  // RISKS: top high-fan-in / orphan files by inbound-ref count. Already in
  // brief.json.risks but previously only surfaced in brief.md and brief.plan.md.
  // Echoes A/B test (2026-04-26) showed agents missed risk-shaped concerns
  // when working only from brief.agent.md — this closes the gap with one cap-3
  // pre-baked section.
  if (risksArr && risksArr.length) {
    lines.push('RISKS:');
    for (const r of risksArr.slice(0, 3)) lines.push(`  ${r.file} (${r.why})`);
  }
  if (recent.length) {
    lines.push('RECENT:');
    for (const c of recent.slice(0, 3)) lines.push(`  ${c.date} ${c.subject}`);
  }
  if (dirtySeams?.totalDirtyFiles > 0) {
    const preview = dirtySeams.features.slice(0, 3).map((f) => `${f.id}(${f.file_count})`).join(', ');
    const orphan = dirtySeams.orphanDirtyFiles > 0 ? ` orphan=${dirtySeams.orphanDirtyFiles}` : '';
    // M4a: split source/docs vs scratch/build to reduce noise on repos with
    // active scratch dirs. dirtySeams.scratchDirtyFiles is computed in
    // overlay/quality.js when available; fall back to flat count otherwise.
    const scratch = dirtySeams.scratchDirtyFiles > 0 ? ` scratch=${dirtySeams.scratchDirtyFiles}` : '';
    lines.push(`DIRTY: ${dirtySeams.totalDirtyFiles} files${preview ? ' ' + preview : ''}${orphan}${scratch}`);
  }
  if (health.issues.length) {
    const tip = health.tip ? ` → ${health.tip}` : '';
    lines.push(`TRUST ${health.level}: ${health.issues.join('; ')}${tip}`);
  } else {
    lines.push(`TRUST ${health.level}`);
  }
  return lines.join('\n');
}

// --- typed-brief variants (A2.2) ---
// brief.onboard.md: trimmed for "you're new here, what's the shape?"
// Drops RECENT/TESTS/RISKS, keeps ENTRY/SUBSYS/EXPORTS/INTERNAL_HUBS/READ/FEATURES/TRUST.
function renderOnboardAgentMarkdown(data) {
  const { snapshot, entries, subs, hubsArr, readFirstArr, health, overlayHealth, tooling, coverage, exports: exportsArr } = data;
  const lines = [];
  lines.push(`REPO: ${snapshot.files}f ${snapshot.symbols}s ${snapshot.edges}e trust=${health.level}`);
  const langStr = snapshot.languages.slice(0, 3).map(l => l.name).join(',');
  if (langStr) lines.push(`LANG: ${langStr}`);
  if (tooling && tooling.length) lines.push(`TOOLING: ${tooling.join(', ')}`);
  if (coverage) lines.push(`COVERS: ${coverage}`);
  if (entries.length) {
    lines.push('ENTRY:');
    for (const e of entries.slice(0, 3)) lines.push(`  ${e.file}:${e.line} ${e.label}`);
  }
  if (exportsArr && exportsArr.length) {
    lines.push('EXPORTS:');
    for (const ex of exportsArr.slice(0, 5)) {
      lines.push(`  ${ex.name} ${ex.location}`);
    }
  }
  if (subs.length) {
    lines.push('SUBSYS:');
    for (const s of subs.slice(0, 4)) {
      const detail = s.edge_count !== undefined ? `${s.file_count}f ${s.edge_count}e` : `${s.score} files`;
      lines.push(`  ${s.path} (${detail})`);
    }
  }
  if (overlayHealth?.valid?.length) {
    lines.push('FEATURES:');
    for (const { feature } of overlayHealth.valid.slice(0, 5)) {
      lines.push(`  ${feature.id}: ${feature.label || feature.id}`);
    }
  }
  if (hubsArr.length) {
    lines.push('INTERNAL_HUBS:');
    for (const h of hubsArr.slice(0, 4)) {
      lines.push(`  [${h.role}] ${h.label} ${h.file}:${h.line}`);
    }
  }
  if (readFirstArr.length) {
    lines.push('READ:');
    for (const r of readFirstArr.slice(0, 4)) lines.push(`  ${r.file}`);
  }
  if (health.issues.length) {
    const tip = health.tip ? ` → ${health.tip}` : '';
    lines.push(`TRUST ${health.level}: ${health.issues.join('; ')}${tip}`);
  } else {
    lines.push(`TRUST ${health.level}`);
  }
  return lines.join('\n');
}

// brief.plan.md: for "I'm about to change something — what's the context?"
// Leads with FEATURES + anchors, then RECENT activity with feature
// attribution (similar-change context), then RISKS. Drops ENTRY/HUBS which
// are orient-specific noise for a change-planning session.
function renderPlanAgentMarkdown(data) {
  const {
    snapshot, health, recentWithFiles, tasksArtifact, enrichedValid, enrichedRisks,
    overlayQuality, dirtySeams,
  } = data;
  const lines = [];
  const tasksByFeature = openTasksByFeature(tasksArtifact);
  const completedByFeature = completedTaskCountsByFeature(tasksArtifact);
  lines.push(`REPO: ${snapshot.files}f ${snapshot.symbols}s ${snapshot.edges}e trust=${health.level}`);
  // FEATURES now carries action-bearing data: primary file + test anchor +
  // caller count. Agent can see "for this feature, open X, tests are at Y,
  // touching Z symbols will ripple to N callers" without another tool call.
  if (enrichedValid?.length) {
    lines.push('FEATURES:');
    for (const { feature, resolved, tests, callers_total } of enrichedValid.slice(0, 6)) {
      const primaryFile = resolved.files[0] || '(no file anchor)';
      const primarySym = resolved.symbols[0] || '';
      const testStr = tests.length > 0 ? tests[0] : '(no test anchor)';
      const deps = feature.depends_on.length ? ` deps=[${feature.depends_on.slice(0, 3).join(',')}]` : '';
      lines.push(`  ${feature.id}: ${feature.label || feature.id}${deps}`);
      lines.push(`    open:  ${primaryFile}${primarySym ? ' (' + primarySym + ')' : ''}`);
      lines.push(`    tests: ${testStr}`);
      lines.push(`    load:  ${callers_total} callers across anchored symbols`);
      if ((feature.anchors.docs || []).length > 0) {
        lines.push(`    docs:  ${feature.anchors.docs.slice(0, 2).join(', ')}`);
      }
      if ((feature.related_to || []).length > 0) {
        lines.push(`    related: [${feature.related_to.slice(0, 3).join(',')}]`);
      }
      const featureTasks = tasksByFeature.get(feature.id) || [];
      const doneCount = completedByFeature.get(feature.id) ?? 0;
      if (featureTasks.length || doneCount > 0) {
        const taskLinkSummary = formatTaskLinkSummary(taskLinkStrengthCounts(featureTasks));
        const completed = doneCount > 0 ? `, ${doneCount} done` : '';
        lines.push(`    tasks: ${featureTasks.length} open${completed}${taskLinkSummary ? ` (${taskLinkSummary})` : ''}`);
        for (const t of featureTasks.slice(0, 2)) {
          lines.push(`      - ${t.id} ${t.title} [${taskLinkStrength(t)}]`);
        }
      }
    }
  }
  if (overlayQuality?.featureCount) {
    lines.push('OVERLAY GAPS:');
    lines.push(
      `  tests ${overlayQuality.featuresWithTests}/${overlayQuality.featureCount} · docs ${overlayQuality.featuresWithDocs}/${overlayQuality.featureCount} · deps ${overlayQuality.featuresWithDependsOn}/${overlayQuality.featureCount} · related ${overlayQuality.featuresWithRelatedTo}/${overlayQuality.featureCount}${overlayQuality.tasksTotal > 0 ? ` · linked tasks ${overlayQuality.linkedTasks}/${overlayQuality.tasksTotal}` : ''}${overlayQuality.tasksTotal > 0 ? ` · task links ${formatTaskLinkSummary({ strong: overlayQuality.strongTaskLinks, mixed: overlayQuality.mixedTaskLinks, broad: overlayQuality.broadTaskLinks }, { includeZeros: true })}` : ''}`,
    );
    if (overlayQuality.featuresWithTests < overlayQuality.featureCount) {
      lines.push('  next: add explicit tests[] where one shared test file covers multiple features');
    }
    if (overlayQuality.unlinkedTasks > 0) {
      lines.push(`  next: attach ${overlayQuality.unlinkedTasks} open task(s) to a feature`);
    }
    if (overlayQuality.broadTaskLinks > 0) {
      lines.push(`  next: tighten ${overlayQuality.broadTaskLinks} broad task link(s) with path/tag/commit evidence where possible`);
    }
  }
  if (dirtySeams?.totalDirtyFiles > 0) {
    lines.push('DIRTY SEAMS:');
    for (const feature of dirtySeams.features.slice(0, 4)) {
      lines.push(`  ${feature.id}: ${feature.file_count} dirty file(s) · ${feature.files.slice(0, 2).join(', ')}`);
    }
    if (dirtySeams.orphanDirtyFiles > 0) {
      const sample = dirtySeams.orphanFilesSample.length ? ` · ${dirtySeams.orphanFilesSample.join(', ')}` : '';
      lines.push(`  orphan dirty files: ${dirtySeams.orphanDirtyFiles}${sample}`);
    }
  }
  const unattributed = openTasksWithoutFeatures(tasksArtifact);
  if (unattributed.length) {
    // Tasks that reference no feature still need visibility — previously
    // dropped from brief.plan.md silently. Cap at 5 so deeply-unmapped
    // backlogs don't flood the prompt.
    lines.push('UNATTRIBUTED TASKS:');
    for (const t of unattributed.slice(0, 5)) {
      lines.push(`  ${t.id} ${t.title}`);
    }
    if (unattributed.length > 5) {
      lines.push(`  +${unattributed.length - 5} more (attach to a feature in functionality.json)`);
    }
  }
  if (recentWithFiles?.length) {
    lines.push('RECENT (feature-tagged):');
    for (const c of recentWithFiles.slice(0, 6)) {
      const featureTag = c.features.length ? ' {' + c.features.slice(0, 3).join(',') + '}' : '';
      lines.push(`  ${c.date} ${c.sha}${featureTag} ${c.subject}`);
    }
  }
  if (enrichedRisks?.length) {
    lines.push('RISK:');
    for (const r of enrichedRisks.slice(0, 3)) {
      // Uniform tagging — feature membership OR explicit orphan marker, plus
      // nearest test OR "no nearby test." High-fan-in files with no feature
      // are the orphan-detection signal surfaced inline; tests-or-nothing is
      // better than a silent missing suffix.
      const featureTag = r.features.length
        ? ` in [${r.features.slice(0, 2).join(',')}]`
        : ' (orphan — no feature)';
      const testTag = r.nearest_test ? ` · test: ${r.nearest_test}` : ' · no nearby test';
      lines.push(`  ${r.file} (${r.why})${featureTag}${testTag}`);
    }
  }
  if (health.issues.length) {
    const tip = health.tip ? ` → ${health.tip}` : '';
    lines.push(`TRUST ${health.level}: ${health.issues.join('; ')}${tip}`);
  } else {
    lines.push(`TRUST ${health.level}`);
  }
  return lines.join('\n');
}

function renderJson(data, repoRoot) {
  const {
    snapshot, entries, subs, hubsArr, readFirstArr, tests, risksArr, recent,
    health, overlay, overlayHealth, brokenFeatureEdges, tasksArtifact,
    overlayQuality, dirtySeams,
  } = data;
  // Pre-compute tasks-by-feature so programmatic consumers of brief.json
  // (e.g. /graph-walk-bugs, future graph-lint) don't need to re-parse
  // tasks.json and re-apply the open/attribution filter. Echoes PM
  // feedback 2026-04-21: "per-feature task counts are only in brief.plan.md
  // (rendered) and have to be recomputed from tasks.json by any consumer."
  const tasksByFeature = openTasksByFeature(tasksArtifact);
  return {
    // We intentionally use manifest.indexedAt (already emitted) rather than a
    // fresh Date.now() for graph_indexed_at: adding wall-clock on every
    // render would defeat the content-hash-guarded cache that keeps brief
    // files byte-identical across no-op regens. Echoes PM Tier B #8 wanted
    // "brief is fresh but graph is N commits behind" detection — same
    // manifest.indexedAt gives them that signal without the cache churn.
    graph_indexed_at: data.manifestIndexedAt ?? null,
    graph_commit: data.manifestCommit ?? null,
    repo: {
      root: repoRoot,
      files: snapshot.files,
      symbols: snapshot.symbols,
      edges: snapshot.edges,
      languages: snapshot.languages,
      trust: { level: health.level, unresolved_edges: snapshot.unresolvedEdges, issues: health.issues },
    },
    entrypoints: entries,
    subsystems: subs,
    hubs: hubsArr.map(h => ({ label: h.label, type: h.type, role: h.role, file: h.file, line: h.line, fan_in: h.fan_in })),
    read_first: readFirstArr,
    tests,
    risks: risksArr,
    recent_activity: recent,
    overlay_quality: overlayQuality,
    dirty_seams: dirtySeams,
    features: {
      version: overlay?.version ?? null,
      valid: (overlayHealth?.valid ?? []).map(v => {
        const featureTasks = tasksByFeature.get(v.feature.id) ?? [];
        const contractCount = (v.feature.contracts ?? []).length;
      return {
        id: v.feature.id,
        label: v.feature.label,
        description: v.feature.description,
        anchors: v.feature.anchors,
        tests: v.feature.tests,
        depends_on: v.feature.depends_on,
        related_to: v.feature.related_to,
          resolved_anchors: v.resolved,
          anchor_health: `${v.totalResolved}/${v.totalDeclared}`,
          // Pre-materialized task binding so programmatic consumers (e.g.
          // /graph-walk-bugs) don't re-parse tasks.json. Capped at 10 per
          // feature to keep brief.json size bounded on task-heavy repos;
          // task_count reports the true total.
          task_count: featureTasks.length,
          tasks: featureTasks.slice(0, 10).map(t => ({
            id: t.id,
            title: t.title ?? '',
            status: t.status ?? null,
            priority: t.priority ?? null,
            url: t.url ?? null,
            link_strength: taskLinkStrength(t),
            evidence: t.evidence ?? null,
          })),
          // Coverage gradient: composite health signal so a reader can tell
          // skeletal features from load-bearing ones at a glance. Three tiers:
          //   🟢 healthy: anchors resolve, has contract, low task overhang
          //   🟡 watch:   anchors resolve but thin (no contract OR >10 tasks)
          //   🔴 risk:    broken anchors OR severe task overhang (>20)
          // Pure synthesis from the fields above — no new data.
          coverage: computeCoverage({
            resolved: v.totalResolved,
            declared: v.totalDeclared,
            taskCount: featureTasks.length,
            contractCount,
          }),
        };
      }),
      broken: (overlayHealth?.broken ?? []).map(v => ({
        id: v.feature.id,
        label: v.feature.label,
        depends_on: v.feature.depends_on,
        missing_anchors: v.resolved,
        anchor_health: `${v.totalResolved}/${v.totalDeclared}`,
      })),
      broken_edges: (brokenFeatureEdges ?? []),
    },
  };
}

// ---------- main ----------

export function generateBrief({ repoRoot }) {
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  try {
    const snapshot = repoSnapshot(db, repoRoot);
    const entries = entryPoints(db, repoRoot);
    const subs = subsystems(db);
    const hubsArr = hubs(db);
    const tests = testAnchors(db);
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
    const readFirstArr = readFirst(db, 6, {
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
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { /* ignore */ }
    const data = {
      snapshot,
      entries,
      subs,
      hubsArr,
      readFirstArr,
      tests,
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
