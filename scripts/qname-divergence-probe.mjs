// Why does the C++ decl/def pair NOT share a canonical key?
//
// symbol_lookup.js states the invariant outright: "Overloads and the C++ decl/def split share a
// canonical key -> one group -> not ambiguous." The identity-callers fixture violates it. This
// reads what is actually STORED rather than inferring it from the extractor source.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REPO = 'C:/Docker/aify-project-graph';
const at = (rel) => pathToFileURL(path.join(REPO, rel)).href;

function buildRepo(fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-qname-'));
  fs.cpSync(fixture, dir, { recursive: true });
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'i');
  return dir;
}

const { graphIndex } = await import(at('mcp/stdio/query/verbs/index.js'));
const { openDb } = await import(at('mcp/stdio/storage/db.js'));

for (const [lang, fixture] of [['C++', 'tests/fixtures/identity-callers'], ['JS', 'tests/fixtures/identity-callers-js']]) {
  const dir = buildRepo(path.join(REPO, fixture));
  await graphIndex({ repoRoot: dir });
  const db = openDb(path.join(dir, '.aify-graph', 'graph.sqlite'));

  console.log(`\n${'='.repeat(78)}\n=== ${lang}  ${fixture}\n${'='.repeat(78)}`);
  const rows = db.all(
    "SELECT id, label, type, file_path, start_line, extra FROM nodes WHERE label='render' ORDER BY file_path, start_line");
  // POSITIVE CONTROL on the zero: if this prints nothing the probe is broken, not the graph.
  console.log(`rows labelled 'render': ${rows.length}`);
  for (const r of rows) {
    let e = {};
    try { e = typeof r.extra === 'string' ? JSON.parse(r.extra) : (r.extra ?? {}); } catch { e = {}; }
    console.log(`  ${r.type.padEnd(9)} ${String(r.file_path).padEnd(16)}:${String(r.start_line).padEnd(3)}`);
    console.log(`      qname        = ${JSON.stringify(e.qname ?? null)}`);
    console.log(`      parent_class = ${JSON.stringify(e.parent_class ?? null)}`);
    for (const k of ['lexical_scope', 'written_qualifier', 'scope_segments', 'module']) {
      if (e[k] !== undefined) console.log(`      ${k} = ${JSON.stringify(e[k])}`);
    }
  }
  // NEGATIVE CONTROL: a label that does not exist must come back empty, proving the query can
  // say ABSENT rather than always finding something.
  const absent = db.all("SELECT COUNT(*) c FROM nodes WHERE label='noSuchSymbolHere'")[0];
  console.log(`  negative control (label='noSuchSymbolHere'): ${absent.c} rows`);
  try { db.close(); } catch { /* handle */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* handle */ }
}
