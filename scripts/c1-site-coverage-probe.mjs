// Site coverage, matching FILE AND LINE. A previous version matched on line alone and reported a
// header declaration as REPRESENTED by a widgets.cpp record that merely shared a line number.
import { openDb } from 'file:///C:/Docker/aify-project-graph/mcp/stdio/storage/db.js';

const R = 'C:/Users/ADMINI~1/AppData/Local/Temp/apg-clangd-qual';
const db = openDb(`${R}/.aify-graph/graph.sqlite`);

const recs = db.all(
  "SELECT kind, symbol_id, qname, file, range_start_line FROM code_intel_records WHERE kind = 'definition'",
);
console.log('RAW definition records (file column verbatim):');
for (const r of recs) {
  console.log(`   file=${JSON.stringify(r.file)} line=${r.range_start_line} qname=${JSON.stringify(r.qname)} id=${r.symbol_id}`);
}

// Ground truth enumerated from the frozen source BEFORE consulting the records.
const TRUTH = [
  ['src/widgets.h', 8, 'alpha::Widget::render', 'declaration'],
  ['src/widgets.h', 15, 'beta::Widget::render', 'declaration'],
  ['src/widgets.cpp', 4, 'alpha::Widget::render', 'definition'],
  ['src/widgets.cpp', 8, 'beta::Widget::render', 'definition'],
  ['src/callers.cpp', 5, 'alphaCaller', 'definition'],
  ['src/callers.cpp', 10, 'betaCaller', 'definition'],
];

const norm = (p) => String(p ?? '').split('\\').join('/');

console.log('\nSITE COVERAGE (file AND line):');
let represented = 0;
for (const [file, line, qname, kind] of TRUTH) {
  const hit = recs.find((r) => norm(r.file).endsWith(file) && Number(r.range_start_line) === line);
  if (hit) represented += 1;
  console.log(`  ${`${file}:${line}`.padEnd(20)}${qname.padEnd(24)}${kind.padEnd(12)}${hit ? `REPRESENTED id=${hit.symbol_id}` : 'UNREPRESENTED'}`);
}
console.log(`  => ${represented} of ${TRUTH.length} ground-truth sites represented`);

console.log('\nQ3 — is there an id linking a DECLARATION to its DEFINITION?');
const ids = new Set(recs.map((r) => r.symbol_id));
console.log(`  definition records: ${recs.length}, distinct symbol_ids: ${ids.size}`);
console.log('  symbol_id form: c:cpp:<file>:<line>:<col> — positional, from cpp-clangd.js:123');
console.log('  A decl and its def sit at different file:line, so they cannot share this id by construction.');

db.close();
