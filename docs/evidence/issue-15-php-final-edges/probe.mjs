// Final-edge PHP probe: what the graph says, not what the extractor emitted.
//
//   node docs/evidence/issue-15-php-final-edges/probe.mjs <apg-checkout> <php-repo> <label>
//
// Deletes <php-repo>/.aify-graph first (a full rebuild, so a code change cannot hide behind an incremental reindex),
// indexes with <apg-checkout>/bin/apg.js, then counts:
//   - EXTENDS, IMPLEMENTS, REFERENCES and USES_TYPE edges from PHP files, by the type of node they land on (Class is right for a class name; Module means a
//     qualified name bound to the file instead of the class it declares);
//   - REFERENCES edges from PHP files that land on a Method or Function (a reference to a callable that is not a call:
//     in PHP that is a `$variable` whose name matches a method), with the most frequent target names.
// Run it against a scratch clone: it writes the graph into the repo it measures.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const [apg, repo, label] = process.argv.slice(2);
if (!apg || !repo) { console.error('usage: probe.mjs <apg-checkout> <php-repo> [label]'); process.exit(2); }
rmSync(join(repo, '.aify-graph'), { recursive: true, force: true });
const head = execFileSync('git', ['-C', apg, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['-C', apg, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim();
execFileSync(process.execPath, [join(apg, 'bin', 'apg.js'), 'index', repo], { stdio: 'ignore' });
const Database = createRequire(join(apg, 'package.json'))('better-sqlite3');
const db = new Database(join(repo, '.aify-graph', 'graph.sqlite'), { readonly: true });
const byType = (relation) => db.prepare(`SELECT t.type AS type, COUNT(*) AS n FROM edges e
  JOIN nodes f ON f.id = e.from_id JOIN nodes t ON t.id = e.to_id
  WHERE e.relation = ? AND f.file_path LIKE '%.php' GROUP BY t.type ORDER BY n DESC`).all(relation);
const fmt = (rows) => rows.map((r) => `${r.type}=${r.n}`).join(' ') || '(none)';
const callableRefs = db.prepare(`SELECT t.label AS label, COUNT(*) AS n FROM edges e
  JOIN nodes f ON f.id = e.from_id JOIN nodes t ON t.id = e.to_id
  WHERE e.relation = 'REFERENCES' AND f.file_path LIKE '%.php' AND t.type IN ('Method', 'Function')
  GROUP BY t.label ORDER BY n DESC`).all();
const phpFiles = db.prepare("SELECT COUNT(*) AS n FROM nodes WHERE type = 'File' AND file_path LIKE '%.php'").get().n;
const calls = db.prepare(`SELECT COUNT(*) AS n FROM edges e JOIN nodes f ON f.id = e.from_id
  WHERE e.relation = 'CALLS' AND f.file_path LIKE '%.php'`).get().n;
const extendsByType = byType('EXTENDS');
const implementsByType = byType('IMPLEMENTS');
const referencesByType = byType('REFERENCES');
const usesTypeByType = byType('USES_TYPE');
db.close();

console.log(`== ${label ?? ''} apg ${head}${dirty ? ' + uncommitted changes' : ''} on ${repo}`);
console.log(`php files indexed: ${phpFiles}; CALLS from php (control): ${calls}`);
console.log(`EXTENDS by target type:    ${fmt(extendsByType)}`);
console.log(`IMPLEMENTS by target type: ${fmt(implementsByType)}`);
console.log(`REFERENCES by target type: ${fmt(referencesByType)}`);
console.log(`USES_TYPE by target type:  ${fmt(usesTypeByType)}`);
console.log(`REFERENCES landing on a Method/Function: ${callableRefs.reduce((s, r) => s + r.n, 0)} edges, ${callableRefs.length} names`);
console.log(`  top: ${callableRefs.slice(0, 12).map((r) => `${r.label}=${r.n}`).join(' ')}`);
