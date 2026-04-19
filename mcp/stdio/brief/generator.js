// Brief artifact generator. Emits three files at `.aify-graph/`:
//   brief.md        — human-readable orientation (~700-900 tokens budget)
//   brief.agent.md  — dense prompt substrate for agent context (~300-450 tokens)
//   brief.json      — machine-readable equivalent
//
// Runs against an already-indexed graph. Reuses the same SQL patterns as
// graph_report and graph_onboard so the brief agrees with what live queries
// would show. The point of emitting it statically is to move that value from
// live-MCP tool calls (expensive) to ambient context the agent reads once.

import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openDb } from '../storage/db.js';
import { loadFunctionality, validateAnchors, hasOverlay, featuresForFile, validateFeatureEdges } from '../overlay/loader.js';

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

function repoSnapshot(db) {
  const totalNodes = count(db, 'SELECT count(*) AS c FROM nodes');
  const totalEdges = count(db, 'SELECT count(*) AS c FROM edges');
  const totalFiles = count(db, "SELECT count(*) AS c FROM nodes WHERE type = 'File'");
  const langs = q(db,
    `SELECT language AS name, count(*) AS files FROM nodes
     WHERE type = 'File' AND language != ''
     GROUP BY language ORDER BY files DESC LIMIT 6`);
  // Trust proxy: count edges whose confidence < 1.0 (loose resolutions, facades, etc.)
  const unresolvedEdges = count(db,
    "SELECT count(*) AS c FROM edges WHERE confidence < 1.0");
  const trustLevel = unresolvedEdges > 2000 ? 'weak'
    : unresolvedEdges > 500 ? 'ok' : 'strong';
  return { files: totalFiles, symbols: totalNodes, edges: totalEdges, languages: langs, unresolvedEdges, trustLevel };
}

// Canonical "real entry" detection: combines filesystem evidence (package.json
// main/bin, shebang lines, well-known entry filenames) with graph-indexed
// Entrypoint/Route nodes. Filesystem findings rank above graph-heuristic
// entries because graph Entrypoint classification fires on any `index.*`,
// which frequently misses the actual program entry (e.g., server.js / app.py).
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
  // dir (path = `<dir>/<basename>` with no further slashes). CONTAINS edges
  // in this graph don't connect Directory→File, so we use path matching.
  // This gives the direct-file count per dir, surfacing leaf subsystems
  // (mcp/stdio/ingest, mcp/stdio/query) over parents (mcp, mcp/stdio).
  const rows = q(db,
    `SELECT n.file_path AS path,
            (SELECT COUNT(*) FROM nodes f
             WHERE f.type = 'File'
               AND f.file_path LIKE n.file_path || '/%'
               AND instr(substr(f.file_path, length(n.file_path) + 2), '/') = 0
            ) AS file_count
     FROM nodes n
     WHERE n.type = 'Directory'
       AND n.file_path != '.'
       AND n.file_path != ''
       AND n.file_path NOT LIKE 'tests/%'
       AND n.file_path NOT LIKE 'test/%'
       AND n.file_path NOT LIKE 'node_modules/%'
       AND n.file_path NOT LIKE 'vendor/%'
       AND n.file_path NOT LIKE '.%'
       AND n.file_path NOT IN ('tests', 'test', 'vendor', 'node_modules', 'docs', 'scripts')
     ORDER BY file_count DESC`);
  return rows
    .filter(r => r.file_count >= 3)
    .slice(0, limit)
    .map(r => ({ path: r.path, why: `${r.file_count} files`, score: r.file_count }));
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

