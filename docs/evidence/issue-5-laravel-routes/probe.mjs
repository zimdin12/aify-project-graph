// #5 probe: how many of a real Laravel app's routes does apg's Laravel plugin find, and do they point at real code?
// Runs the REAL plugin (laravelRoutesPlugin.enrich) from the APG checkout given against the target repo, then checks it
// against the repo itself, independently of the plugin:
//   written   route registrations in routes/*.php, counted by a line regex (Route::get|post|put|patch|delete|options|any|match);
//   found     Route nodes the plugin emitted;
//   invokes   INVOKES targets "Controller.method", and how many name a method that exists: a file under app/ declaring
//             `class Controller` with `function method` in it.
// Usage: node docs/evidence/issue-5-laravel-routes/probe.mjs <apg-checkout> <laravel-repo>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [apg, repo] = process.argv.slice(2);
const { laravelRoutesPlugin } = await import(pathToFileURL(join(apg, 'mcp/stdio/ingest/frameworks/laravel.js')).href);
const out = await laravelRoutesPlugin.enrich({ repoRoot: repo, result: { nodes: [], edges: [], refs: [] } });

const routeFiles = execFileSync('git', ['-C', repo, 'ls-files', 'routes/*.php'], { encoding: 'utf8' }).trim().split('\n');
const VERB_RE = /Route::(get|post|put|patch|delete|options|any|match)\s*\(/gu;
const written = routeFiles.reduce((n, f) => n + [...readFileSync(join(repo, f), 'utf8').matchAll(VERB_RE)].length, 0);

// Independent method index: class name -> set of method names, read from app/ with regexes, not with apg.
const methods = new Map();
for (const f of execFileSync('git', ['-C', repo, 'ls-files', 'app/*.php'], { encoding: 'utf8' }).trim().split('\n')) {
  const text = readFileSync(join(repo, f), 'utf8');
  const cls = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/u.exec(text)?.[1];
  if (!cls) continue;
  const set = methods.get(cls) ?? new Set();
  for (const m of text.matchAll(/function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu)) set.add(m[1]);
  methods.set(cls, set);
}
const routes = out.nodes.filter((n) => n.type === 'Route');
const invokes = out.refs.filter((r) => r.relation === 'INVOKES');
const real = invokes.filter((r) => { const [c, m] = String(r.target).split('.'); return methods.get(c)?.has(m); });
const missing = invokes.filter((r) => !real.includes(r)).map((r) => r.target);
const head = (dir) => execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
console.log(`apg ${head(apg)} on ${repo} ${head(repo)}`);
console.log(`route registrations written in ${routeFiles.join(', ')}: ${written}`);
console.log(`Route nodes found: ${routes.length} (${new Set(routes.map((n) => n.label)).size} distinct labels)`);
console.log(`INVOKES refs: ${invokes.length}, naming a method that exists in app/: ${real.length}`);
console.log(`PASSES_THROUGH refs: ${out.refs.filter((r) => r.relation === 'PASSES_THROUGH').length}`);
if (missing.length) console.log(`  not found in app/: ${[...new Set(missing)].slice(0, 8).join(', ')}`);
for (const n of routes.slice(0, 3)) console.log(`  e.g. ${n.label}`);
