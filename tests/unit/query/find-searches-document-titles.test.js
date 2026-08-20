// ⛔ THE TITLE FIX REACHED ONE OF TWO VERBS, AND THE SAME REPO ANSWERED THE SAME QUESTION TWO WAYS.
//
// `graph_search` learned to query a document's own title in c35836a, with the measurement in its
// comment. `graph_find` is a SEPARATELY REGISTERED tool with its own doc search, and it still
// matched label and path only. Measured on this repo at 900b7bb, both verbs, same queries:
//
//     query                  graph_search(kind:"all")   graph_find(layers:["docs"])
//     "install guide"        finds a document           finds one — by FILENAME, coincidentally
//     "triage"               finds a document           NOTHING
//     "findings register"    finds a document           NOTHING
//
// Re-measured rather than taken from the other comment: 75 of 155 documents (48%) carry a title
// word appearing nowhere in their path. `AGENTS.md` is titled "Agent install guide";
// `2026-08-10-scan-plan.md` is "Scan plan — collect findings widely, then triage them together".
//
// ⭐ AND THAT IS THE QUERY AN INDEX EXISTS TO WIN. The competitor on discovery is `ls docs/`, not
// grep: it finds anything whose NAME carries the topic, costs nothing and needs no index. The only
// query where an index earns its keep is TOPIC → DOCUMENT WHOSE FILENAME LACKS THE TOPIC — exactly
// the query this verb returned nothing for.
//
// ★ SAME SHAPE AS THE COLLECTOR'S MISSING `session.scope`: a fix applied at one of N call sites,
// where nothing about the fixed site tells you the other exists. Found by asking which verbs answer
// this question, not by reading the one that was already right.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphFind } from '../../../mcp/stdio/query/verbs/find.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

/** A repo whose documents are named nothing like what they are about. */
async function repoWithTitledDocs() {
  const repo = await mkdtemp(join(tmpdir(), 'apg-findtitle-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t',
    'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repo, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 3, edges: 0, schemaVersion: 4,
    extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  const doc = (id, file, extra) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ($id,'Document',$l,$f,1,1,'markdown',1,$e)`,
    { id, l: file.split('/').pop(), f: file, e: JSON.stringify(extra) });
  // The document at the centre of the defect: nothing in its name says what it is about.
  doc('d1', 'docs/2026-08-10-scan-plan.md',
    { title: 'Scan plan — collect findings widely, then triage them together' });
  // The control: a document findable the old way, so a fix cannot pass by breaking name matching.
  doc('d2', 'docs/attribution.md', { title: 'Attribution' });
  // The restraint: `summary` must NOT be matched. Same reasoning search.js reached — a title is
  // the author naming the document, a summary is whatever sentence happened to be second.
  doc('d3', 'docs/misc.md', { title: 'Miscellany', summary: 'mentions quicksilver in passing' });
  db.close();
  return repo;
}

const docHits = async (query) => {
  const r = JSON.parse(await graphFind({ repoRoot, query, layers: ['docs'], limit: 5 }));
  return r.hits?.docs?.items ?? [];
};

describe('graph_find reaches documents by their own title', () => {
  it('★★★ a topic that appears ONLY in the title is found', async () => {
    // ⛔ THE DEFECT. "triage" is nowhere in `2026-08-10-scan-plan.md` — not the filename, not the
    // path — and it is the word the author used to say what the document is for.
    repoRoot = await repoWithTitledDocs();
    const hits = await docHits('triage');
    expect(hits.map((h) => h.file), 'the only place this word exists is the title')
      .toEqual(['docs/2026-08-10-scan-plan.md']);
  }, 20_000);

  it('★★★ the matched title is RETURNED, not just matched on', async () => {
    // A hit whose filename does not contain the query looks like a false positive unless the
    // caller can see what matched — and this clause exists precisely to return such documents.
    repoRoot = await repoWithTitledDocs();
    const hits = await docHits('triage');
    expect(hits[0].title, 'the caller can see why this came back').toMatch(/triage/i);
  }, 20_000);

  it('★★★ CONTROL: filename matching still works and is not outranked', async () => {
    // ⛔ Without this, a fix that searched ONLY titles would pass the test above and silently
    // break the ordinary case — trading one blind spot for another.
    repoRoot = await repoWithTitledDocs();
    const hits = await docHits('attribution');
    expect(hits[0].file).toBe('docs/attribution.md');
  }, 20_000);

  it('★★★ SUMMARY is deliberately NOT matched', async () => {
    // ⚠ THE RESTRAINT IS THE DECISION, and it is adopted from search.js rather than re-made here:
    // a summary is the second non-empty line, whatever prose happened to be there. Matching it
    // would widen recall by an unmeasured amount at an unmeasured precision cost, and this repo
    // has spent a session deleting rules admitted without a measurement.
    repoRoot = await repoWithTitledDocs();
    expect(await docHits('quicksilver'), 'summary text is not a search surface').toEqual([]);
  }, 20_000);

  it('★★★ NEGATIVE CONTROL: a word in no title, name or path returns nothing', async () => {
    // Without this the suite cannot tell "found by title" from "returns everything".
    repoRoot = await repoWithTitledDocs();
    expect(await docHits('zzznotanywhere')).toEqual([]);
  }, 20_000);
});
