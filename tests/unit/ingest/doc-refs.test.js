// PHASE 1 RULE 2 — A DOC→SYMBOL EDGE THAT CAN NAME ITS EVIDENCE.
//
// ⛔ WHAT THIS REPLACES. `analysis/mentions.js` admitted an edge for every `\b[A-Za-z_]\w{3,}\b`
// token equal to a symbol label, first-wins on duplicates, `source_line` hardcoded to 0. Measured
// on this repo right now: 2,533 edges, 100% with no line, 83.9% pointing at an all-lowercase
// English word — `files`, `file`, `repo`, `read`. The document contained the WORD; we recorded an
// edge to the FUNCTION.
//
// graph-senior-dev's ruling was DELETE AND REDERIVE: "remove every edge emitted by the legacy
// mentions extractor from the consumable graph and rebuild under a new extractor version." Their
// invariant: a stored doc edge must carry a recoverable source span and a deterministic resolution
// path to exactly one node.
//
// ★ RULE 2 IS TWO PIECES OF EVIDENCE, NOT ONE. dev was explicit that backticks alone are not
// sufficient — an author marks all sorts of things as code. So this admits a span only when it is
// BOTH marked as code by the author AND carries a qualifier (`::`, `.`, `->`). A qualifier is what
// distinguishes a reference to a program element from an English word that happens to collide with
// a symbol name, and the marking is what distinguishes a deliberate reference from prose.
//
// ⚠ NO STOPWORD LIST AND NO GLOBAL THRESHOLD, per dev. The legacy rate was 83.9% here and 63.1% on
// echoes for the same code, because it tracks the language's naming convention rather than the
// documents. A dictionary tuned on one repo is wrong on the other by construction.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { detectDocRefs, buildSymbolIndex, shapeOf } from '../../../mcp/stdio/analysis/doc-refs.js';

let repo;
afterEach(async () => {
  if (repo) { try { await rm(repo, { recursive: true, force: true }); } catch { /* win lock */ } }
  repo = undefined;
});

