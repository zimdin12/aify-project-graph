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
import { detectDocRefs, buildSymbolIndex, shapeOf, isSpanHead } from '../../../mcp/stdio/analysis/doc-refs.js';

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

describe('the recoverable-source-span invariant', () => {
  it('★★★ EVERY emitted edge cites a line that actually contains its target', async () => {
    // ⛔ THIS IS A DIFFERENT PROPERTY FROM PRECISION AND IT IS INVISIBLE TO A PRECISION COUNT.
    //
    // dev's invariant for the whole layer is "a recoverable source span and a deterministic
    // resolution path to exactly one node". Precision grading checks the SECOND half — does this
    // edge point at the right symbol. Nothing in it checks the FIRST: an edge could resolve
    // perfectly and cite a line the token does not appear on, and every grader reading
    // doc:line -> symbol would score it correct because they judge the resolution.
    //
    // ef-manager ran it as a one-off over the 71 live edges (0 of 71 missing) while grading rule
    // 3, and it is exactly the check that would catch an off-by-one in the scanner, a fence
    // toggle drifting the line counter, or a re-scan on stale content. Every one of those breaks
    // the promise the layer exists to make while leaving the resolution untouched.
    //
    // ⚠ THE LEGACY EXTRACTOR FAILED THIS ON ALL 2,533 EDGES — source_line hardcoded to 0 — and no
    // amount of precision grading would have surfaced it, because the targets were the thing
    // being judged.
    const body = [
      'The entry point is `Terrain::generate` today.',
      '',
      'It calls `compute()` and then `helper()`.',
      '',
      '```md',
      'Not this one: `compute()`',
      '```',
      '',
      'Finally see `LspClient` for the transport.',
    ].join('\n');

    const db = await fixture(body, [
      ['c1', 'Function', 'compute', 'src/c.cpp', '{"qname":"compute"}'],
      ['h1', 'Function', 'helper', 'src/h.cpp', '{"qname":"helper"}'],
      ['l1', 'Class', 'LspClient', 'src/l.cpp', '{"qname":"LspClient"}'],
    ]);
    await detectDocRefs(db, repo);

    const lines = body.split('\n');
    const edges = refs(db);

    // Positive control: the invariant is vacuous over an empty set, and an extractor that emits
    // nothing satisfies it perfectly.
    expect(edges.length, 'the fixture must produce edges, or the loop below proves nothing')
      .toBeGreaterThanOrEqual(4);

    for (const e of edges) {
      const text = lines[e.source_line - 1];
      expect(text, `edge cites line ${e.source_line}, which is past the end of the document`)
        .toBeTruthy();
      expect(text, `edge -> ${e.target} cites a line not containing it: ${JSON.stringify(text)}`)
        .toContain(e.target);
    }
  }, 20_000);
});

describe('uniqueness names the population it is unique within', () => {
  it('★★★ an EXTERNAL node sharing the label makes the name ambiguous, not unique', async () => {
    // ⛔ "UNIQUE" WAS A POPULATION STATEMENT HIDING INSIDE A BOOLEAN.
    //
    // The label filter ran BEFORE the uniqueness test, so `hits.length > 1` meant "more than one
    // non-External, non-Module, non-file-level node" while reading as "more than one node in the
    // graph". A name with two owners passed as unique because one owner was removed first.
    //
    // ef-manager found it as two false positives on echoes_of_the_fallen. `vec3` has a Class node
    // — a PRIVATE NESTED STRUCT inside an unrelated noise header — and an External node for the
    // glm/GLSL type the authors actually meant. The External one was filtered out, so both
    // documents got an edge to the private struct.
    //
    // ⇒ The filter is right for RESOLUTION (an edge must not point at an External stub, which has
    // no file and no span) and wrong for AMBIGUITY DETECTION (an External node carrying your label
    // is exactly the evidence that the name is not yours alone). Same index, opposite needs.
    const db = await fixture('The gravity vector is `vec3(0,-1,0)`.', [
      ['v1', 'Class', 'vec3', 'src/noise.h', '{"qname":"SimplexNoise.vec3"}'],
      ['v2', 'External', 'vec3', '', '{}'],
    ]);
    const stats = await detectDocRefs(db, repo);
    expect(refs(db), 'two owners is not one owner').toEqual([]);
    expect(stats.misses.map((m) => m.bucket)).toContain('shaped_ambiguous');
    db.close();
  }, 20_000);

  it('★★★ the SAME reference resolves when nothing else claims the name', async () => {
    // The negative control, and it is doing real work: without it, a rule that refused everything
    // would satisfy the test above perfectly. Removing ONLY the External node must flip the answer.
    const db = await fixture('The gravity vector is `vec3(0,-1,0)`.', [
      ['v1', 'Class', 'vec3', 'src/noise.h', '{"qname":"SimplexNoise.vec3"}'],
    ]);
    await detectDocRefs(db, repo);
    expect(refs(db).map((r) => r.target), 'sole claimant, so it resolves').toEqual(['vec3']);
    db.close();
  }, 20_000);

  it('★★★ an External stub is still never the TARGET of an edge', async () => {
    // The other half of the split: External is counted for ambiguity but remains inadmissible as
    // a destination. If it were admissible, this would emit an edge to a node with no file and no
    // line — breaking the recoverable-source-span invariant from the other direction.
    const db = await fixture('See `parseJson()` for details.', [
      ['e1', 'External', 'parseJson', '', '{}'],
    ]);
    const stats = await detectDocRefs(db, repo);
    expect(refs(db)).toEqual([]);
    expect(stats.misses.map((m) => m.bucket), 'no admissible target at all')
      .toContain('shaped_no_symbol');
    db.close();
  }, 20_000);
});

