// Usage: node apg-idprobe.mjs <apgRepo> <scratchParent> <label>  -> indexes a git copy of tests/fixtures, prints the node-ID set hash
import { cpSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const [apg, parent, label] = process.argv.slice(2);
const dir = mkdtempSync(join(parent, 'apg-idprobe-'));
cpSync(join(apg, 'tests', 'fixtures'), dir, { recursive: true, filter: (src) => basename(src) !== '.aify-graph' });
const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'ignore' });
git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'fx');
execFileSync(process.execPath, [join(apg, 'bin', 'apg.js'), 'index', dir], { stdio: 'ignore' });
const Database = createRequire(join(apg, 'package.json'))('better-sqlite3');
const db = new Database(join(dir, '.aify-graph', 'graph.sqlite'), { readonly: true });
const ids = db.prepare('SELECT id FROM nodes ORDER BY id').all().map((r) => r.id);
const edges = db.prepare('SELECT from_id, to_id, relation FROM edges ORDER BY from_id, to_id, relation').all().map((r) => `${r.from_id} ${r.relation} ${r.to_id}`);
db.close();
const { createHash } = await import('node:crypto');
const h = (xs) => createHash('sha256').update(xs.join('\n')).digest('hex').slice(0, 16);
console.log(`${label}: dir=${dir} nodes=${ids.length} idset=${h(ids)} edges=${edges.length} edgeset=${h(edges)}`);