async function fixture(docBody, extraNodes = []) {
  repo = await mkdtemp(join(tmpdir(), 'apg-docrefs-'));
  await mkdir(join(repo, 'docs'), { recursive: true });
  await writeFile(join(repo, 'docs', 'design.md'), docBody);
  const db = openDb(join(repo, 'graph.sqlite'));
  const add = (id, type, label, file, extra = '{}') => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ('${id}','${type}','${label}','${file}',1,1,'cpp',1,'${extra}')`);
  add('d1', 'Document', 'design.md', 'docs/design.md');
  // A qualified method: qname carries the owner, which is what makes the reference resolvable.
  add('m1', 'Method', 'generate', 'src/terrain.cpp', '{"qname":"Terrain.generate"}');
  // A bare function whose NAME is an ordinary English word — the legacy extractor's favourite.
  add('f1', 'Function', 'read', 'src/io.cpp');
  for (const [id, type, label, file, extra] of extraNodes) add(id, type, label, file, extra);
  return db;
}

const refs = (db) => db.all(
  `SELECT e.*, t.label AS target FROM edges e JOIN nodes t ON t.id = e.to_id
   WHERE e.relation = 'MENTIONS'`);

describe('doc → symbol references, rule 2 (qualified + marked)', () => {
  it('★★★ a qualified reference in inline code resolves to exactly one symbol', async () => {
    const db = await fixture('The entry point is `Terrain::generate` today.\n');
    await detectDocRefs(db, repo);
    const rows = refs(db);
    expect(rows.length).toBe(1);
    expect(rows[0].target).toBe('generate');
    db.close();
  }, 20_000);

  it('★★★ the edge carries a REAL source line, not 0', async () => {
    // Every one of the 2,533 legacy edges had line 0, so no claim any of them made could be
    // checked against the document it came from. A span you cannot return to is not evidence.
    const db = await fixture('# T\n\nintro\n\nSee `Terrain::generate` for details.\n');
    await detectDocRefs(db, repo);
    expect(refs(db)[0].source_line, 'the line the reference is actually on').toBe(5);
    db.close();
  }, 20_000);

  it('★★★ dot and arrow qualifiers resolve the same way', async () => {
    for (const spelling of ['Terrain.generate', 'Terrain->generate']) {
      const db = await fixture(`Call \`${spelling}\` here.\n`);
      await detectDocRefs(db, repo);
      expect(refs(db).length, `${spelling} must resolve`).toBe(1);
      db.close();
    }
  }, 40_000);

  it('★★★ a BARE symbol name in inline code emits nothing — backticks are not enough', async () => {
    // ⛔ dev, explicitly: backticks alone are not sufficient evidence. An author marks all sorts of
    // things as code. Without a qualifier there is nothing distinguishing a reference to the
    // function `read` from the English word `read` typed in monospace.
    const db = await fixture('You should `read` the file first.\n');
    await detectDocRefs(db, repo);
    expect(refs(db), 'marked but unqualified is not a reference').toEqual([]);
    db.close();
  }, 20_000);

  it('★★★ a qualified reference in PROSE emits nothing — the marking is required too', async () => {
    // The other half of the two-evidence rule. Rule 2 needs both; either alone is the legacy
    // extractor with extra steps.
    const db = await fixture('We call Terrain::generate during startup.\n');
    await detectDocRefs(db, repo);
    expect(refs(db), 'unmarked prose is not a deliberate reference').toEqual([]);
    db.close();
  }, 20_000);

  it('★★★ an AMBIGUOUS qualified reference emits nothing rather than picking one', async () => {
    // The legacy map was first-wins over duplicate labels. Picking one of two is a coin toss
    // recorded as evidence.
    const db = await fixture('See `Mesh::build`.\n', [
      ['a1', 'Method', 'build', 'src/a.cpp', '{"qname":"Mesh.build"}'],
      ['a2', 'Method', 'build', 'src/b.cpp', '{"qname":"Mesh.build"}'],
    ]);
    await detectDocRefs(db, repo);
    expect(refs(db)).toEqual([]);
    db.close();
  }, 20_000);

  it('★★★ a qualified name that resolves to NOTHING emits nothing', async () => {
    const db = await fixture('See `Ghost::vanish`.\n');
    await detectDocRefs(db, repo);
    expect(refs(db)).toEqual([]);
    db.close();
  }, 20_000);

  it('★★★ a SLASHED path never reaches this rule at all', async () => {
    const db = await fixture('See `src/io.cpp` and `docs/design.md`.\n');
    await detectDocRefs(db, repo);
    expect(refs(db)).toEqual([]);
    db.close();
  }, 20_000);

  it('★★★ a path with NO slash is refused BY THE PATH GUARD, not by luck', async () => {
    // ⛔ THE PREVIOUS VERSION OF THIS TEST PROVED NOTHING. It used `src/io.cpp`, which the
    // qualified-chain pattern rejects on the slash long before the path guard runs — so deleting
    // the guard entirely left the suite green. A mutation battery caught it: MUT 6 SURVIVED.
    //
    // `README.md` is the case that actually needs the guard. It is a well-formed qualified chain
    // (`Ident.Ident`) AND a real indexed file, so without rule 1 getting first refusal the same
    // authored span could be claimed by both layers and double-counted by anyone adding them.
    const db = await fixture('See `README.md` for setup.\n', [
      ['r1', 'File', 'README.md', 'README.md', '{}'],
    ]);
    const stats = await detectDocRefs(db, repo);
    expect(refs(db), 'rule 1 owns this span').toEqual([]);
    expect(stats.misses.map((m) => m.bucket), 'and it is recorded as a path, not as a missing symbol')
      .toContain('is_a_path');
    db.close();
  }, 20_000);

  it('★★★ a marked span INSIDE a fence is not a reference', async () => {
    // ⛔ THE PREVIOUS VERSION OF THIS TEST PROVED NOTHING EITHER. It fenced a bare line of C++
    // with no backticks in it, so there was no inline-code span for the fence rule to exclude —
    // deleting the fence check left the suite green (MUT 1 SURVIVED). The case that needs the
    // check is a fence containing a backtick pair, which is exactly what a document explaining
    // markdown contains.
    const db = await fixture('Example:\n\n```md\nWrite `Terrain::generate` like this.\n```\n');
    const stats = await detectDocRefs(db, repo);
    expect(refs(db), 'a demonstration of a shape is not a reference').toEqual([]);
    expect(stats.misses.map((m) => m.bucket)).toContain('fenced_example');
    db.close();
  }, 20_000);

  it('★★★ a bare word is structurally unindexable — not merely guarded against', async () => {
    // ★ THE MUTATION BATTERY CHANGED WHAT I BELIEVED THIS RULE'S GUARD WAS DOING. Disabling the
    // `!ref.qualified` check does NOT admit `read` as an edge, because buildSymbolIndex only ever
    // creates keys of two segments or more. The guard's real job is keeping the miss ledger
    // honest; edge suppression is enforced one level down, by the index having no bare key to
    // find. That is the stronger arrangement — the bad state is unconstructible rather than
    // merely checked — but I had it backwards until a mutant survived and made me look.
    const index = buildSymbolIndex([
      { id: 'x', type: 'Method', extra: '{"qname":"a.b.Terrain.generate"}' },
    ]);
    expect(index.has('generate'), 'no bare key exists to resolve against').toBe(false);
    expect(index.has('Terrain.generate'), 'qualified suffixes do').toBe(true);
    expect(index.has('b.Terrain.generate')).toBe(true);
  });

  it('★★★ every edge names the rule that admitted it, and carries its confidence', async () => {
    const db = await fixture('See `Terrain::generate`.\n');
    await detectDocRefs(db, repo);
    const e = refs(db)[0];
    expect(e.extractor).toBe('doc_ref:qualified');
    expect(e.provenance).toBe('INFERRED');
    expect(e.confidence).toBeGreaterThan(0.8);
    db.close();
  }, 20_000);

  it('★★★ THE LEGACY EDGES ARE DELETED — delete and rederive, not add alongside', async () => {
    // ⛔ dev's ruling in full: "remove every edge emitted by the legacy mentions extractor from the
    // consumable graph and rebuild under a new extractor version." Leaving them would put
    // evidence-backed and word-collision edges under ONE relation, where no reader can weigh
    // either — the same defect as filing two mechanisms under one name.
    const db = await fixture('See `Terrain::generate`.\n');
    db.run(
      `INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
       VALUES ('d1','f1','MENTIONS','docs/design.md',0,0.6,'INFERRED','mentions')`);
    expect(refs(db).length, 'the legacy edge is planted').toBe(1);

    await detectDocRefs(db, repo);

    const rows = refs(db);
    expect(rows.length, 'one edge, and it is not the legacy one').toBe(1);
    expect(rows[0].extractor).toBe('doc_ref:qualified');
    expect(rows.some((r) => r.extractor === 'mentions'), 'no word-collision edge survives')
      .toBe(false);
    db.close();
  }, 20_000);

  it('★★★ ...and re-running does not duplicate', async () => {
    const db = await fixture('See `Terrain::generate`.\n');
    await detectDocRefs(db, repo);
    await detectDocRefs(db, repo);
    expect(refs(db).length).toBe(1);
    db.close();
  }, 20_000);

  it('★★★ the miss ledger records what it refused, and why', async () => {
    // Same contract as the doc-link ledger: a count nobody can open is unfalsifiable, and the
    // buckets must be gradeable by someone who did not write the rule.
    const db = await fixture([
      'Bare `read` here.',                    // unqualified
      'Prose Terrain::generate unmarked.',    // unmarked
      'Missing `Ghost::vanish`.',             // unresolved
    ].join('\n'));
    const stats = await detectDocRefs(db, repo);
    const buckets = stats.misses.map((m) => m.bucket).sort();
    expect(buckets).toContain('unqualified');
    expect(buckets).toContain('no_such_symbol');
    expect(stats.misses.every((m) => typeof m.line === 'number' && m.line > 0),
      'every miss is openable at a line').toBe(true);
    db.close();
  }, 20_000);
});

