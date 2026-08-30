// ⛔ A DOCUMENT IS REACHED BY WHAT ITS AUTHOR SIGNPOSTED, NOT BY WHAT IT HAPPENS TO CONTAIN.
//
// Before this, the only searchable text for a document was its FILENAME and its title. Measured
// over ten topics this repo genuinely discusses, across 179 documents:
//
//     reachable by name|title      3
//     headings would ADD          49        ← a seventeen-fold gain
//     the lede would add          10 more
//     body-word presence         359        ⛔ NOT A TARGET
//
// ⚠ THE 359 IS THE TRAP. Ninety-six documents contain the word "overlay"; returning all of them
// for the query "overlay" is catastrophic precision. Word-containment-as-aboutness is exactly the
// error that produced the legacy `mentions` extractor and its 2,533 unverifiable edges — and I
// computed "99.4% of documents unreachable" from that population before catching that it is a
// capability statement and not a defect rate.
//
// ⇒ ADJACENT, NOT AMBIENT. A heading is a structural claim the author made about a section; a
// mention is a coincidence of vocabulary. This is the same property that separated the doc→symbol
// rules which survived held-out grading from the one deleted at 0.9311.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { extractHeadings } from '../../../mcp/stdio/ingest/sweep.js';
import { graphSearch } from '../../../mcp/stdio/query/verbs/search.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

describe('extractHeadings reads the structure, not the prose', () => {
  it('★★★ every ATX level is a heading', () => {
    const { headings } = extractHeadings('# One\n\ntext\n\n### Three\n\n###### Six\n');
    expect(headings).toEqual(['One', 'Three', 'Six']);
  });

  it('★★★⛔ a `#` INSIDE A FENCE is a comment, not a heading', () => {
    // ⛔ Every shell and Python block in this repo's docs starts lines with `#`. Without fence
    // tracking the index fills with "!/usr/bin/env node" and "TODO: fix this", and a topic index
    // made of code comments is worse than none — it looks like coverage.
    const { headings } = extractHeadings([
      '# Real Heading',
      '```bash',
      '# not a heading, a shell comment',
      '## also not one',
      '```',
      '## Second Real Heading',
    ].join('\n'));
    expect(headings).toEqual(['Real Heading', 'Second Real Heading']);
  });

  it('★★★ tilde fences count too, and an unclosed fence does not swallow the file', () => {
    expect(extractHeadings('~~~\n# hidden\n~~~\n# shown\n').headings).toEqual(['shown']);
    // An unclosed fence legitimately hides the rest — that is what the markup says. Pinned so the
    // behaviour is a decision rather than an accident.
    expect(extractHeadings('```\n# hidden\n# also hidden\n').headings).toEqual([]);
  });

  it('★★★ NEGATIVE CONTROL: prose containing # is not a heading', () => {
    // ⛔ Without this the extractor is satisfied by one that matches any line with a hash — which
    // would pull in every issue reference and every colour literal in the corpus.
    expect(extractHeadings('See issue #42 for details.\n').headings).toEqual([]);
    expect(extractHeadings('#nospace\n').headings, 'ATX requires a space').toEqual([]);
  });

  it('★★★⛔ THE FOURTH SPACE IS THE BOUNDARY — 0-3 is a heading, 4 is a code block', () => {
    // ⛔ CommonMark: an ATX heading may be indented 0–3 spaces; at 4 the line is an indented CODE
    // BLOCK. That is not pedantry, it is the difference between a heading inside a list item and a
    // shell comment inside a code sample — and code samples are full of `# do the thing`.
    //
    // ⚠ MY FIRST VERSION ANCHORED AT COLUMN 0 and this test asserted the spec, so the test failed
    // against code that was merely stricter rather than wrong. I changed the CODE, because
    // column-0-only lost real headings for no precision gain — but the direction of that decision
    // deserved a moment: the reflex is to relax the test to whatever the code does.
    expect(extractHeadings('   # three spaces\n').headings, '3 spaces is still a heading')
      .toEqual(['three spaces']);
    expect(extractHeadings('    # four spaces\n').headings, '4 spaces is code, not a heading')
      .toEqual([]);
  });

  it('★★★ closing-hash style is stripped', () => {
    expect(extractHeadings('## Title ##\n').headings).toEqual(['Title']);
  });

  it('★★★⛔ the character cap DISCLOSES, it does not truncate silently', () => {
    // ⛔ A cap that reports nothing is the defect this repo has now fixed four times. The flag
    // travels with the value so a reader can tell a short document from a clipped one.
    const many = Array.from({ length: 500 }, (_, i) => `## Heading number ${i} with padding text`).join('\n');
    const { headings, truncated } = extractHeadings(many);
    expect(truncated, 'the cap fired').toBe(true);
    expect(headings.length, 'and it kept a real prefix rather than giving up').toBeGreaterThan(10);
    expect(headings.length).toBeLessThan(500);

    // NEGATIVE CONTROL: an ordinary document is NOT flagged. Without this, `truncated: true`
    // could be hardcoded and the assertion above would still pass.
    expect(extractHeadings('# A\n## B\n').truncated).toBe(false);
  });
});

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

