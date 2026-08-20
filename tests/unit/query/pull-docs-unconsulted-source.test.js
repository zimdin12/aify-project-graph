// ⛔ "NO DOCUMENTS, EXHAUSTIVELY" OVER TWELVE REAL DOCUMENTS.
//
// ef-manager, field-testing 6c2edb3 from the user's seat. They picked the best case in the repo —
// `mcp/stdio/server-instructions.js`, 12 inbound authored doc links, more than any other file —
// and asked the verb an agent can actually reach:
//
//   graph_pull(node="mcp/stdio/server-instructions.js", layers=["docs","relations"])
//     -> "docs":    { "items": [], "total": 0, "truncated": false }
//     -> "receipt": { "exhaustive": true }
//
// Two independent defects stacked, and the second is why the first was invisible:
//
//   1. The docs layer hardcoded `MENTIONS`. `LINKS_TO` had been added to the graph and the query
//      was never told. It answered one of the two relations that carry doc→code information and
//      reported the result as the answer to the question.
//
//   2. The receipt could not tell an EMPTY list from an UNASKED one. `assessTruncation` proves a
//      list was not cut short — and a list nobody populated is `truncated: false`, therefore
//      "proven". So the completeness machinery certified an absence it had never checked.
//
// ⚠ WHY THIS OUTRANKED EVERYTHING ELSE IN THE QUEUE. ef-manager: "an unreachable feature costs an
// agent nothing — they never learn it existed. A reachable verb saying 'no documents,
// exhaustively' ACTIVELY TERMINATES the search." That search is Steven's compacted sc-manager
// trying to remember the design doc exists. Before the doc layer landed, the graph had nothing to
// be wrong about; after it, the graph held the answer and the front door denied it.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { graphPull } from '../../../mcp/stdio/query/verbs/pull.js';
import { assessCoverage } from '../../../mcp/stdio/query/receipt.js';
import { DOC_FAMILY } from '../../../mcp/stdio/storage/taxonomy.js';

let repo;
afterEach(async () => {
  if (repo) { try { await rm(repo, { recursive: true, force: true }); } catch { /* win lock */ } }
  repo = undefined;
});