describe('miss buckets name the reason, not the rule that refused', () => {
  it('★★★ an AMBIGUOUS basename is not reported as an unindexed path', async () => {
    // ⛔ FOURTH LYING BUCKET, AND IT WAS INSIDE THE SPLIT BUILT TO STOP BUCKETS LYING.
    //
    // ef-manager graded `path_not_indexed = 228` on this repo: 28 of them were bare basenames
    // whose file IS in the graph at two or more paths — `server.js`, `render.js`, `extract.js`,
    // `schema.js`. rule 1 correctly refuses an ambiguous basename rather than picking one, but
    // its refusal and its no-such-file both return null, so ambiguity had nowhere to go.
    //
    // A refusal is not an absence. This is the same collapse as a guard that declines to answer
    // sharing an exit code with a guard that found a fault.
    const db = await fixture('See `server.js` for the entry point.\n', [
      ['p1', 'File', 'server.js', 'mcp/stdio/server.js', '{}'],
      ['p2', 'File', 'server.js', 'mcp/stdio/dashboard/server.js', '{}'],
    ]);
    const stats = await detectDocRefs(db, repo);
    const buckets = stats.misses.map((m) => m.bucket);
    expect(buckets, 'the file IS indexed — twice').toContain('ambiguous_path');
    expect(buckets, 'so it is emphatically not missing from the corpus')
      .not.toContain('path_not_indexed');
    expect(refs(db), 'and it still emits nothing — ambiguity refuses').toEqual([]);
    db.close();
  }, 20_000);

  it('★★★ a basename indexed EXACTLY ONCE is claimed by rule 1, not bucketed at all', async () => {
    // The positive control on the ambiguity check: with one candidate the path resolves, so it
    // must land in `is_a_path` rather than in either failure bucket. Without this, a check that
    // called everything ambiguous would look identical.
    const db = await fixture('See `server.js` for the entry point.\n', [
      ['p1', 'File', 'server.js', 'mcp/stdio/server.js', '{}'],
    ]);
    const stats = await detectDocRefs(db, repo);
    const buckets = stats.misses.map((m) => m.bucket);
    expect(buckets, 'one candidate resolves').toContain('is_a_path');
    expect(buckets).not.toContain('ambiguous_path');
    db.close();
  }, 20_000);

  it('★★★ a basename indexed NOWHERE is still reported as an unindexed path', async () => {
    // The negative control. The bucket must keep its original meaning for the case it was
    // built for, or the split has moved the lie rather than removed it.
    // ⚠ NO HYPHEN. My first attempt used `nowhere-at-all.md` and it landed in `unqualified`,
    // because the chain grammar is built from identifier segments and the word-character class
    // excludes the hyphen. So a hyphenated filename never reaches the path buckets at all —
    // correct, since it is not an identifier chain, but it made this control test the wrong
    // branch and pass for a reason unrelated to what it claims.
    const db = await fixture('See `nowhere.md` for details.\n');
    const stats = await detectDocRefs(db, repo);
    const buckets = stats.misses.map((m) => m.bucket);
    expect(buckets).toContain('path_not_indexed');
    expect(buckets).not.toContain('ambiguous_path');
    db.close();
  }, 20_000);
});

