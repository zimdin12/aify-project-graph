// PHASE 1 SLICE 1 — A DOC EDGE THAT CAN EXPLAIN WHY IT EXISTS.
//
// ⛔ THE LEGACY EXTRACTOR ADMITTED EVERY WORD COLLISION. `analysis/mentions.js` took every
// `\b[A-Za-z_]\w{3,}\b` token in a document, looked it up in a symbol map built FIRST-WINS over
// duplicate labels, and wrote an edge with `source_line` hardcoded to 0. Measured on this repo:
// ~2,370 doc edges, 83.5% of them pointing at an all-lowercase-word target — `files` (60),
// `file` (58), `repo` (56), `tests` (53), `read` (52). The document contained the WORD; we
// recorded an edge to the FUNCTION.
//
// ⚠ 83.5% IS A TRIAGE PROXY, NOT A CORRECTNESS LABEL — a doc can genuinely refer to `read()`.
// What is established from source is that the ADMISSION RULE required no reference evidence.
//
// ⭐ AND the field test RAN IT ON A SECOND REPO: 63.1% on echoes, twenty points apart, same
// extractor. The rate tracks the LANGUAGE'S NAMING CONVENTION — JavaScript names functions
// `exists`, `count`, `read` and collides with English head-on, while C++ CamelCase survives it.
// So no global threshold and no hand-tuned stop-word list can be right on both repos. This slice
// uses neither.
//
// the reviewer's invariant, which this implements:
//   > A stored doc edge must carry a recoverable source span and a deterministic resolution path
//   > to exactly one node.
//
// Rule 1 of four, and the highest-value one: an explicit Markdown link or path-shaped inline code
// resolving to a file that is actually indexed. It emits Document→File `LINKS_TO`, NOT a symbol
// `MENTIONS` — dev was explicit that these are different relations with different authority, and
// this is the one that answers "where is the design doc".
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { detectDocLinks } from '../../../mcp/stdio/analysis/doc-links.js';

let repo;
afterEach(async () => {
  if (repo) { try { await rm(repo, { recursive: true, force: true }); } catch { /* win lock */ } }
  repo = undefined;
});

