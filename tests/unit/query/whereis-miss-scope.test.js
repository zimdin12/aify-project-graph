// A REFUSAL IS A CLAIM, AND IT MUST NAME THE POPULATION IT SEARCHED.
//
// ⛔ MEASURED (2026-08-19). 84 of 89 `export const NAME = …` names in `mcp/` have no
// declaration node in this repo's own graph, and the node-type histogram has NO `Variable`
// row at all: tree-sitter extraction has no path that emits one, and the only producer is the
// code-intel importer, which needs a collection this repo does not have.
//
// ⇒ `graph_whereis("SEARCH_TYPES")` — an exported const declared in whereis.js itself and
// imported elsewhere — answers `NO MATCH … Try graph_search`. That sentence is shaped like a
// fact about the repository. The true fact is about this verb's DECLARATION TABLE.
//
// ★ This is the same defect as the FILE-target case one branch above, one kind further out,
// and it is the reason a competent agent stops reaching for the verb: it answered a question
// about existence, wrongly, with no way to tell.
//
// ⚠ SCOPE THE DOUBT TO ITS CAUSE. A generic "results may be incomplete" costs the reader as
// much as a false claim — they go and check either way. So the disclosure must be MEASURED:
// name the types searched, and name which of them are EMPTY IN THIS GRAPH. That is a fact
// the reader can act on, not a hedge.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphWhereis, SEARCH_TYPES } from '../../../mcp/stdio/query/verbs/whereis.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

// `rows` is a list of [type, label]. Nothing else varies between the arms below, so a
// difference in output is attributable to the graph's type population and nothing else.
async function repoWith(rows) {
  const repo = await mkdtemp(join(tmpdir(), 'apg-ms-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: rows.length, edges: 0, schemaVersion: 4,
    extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  rows.forEach(([type, label], i) => {
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('n${i}','${type}','${label}','src/a.js',${i + 1},${i + 2},'javascript',1,'{}')`);
  });
  db.close();
  return repo;
}

describe('graph_whereis miss — the refusal names its population', () => {
  it('★★★ does not present a miss as a bare fact about the repository', async () => {
    repoRoot = await repoWith([['Function', 'doThing']]);
    const out = await graphWhereis({ repoRoot, symbol: 'MAX_RETRIES' });
    expect(out, 'the reader must be told this verb searched a DECLARATION TABLE, not the repo')
      .toMatch(/declaration type/i);
  }, 20_000);

  it('★★★ names the empty types by name, because that is what the reader can act on', async () => {
    // Only Function is populated. Every other searched type is empty IN THIS GRAPH, and
    // `Variable` is the one that makes a constant unfindable.
    repoRoot = await repoWith([['Function', 'doThing']]);
    const out = await graphWhereis({ repoRoot, symbol: 'MAX_RETRIES' });
    expect(out, 'a symbol of an empty type cannot be found here — say which').toMatch(/Variable/);
  }, 20_000);

  it('★★★ does not claim a type is empty when it is populated', async () => {
    // Every searched type has a node. There is nothing to disclose, and inventing a doubt
    // costs the reader exactly as much as inventing a claim.
    repoRoot = await repoWith(SEARCH_TYPES.map((t, i) => [t, `sym${i}`]));
    const out = await graphWhereis({ repoRoot, symbol: 'MAX_RETRIES' });
    expect(out, 'no type is empty, so no type may be listed as empty')
      .not.toMatch(/have NO nodes|are empty in this graph/i);
  }, 20_000);

  it('★★★ still reports the population basis even when suggestions exist', async () => {
    // The suggester fires on a near-miss. The old code returned EITHER suggestions OR the
    // bare wording — two routes, and a fix applied to one of them is this repo's most
    // frequently repeated defect. Both routes must carry the scope.
    repoRoot = await repoWith([['Function', 'max_retries']]);
    const out = await graphWhereis({ repoRoot, symbol: 'MAX_RETRIES' });
    expect(out, 'the suggestion route must not lose the scope the bare route carries')
      .toMatch(/declaration type/i);
    expect(out, 'sanity: this arm must actually be the suggestion route').toMatch(/Did you mean/);
  }, 20_000);
});
