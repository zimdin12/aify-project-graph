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
  return rows.filter(r => !isNoisyFile(r.file)).slice(0, limit);
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

function risks(db, limit = 3) {
  // Files with high fan-in from refresh/state/freshness/orchestrator-ish logic,
  // and high-degree nodes in file-root positions. Cheap heuristic.
  const rows = q(db,
    `SELECT n.file_path AS file, count(e.from_id) AS fan
     FROM nodes n JOIN edges e ON e.to_id = n.id
     WHERE e.relation IN ('CALLS', 'REFERENCES')
     GROUP BY n.file_path
     ORDER BY fan DESC LIMIT $limit`, { limit: limit * 3 });
  return rows.filter(r => !isNoisyFile(r.file)).slice(0, limit)
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

// ---------- trust/health (A1 item #10) ----------

// Trust/health signal. Must be a ROUTING line, not comfort text — the agent
// should change strategy when trust is weak (e.g., prefer direct file reads
// over graph queries). Issues are phrased actionably.
function trust(snapshot, entries, subs, hubsArr) {
  const issues = [];
  let tip = '';
  if (snapshot.unresolvedEdges > 2000) {
    issues.push(`${snapshot.unresolvedEdges} unresolved edges`);
    tip = 'prefer direct file reads for cross-file impact questions';
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
  const { snapshot, entries, subs, hubsArr, readFirstArr, tests, risksArr, recent, health } = data;
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

  if (hubsArr.length) {
    lines.push('## Key symbols');
    for (const h of hubsArr) lines.push(`- \`${h.label}\` (${h.type.toLowerCase()}) \`${h.file}:${h.line}\` — ${h.fan_in} incoming`);
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
  const { snapshot, entries, subs, hubsArr, readFirstArr, tests, recent, health } = data;
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
  if (hubsArr.length) {
    lines.push('HUBS:');
    for (const h of hubsArr.slice(0, 4)) lines.push(`  ${h.label} ${h.file}:${h.line} fan=${h.fan_in}`);
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

function renderJson(data, repoRoot) {
  const { snapshot, entries, subs, hubsArr, readFirstArr, tests, risksArr, recent, health } = data;
  return {
    generated_at: new Date().toISOString(),
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
    hubs: hubsArr.map(h => ({ label: h.label, type: h.type, file: h.file, line: h.line, fan_in: h.fan_in })),
    read_first: readFirstArr,
    tests,
    risks: risksArr,
    recent_activity: recent,
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
    const health = trust(snapshot, entries, subs, hubsArr);
    const data = { snapshot, entries, subs, hubsArr, readFirstArr, tests, risksArr, recent, health };

    const md = renderMarkdown(data);
    const agentMd = renderAgentMarkdown(data);
    const json = renderJson(data, repoRoot);
    const jsonStr = JSON.stringify(json, null, 2);

    // Cache-discipline: only write when content actually changed. Keeping the
    // file mtime stable when content is unchanged preserves downstream tool
    // prefix caches that may key on file contents/hashes.
    const outDir = join(repoRoot, '.aify-graph');
    const writes = {
      'brief.md': md,
      'brief.agent.md': agentMd,
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
      json_bytes: jsonStr.length,
      md_tokens_est: Math.ceil(md.length / 4),
      agent_tokens_est: Math.ceil(agentMd.length / 4),
      files_changed: changed,
    };
  } finally {
    db.close();
  }
}