// A repo where the topic appears ONLY in a heading — never in a filename, never in a title, and
// never as a symbol label. That is the exact query the roadmap says an index must earn its keep on:
// "topic -> doc where the filename does not contain the topic", because `ls docs/` already passes
// the other one.
async function topicRepo() {
  const r = await mkdtemp(join(tmpdir(), 'apg-topic-'));
  await mkdir(join(r, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', r, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', r, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(r, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 3, edges: 0, schemaVersion: 4,
    extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(r, '.aify-graph', 'graph.sqlite'));
  const add = (id, type, label, file, extra) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ('${id}','${type}','${label}','${file}',1,1,'',1,'${extra}')`);
  // The document: topic is in a HEADING only. Filename and title say nothing about it.
  add('d1', 'Document', 'design-notes.md', 'docs/design-notes.md',
    JSON.stringify({ title: 'Design notes', headings: ['Design notes', 'How the widget cache works'] }).replace(/'/g, "''"));
  // A decoy document that merely CONTAINS nothing relevant — proves we are not returning everything.
  add('d2', 'Document', 'unrelated.md', 'docs/unrelated.md',
    JSON.stringify({ title: 'Unrelated', headings: ['Nothing to see'] }).replace(/'/g, "''"));
  // ⛔ AN EXACT-LABEL SYMBOL, which is what made the fast path fire and delete the widening.
  add('s1', 'Function', 'cache', 'src/cache.js', '{}');
  db.close();
  return r;
}

const docsIn = (out) => [...new Set([...out.matchAll(/([\w./-]+\.md)/g)].map((m) => m[1]))];

describe('a topic in a heading is reachable when the caller widens', () => {
  it('★★★⛔ THE QUERY THAT USED TO RETURN NOTHING: exact symbol name, kind="all"', async () => {
    // ⛔ THE DEFECT, AND IT PREDATES THE HEADING INDEX. `graphSearch` short-circuits on an exact
    // `label` match. A document is never reached by label — a label is a filename — so whenever
    // the query happened to be a valid symbol name AND any node carried it exactly, the widened
    // query was NEVER EXECUTED. Measured on the real repo: `overlay` had 4 exact-label nodes and
    // 24 documents matching by heading, and returned ZERO of them; `sqlite` had 0 exact-label
    // nodes and returned its documents fine. Perfect discrimination.
    //
    // ⇒ Not a ranking problem and not a cap. The reserved-page-share machinery sits downstream of
    // a `return` statement, so no amount of tuning it could ever have helped.
    repoRoot = await topicRepo();
    const out = await graphSearch({ repoRoot, query: 'cache', kind: 'all' });
    expect(docsIn(out), 'the heading match must survive the exact-label symbol')
      .toContain('docs/design-notes.md');
  }, 20_000);

  it('★★★ POSITIVE CONTROL: the exact-label symbol is still returned too', async () => {
    // ⛔ Without this, the assertion above is satisfied by a fix that DROPPED the fast path's
    // results — trading a missing document for a missing symbol.
    repoRoot = await topicRepo();
    const out = await graphSearch({ repoRoot, query: 'cache', kind: 'all' });
    expect(out, 'code still leads; the widening is additive').toMatch(/src\/cache\.js/);
  }, 20_000);

  it('★★★⛔ THE DEFAULT kind="code" IS UNCHANGED — no document, and the fast path intact', async () => {
    // ⚠ THE OVER-CORRECTION GUARD. Removing the fast path outright would make every ordinary
    // symbol lookup pay a broad substring scan, and would start returning documents to callers who
    // asked for code. The fix is conditional on the caller having explicitly widened, and this is
    // what says so.
    repoRoot = await topicRepo();
    const out = await graphSearch({ repoRoot, query: 'cache' });
    expect(docsIn(out), 'a code search returns no documents').toEqual([]);
    expect(out).toMatch(/src\/cache\.js/);
  }, 20_000);

  it('★★★ NEGATIVE CONTROL: a topic in NO heading is still not found', async () => {
    // ⛔ The whole value is discrimination. A search that returned documents for anything would
    // pass every assertion above while being useless — and would be the legacy `mentions` shape.
    repoRoot = await topicRepo();
    const out = await graphSearch({ repoRoot, query: 'thermodynamics', kind: 'all' });
    expect(docsIn(out)).toEqual([]);
  }, 20_000);

  it('★★★ and the DECOY document is not swept in with the real match', async () => {
    repoRoot = await topicRepo();
    const found = docsIn(await graphSearch({ repoRoot, query: 'widget', kind: 'all' }));
    expect(found).toContain('docs/design-notes.md');
    expect(found, 'a document with no claim on the topic stays out').not.toContain('docs/unrelated.md');
  }, 20_000);
});

// ⛔ REACHABLE BY A QUERY IS ONLY HALF OF IT. A FEATURE MUST ALSO REACH DEPLOYED GRAPHS.
//
// `headings` shipped and was INERT everywhere it mattered. Measured on three already-indexed
// repositories immediately after:
//
//     graphify                    363 documents,   0 with headings
//     agent-understand-anything   118 documents,   0 with headings
//     codegraph                    80 documents,   0 with headings
//
// An unchanged file is never re-extracted, so its `extra` keeps the old shape for ever. Bumping
// EXTRACTOR_VERSION is what forces one re-extraction — and running the IDENTICAL command after the
// bump gave 347/363, 118/118, 78/80.
//
// ⛔⛔ AND THE COMMENT DIRECTLY ABOVE THAT CONSTANT ALREADY SAID SO, in its own words, about the
// previous bump: "a graph indexed under 0.2.3 would otherwise never re-derive documents that had
// not changed, and the new layer would be missing on precisely the long-lived repos it was built
// for." Correct, prominent, adjacent knowledge that did not prevent the defect it described. The
// remedy for that is never a better comment.
//
// ⇒ So the coupling is made MECHANICAL. This pins the extractor's output shape beside the version.
// Add a field and the shape changes; the test fails and names the bump. It can still be satisfied
// by updating both without thinking — but it cannot be satisfied by not noticing.
describe('the extractor output shape and EXTRACTOR_VERSION move together', () => {
  it('★★★⛔ a change to what a Document node carries requires a version bump', async () => {
    const { extractDocumentMeta } = await import('../../../mcp/stdio/ingest/sweep.js');
    const { EXTRACTOR_VERSION } = await import('../../../mcp/stdio/freshness/orchestrator.js');
    const shape = Object.keys(
      extractDocumentMeta('# Title\nsecond line\n\n## A heading\n', 'docs/x.md'),
    ).sort().join(',');
    expect({ shape, version: EXTRACTOR_VERSION },
      'If `shape` changed, deployed graphs will NOT re-extract and the change is inert on every '
      + 'existing repository. Bump EXTRACTOR_VERSION in freshness/orchestrator.js and update this '
      + 'expectation in the same edit — that is the whole point of pinning them together.')
      .toEqual({ shape: 'headings,summary,title', version: '0.4.0' });
  });

  it('★★★ POSITIVE CONTROL: the shape really does move when a field appears', async () => {
    // ⛔ Without this the assertion above passes against a `shape` that is a constant string —
    // which would be a guard that cannot detect the thing it guards.
    const { extractDocumentMeta } = await import('../../../mcp/stdio/ingest/sweep.js');
    // ⚠ THE NO-HEADINGS DOCUMENT MUST NOT START WITH `#`. My first version used '# T\nx\n' and the
    // control failed — because an H1 title IS a heading, so that document has one. The fixture, not
    // the code, was wrong. A document with no ATX heading anywhere is the only way to observe the
    // key being absent.
    const withHeadings = Object.keys(extractDocumentMeta('# T\nx\n\n## H\n', 'a.md')).sort().join(',');
    const noHeadings = Object.keys(extractDocumentMeta('Plain prose title\nsecond line\n', 'a.md')).sort().join(',');
    expect(withHeadings).toBe('headings,summary,title');
    expect(noHeadings, 'a document with no headings carries no headings key').toBe('summary,title');
    expect(withHeadings).not.toBe(noHeadings);
  });
});

