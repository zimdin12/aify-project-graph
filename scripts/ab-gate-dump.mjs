// Dump the gate-carrying verbs' output on a healthy and a torn graph, to a file.
//
// Run once on CURRENT code and once on the GATE-DISABLED MUTANT, then diff the two dumps. That
// comparison is review's second precondition: it is not enough to know which routes change under
// tearing (the census answered that) — the mutant must be shown to change those same routes, or
// the treatment arm and the control arm are the same experiment run twice.
//
// ⚠ TAKES THE OUTPUT PATH AS argv[2] so the same script produces both sides. Nothing here knows or
// cares which side it is running on, which is what keeps the comparison honest.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = 'C:/Docker/aify-project-graph';
const CORPUS = join(ROOT, 'tests', 'fixtures', 'linkage-scope', 'corpus');
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node ab-gate-dump.mjs <output.json>'); process.exit(1); }

async function buildRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'apg-gate-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  for (const f of ['weights.cpp', 'pipeline.cpp', 'bundle.cpp', 'normalize.h', 'normalize.cpp',
    'stage.cpp', 'gain.cpp']) copyFileSync(join(CORPUS, f), join(repo, 'src', f));
  writeFileSync(join(repo, 'src', 'entry.js'),
    'export function normalizeInput(x) { return x - 1; }\n'
    + 'export function runNormalize() { return normalizeInput(9); }\n');
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'corpus');
  const { ensureFresh } = await import(`file:///${ROOT}/mcp/stdio/freshness/orchestrator.js`);
  await ensureFresh({ repoRoot: repo });
  return repo;
}

const VERBS = [
  ['graph_health', 'query/verbs/health.js', 'graphHealth', (r) => ({ repoRoot: r })],
  ['graph_status', 'query/verbs/status.js', 'graphStatus', (r) => ({ repoRoot: r })],
  ['graph_preflight', 'query/verbs/preflight.js', 'graphPreflight', (r) => ({ repoRoot: r, symbol: 'normalizeInput' })],
];

const normalize = (s) => String(s)
  .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<TS>')
  .replace(/\d+(\.\d+)?\s*ms/g, '<MS>')
  .replace(/[0-9a-f]{7,40}/g, '<SHA>')
  .replace(/apg-gate-[A-Za-z0-9]+/g, '<TMP>');

async function run(verb, repo) {
  const [, path, fn, args] = verb;
  try {
    const mod = await import(`file:///${ROOT}/mcp/stdio/${path}`);
    const out = await mod[fn](args(repo));
    return normalize(typeof out === 'string' ? out : JSON.stringify(out));
  } catch (e) { return `THREW: ${e?.message ?? e}`; }
}

const repo = await buildRepo();
const dump = { healthy: {}, torn: {} };

for (const v of VERBS) dump.healthy[v[0]] = await run(v, repo);

const { openDb } = await import(`file:///${ROOT}/mcp/stdio/storage/db.js`);
const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
try { db.run('UPDATE graph_generation SET generation = generation + 1'); } finally { db.close(); }

for (const v of VERBS) dump.torn[v[0]] = await run(v, repo);

writeFileSync(OUT, JSON.stringify(dump, null, 2));
rmSync(repo, { recursive: true, force: true });
console.log(`dumped ${VERBS.length} verbs x 2 states -> ${OUT}`);