// A repo whose graph holds ONE authored doc→file link and no MENTIONS at all — the exact shape
// that returned an exhaustive empty set.
async function repoWithAuthoredLink() {
  repo = await mkdtemp(join(tmpdir(), 'apg-pulldocs-'));
  await mkdir(join(repo, '.aify-graph'), { recursive: true });
  await mkdir(join(repo, 'docs'), { recursive: true });
  await mkdir(join(repo, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
  await writeFile(join(repo, 'src', 'terrain.js'), 'export function generateTerrain(){}\n');
  // ⚠ mesh.js MUST EXIST ON DISK. Two tests below use it as the "no doc edges point here" case,
  // and without the file `graphPull` cannot resolve the node — it returns an error shape with no
  // `layers` at all. One of those tests then passed VACUOUSLY: it asserted `docs_not_shown` was
  // undefined, which is trivially true of a result that resolved nothing. A negative assertion
  // over an error path proves nothing, and it is the shape that hides best.
  await writeFile(join(repo, 'src', 'mesh.js'), 'export function buildMesh(){}\n');
  await writeFile(join(repo, 'docs', 'design.md'), 'See [terrain](../src/terrain.js).\n');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });

  const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
  const add = (id, type, label, file) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ('${id}','${type}','${label}','${file}',1,1,'javascript',1,'{}')`);
  add('d1', 'Document', 'design.md', 'docs/design.md');
  add('f1', 'File', 'terrain.js', 'src/terrain.js');
  add('s1', 'Function', 'generateTerrain', 'src/terrain.js');
  // ⚠ mesh.js NEEDS ITS OWN File NODE. `detectNodeKind` resolves a path only when a `File` node
  // with that exact `file_path` exists; without it `graphPull` returns `kind: "unresolved"`, and
  // the two mesh.js tests below were reading an absence off an ERROR result rather than off a
  // resolved file — the negative one passing vacuously, in exactly the way that hides best.
  // The liveness assertion added to that test is what surfaced it.
  add('f2', 'File', 'mesh.js', 'src/mesh.js');
  // Three documents so every bucket has an occupant: one links only, one mentions only, one both.
  add('d-link', 'Document', 'links.md', 'docs/links.md');
  add('d-mention', 'Document', 'mentions.md', 'docs/mentions.md');
  add('d-both', 'Document', 'both.md', 'docs/both.md');
  add('s2', 'Function', 'buildMesh', 'src/mesh.js');
  // A SECOND symbol in terrain.js — this is what makes rows exceed documents.
  add('s3', 'Function', 'shadeTerrain', 'src/terrain.js');
  db.run(
    `INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
     VALUES ('d1','f1','LINKS_TO','docs/design.md',1,0.95,'INFERRED','doc_link:markdown')`);
  db.close();
  return repo;
}

describe('graph_pull docs — an unasked source is not an absence', () => {
  it('★★★ an authored doc→file link REACHES the docs layer', async () => {
    // The user-visible half. This is the query an agent runs when they ask "what do I need to
    // know about this file", and it is where the doc layer has to surface or it does not exist.
    await repoWithAuthoredLink();
    // ⚠ graphPull serialises. Parsing here rather than reaching into an object is not a
    // formality — it is the shape a caller actually receives, and asserting on the pre-serialised
    // value would test a structure no consumer ever sees.
    const out = JSON.parse(await graphPull({ repoRoot: repo, node: 'src/terrain.js', layers: ['docs'] }));
    const items = out.layers?.docs?.items ?? [];
    expect(items.length, 'the edge is in the graph — the layer must see it').toBe(1);
    expect(items[0].file).toBe('docs/design.md');
  }, 60_000);

  it('★★★ the row names the RELATION that produced it, not a hardcoded one', async () => {
    // The receipt used to stamp `basis: 'MENTIONS edge'` on every docs row. After the query
    // widened that string would have been false for exactly the rows it was newly returning —
    // a hardcoded provenance string that survives a query change is how a receipt starts lying.
    await repoWithAuthoredLink();
    const out = JSON.parse(await graphPull({
      repoRoot: repo, node: 'src/terrain.js', layers: ['docs'], receipt: 'full',
    }));
    expect(out.layers.docs.items[0].via, 'an authored link is different evidence from a prose mention')
      .toBe('LINKS_TO');
    // ⛔ THIS ASSERTION USED TO BE `if (docClaim) expect(...)`, and a mutation battery proved it
    // never ran: the default receipt mode is a HEAD, which carries no `claims` array, so the
    // guard was permanently false and the hardcoded-basis mutation survived untouched. A
    // conditional assertion is a test that decides for itself whether to test.
    const claims = out.receipt?.claims ?? [];
    const docClaim = claims.find((c) => c.field === 'docs');
    expect(docClaim, 'the receipt must carry a claim for the docs row').toBeTruthy();
    expect(docClaim.basis, 'the basis names the relation that produced the row').toMatch(/LINKS_TO/);
  }, 60_000);

  it('★★★ REACHABLE-BY-ARGUMENT IS NOT REACHABLE — a default-layer pull discloses the docs it hid', async () => {
    // ⛔ ef-manager, after verifying the fix worked, re-ran the SAME call with `layers` omitted —
    // what an agent gets who reaches for the right verb without knowing the layer names. The
    // defaults are code/functionality/tasks/activity. Docs is not among them. The response
    // carried zero documents and nothing anywhere in it named a docs layer or hinted one existed.
    //
    // "An agent who reaches correctly and does not know to type layers:['docs'] gets the same
    // nothing they got this morning, now from a call that returns exhaustive:false without saying
    // what it left out. graph_neighbors being unlisted was never the whole barrier."
    await repoWithAuthoredLink();
    const out = JSON.parse(await graphPull({ repoRoot: repo, node: 'src/terrain.js' }));
    expect(out.layers.docs, 'defaults are unchanged — this is a disclosure, not a new default')
      .toBeUndefined();
    // ⚠ WORDING UPDATED WITH THE NOUN FIX. "reference this file" was the defect: it covered
    // MENTIONS edges, which point at a SYMBOL and say nothing about the file being named.
    expect(out.docs_not_shown, 'the payload must name what it withheld and how to ask for it')
      .toMatch(/1 document\(s\) relate to this file/);
    expect(out.docs_not_shown, 'and say which kind of relation it was').toMatch(/1 links to the file itself/);
    expect(out.docs_not_shown).toMatch(/layers:\["docs"\]/);
  }, 60_000);

  it('★★★ ...and stays SILENT when there is nothing to disclose', async () => {
    // A pointer that always appears is a banner, and readers learn to skip banners — which is how
    // the graph-staleness line got treated. `src/mesh.js` has no inbound doc edge in this fixture.
    await repoWithAuthoredLink();
    const out = JSON.parse(await graphPull({ repoRoot: repo, node: 'src/mesh.js' }));
    // Prove the call RESOLVED before reading an absence off it — otherwise this asserts nothing.
    expect(out.layers, 'the node must have resolved for its silence to mean anything').toBeTruthy();
    expect(out.docs_not_shown, 'no documents point here, so there is nothing to point at')
      .toBeUndefined();
  }, 60_000);

  it('★★★ an empty docs answer distinguishes a TRUE zero from a BROKEN one', async () => {
    // ⛔ ef-manager's residual on my own fix: "the morning bug returned items:[] + exhaustive:true
    // over 12 real edges. The true zero I used as a control returns items:[] + exhaustive:true.
    // You fixed the data; you did not make the failure distinguishable from the success."
    //
    // The coverage check does not close it: if extraction breaks, the graph holds no LINKS_TO at
    // all, the relations-present set shrinks to match what was consulted, and the claim is proven
    // complete over a corpus that quietly lost a source. This is the positive control applied to
    // ourselves — an empty answer states whether the instrument can produce a non-empty one
    // ANYWHERE, because "no document links to this file" and "no document links to any file" are
    // different facts and only the first is about the file that was asked about.
    await repoWithAuthoredLink();
    const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
    db.run("DELETE FROM edges WHERE relation = 'LINKS_TO'");   // extraction produced nothing
    db.close();

    const out = JSON.parse(await graphPull({ repoRoot: repo, node: 'src/terrain.js', layers: ['docs'] }));
    expect(out.layers.docs.items).toEqual([]);
    expect(out.layers.docs.absence_cause, 'a suspect zero must not read like an observed one')
      .toMatch(/ZERO doc edges of any kind/);
  }, 60_000);

  it('★★★ ...and a genuine per-file zero carries NO suspicion', async () => {
    // The other half, and the one that keeps the field meaningful. The graph has doc edges — just
    // none pointing at this file. That absence is an observation about the file and must not be
    // dressed up as an instrument failure, or the note becomes noise and gets ignored.
    await repoWithAuthoredLink();
    const out = JSON.parse(await graphPull({ repoRoot: repo, node: 'src/mesh.js', layers: ['docs'] }));
    expect(out.layers.docs.items).toEqual([]);
    expect(out.layers.docs.absence_cause, 'the instrument demonstrably works — it found terrain.js')
      .toBeUndefined();
  }, 60_000);

  it('★★★ a doc relation the GRAPH holds but the family does not know refuses exhaustive', async () => {
    // ⛔ MY FIRST VERSION OF THIS WIRING WAS A TAUTOLOGY, and the battery caught it: I declared
    // DOC_FAMILY on both sides of the coverage check, so the two could not disagree — two reads
    // of one source is one instrument read twice.
    //
    // The honest denominator is what the graph ACTUALLY contains. Here a Document emits a
    // relation that is real, is in the taxonomy, and is NOT in DOC_FAMILY. The docs query
    // faithfully ignores it, the returned list is not truncated, and every earlier check would
    // have passed the receipt as exhaustive. This is the state the whole defect lived in:
    // LINKS_TO existed in the graph before the layer knew of it.
    await repoWithAuthoredLink();
    const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
    db.run(
      `INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
       VALUES ('d1','s1','REFERENCES','docs/design.md',1,0.6,'INFERRED','some_future_rule')`);
    db.close();

    const out = JSON.parse(await graphPull({
      repoRoot: repo, node: 'src/terrain.js', layers: ['docs', 'relations'], receipt: 'full',
    }));
    expect(out.receipt.floor.exhaustive, 'a source nobody asked cannot support completeness')
      .toBe(false);
    expect(out.receipt.floor.cause, 'and the reader must learn WHICH question went unasked')
      .toMatch(/REFERENCES/);
  }, 60_000);

  it('★★★ the docs query is DERIVED from the registry, so a new relation cannot be forgotten', async () => {
    // The defect was a hardcoded relation, so the fix is not "add the missing one" — that leaves
    // the next one to be forgotten in the same way. Every member of the family must reach it.
    const src = await import('node:fs').then((fs) => fs.readFileSync(
      new URL('../../../mcp/stdio/query/verbs/pull.js', import.meta.url), 'utf8'));
    expect(src, 'the docs clause must interpolate the shared list, not spell relations out')
      .toMatch(/e\.relation IN \(\$\{PULL_DOC_SQL_LIST\}\)/);
    expect(DOC_FAMILY).toContain('MENTIONS');
    expect(DOC_FAMILY).toContain('LINKS_TO');
  });
});

describe('graph_pull resolves nodes that EXIST — "unresolved" is not "no docs"', () => {
  // ⛔ ef-manager, census over the whole graph: 78 of 266 non-File doc-edge targets answered
  //     graph_pull("README.md") -> {"kind":"unresolved","value":"README.md"}
  // for a Document node with FIVE documents pointing at it. `.mcp.json` had nine.
  //
  // The breakdown was Document 37 · Config 24 · Directory 16 · Entrypoint 1 = 78 — exactly
  // FILE_LEVEL_TYPES minus File. `detectNodeKind` matched `type = 'File'` only.
  //
  // ⚠ THIS IS THE SAME ASSUMPTION THAT COST doc-links.js ALL 68 OF ITS MARKDOWN LINKS THIS
  // MORNING. I fixed it there, wrote the constant, commented the trap, and left it standing in a
  // resolver two hundred lines from the file I was editing. The constant now lives in the
  // registry so a second consumer inherits the fix rather than repeating the bug.
  //
  // "Unresolved" is not "no docs": it says THE NODE DOES NOT EXIST, which ends a search instead
  // of redirecting it.
  it('★★★ a Document node resolves — not "unresolved"', async () => {
    await repoWithAuthoredLink();
    const out = JSON.parse(await graphPull({ repoRoot: repo, node: 'docs/design.md' }));
    expect(out.node.kind, 'a Document is in the graph and must resolve').toBe('file');
    expect(out.node.kind).not.toBe('unresolved');
  }, 60_000);

  it('★★★ a bare DIRECTORY name resolves — the residue the first fix left', async () => {
    // ⚠ Widening the type list took the population from 78 unresolvable to 6, NOT to 0. The six
    // survivors were bare top-level directory names (`docs`, `mcp`, `tests`, ...) which fail a
    // SECOND gate: `looksFileish` needs a slash or a known extension. Fixed as a last resort
    // AFTER the symbol lookup, so a directory named `docs` cannot outrank a symbol named `docs`.
    await repoWithAuthoredLink();
    const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('dir1','Directory','docs','docs',0,0,'',1,'{}')`);
    db.close();
    const out = JSON.parse(await graphPull({ repoRoot: repo, node: 'docs' }));
    expect(out.node.kind).toBe('file');
  }, 60_000);

  it('★★★ a SYMBOL still outranks a same-named path — precedence preserved', async () => {
    // ⚠ THE CONTROL THAT KEEPS THE FIX HONEST. The fallback runs only after the symbol lookup has
    // already failed. Putting it earlier — or widening `looksFileish` — would let a Directory
    // named `generateTerrain` shadow the FUNCTION of that name, trading one wrong answer for
    // another and breaking every existing symbol pull.
    await repoWithAuthoredLink();
    const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('dir2','Directory','generateTerrain','generateTerrain',0,0,'',1,'{}')`);
    db.close();
    const out = JSON.parse(await graphPull({ repoRoot: repo, node: 'generateTerrain' }));
    expect(out.node.kind, 'the symbol must still win').toBe('symbol');
  }, 60_000);

  it('★★★ the code layer no longer asserts absence about a node that is present', async () => {
    // ⛔ THE SECOND SITE, and ef-manager scoped it correctly: fixing the resolver alone IS enough
    // to surface the docs disclosure, because this gate fails soft. But those same nodes would
    // then be told "file not in graph" about a file that IS in the graph — the identical false
    // claim one layer down, on exactly the population just fixed. It is the ASSERTION, not the
    // emptiness, that ends a search.
    await repoWithAuthoredLink();
    const out = JSON.parse(await graphPull({
      repoRoot: repo, node: 'docs/design.md', layers: ['code'],
    }));
    expect(out.layers.code.error, 'it must say what it checked, not claim absence')
      .toMatch(/indexed as Document, not as a source File/);
    expect(out.layers.code.error).not.toMatch(/^file not in graph$/);
    expect(out.layers.code.indexed_as).toBe('Document');
  }, 60_000);

  it('★★★ a path that is genuinely absent still says so', async () => {
    // NEGATIVE CONTROL. Softening the message must not make it impossible to report a real
    // absence — otherwise the fix trades a false claim for an unfalsifiable one.
    await repoWithAuthoredLink();
    const out = JSON.parse(await graphPull({
      repoRoot: repo, node: 'src/terrain.js', layers: ['code'],
    }));
    expect(out.layers.code.error, 'a real File resolves and has no error at all').toBeUndefined();
  }, 60_000);
});

describe('docs_not_shown — the noun, and the denominator', () => {
  // ⛔ ef-manager, from the user's seat: "12 document(s) reference this file." MENTIONS is
  // Document→SYMBOL; LINKS_TO is Document→FILE. The count mixed both and attached the result to
  // the noun "this file". Proven on dedup-records.js — one document, CHANGELOG.md, which never
  // names that file; it names the SYMBOL dedupCollectionRecords.
  //
  // Blast radius over 350 files with doc edges: 83 (24%) sentences 100% wrong, 101 (29%) partly,
  // 166 (47%) correct. So more than half overstated.
  const plant = (db, from, to, relation, line) => db.run(
    `INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
     VALUES ('${from}','${to}','${relation}','x',${line},0.9,'INFERRED','t')`);

  it('★★★ the three buckets RECONCILE to the total — a two-way split overshoots', async () => {
    // ⛔ THE PROPERTY THAT FAILED. My proposed fix rendered "N link, M mention", and those sets
    // INTERSECT: scripts/refactor-oracle.mjs is total 53, linking 1, mentioning 53 — so 1 + 53 =
    // 54 against a total of 53. It would have fixed a noun error by shipping an arithmetic one,
    // and looked MORE authoritative for carrying structure.
    await repoWithAuthoredLink();
    const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
    plant(db, 'd-link', 'f1', 'LINKS_TO', 1);
    plant(db, 'd-mention', 's1', 'MENTIONS', 0);
    plant(db, 'd-both', 'f1', 'LINKS_TO', 2);
    plant(db, 'd-both', 's1', 'MENTIONS', 0);
    db.close();

    const out = JSON.parse(await graphPull({ repoRoot: repo, node: 'src/terrain.js' }));
    const b = out.docs_not_shown_breakdown;
    expect(b.linkOnly + b.mentionOnly + b.both, 'parts must reconcile to the whole')
      .toBe(b.documents);
    expect(b.linkOnly).toBe(2);      // d1 (from the base fixture) and d-link
    expect(b.mentionOnly).toBe(1);
    expect(b.both).toBe(1);
    expect(b.documents).toBe(4);
  }, 60_000);

  it('★★★ a MENTION-only document is not described as referencing the file', async () => {
    // The dedup-records.js case in miniature: the only document mentions a SYMBOL and never names
    // the file. The old sentence called that "1 document(s) reference this file".
    await repoWithAuthoredLink();
    const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
    db.run("DELETE FROM edges WHERE relation = 'LINKS_TO'");
    plant(db, 'd-mention', 's1', 'MENTIONS', 0);
    db.close();

    const out = JSON.parse(await graphPull({ repoRoot: repo, node: 'src/terrain.js' }));
    expect(out.docs_not_shown).toMatch(/1 only mentions a symbol defined in it/);
    expect(out.docs_not_shown, 'nothing links to this file, so nothing may say it does')
      .not.toMatch(/links? to the file itself/);
  }, 60_000);

  it('★★★ NEGATIVE CONTROL — a link-only file stays correct after the fix', async () => {
    // ⚠ ef-manager: "A fix that makes the 83 right and quietly breaks the 166 that were already
    // right is a worse build, and only a negative control catches it." server-instructions.js is
    // their real-world instance — 12 documents, all LINKS_TO, zero MENTIONS, verified including
    // the two rows truncated past the display limit.
    await repoWithAuthoredLink();
    const out = JSON.parse(await graphPull({ repoRoot: repo, node: 'src/terrain.js' }));
    expect(out.docs_not_shown).toMatch(/1 links to the file itself/);
    expect(out.docs_not_shown).not.toMatch(/mentions? a symbol/);
    expect(out.docs_not_shown).not.toMatch(/does both|do both/);
  }, 60_000);

  it('★★★ the SILENCE of the entries figure depends on MENTIONS having no line — pinned', async () => {
    // ⛔ ef-manager cross-tabbed all 350 files with doc edges and found that 16 of the 19 where
    // documents == layer-rows agree BY CONSTRUCTION, not by coincidence: MENTIONS edges carry no
    // source_line (2527 of 2527 are zero; LINKS_TO is 477 of 477 non-zero). With the fourth field
    // of the layer tuple constant, a mention-only file collapses to one row per document as a
    // THEOREM.
    //
    // So "print the entries figure only when it differs" is silent on those files because of an
    // undocumented property of the extractor. If MENTIONS ever gains line numbers — plausible,
    // since LINKS_TO already has them — the field wakes up on sixteen files at once and nothing
    // in the code says why.
    //
    // This is that dependency made executable: give two MENTIONS edges DIFFERENT lines and the
    // figure must appear. A correct design resting on an undeclared invariant is the same shape
    // as a guard that passes because its input is missing.
    await repoWithAuthoredLink();
    const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
    db.run("DELETE FROM edges WHERE relation = 'LINKS_TO'");
    plant(db, 'd-mention', 's1', 'MENTIONS', 11);
    plant(db, 'd-mention', 's3', 'MENTIONS', 22);   // same doc, DIFFERENT lines -> no collapse
    db.close();

    const out = JSON.parse(await graphPull({ repoRoot: repo, node: 'src/terrain.js' }));
    const b = out.docs_not_shown_breakdown;
    expect(b.documents, 'one document').toBe(1);
    expect(b.references, 'two rows, because the lines differ').toBe(2);
    expect(out.docs_not_shown, 'the figure must surface the moment the invariant stops holding')
      .toMatch(/giving 2 entries/);
  }, 60_000);

  it('★★★ the disclosed count and the docs layer do not contradict each other', async () => {
    // ⛔ THE SECOND DEFECT, and the worse one: docEdgeCountForFile counted DISTINCT DOCUMENTS
    // while the docs layer returns DISTINCT edge ROWS, and both surfaced as `total`. Measured on
    // the real repo: packet.js disclosed 13, the layer returned 18. An agent told "13 documents",
    // who then passes layers:["docs"] EXACTLY AS THE SENTENCE INSTRUCTS, is handed 18 under a
    // field also called total. The instruction walked the reader into the contradiction.
    await repoWithAuthoredLink();
    const db = openDb(join(repo, '.aify-graph', 'graph.sqlite'));
    // ⛔ MY FIRST VERSION OF THIS TEST WAS IMPOSSIBLE, and the schema said so:
    //   UNIQUE constraint failed: edges.from_id, edges.to_id, edges.relation
    // I had assumed one document linking to a file on three lines meant three rows. It cannot:
    // that tuple is UNIQUE, so it is ONE edge. My mental model of the divergence was wrong and
    // the database corrected it — the rows/documents gap comes from a document touching several
    // SYMBOLS in the same file, each a distinct `to_id`, all matching `s.file_path = $p`.
    plant(db, 'd-both', 's1', 'MENTIONS', 0);
    plant(db, 'd-both', 's3', 'MENTIONS', 0);   // 2 symbols in ONE file -> 2 rows, 1 document
    db.close();

    const bare = JSON.parse(await graphPull({ repoRoot: repo, node: 'src/terrain.js' }));
    const withDocs = JSON.parse(await graphPull({
      repoRoot: repo, node: 'src/terrain.js', layers: ['docs'],
    }));
    const b = bare.docs_not_shown_breakdown;
    expect(b.documents, 'd1 (links) and d-both (mentions two symbols)').toBe(2);
    // ⚠ TWO, NOT THREE — and my expectation of 3 was the third wrong model in this one test.
    // The layer's SELECT DISTINCT omits the target symbol, so d-both's two MENTIONS (to different
    // symbols, both on line 0) collapse into ONE row. One link row + one collapsed mention row.
    // The number the disclosure promises is the number the layer hands back, which is the only
    // property that matters here.
    expect(b.references, 'what the layer will actually return').toBe(2);
    expect(withDocs.layers.docs.total,
      'the layer counts REFERENCES, and the disclosure must have said so')
      .toBe(b.references);
    expect(bare.docs_not_shown, 'both numbers named, so following the instruction cannot surprise')
      .toMatch(/2 document\(s\)/);
  }, 60_000);
});

describe('assessCoverage — the receipt learns that unconsulted is not untruncated', () => {
  it('★★★ a declared source that was never consulted refuses the exhaustive claim', () => {
    const c = assessCoverage({ declared: ['MENTIONS', 'LINKS_TO'], consulted: ['MENTIONS'] });
    expect(c.proven).toBe(false);
    expect(c.unconsulted).toEqual(['LINKS_TO']);
  });

  it('★★★ consulting everything declared proves coverage', () => {
    // Negative control. Without it, a function that always refused would pass the test above and
    // make every receipt permanently non-exhaustive — which is the reflexive-pessimism failure
    // this file already names: a doubt that is always present carries no information.
    expect(assessCoverage({ declared: ['MENTIONS', 'LINKS_TO'], consulted: ['LINKS_TO', 'MENTIONS'] }).proven)
      .toBe(true);
  });

  it('★★★ buildReceipt REFUSES exhaustive when a declared source went unconsulted', async () => {
    // The mechanism where it matters. `assessTruncation` would pass this receipt without
    // complaint — no list is truncated, every truncation state is known — and the claim would
    // still be false, because one of the sources the claim depends on was never queried.
    const { buildReceipt } = await import('../../../mcp/stdio/query/receipt.js');
    const r = buildReceipt({
      verb: 'graph_pull',
      args: { node: 'x.js' },
      claims: [],
      floor: {
        exhaustive: true,
        sources: [['docs', { items: [], truncated: false }]],
        coverage: { declared: ['MENTIONS', 'LINKS_TO'], consulted: ['MENTIONS'] },
      },
    });
    expect(r.floor.exhaustive, 'an unasked source cannot support a completeness claim').toBe(false);
    expect(r.floor.downgraded_from_declared_exhaustive).toBe(true);
    expect(r.floor.cause, 'the reader must learn WHICH question went unasked').toMatch(/LINKS_TO/);
    expect(r.floor.cause).toMatch(/NEVER CONSULTED/);
  });

  it('★★★ ...and still grants exhaustive when coverage IS proven', () => {
    // Negative control at the receipt level. Without it the coverage gate could refuse
    // unconditionally and every test above would pass while `exhaustive` became a dead field.
    // A completeness flag that is never true is as uninformative as one that is always true.
    return import('../../../mcp/stdio/query/receipt.js').then(({ buildReceipt }) => {
      const r = buildReceipt({
        verb: 'graph_pull',
        args: { node: 'x.js' },
        claims: [],
        floor: {
          exhaustive: true,
          sources: [['docs', { items: [], truncated: false }]],
          coverage: { declared: ['MENTIONS', 'LINKS_TO'], consulted: ['MENTIONS', 'LINKS_TO'] },
        },
      });
      expect(r.floor.exhaustive).toBe(true);
      expect(r.floor.downgraded_from_declared_exhaustive).toBeUndefined();
    });
  });

  it('★★★ nothing declared proves nothing — and does not silently pass as complete', () => {
    // An empty declaration is vacuously proven, which is correct ONLY because a caller that
    // declares no sources is making no coverage claim. The guard against that is the caller
    // deriving `declared` from the GRAPH rather than from its own constant.
    expect(assessCoverage({}).proven).toBe(true);
    expect(assessCoverage({ declared: [], consulted: [] }).unconsulted).toEqual([]);
  });
});