// RULE 3 — THE SHAPE IS THE EVIDENCE.
//
// Rule 2 needs a qualifier. Most references in real documents do not have one: people write
// `computeTrustLevel()`, not `health.computeTrustLevel()`. Rule 3 admits an unqualified span when
// the author put a SHAPE on it — call parentheses, CamelCase humps, an underscore — and the bare
// label resolves to exactly one symbol.
//
// ⚠ IT IS WEAKER THAN RULE 2 AND TAGGED SEPARATELY. Uniqueness is a property of the REPOSITORY,
// not of the writing: the same sentence in a repo with two `trust` functions emits nothing. Rule
// 2's evidence travels with the document; rule 3's is half in the graph.
describe('doc → symbol references, rule 3 (shaped + unique)', () => {
  const shaped = (db) => db.all(
    `SELECT e.*, t.label AS target FROM edges e JOIN nodes t ON t.id = e.to_id
     WHERE e.extractor = 'doc_ref:shaped'`);

  it('★★★ an INVOCATION-shaped span resolves by bare label', async () => {
    const db = await fixture('Call `compute()` at startup.\n', [
      ['c1', 'Function', 'compute', 'src/c.cpp', '{"qname":"compute"}'],
    ]);
    await detectDocRefs(db, repo);
    expect(shaped(db).length).toBe(1);
    expect(shaped(db)[0].target).toBe('compute');
    expect(shaped(db)[0].source_line).toBe(1);
    db.close();
  }, 20_000);

  it('★★★ THE PARENTHESES ARE THE WHOLE DIFFERENCE — `read` vs `read()`', async () => {
    // ⛔ This is the line between rule 3 and the extractor it replaced. The legacy rule admitted
    // `read` because a function was called that; rule 3 admits `read()` because somebody wrote a
    // call. Same word, same graph, different claim by the author.
    const bare = await fixture('You should `read` the file first.\n');
    await detectDocRefs(bare, repo);
    expect(shaped(bare), 'the English word emits nothing').toEqual([]);
    bare.close();

    const called = await fixture('The helper `read()` opens it.\n');
    await detectDocRefs(called, repo);
    expect(shaped(called).length, 'the written call emits an edge').toBe(1);
    called.close();
  }, 40_000);

  it('★★★ CamelCase needs TWO humps — `Graph` is a word, `LspClient` is a type', async () => {
    // ⚠ A single hump is an ordinary English word with a capital, and screaming case (`README`,
    // `TODO`) is not a type at all. Both are excluded by the shape, not by a dictionary.
    const db = await fixture('See `Graph` and `README` and `LspClient`.\n', [
      ['g1', 'Class', 'Graph', 'src/g.cpp', '{"qname":"Graph"}'],
      ['r1', 'Class', 'README', 'src/r.cpp', '{"qname":"README"}'],
      ['l1', 'Class', 'LspClient', 'src/l.cpp', '{"qname":"LspClient"}'],
    ]);
    await detectDocRefs(db, repo);
    expect(shaped(db).map((r) => r.target), 'only the two-hump type is a reference')
      .toEqual(['LspClient']);
    db.close();
  }, 20_000);

  it('★★★ snake_case is caught BY THE INVOCATION SHAPE, and the bare shape is deleted', async () => {
    // ⛔ THE BARE snake_case SHAPE SHIPPED AND NEVER FIRED. 1170 candidates on this repo, 270 on
    // echoes_of_the_fallen, ZERO resolved on either. I held it at 0/1170 because deleting a shape
    // on one repository's evidence would be calibrating on that repository's naming convention —
    // and then predicted, on the record, that a C++ repo would rescue it.
    //
    // ⚠ THE SECOND REPO CONVICTED IT INSTEAD. Same zero, and the sample says why: `comms_send`
    // x26, `comms_share` x12, `query_voxel` x8 — MCP TOOL NAMES AND CONFIG KEYS, snake_case by
    // ECOSYSTEM convention in both corpora regardless of host language.
    //
    // ★ And the case worth having was never the bare shape's: a snake_case function written the
    // way people write functions is an INVOCATION. That is what this test now pins.
    const db = await fixture('Call `render_frame()`; the tool is `voxel_count`.', [
      ['s1', 'Function', 'render_frame', 'src/r.c', '{"qname":"render_frame"}'],
      ['s2', 'Function', 'voxel_count', 'src/v.c', '{"qname":"voxel_count"}'],
    ]);
    await detectDocRefs(db, repo);
    expect(shaped(db).map((r) => r.target),
      'the call admits; the bare token does not, even though both symbols exist')
      .toEqual(['render_frame']);
    db.close();
  }, 20_000);

  it('★★★ shapeOf reads parentheses as the stronger evidence, not as punctuation', async () => {
    // The ordering control. If TYPE/snake were tested before INVOCATION, `render_frame()` would
    // have been read as something else and the subsumption above would be an accident of regex
    // order rather than a stated rule.
    expect(shapeOf('render_frame()')).toEqual({ name: 'render_frame', shape: 'invocation' });
    expect(shapeOf('render_frame'), 'no parens, no shape — deliberately').toBeNull();
    expect(shapeOf('LspClient')).toEqual({ name: 'LspClient', shape: 'type' });
  });

  it('★★★ an AMBIGUOUS bare label emits nothing — uniqueness is the qualifier', async () => {
    const db = await fixture('Call `build()`.\n', [
      ['b1', 'Function', 'build', 'src/a.cpp', '{"qname":"a.build"}'],
      ['b2', 'Function', 'build', 'src/b.cpp', '{"qname":"b.build"}'],
    ]);
    const stats = await detectDocRefs(db, repo);
    expect(shaped(db)).toEqual([]);
    expect(stats.misses.map((m) => m.bucket)).toContain('shaped_ambiguous');
    db.close();
  }, 20_000);

  it('★★★ rule 3 edges are tagged SEPARATELY from rule 2, and carry lower confidence', async () => {
    // ⛔ ONE TAG FOR TWO STRENGTHS IS THE DEFECT THAT KILLED THE LEGACY EXTRACTOR. A reader
    // pulling MENTIONS must be able to tell an in-document qualifier from a graph-wide uniqueness
    // claim, or the weaker inherits the stronger one's authority.
    const db = await fixture('Both `Terrain::generate` and `compute()` here.\n', [
      ['c1', 'Function', 'compute', 'src/c.cpp', '{"qname":"compute"}'],
    ]);
    await detectDocRefs(db, repo);
    const byTag = Object.fromEntries(db.all(
      "SELECT extractor, confidence FROM edges WHERE relation = 'MENTIONS'")
      .map((r) => [r.extractor, r.confidence]));
    expect(Object.keys(byTag).sort()).toEqual(['doc_ref:qualified', 'doc_ref:shaped']);
    expect(byTag['doc_ref:shaped'], 'weaker rule, lower confidence, visibly')
      .toBeLessThan(byTag['doc_ref:qualified']);
    db.close();
  }, 20_000);

  it('★★★ a fenced shaped span is still excluded', async () => {
    const db = await fixture('```js\nCall `compute()` here.\n```\n', [
      ['c1', 'Function', 'compute', 'src/c.cpp', '{"qname":"compute"}'],
    ]);
    await detectDocRefs(db, repo);
    expect(shaped(db)).toEqual([]);
    db.close();
  }, 20_000);
});