// A repo with two indexed files, one document, and whatever body the case needs.
async function fixture(docBody, extraNodes = []) {
  repo = await mkdtemp(join(tmpdir(), 'apg-links-'));
  await mkdir(join(repo, 'docs'), { recursive: true });
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'docs', 'design.md'), docBody);
  await writeFile(join(repo, 'src', 'terrain.js'), 'export function generateTerrain(){}\n');
  const db = openDb(join(repo, 'graph.sqlite'));
  const add = (id, type, label, file) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ('${id}','${type}','${label}','${file}',1,1,'javascript',1,'{}')`);
  // ⛔ THE FIRST VERSION OF THIS FIXTURE LIED ABOUT THE GRAPH, and every test passed anyway.
  // It only ever created `File` nodes. In a real index EVERY `.md` path is a `Document` node and
  // never a `File` node — so the module resolved 0 of 68 authored Markdown links on this repo
  // while this suite was fully green. A fixture that is easier to satisfy than production is not
  // a test of production. These rows now mirror what the indexer actually writes.
  add('d1', 'Document', 'design.md', 'docs/design.md');
  add('d2', 'Document', 'architecture.md', 'docs/architecture.md');
  add('f1', 'File', 'terrain.js', 'src/terrain.js');
  add('f2', 'File', 'mesh.js', 'src/mesh.js');
  add('c1', 'Config', 'tsconfig.json', 'tsconfig.json');
  add('s1', 'Function', 'generateTerrain', 'src/terrain.js');
  for (const [id, type, label, file] of extraNodes) add(id, type, label, file);
  return db;
}

const links = (db) => db.all(
  `SELECT e.*, t.file_path AS target FROM edges e JOIN nodes t ON t.id = e.to_id
   WHERE e.relation = 'LINKS_TO'`);

describe('doc → file links', () => {
  it('★★★ a Markdown link to an indexed file becomes one LINKS_TO edge', async () => {
    const db = await fixture('See [the terrain module](../src/terrain.js) for details.\n');
    await detectDocLinks(db, repo);
    const rows = links(db);
    expect(rows.length).toBe(1);
    expect(rows[0].target).toBe('src/terrain.js');
    db.close();
  }, 20_000);

  it('★★★ the edge carries a REAL source line, not 0', async () => {
    // The legacy extractor wrote line 0 for every edge, so no claim it made could be checked
    // against the document. A span you cannot return to is not evidence.
    const db = await fixture('# Title\n\nintro\n\nSee [terrain](src/terrain.js).\n');
    await detectDocLinks(db, repo);
    expect(links(db)[0].source_line, 'the line the link is actually on').toBe(5);
    db.close();
  }, 20_000);

  it('★★★ path-shaped inline code counts as a link', async () => {
    const db = await fixture('The entry point is `src/terrain.js` today.\n');
    await detectDocLinks(db, repo);
    expect(links(db).map((r) => r.target)).toEqual(['src/terrain.js']);
    db.close();
  }, 20_000);

  it('★★★ a link to a file that is NOT indexed emits nothing', async () => {
    // "Resolves to exactly one node" is the invariant. A path we cannot resolve is not a
    // deterministic resolution — it is a guess with a slash in it.
    const db = await fixture('See [gone](src/deleted-yesterday.js).\n');
    await detectDocLinks(db, repo);
    expect(links(db)).toEqual([]);
    db.close();
  }, 20_000);

  it('★★★ an external URL is not a repository edge — and is not counted as a MISS', async () => {
    // ⛔ THE FIRST VERSION OF THIS TEST PASSED FOR THE WRONG REASON. A mutation battery deleted
    // the external-scheme check and all twelve tests stayed green: a URL was already refused by
    // the tier-2 slash guard and by PATH_CHARS rejecting `:`. The guard was unreachable, so the
    // assertion "no edge" could never distinguish a module that checks from one that does not.
    //
    // What DOES distinguish them is the counter. A link out to the web is not a coverage gap and
    // never becomes one; a repo-shaped path we failed to resolve is. Folding both into one number
    // hides real misses inside expected noise, so the two outcomes are reported separately and
    // this test is what holds them apart.
    const db = await fixture('See [the spec](https://example.com/src/terrain.js).\n');
    const stats = await detectDocLinks(db, repo);
    expect(links(db)).toEqual([]);
    expect(stats.external, 'deliberately outside the repo').toBe(1);
    expect(stats.noSuchPath, 'a URL is not a failed lookup').toBe(0);
    db.close();
  }, 20_000);

  it('★★★ a repo-shaped path we cannot resolve IS counted as a miss', async () => {
    // The other side of the same split. This is the number that should drive work.
    const db = await fixture('See [gone](src/deleted-yesterday.js).\n');
    const stats = await detectDocLinks(db, repo);
    expect(stats.noSuchPath).toBe(1);
    expect(stats.external).toBe(0);
    db.close();
  }, 20_000);

  it('★★★ path-shaped PROSE is not counted as a coverage gap', async () => {
    // ⛔ MY OWN COUNTER REPRODUCED THE DEFECT IT WAS BUILT TO FIX. Having split `external` out of
    // `unresolved` because one number covering two causes can only be read as the wrong one, I
    // measured the result on the real graph: of 1178 misses, 262 were tokens like `tools/call`
    // and `npm run build` — path-SHAPED prose that was never a claim about a file. Counting those
    // as a gap inflates the gap and buries the real misses inside it. Same defect, other
    // direction, found only because the number was measured instead of assumed.
    const db = await fixture('Call the `tools/call` endpoint, then run `npm run build`.\n');
    const stats = await detectDocLinks(db, repo);
    expect(stats.noSuchPath, 'neither token claims a file exists').toBe(0);
    expect(stats.notAFileReference).toBeGreaterThan(0);
    db.close();
  }, 20_000);

  it('★★★ a span that names NO path segment resolves to nothing — the slash bug', async () => {
    // ⛔ FIELD-FOUND BY the field test ON THE REAL GRAPH, and my shape test was innocent of it.
    // `.` and `..` were explicitly rejected — and that guard turns out to be dead, because
    // neither has an extension or a separator so neither was ever a candidate. The span that got
    // through is `` `/` ``: it IS path-shaped (it contains a separator), it normalises to
    // nothing, and then the document-relative anchoring joins nothing onto the document's own
    // directory. So `docs/x.md` writing `` `/` `` produced an edge to `docs`.
    //
    // ⚠ THE REASON THIS MATTERS MORE THAN THREE BAD EDGES: the false positives concentrate in
    // documents ABOUT path handling, because those are the documents that write `/` and `./` in
    // inline code while discussing syntax. the field test: "any repo doing import or path work will
    // hit it, and yours is the worst case." An error rate that tracks what the project is about
    // cannot be estimated from a sample of that project.
    const db = await fixture('Paths use `/` separators, no leading `/`, no `.` or `..`.\n');
    await detectDocLinks(db, repo);
    expect(links(db), 'a separator is not a reference to the directory you are standing in')
      .toEqual([]);
    db.close();
  }, 20_000);

  it('★★★ ...and every no-segment spelling refuses, not just the one that was reported', async () => {
    // One reported spelling is one spelling. The rule is "no segment that is not empty, . or ..",
    // which is a property of the span rather than a list of strings somebody noticed.
    for (const span of ['/', '//', './', '../', '.', '..', '/./']) {
      const db = await fixture(`Syntax note: \`${span}\` is special.\n`);
      await detectDocLinks(db, repo);
      expect(links(db), `\`${span}\` must not resolve`).toEqual([]);
      db.close();
    }
  }, 60_000);

  it('★★★ a REAL relative path still resolves — the guard must not eat `../`', async () => {
    // Negative control for the rule above. `../src/terrain.js` begins with the same segments the
    // guard rejects; refusing it would trade a false-positive class for a false-negative one.
    const db = await fixture('See [terrain](../src/terrain.js).\n');
    await detectDocLinks(db, repo);
    expect(links(db).map((r) => r.target)).toEqual(['src/terrain.js']);
    db.close();
  }, 20_000);

  it('★★★ a fenced path is COUNTED, not silently dropped', async () => {
    // ⚠ the field test: "a fenced path is invisible in every counter you have — it is neither an edge
    // nor a miss." Fence exclusion is deliberate and correct (a mocked output block shows a
    // shape, it does not make a reference), but a category that exists in the code and not in the
    // accounting is how a denominator goes wrong quietly.
    //
    // Its own bucket rather than folded into `notAFileReference`, because "the author wrote a
    // path inside an example block" and "the author wrote prose that looked like a path" are
    // different facts about the document.
    const db = await fixture('Example:\n\n```md\nSee [terrain](src/terrain.js) and `src/mesh.js`.\n```\n');
    const stats = await detectDocLinks(db, repo);
    expect(links(db), 'still no edge — the exclusion itself is unchanged').toEqual([]);
    expect(stats.fencedExample, 'but it appears in the ledger now').toBeGreaterThan(0);
    expect(stats.notAFileReference, 'and NOT under the prose bucket').toBe(0);
    db.close();
  }, 20_000);

  it('★★★ the stats name how many DOCUMENTS produced an edge, not just how many edges', async () => {
    // the field test's denominator point: "83% of documents link out" and "39% of the repo's markdown
    // is reachable" describe the same system and imply different next actions. The per-document
    // reach is the figure that answers "will this find the doc I forgot", so it is emitted
    // rather than left to be recomputed by whoever quotes the edge count.
    const db = await fixture('See [terrain](../src/terrain.js) and [mesh](../src/mesh.js).\n');
    const stats = await detectDocLinks(db, repo);
    expect(stats.added, 'two edges').toBe(2);
    expect(stats.documentsWithLinks, 'from ONE document').toBe(1);
    expect(stats.documents, 'out of two admitted documents').toBe(2);
    db.close();
  }, 20_000);

  it('★★★ the admitted TARGET TYPES are pinned — the contract said "file", the code said five', async () => {
    // ⛔ the field test measured the 480 real edges by target type: File 303, Document 80, Config 64,
    // Directory 31, Entrypoint 2. The module described itself as resolving "to exactly one indexed
    // FILE", so 6.5% of edges broke a promise nobody had noticed making — a consumer told
    // Document→File and handed a Directory gets a different kind of answer than the contract says.
    //
    // Directories stay in: `docs/THE-GOAL.md` writing `` `docs/` `` means the directory. It was
    // the DESCRIPTION that was wrong. Pinning the set here makes a future widening a reviewed
    // event rather than something the field tester discovers for us.
    const { FILE_LEVEL_TYPES } = await import('../../../mcp/stdio/analysis/doc-links.js');
    expect([...FILE_LEVEL_TYPES]).toEqual(['File', 'Document', 'Config', 'Entrypoint', 'Directory']);
    db_check: {
      const db = await fixture('The specs live in `docs/` and config in [tsconfig](../tsconfig.json).\n', [
        ['dir1', 'Directory', 'docs', 'docs'],
      ]);
      await detectDocLinks(db, repo);
      const targets = db.all(
        `SELECT t.type AS type FROM edges e JOIN nodes t ON t.id = e.to_id
         WHERE e.relation = 'LINKS_TO' ORDER BY t.type`).map((r) => r.type);
      expect(targets, 'a directory reference is an authored pointer and resolves')
        .toEqual(['Config', 'Directory']);
      db.close();
    }
  }, 30_000);

  it('★★★ every miss is RECORDED, not just counted', async () => {
    // ⛔ the field test, blocked: "I could not falsify the split between the two miss buckets, because
    // the manifest stores counts and not the misses themselves — I can see how many landed in
    // each, never which."
    //
    // A count is unfalsifiable from outside. 707 `noSuchPath` on this repo could be 707 genuine
    // stale references or 707 mis-bucketed prose tokens and the number reads identically. The
    // ledger is what makes the categories gradeable by someone who is not me.
    const db = await fixture([
      'See [gone](src/deleted-yesterday.js).',           // noSuchPath
      'Call the `tools/call` endpoint.',                  // notAFileReference
      'Spec at [x](https://example.com/a.js).',           // external
      '',
      '```md',
      'See [ex](src/terrain.js).',                        // fencedExample
      '```',
      '',
    ].join('\n'));
    const stats = await detectDocLinks(db, repo);

    const buckets = stats.misses.map((m) => m.bucket).sort();
    expect(buckets).toEqual(['external', 'fenced_example', 'no_such_path', 'not_a_file_reference']);

    const gone = stats.misses.find((m) => m.bucket === 'no_such_path');
    expect(gone.written, 'the span exactly as the author wrote it').toBe('src/deleted-yesterday.js');
    expect(gone.doc).toBe('docs/design.md');
    expect(gone.line, 'a line the grader can open the document to').toBe(1);
    expect(gone.rule).toBe('doc_link:markdown');
    db.close();
  }, 20_000);

  it('★★★ the COUNTS and the RECORDS cannot disagree', async () => {
    // ⚠ THE POINT OF SHIPPING BOTH. If the counters were incremented independently of the ledger
    // they could drift, and a grader auditing 30 sampled records would be certifying a number
    // those records do not add up to — a receipt for the wrong claim. They are derived from one
    // pass over one list, and this is what holds them to it.
    const db = await fixture([
      'See [a](src/gone-1.js) and [b](src/gone-2.js).',
      'Run `npm run build` then `tools/call`.',
      'Spec [s](https://example.com/x.js).',
    ].join('\n'));
    const stats = await detectDocLinks(db, repo);
    const tally = (b) => stats.misses.filter((m) => m.bucket === b).length;
    expect(tally('no_such_path')).toBe(stats.noSuchPath);
    expect(tally('not_a_file_reference')).toBe(stats.notAFileReference);
    expect(tally('external')).toBe(stats.external);
    expect(tally('fenced_example')).toBe(stats.fencedExample);
    expect(stats.misses.length, 'no miss belongs to no bucket')
      .toBe(stats.noSuchPath + stats.notAFileReference + stats.external + stats.fencedExample);
    db.close();
  }, 20_000);

  it('★★★ a doc→DOC link resolves — the case the real graph could not do', async () => {
    // ⭐ THE HIGHEST-VALUE EDGE IN THE WHOLE FEATURE, and the first implementation could not
    // produce a single one. Documents are `Document` nodes, never `File` nodes, and the index
    // covered `type = 'File'` only — so every one of the 252 doc→doc references on this repo was
    // recorded as a MISS. "This decision came from that doc" is precisely what Steven asked for
    // and precisely what was structurally impossible, under a green test suite.
    const db = await fixture('Background is in [architecture](./architecture.md).\n');
    await detectDocLinks(db, repo);
    expect(links(db).map((r) => r.target)).toEqual(['docs/architecture.md']);
    db.close();
  }, 20_000);

  it('★★★ a link to a CONFIG file resolves', async () => {
    // Same class as the doc→doc hole: config files are `Config` nodes. Docs point at them
    // constantly (`.claude-plugin/plugin.json`, `tsconfig.json`) and every one was a miss.
    const db = await fixture('Compiler options live in [tsconfig](../tsconfig.json).\n');
    await detectDocLinks(db, repo);
    expect(links(db).map((r) => r.target)).toEqual(['tsconfig.json']);
    db.close();
  }, 20_000);

  it('★★★ overlapping file-level types resolve by DECLARED precedence, not row order', async () => {
    // Six paths in this repo carry both `Entrypoint` and `File`. A map keeping whatever it saw
    // first would resolve those by SQLite row order — the legacy first-wins bug, one level up,
    // and invisible because both ids are plausible. `File` is the canonical whole-file node.
    // The Entrypoint row is inserted FIRST so row order and precedence disagree.
    const db = await fixture('See [entry](../bin/apg.js).\n', [
      ['e1', 'Entrypoint', 'apg.js', 'bin/apg.js'],
      ['f9', 'File', 'apg.js', 'bin/apg.js'],
    ]);
    await detectDocLinks(db, repo);
    const rows = links(db);
    expect(rows.length).toBe(1);
    expect(rows[0].to_id, 'the File node, not whichever row came back first').toBe('f9');
    db.close();
  }, 20_000);

  it('★★★ two anchorings landing on DIFFERENT files is a refusal, not a preference', async () => {
    // `src/terrain.js` written inside `docs/` is genuinely ambiguous: repo-root-relative it means
    // src/terrain.js, document-relative it means docs/src/terrain.js, and both exist. There is no
    // fact in the document that decides it. Preferring either anchoring would be a house rule
    // presented as a resolution — the same move as the legacy first-wins map, one level up.
    const db = await fixture('See [terrain](src/terrain.js).\n', [
      ['f5', 'File', 'terrain.js', 'docs/src/terrain.js'],
    ]);
    await detectDocLinks(db, repo);
    expect(links(db)).toEqual([]);
    db.close();
  }, 20_000);

  it('★★★ a bare prose word that matches a symbol emits NOTHING', async () => {
    // The whole point. dev: "uniqueness says only one target exists; it does not prove the
    // author referred to it." This document says the English word and names no path.
    const db = await fixture('We read the files and count the tests in this repo.\n', [
      ['s2', 'Function', 'read', 'src/terrain.js'],
      ['s3', 'Function', 'count', 'src/terrain.js'],
      ['s4', 'Function', 'files', 'src/terrain.js'],
    ]);
    await detectDocLinks(db, repo);
    expect(links(db), 'prose collisions are what this rebuild deletes').toEqual([]);
    db.close();
  }, 20_000);

  it('★★★ an AMBIGUOUS path emits nothing rather than picking the first', async () => {
    // The legacy map was `if (!symbolMap.has(label))` — first wins. Two files whose paths both
    // end with the linked suffix cannot be told apart, and choosing one is inventing evidence.
    const db = await fixture('See [helper](helper.js).\n', [
      ['f3', 'File', 'helper.js', 'src/a/helper.js'],
      ['f4', 'File', 'helper.js', 'src/b/helper.js'],
    ]);
    await detectDocLinks(db, repo);
    expect(links(db)).toEqual([]);
    db.close();
  }, 20_000);

  it('★★★ every edge names the rule that admitted it', async () => {
    // dev: provenance must reach the reader. A reader must be able to weigh a link differently
    // from a bare-name match, which requires knowing which rule fired.
    const db = await fixture('See [terrain](src/terrain.js).\n');
    await detectDocLinks(db, repo);
    const e = links(db)[0];
    expect(e.extractor).toMatch(/^doc_link:/);
    expect(e.provenance, 'the occurrence is observed; the resolution is inferred').toBe('INFERRED');
    db.close();
  }, 20_000);

  it('★★★ a WRITTEN DIRECTORY that does not exist is not resolved by basename', async () => {
    // ⚠ `mesh.js` is indexed exactly once, so a basename match would resolve uniquely — and would
    // be wrong, because the author wrote `other/dir/`, which is not where the file is. Uniqueness
    // is not permission to ignore the part of the path the author actually typed. Tier 2 exists
    // for bare names like `[helper](helper.js)`, not for paths whose directory failed to match.
    const db = await fixture('See [mesh](other/dir/mesh.js).\n');
    await detectDocLinks(db, repo);
    expect(links(db)).toEqual([]);
    db.close();
  }, 20_000);

  it('★★★ a bare FILENAME in prose, unmarked, emits nothing', async () => {
    // ⚠ The sharper version of the prose case. `terrain.js` is a real indexed file and the token
    // is exact — uniqueness holds, and it still is not evidence, because the author marked
    // nothing. If this ever goes green-to-red, an admission rule has started reading prose again.
    const db = await fixture('The file terrain.js is where the mesh work happens.\n');
    await detectDocLinks(db, repo);
    expect(links(db)).toEqual([]);
    db.close();
  }, 20_000);

  it('★★★ a link inside a fenced code block is literal text, not a link', async () => {
    // Inside a fence the Markdown link grammar does not apply, so parsing it there would be
    // reading a grammar the author was not writing in.
    const db = await fixture('Example:\n\n```md\nSee [terrain](src/terrain.js).\n```\n');
    await detectDocLinks(db, repo);
    expect(links(db)).toEqual([]);
    db.close();
  }, 20_000);

  it('★★★ re-running does not duplicate', async () => {
    const db = await fixture('See [terrain](src/terrain.js).\n');
    await detectDocLinks(db, repo);
    await detectDocLinks(db, repo);
    expect(links(db).length).toBe(1);
    db.close();
  }, 20_000);

  it('★★★ a RETIRED rule’s edges do not survive the rebuild', async () => {
    // ⛔ THE NO-DUPLICATE TEST ABOVE DOES NOT TEST THIS, and a mutation battery proved it: deleting
    // the purge entirely left every test green, because `INSERT OR IGNORE` plus the unique index
    // already collapses a re-insert. What that test actually pins is the index.
    //
    // dev's point was the opposite case, which nothing was checking: an edge written by a rule
    // that no longer exists is never re-inserted and never removed, so it outlives its own
    // admission rule forever. Tightening the extractor cannot claw back what the loose version
    // already stored. An extractor owns its tag and clears it before writing.
    const db = await fixture('See [terrain](src/terrain.js).\n');
    const plant = (to, relation, extractor) => db.run(
      `INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
       VALUES ('d1','${to}','${relation}','docs/design.md',1,0.6,'INFERRED','${extractor}')`);
    plant('f2', 'LINKS_TO', 'doc_link:retired-rule');   // what a loosened rule once admitted
    plant('s1', 'MENTIONS', 'mentions');                // another extractor's edge — not ours

    await detectDocLinks(db, repo);

    expect(links(db).map((r) => r.target), 'the retired rule’s edge is gone')
      .toEqual(['src/terrain.js']);
    // ⚠ AND THE PURGE STAYS INSIDE ITS OWN TAG. A rebuild that cleaned the table rather than its
    // own contribution would trade one silent corruption for a louder one.
    expect(db.all("SELECT 1 FROM edges WHERE extractor = 'mentions'").length,
      'another extractor’s edges are none of our business').toBe(1);
    db.close();
  }, 20_000);
});