// RULE 4 — THE PATH IS THE QUALIFIER.
//
// Rules 2 and 3 both require the TOKEN to carry its own evidence: a `::` or a `()`. Rule 4 requires
// neither, because the author wrote the FILE alongside the name, and a file scope disambiguates a
// bare word far better than any token shape can.
//
// ★ IT REACHES REFERENCES THE OTHER RULES STRUCTURALLY CANNOT. Measured on this repo:
// `diagnostics`, `references` and `hover` all appear on one line beside
// `mcp/stdio/code-intel/lsp-client.js`. They are ordinary English words; rule 3 refuses them and
// should. Scoped to that file they are three unambiguous methods.
describe('doc → symbol references, rule 4 (path-scoped)', () => {
  const scoped = (db) => db.all(
    `SELECT e.*, t.label AS target FROM edges e JOIN nodes t ON t.id = e.to_id
     WHERE e.extractor = 'doc_ref:path-scoped'`);

  async function scopedFixture(body) {
    return fixture(body, [
      // Two ordinary English words that are also methods of one file.
      ['c1', 'Method', 'hover', 'src/client.js', '{"qname":"LspClient.hover"}'],
      ['c2', 'Method', 'references', 'src/client.js', '{"qname":"LspClient.references"}'],
      // The file node the path must resolve to.
      ['fc', 'File', 'client.js', 'src/client.js', '{}'],
      // A same-named method in a DIFFERENT file — not ambiguous once the path has scoped us.
      ['o1', 'Method', 'hover', 'src/other.js', '{"qname":"Other.hover"}'],
      ['fo', 'File', 'other.js', 'src/other.js', '{}'],
    ]);
  }

  it('★★★ a bare word beside its declaring file resolves — no shape required', async () => {
    const db = await scopedFixture('See `src/client.js` for `hover` and `references`.');
    await detectDocRefs(db, repo);
    expect(scoped(db).map((r) => r.target).sort()).toEqual(['hover', 'references']);
    db.close();
  }, 20_000);

  it('★★★ the SAME words without the path emit nothing — the path is the whole evidence', async () => {
    // ⛔ THE NEGATIVE CONTROL, AND IT IS THE ONE THAT MATTERS. `hover` and `references` are English
    // words; if they resolved without the scoping path this rule would be the legacy extractor
    // wearing a new tag. Removing ONLY the path must remove the edges.
    const db = await scopedFixture('The client supports `hover` and `references` today.');
    await detectDocRefs(db, repo);
    expect(scoped(db), 'a bare word with nothing scoping it is prose').toEqual([]);
    db.close();
  }, 20_000);

  it('★★★ a word declared in a DIFFERENT file is not scoped by this path', async () => {
    // `hover` exists in both src/client.js and src/other.js. Naming one file must reach one
    // symbol — the point of scoping is that repository-wide ambiguity stops mattering.
    const db = await scopedFixture('See `src/other.js` and its `hover`.');
    await detectDocRefs(db, repo);
    const rows = scoped(db);
    expect(rows.length).toBe(1);
    expect(rows[0].to_id, 'the one declared in the file the author named').toBe('o1');
    db.close();
  }, 20_000);

  it('★★★ the scope is a LINE, not the document', async () => {
    // ⛔ dev was explicit that whole-document co-occurrence is too weak. A path in the first
    // paragraph must not scope a word four paragraphs later, or the rule degenerates into
    // "this document mentions this file, therefore every word in it is a reference".
    const db = await scopedFixture([
      'See `src/client.js` for the transport.',
      '',
      'Unrelated paragraph about `hover` in general.',
    ].join('\n'));
    await detectDocRefs(db, repo);
    expect(scoped(db), 'a different line is a different span').toEqual([]);
    db.close();
  }, 20_000);

  it('★★★ a Markdown LINK scopes as well as inline code', async () => {
    // Rule 1 admits both spellings, so rule 4 must see both or a path written as a link is
    // invisible here for no reason a reader could predict.
    const db = await scopedFixture('See [the client](src/client.js) and its `hover`.');
    await detectDocRefs(db, repo);
    expect(scoped(db).map((r) => r.target)).toEqual(['hover']);
    db.close();
  }, 20_000);

  it('★★★ the STRONGEST rule wins when two reach the same symbol', async () => {
    // ⛔ PRECEDENCE WAS AN ARTIFACT OF CONTROL FLOW BEFORE THIS. Both emits were inline, so
    // whichever loop reached a symbol first got the tag. The extractor tag is the ONLY thing
    // telling a reader how much to trust an edge, and "whichever ran first" is not a reason.
    //
    // Here `hover()` is invocation-shaped (rule 3, 0.80) AND sits beside its declaring file
    // (rule 4, 0.85). One edge, tagged with the stronger rule.
    const db = await scopedFixture('In `src/other.js`, call `hover()` first.');
    await detectDocRefs(db, repo);
    const rows = db.all(
      "SELECT extractor, to_id FROM edges WHERE relation = 'MENTIONS'");
    expect(rows.length, 'one edge per (document, symbol), not one per rule').toBe(1);
    expect(rows[0].extractor, 'path-scoped outranks shaped').toBe('doc_ref:path-scoped');
    db.close();
  }, 20_000);

  it('★★★ a fenced line does not scope', async () => {
    const db = await scopedFixture('```js\nSee `src/client.js` and `hover`.\n```');
    await detectDocRefs(db, repo);
    expect(scoped(db)).toEqual([]);
    db.close();
  }, 20_000);
});