// ⛔ A ZERO MUST NAME THE POPULATION IT SEARCHED, OR IT READS AS A CLAIM ABOUT THE REPOSITORY.
//
// the field test, field-testing the heading index on their own corpus: `denoiser` returned
//
//     NO RESULTS for "denoiser". Ruled out: the index is fresh.
//
// with ELEVEN documents discussing denoisers sitting in that corpus. `git grep` finds all eleven.
//
// ⛔⛔ "Ruled out: the index is fresh" MADE THE FALSE NEGATIVE MORE CONFIDENT. It answers "is this
// stale?", which was not the reason for the zero, and by eliminating the one cause it can see it
// implies the remaining explanation is that the topic is not here. Their words: a three-state
// instrument reporting two states — PRESENT and ABSENT, with NOT-SIGNPOSTED collapsed into ABSENT.
// `git grep` returning noise never does that, because noise is visibly noise and a confident zero
// is not.
//
// ⚠ Of four topics genuinely present in their corpus, the tool found ONE — their documents are
// audits and session logs whose headings are dates and role names rather than subjects. The recall
// floor is real and disclosed. The MESSAGE was the defect.
describe('a zero result discloses what was actually searched', () => {
  it('★★★⛔ kind="all" with no match says bodies are not indexed', async () => {
    repoRoot = await topicRepo();
    const out = await graphSearch({ repoRoot, query: 'denoiser', kind: 'all' });
    expect(out).toMatch(/NO RESULTS/);
    expect(out, 'name the surface').toMatch(/FILENAME, TITLE and HEADINGS only/);
    expect(out, 'and say what the zero does NOT mean').toMatch(/NOT evidence the topic is absent/);
    expect(out, 'and give the fallback that does search bodies').toMatch(/grep/i);
  }, 20_000);

  // ⚠ CONTRACT CHANGED 2026-08-30. This previously asserted that a DEFAULTED search must NOT explain
  // the document population — "one explanation per population", the over-correction guard against
  // noise that trains people to stop reading the warning block.
  //
  // That guard was right while documents were NOT SEARCHED on the default path: explaining a
  // population you did not look at is noise. The default now widens to documents when code finds
  // nothing, so the population IS searched — and describing what was searched is no longer a second
  // explanation, it is the only accurate account of the zero. The guard's own principle, one
  // explanation per population searched, is what now requires this line rather than forbids it.
  it('★★★ a zero after widening names the population that was ACTUALLY searched', async () => {
    repoRoot = await topicRepo();
    const out = await graphSearch({ repoRoot, query: 'denoiser' });
    expect(out).toMatch(/NO RESULTS/);
    // Matches the CLAIM (documents were in the population and matched nothing), not one phrasing of
    // it — an assertion pinned to exact prose fails on every honest rewording.
    expect(out, 'the reader must learn documents were covered and still empty')
      .toMatch(/Document\/Directory\/Config nodes were searched/);
    expect(out, 'and what the document recall floor is').toMatch(/FILENAME, TITLE and HEADINGS/);
    // ⛔ AND IT MUST NOT OFFER A WIDENING IT ALREADY PERFORMED — the non-terminating shape this
    // file's neighbours warn about: a remedy whose answer is already computed.
    expectAbsentWithLiveMatcher(
      /kind="all"/,
      { forbidden: 'Next: graph_search(query="denoiser", kind="all") to include docs/configs',
        allowed: 'Next: graph_pull for cross-layer context on a known node.' },
      out,
      'a widening already performed must not be suggested as the next step',
    );
  }, 20_000);

  it('★★★ POSITIVE CONTROL: a query WITH results carries no such disclosure', async () => {
    // ⛔ Without this, the assertions above are satisfied by appending the sentence to every
    // response — which would put a permanent caveat on every successful search in the product.
    repoRoot = await topicRepo();
    const out = await graphSearch({ repoRoot, query: 'widget', kind: 'all' });
    expect(out, 'this query does find something').toMatch(/design-notes\.md/);
    expectAbsentWithLiveMatcher(
      /FILENAME, TITLE and HEADINGS only/,
      { forbidden: 'Scope searched for documents: FILENAME, TITLE and HEADINGS only.',
        allowed: 'NODE abc document design-notes.md docs/design-notes.md:1' },
      out,
      'a successful search must not carry a permanent caveat',
    );
  }, 20_000);
});