// TIER 3 — A UNIQUE PATH SUFFIX. NOT THE DELETED TIER UNDER A NEW NAME.
//
// ⛔ Tier 2 resolved a BARE BASENAME. `compile_commands.json` names a KIND of file, and in 35 of
// its 120 edges it meant the READER'S build artifact while resolving to our test fixture. It
// graded 0.708 and was deleted.
//
// ⭐ A PARTIAL PATH IS DIFFERENT IN KIND, NOT DEGREE. `code-intel/coverage.js` carries DIRECTORY
// CONTEXT — the author wrote where the file sits, not just what it is called — and that context is
// exactly what the basename lacked. Same relationship as rule 2 to rule 3 in the symbol layer: a
// qualifier is evidence, an unqualified name is not.
//
// MEASURED over this corpus before the tier was written:
//   exact 674 · partial UNIQUE 66 · partial AMBIGUOUS 12 · bare basename 1484 (the deleted tier)
//
// A/B on the real corpus, tier 3 on vs off:
//   LINKS_TO            471 -> 533
//   rule-4 MENTIONS      19 ->  32   (a partial path could not scope a line before)
//   -> compile_commands.json  1 ->  1   <- THE CONTROL: the FP class is not reintroduced
describe('tier 3 resolves a unique path suffix, on segment boundaries only', () => {
  async function repoWithNestedFile() {
    const repo = await mkdtemp(join(tmpdir(), 'apg-suffix-'));
    await mkdir(join(repo, 'docs'), { recursive: true });
    await writeFile(join(repo, 'docs', 'design.md'),
      'See `code-intel/coverage.js` and `intel/coverage.js` and `helper.js`.\n');
    const db = openDb(join(repo, 'graph.sqlite'));
    const add = (id, type, label, file) => db.run(
      `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
       VALUES ('${id}','${type}','${label}','${file}',1,1,'js_ts',1,'{}')`);
    add('d1', 'Document', 'design.md', 'docs/design.md');
    add('f1', 'File', 'coverage.js', 'mcp/stdio/code-intel/coverage.js');
    add('f2', 'File', 'helper.js', 'src/deep/nested/helper.js');
    return { repo, db };
  }

  it('★★★ a multi-segment suffix resolves to the one path that ends with it', async () => {
    const { repo, db } = await repoWithNestedFile();
    await detectDocLinks(db, repo);
    const rows = db.all(
      `SELECT e.extractor, t.file_path FROM edges e JOIN nodes t ON t.id = e.to_id
       WHERE e.relation = 'LINKS_TO'`);
    const cov = rows.find((r) => r.file_path === 'mcp/stdio/code-intel/coverage.js');
    expect(cov, '`code-intel/coverage.js` must resolve').toBeTruthy();
    expect(cov.extractor, 'tagged as its own tier, not as an exact path')
      .toBe('doc_link:path-suffix');
    db.close();
    await rm(repo, { recursive: true, force: true });
  }, 20_000);

  it('★★★ a SUBSTRING that is not a segment boundary does NOT resolve', async () => {
    // ⛔ `intel/coverage.js` is a substring of `code-intel/coverage.js` and is NOT a path suffix.
    // Matching it would resolve a path the author did not write — the whole difference between a
    // suffix match and a `LIKE '%...%'`. Both spans are on the same line, so a rule that resolved
    // either would resolve both, and the fixture would not be able to tell them apart.
    const { repo, db } = await repoWithNestedFile();
    await detectDocLinks(db, repo);
    const edges = db.all(
      `SELECT COUNT(*) c FROM edges e JOIN nodes t ON t.id = e.to_id
       WHERE e.relation = 'LINKS_TO' AND t.file_path = 'mcp/stdio/code-intel/coverage.js'`)[0].c;
    expect(edges, 'exactly one edge — from the real suffix, not from the substring too').toBe(1);
    db.close();
    await rm(repo, { recursive: true, force: true });
  }, 20_000);

  it('★★★ a BARE basename still does not resolve — the deleted tier stays deleted', async () => {
    // The regression guard on the 0.708 rule. `helper.js` is unique in this graph and would have
    // resolved under tier 2. Tier 3 requires a slash, so it does not, and adding a suffix tier must
    // not quietly restore the tier that was graded out.
    const { repo, db } = await repoWithNestedFile();
    await detectDocLinks(db, repo);
    const edges = db.all(
      `SELECT COUNT(*) c FROM edges e JOIN nodes t ON t.id = e.to_id
       WHERE e.relation = 'LINKS_TO' AND t.file_path = 'src/deep/nested/helper.js'`)[0].c;
    expect(edges, 'a bare name carries no directory context and stays unresolved').toBe(0);
    db.close();
    await rm(repo, { recursive: true, force: true });
  }, 20_000);

  it('★★★ an AMBIGUOUS suffix resolves to nothing rather than picking one', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'apg-suffix-amb-'));
    await mkdir(join(repo, 'docs'), { recursive: true });
    await writeFile(join(repo, 'docs', 'design.md'), 'See `skill/SKILL.md`.\n');
    const db = openDb(join(repo, 'graph.sqlite'));
    const add = (id, type, label, file) => db.run(
      `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
       VALUES ('${id}','${type}','${label}','${file}',1,1,'md',1,'{}')`);
    add('d1', 'Document', 'design.md', 'docs/design.md');
    add('a1', 'Document', 'SKILL.md', 'integrations/claude-code/skill/SKILL.md');
    add('a2', 'Document', 'SKILL.md', 'integrations/codex/skill/SKILL.md');
    await detectDocLinks(db, repo);
    expect(db.all("SELECT COUNT(*) c FROM edges WHERE relation = 'LINKS_TO'")[0].c,
      'two candidates is not one candidate').toBe(0);
    db.close();
    await rm(repo, { recursive: true, force: true });
  }, 20_000);
});