describe('a code span names ONE thing, and the thing is at its head', () => {
  const spanOf = (line) => {
    const m = [...line.matchAll(/`([^`\n]+)`/g)][0];
    return { start: m.index, end: m.index + m[0].length };
  };

  it('★★★ a word that is not what its span names is refused', () => {
    // ⛔ THE SURVIVING FALSE POSITIVE FROM RULE 4's FIRST GRADE. `npm rebuild better-sqlite3` is a
    // marked span holding a SHELL COMMAND, and it produced an edge to a function called `rebuild`.
    // A code span names one thing; a word buried inside a command is not it.
    const line = 'Recovery: `npm rebuild better-sqlite3` (single command).';
    expect(isSpanHead(line, spanOf(line), line.indexOf('rebuild'))).toBe(false);
    expect(isSpanHead(line, spanOf(line), line.indexOf('npm')), 'the head is npm').toBe(true);
  });

  it('★★★ DECLARATION KEYWORDS are skipped — naive head position drops a real reference', () => {
    // ⛔ THE VERSION I PROPOSED WOULD HAVE DROPPED A TRUE POSITIVE, and ef-manager measured that
    // before I applied it rather than after:
    //
    //     `npm rebuild better-sqlite3`               head `npm`     -> the FP, correctly dropped
    //     `export function autoReindexEnabled(env)`  head `export`  -> A REAL REFERENCE, dropped
    //
    // So the head is the first identifier that is not a declaration keyword. That still kills
    // `npm rebuild …`, because `npm` is an ordinary identifier sitting in head position — the
    // keyword list is syntactic, not a list of words that seemed unimportant.
    const line = 'A module-level helper keeps it testable: `export function autoReindexEnabled(env)` in a file.';
    expect(isSpanHead(line, spanOf(line), line.indexOf('autoReindexEnabled'))).toBe(true);
    expect(isSpanHead(line, spanOf(line), line.indexOf('export')), 'a keyword is never the name')
      .toBe(false);
  });

  it('★★★ a missing span answers false — a guard cannot pass on absent input', () => {
    // Guards fail closed. Returning true for "no span" would let every unmarked token through the
    // one check that is supposed to require marking.
    expect(isSpanHead('anything', null, 0)).toBe(false);
    expect(isSpanHead('anything', undefined, 0)).toBe(false);
  });

  it('★★★ end to end: the shell-command span emits nothing, the declaration span emits', async () => {
    // ⚠ The unit assertions above test the predicate. This tests that the predicate is actually
    // WIRED — a live helper with no call site is the defect this repo spent the night on.
    const db = await fixture(
      'In `src/client.js`: `npm hover better-sqlite3` and `export function references(x)`.', [
        ['c1', 'Method', 'hover', 'src/client.js', '{"qname":"LspClient.hover"}'],
        ['c2', 'Method', 'references', 'src/client.js', '{"qname":"LspClient.references"}'],
        ['fc', 'File', 'client.js', 'src/client.js', '{}'],
      ]);
    await detectDocRefs(db, repo);
    const targets = db.all(
      `SELECT t.label FROM edges e JOIN nodes t ON t.id = e.to_id
       WHERE e.extractor = 'doc_ref:path-scoped'`).map((r) => r.label);
    expect(targets, 'hover is buried in a command; references heads a declaration')
      .toEqual(['references']);
    db.close();
  }, 20_000);
});
