#!/usr/bin/env node
// Manually simulates a crashed rebuild then invokes ensureFresh and prints
// whether the resumed run took the resume path or did a full rebuild.
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { ensureFresh } from '../mcp/stdio/freshness/orchestrator.js';

const tmp = join(tmpdir(), 'apg-crashrecov-' + Date.now()).replace(/\\/g, '/');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(join(tmp, 'src'), { recursive: true });
writeFileSync(join(tmp, 'src', 'a.py'), 'def a():\n    pass\n');
writeFileSync(join(tmp, 'src', 'b.py'), 'def b():\n    a()\n');
writeFileSync(join(tmp, 'src', 'c.py'), 'def c():\n    b()\n');

execFileSync('git', ['init', '-q'], { cwd: tmp });
execFileSync('git', ['add', '-A'], { cwd: tmp });
execFileSync('git', [
  '-c', 'user.email=x@x',
  '-c', 'user.name=x',
  'commit', '-q', '-m', 'init',
], { cwd: tmp });

console.log('=== INITIAL FULL BUILD ===');
const r1 = await ensureFresh({ repoRoot: tmp, force: true });
console.log('  nodes:', r1.nodes, 'edges:', r1.edges, 'processedFiles:', r1.processedFiles.length, 'resumedFromPartial:', r1.resumedFromPartial ?? false);

console.log('\n=== SIMULATE CRASH (wipe b.py + c.py nodes, flip status to indexing) ===');
const dbPath = join(tmp, '.aify-graph', 'graph.sqlite');
{
  const db = new Database(dbPath);
  const before = db.prepare('SELECT COUNT(*) AS n FROM nodes').get().n;
  db.exec(`
    DELETE FROM edges WHERE source_file IN ('src/b.py','src/c.py');
    DELETE FROM nodes WHERE file_path IN ('src/b.py','src/c.py');
  `);
  const after = db.prepare('SELECT COUNT(*) AS n FROM nodes').get().n;
  console.log('  nodes before/after wipe:', before, '->', after);
  db.close();
}
const manifestPath = join(tmp, '.aify-graph', 'manifest.json');
const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
m.status = 'indexing';
writeFileSync(manifestPath, JSON.stringify(m, null, 2));
console.log('  manifest status: indexing');

console.log('\n=== RESUME ===');
const r2 = await ensureFresh({ repoRoot: tmp });
console.log('  nodes:', r2.nodes, 'edges:', r2.edges, 'processedFiles:', r2.processedFiles.length, 'resumedFromPartial:', r2.resumedFromPartial);

const expectResume = r2.resumedFromPartial === true;
const expectProcessed = r2.processedFiles.length === 2; // only b.py + c.py should be re-processed
const expectNodesBackToFull = r2.nodes === r1.nodes;
console.log('\n  RESULT:');
console.log('    resumed?', expectResume ? 'YES ✓' : 'NO ✗');
console.log('    only 2 files re-processed (b.py, c.py)?', expectProcessed ? 'YES ✓' : `NO — got ${r2.processedFiles.length} ✗`);
console.log('    node count recovered?', expectNodesBackToFull ? 'YES ✓' : `NO — got ${r2.nodes} vs expected ${r1.nodes} ✗`);

rmSync(tmp, { recursive: true, force: true });
process.exit(expectResume && expectProcessed && expectNodesBackToFull ? 0 : 1);