function readFirst(db, limit = 6) {
  // Non-obvious "read first" targets: high-degree source files that an agent
  // wouldn't automatically go read. Skip README/AGENTS.md — agents read those
  // by default, listing them wastes brief space. Keep ARCHITECTURE docs since
  // they're less universal.
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
  for (const d of docs) out.push({ file: d.file, why: 'architecture doc', kind: 'doc' });
  for (const f of files) {
    if (isNoisyFile(f.file)) continue;
    if (/^(README|AGENTS|CONTRIBUTING)\.md$/i.test(f.label)) continue;
    if (out.some(e => e.file === f.file)) continue;
    out.push({ file: f.file, why: `${f.deg} connections`, kind: 'high-degree' });
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
    let tests = [];
    const symbols = feature.anchors.symbols || [];
    if (symbols.length > 0) {
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
    let callersTotal = 0;
    if (symbols.length > 0) {
      const row = db.get(
        `SELECT COUNT(*) AS c FROM edges e
         JOIN nodes n ON n.id = e.to_id
         WHERE n.label IN (${symbols.map((_, i) => `$s${i}`).join(',')})
           AND e.relation IN ('CALLS', 'REFERENCES', 'USES_TYPE')`,
        Object.fromEntries(symbols.map((s, i) => [`s${i}`, s]))
      );
      callersTotal = row?.c ?? 0;
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

// Load tasks.json if present (written by the graph-map-tasks skill).
// This is cross-layer L3 — task tracker data linked to features.
function loadTasks(repoRoot) {
  const path = join(repoRoot, '.aify-graph', 'tasks.json');
  if (!existsSync(path)) return { tasks: [], source: null };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return {
      tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
      source: raw.source || 'unknown',
      fetched_at: raw.fetched_at,
    };
  } catch {
    return { tasks: [], source: null };
  }
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
function trust(snapshot, entries, subs, hubsArr, overlayHealth, brokenFeatureEdges) {
  const issues = [];
  let tip = '';
  if (snapshot.unresolvedEdges > 2000) {
    issues.push(`${snapshot.unresolvedEdges} unresolved edges`);
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
  const { snapshot, entries, subs, hubsArr, readFirstArr, tests, recent, health, overlayHealth } = data;
  const lines = [];
  lines.push(`REPO: ${snapshot.files}f ${snapshot.symbols}s ${snapshot.edges}e trust=${health.level}`);
  const langStr = snapshot.languages.slice(0, 3).map(l => l.name).join(',');
  if (langStr) lines.push(`LANG: ${langStr}`);
  if (entries.length) {
    lines.push('ENTRY:');
    for (const e of entries.slice(0, 3)) lines.push(`  ${e.file}:${e.line} ${e.label}`);
  }
  if (subs.length) {
    lines.push('SUBSYS:');
    for (const s of subs.slice(0, 4)) lines.push(`  ${s.path} (${s.score} files)`);
  }
  // FEATURES only if the user-authored overlay exists. Keeps briefs clean on
  // repos that haven't adopted functionality.json yet.
  if (overlayHealth?.valid?.length) {
    lines.push('FEATURES:');
    for (const { feature } of overlayHealth.valid.slice(0, 5)) {
      const label = feature.label || feature.id;
      const anchors = feature.anchors.symbols.slice(0, 2).join(',');
      const deps = feature.depends_on.length ? ` deps=[${feature.depends_on.slice(0, 3).join(',')}]` : '';
      lines.push(`  ${feature.id}: ${label}${anchors ? ' [' + anchors + ']' : ''}${deps}`);
    }
  }
  if (hubsArr.length) {
    lines.push('HUBS:');
    for (const h of hubsArr.slice(0, 4)) {
      lines.push(`  [${h.role}] ${h.label} ${h.file}:${h.line} fan=${h.fan_in}`);
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
  if (recent.length) {
    lines.push('RECENT:');
    for (const c of recent.slice(0, 3)) lines.push(`  ${c.date} ${c.subject}`);
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
// Drops RECENT/TESTS/RISKS, keeps ENTRY/SUBSYS/HUBS/READ/FEATURES/TRUST.
function renderOnboardAgentMarkdown(data) {
  const { snapshot, entries, subs, hubsArr, readFirstArr, health, overlayHealth } = data;
  const lines = [];
  lines.push(`REPO: ${snapshot.files}f ${snapshot.symbols}s ${snapshot.edges}e trust=${health.level}`);
  const langStr = snapshot.languages.slice(0, 3).map(l => l.name).join(',');
  if (langStr) lines.push(`LANG: ${langStr}`);
  if (entries.length) {
    lines.push('ENTRY:');
    for (const e of entries.slice(0, 3)) lines.push(`  ${e.file}:${e.line} ${e.label}`);
  }
  if (subs.length) {
    lines.push('SUBSYS:');
    for (const s of subs.slice(0, 4)) lines.push(`  ${s.path} (${s.score} files)`);
  }
  if (overlayHealth?.valid?.length) {
    lines.push('FEATURES:');
    for (const { feature } of overlayHealth.valid.slice(0, 5)) {
      lines.push(`  ${feature.id}: ${feature.label || feature.id}`);
    }
  }
  if (hubsArr.length) {
    lines.push('HUBS:');
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
  const { snapshot, health, recentWithFiles, tasksArtifact, enrichedValid, enrichedRisks } = data;
  const lines = [];
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
    }
  }
  // Open tasks grouped by feature — from .aify-graph/tasks.json if present.
  if (tasksArtifact?.tasks?.length) {
    const byFeature = new Map();
    const unattributed = [];
    for (const t of tasksArtifact.tasks) {
      if (t.status && !/open|progress|active|todo|in_progress/i.test(t.status)) continue;
      if (!t.features || t.features.length === 0) { unattributed.push(t); continue; }
      for (const fid of t.features) {
        if (!byFeature.has(fid)) byFeature.set(fid, []);
        byFeature.get(fid).push(t);
      }
    }
    if (byFeature.size > 0 || unattributed.length > 0) {
      lines.push(`OPEN_TASKS (${tasksArtifact.source || 'unknown'}):`);
      for (const [fid, tasks] of byFeature) {
        const preview = tasks.slice(0, 3).map(t => t.id).join(',');
        lines.push(`  ${fid}: ${tasks.length} (${preview})`);
      }
      if (unattributed.length > 0 && byFeature.size < 6) {
        lines.push(`  (unattributed): ${unattributed.length}`);
      }
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
  const { snapshot, entries, subs, hubsArr, readFirstArr, tests, risksArr, recent, health, overlay, overlayHealth, brokenFeatureEdges } = data;
  return {
    // Deliberately omit a timestamp — it would force brief.json to rewrite
    // on every regen, defeating the content-hash-guarded cache-discipline
    // we use for brief.agent.md. Consumers who want "when was this made?"
    // can stat the file mtime.
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
    features: {
      version: overlay?.version ?? null,
      valid: (overlayHealth?.valid ?? []).map(v => ({
        id: v.feature.id,
        label: v.feature.label,
        description: v.feature.description,
        anchors: v.feature.anchors,
        depends_on: v.feature.depends_on,
        related_to: v.feature.related_to,
        resolved_anchors: v.resolved,
        anchor_health: `${v.totalResolved}/${v.totalDeclared}`,
      })),
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
    const snapshot = repoSnapshot(db);
    const entries = entryPoints(db, repoRoot);
    const subs = subsystems(db);
    const hubsArr = hubs(db);
    const readFirstArr = readFirst(db);
    const tests = testAnchors(db);
    const risksArr = risks(db);
    const recent = recentActivity(repoRoot);

    // L2 overlay: if functionality.json exists, ingest + validate against graph.
    const overlay = loadFunctionality(repoRoot);
    const overlayHealth = overlay.features.length > 0
      ? validateAnchors(overlay.features, db)
      : { valid: [], broken: [] };
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
    const tasksArtifact = loadTasks(repoRoot);

    // Plan-brief enrichment: features get tests + callers count, risks get
    // feature attribution + nearest test. Computed here so renderers can
    // emit action-bearing lines instead of bare anchors.
    const enrichedValid = overlay.features.length > 0
      ? enrichFeaturesForPlanning(db, overlayHealth.valid)
      : [];
    const enrichedRisks = enrichRisksForPlanning(db, risksArr, overlay.features);

    const health = trust(snapshot, entries, subs, hubsArr, overlayHealth, brokenFeatureEdges);
    const data = { snapshot, entries, subs, hubsArr, readFirstArr, tests, risksArr, recent, health, overlay, overlayHealth, brokenFeatureEdges, recentWithFiles, tasksArtifact, enrichedValid, enrichedRisks };

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
    };
  } finally {
    db.close();
  }
}
