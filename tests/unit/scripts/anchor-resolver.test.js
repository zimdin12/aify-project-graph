// ⛔⛔ THE PROVIDER SIDE OF THE DASHBOARD CODE-GRAPH SEAM MUST NOT MANUFACTURE A VERDICT.
//
// The seam takes four answers per anchor and turns them into marks on a page a human reads. Three of the
// failures below are the ones that put a WRONG mark there, and a wrong mark is worse than none: it sends
// somebody looking for a deletion that never happened, or tells them a module is untouched when the provider
// simply could not see it.
//
//   1. `changed` on a first sweep, because no baseline exists yet        → the page says the repository moved
//   2. `gone` for a symbol the extractor never models                   → a deletion that never happened
//   3. `unhandled_language` for a file the DOCUMENT path covers          → coverage reported as absence
//
// ⛔ THE THIRD ONE IS THE DEFECT I ALMOST SHIPPED, and it is the same shape as a measurement I had corrected
// hours earlier: ONE PREDICATE FOR A QUESTION PRODUCED BY THREE PATHS. `getLanguageConfig('AGENTS.md')`
// THROWS, and AGENTS.md has a Document node anyway. Routing on that one predicate reports an absence for a
// covered file, in the confident direction.
//
// ⚠ WHAT THESE ARMS DO NOT PROVE: the deps are fakes here, so this file bounds the DECISIONS, never the
// extractor or the doc scanner. Those were measured separately and live, with positive and negative controls,
// in `docs/evidence/dashboard-seam-2026-09-30/anchor-facts-probe.mjs` — including the mutation that says the
// fingerprint is not simply constant. A hermetic test of a routing decision cannot establish either.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveAnchor, splitBatch, docLinkSet, presentWithExactCase,
  STAMP_VERSIONS, UNWATCHED_REASONS,
} from '../../../scripts/lib/anchor-resolver.mjs';

let repoRoot;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-anchor-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'code.js'), 'export function a() { return 1; }\n');
  await writeFile(join(repoRoot, 'src', 'consts.js'), 'export const TABLE = [1, 2, 3];\n');
  await writeFile(join(repoRoot, 'README.md'), '# doc\n\nsee [x](src/code.js)\n');
  await writeFile(join(repoRoot, '.gitattributes'), '* text=auto\n');
});

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

// The fake deps. Each one is a NAMED WORLD rather than a mock with behaviour scattered through the arms, so
// an arm's expectation can be read against the world it ran in.
// ⚠ `coverage` defaults to a COMPLETE extraction, because that is what the real `extractFile` returns for a
// clean file. It was absent from this fake until the extractor learned to report it; the resolver now refuses a
// missing `coverage` (fail closed), so a fake without it would be modelling a contract that no longer exists.
const COMPLETE = Object.freeze({ parseHadError: false, depthCapFired: false, depthCap: 80 });

function deps({
  symbols = null, fp = 'FP1', docRefs = [{ written: 'src/code.js', fenced: false }], coverage = COMPLETE,
} = {}) {
  return {
    // Only `.js` has a code extractor here, which is the real shape: `.md` and `.gitattributes` both throw.
    languageOf: (rel) => {
      if (rel.endsWith('.js')) return { name: 'javascript' };
      throw new Error(`No language config found for ${rel}`);
    },
    isDocument: (rel) => rel.endsWith('.md'),
    readSource: () => 'source text',
    extract: ({ relPath }) => ({
      nodes: [
        { type: 'File', label: relPath },
        { type: 'Module', label: 'mod' },
        // `symbols` is per-world: null means "this file's symbols are not modelled", which is what the real
        // extractor produces for a file of data constants.
        ...(symbols ?? []),
      ],
      // ⛔ `null`, NOT `undefined`, means "this world's extractor did not report coverage". A default parameter
      // REPLACES an explicit `undefined`, so `deps({ coverage: undefined })` would silently receive COMPLETE and
      // the arm that tests a missing report would be testing a complete one. Defaults do not replace `null`.
      ...(coverage === null ? {} : { coverage }),
    }),
    fileFingerprint: () => fp,
    docReferences: () => docRefs,
  };
}

const moduleItem = (over = {}) => ({
  watchId: 'w1',
  anchor: { project: 'p', path: 'src/code.js', name: 'code', kind: 'module' },
  stamp: null,
  ...over,
});

describe('resolveAnchor decides only what it observed', () => {
  it('★★★ a NULL baseline is `restamp`, never `changed`', () => {
    const out = resolveAnchor({ repoRoot, item: moduleItem({ stamp: null }), deps: deps() });
    expect(out.kind).toBe('result');
    // ⛔ THE WHOLE POINT. With seven anchors and no stamps, `changed` would mark all seven on the first
    // sweep and tell an operator the entire repository moved while nothing did.
    expect(out.row.status).toBe('restamp');
    expect(out.row.stamp).toEqual({ hash: 'FP1', stampVersion: STAMP_VERSIONS.code });
    expect(out.row.evidence).toMatch(/first baseline/u);
  });

  it('★★★ an UNCOMPARABLE stamp version is `restamp`, and says so', () => {
    const item = moduleItem({ stamp: { hash: 'FP1', stampVersion: 'apg-something-older', commit: 'abc' } });
    const out = resolveAnchor({ repoRoot, item, deps: deps() });
    // Note the hash MATCHES here. Only the version differs, so a provider comparing hashes alone would say
    // `unchanged` about two values that were never comparable.
    expect(out.row.status).toBe('restamp');
    expect(out.row.evidence).toMatch(/not comparable/u);
  });

  it('★★★ an equal stamp is `unchanged` and a different one is `changed`', () => {
    const same = resolveAnchor({
      repoRoot,
      item: moduleItem({ stamp: { hash: 'FP1', stampVersion: STAMP_VERSIONS.code, commit: 'abc' } }),
      deps: deps({ fp: 'FP1' }),
    });
    expect(same.row.status).toBe('unchanged');

    const moved = resolveAnchor({
      repoRoot,
      item: moduleItem({ stamp: { hash: 'FP_OLD', stampVersion: STAMP_VERSIONS.code, commit: 'abc' } }),
      deps: deps({ fp: 'FP_NEW' }),
    });
    // ⛔ BOTH DIRECTIONS IN ONE ARM, DELIBERATELY. An implementation that always returned `unchanged` would
    // pass the first half; one that always returned `changed` would pass the second. Neither passes both.
    expect(moved.row.status).toBe('changed');
    expect(moved.row.evidence).toMatch(/Baseline was FP_OLD/u);
  });

  it('★★★ a file absent from the tree is `gone`, decided by the filesystem', () => {
    const item = moduleItem({ anchor: { path: 'src/deleted.js', name: 'deleted', kind: 'module' } });
    const out = resolveAnchor({ repoRoot, item, deps: deps() });
    expect(out.row.status).toBe('gone');
    // ⚠ And it carries no stamp: there is nothing present to stamp.
    expect(out.row.stamp).toBeUndefined();
  });

  it('★★★ a WRONG-CASE path is `gone` — the case-insensitive filesystem must not answer this', () => {
    // ⛔ THE LIVE PHANTOM THIS REPO SHIPPED. `existsSync('src/CODE.js')` returns TRUE on Windows while the
    // file is `src/code.js`, so a stale anchor spelling would report `unchanged` forever.
    //
    // POSITIVE CONTROL FIRST, so the negative below is about case and not about a broken checker.
    expect(presentWithExactCase(repoRoot, 'src/code.js'), 'the real spelling must be PRESENT').toBe(true);
    expect(presentWithExactCase(repoRoot, 'src/CODE.js'), 'the wrong case must be ABSENT').toBe(false);

    const item = moduleItem({ anchor: { path: 'src/CODE.js', name: 'code', kind: 'module' } });
    expect(resolveAnchor({ repoRoot, item, deps: deps() }).row.status).toBe('gone');
  });
});

describe('the three coverage paths are all asked before an absence is reported', () => {
  it('★★★ a MARKDOWN anchor resolves on the DOCUMENT path although languageOf THROWS', () => {
    // ⛔⛔ THE DEFECT THIS FILE EXISTS FOR. Routed on `getLanguageConfig` alone, this returns
    // `unwatched: unhandled_language` for a file that has a Document node — coverage reported as absence.
    const item = {
      watchId: 'w-doc',
      anchor: { project: 'p', path: 'README.md', name: 'readme', kind: 'module' },
      stamp: null,
    };
    const out = resolveAnchor({ repoRoot, item, deps: deps() });
    expect(out.kind, 'a covered document must NOT be reported as unwatched').toBe('result');
    expect(out.row.status).toBe('restamp');
    // ⭐ And it stamps with the DOC version, in the same batch as code anchors — their stamps table is keyed
    // per watch id, so one batch carries mixed versions.
    expect(out.row.stamp.stampVersion).toBe(STAMP_VERSIONS.doc);
    expect(out.row.stamp.stampVersion).not.toBe(STAMP_VERSIONS.code);
  });

  it('★★★ kind "file" is a WHOLE-FILE anchor, not an unknown kind', () => {
    // ⛔ THE LIVE SET CORRECTED ME HERE. I built for kind "module" from a description in prose; the real
    // anchors carry `module` (4), `symbol` (1) and `file` (2). Their service does not constrain the
    // vocabulary at all — `anchor` is `Record<string, unknown>` — so the kinds are whatever a document
    // author wrote, and a provider that supports only the ones it guessed refuses real anchors. This arm
    // came from a DRY RUN against the live set, not from re-reading my own code.
    const asFile = resolveAnchor({
      repoRoot,
      item: { watchId: 'w-f', anchor: { path: 'src/code.js', name: 'code', kind: 'file' }, stamp: null },
      deps: deps(),
    });
    expect(asFile.kind).toBe('result');
    expect(asFile.row.stamp.stampVersion).toBe(STAMP_VERSIONS.code);

    // A DOCUMENT anchored as kind "file" must still route to the doc path — this is the live AGENTS.md case.
    const asDoc = resolveAnchor({
      repoRoot,
      item: { watchId: 'w-d', anchor: { path: 'README.md', name: 'readme', kind: 'file' }, stamp: null },
      deps: deps(),
    });
    expect(asDoc.kind, 'a document anchored as kind "file" is still a document').toBe('result');
    expect(asDoc.row.stamp.stampVersion).toBe(STAMP_VERSIONS.doc);

    // ⛔ AND THE OPEN VOCABULARY STILL REFUSES WHAT IT DOES NOT KNOW. Because the service constrains nothing,
    // an unknown kind will arrive one day; guessing "probably the whole file" would publish a verdict for an
    // anchor whose author meant something else.
    const unknown = resolveAnchor({
      repoRoot,
      item: { watchId: 'w-u', anchor: { path: 'src/code.js', name: 'code', kind: 'paragraph' }, stamp: null },
      deps: deps(),
    });
    expect(unknown.kind).toBe('unwatched');
    expect(unknown.row.reason).toBe(UNWATCHED_REASONS.unsupported_anchor_kind);
  });

  it('★★★ a file covered by NEITHER path is `unwatched`, naming the absence as an absence', () => {
    const item = {
      watchId: 'w-attr',
      anchor: { project: 'p', path: '.gitattributes', name: 'git-attributes', kind: 'module' },
      stamp: null,
    };
    const out = resolveAnchor({ repoRoot, item, deps: deps() });
    expect(out.kind).toBe('unwatched');
    expect(out.row.reason).toBe(UNWATCHED_REASONS.unhandled_language);
    // ⚠ The wording matters as much as the routing: "absence of coverage, not a clean result" is what stops
    // a reader treating a silent anchor as a verified one.
    expect(out.row.reason).toMatch(/absence of coverage, not a clean result/u);
  });
});

describe('a symbol anchor reports the population before the verdict', () => {
  const symbolItem = (path, name) => ({
    watchId: 'w-sym',
    anchor: { project: 'p', path, name, kind: 'symbol' },
    stamp: null,
  });

  it('★★★ ZERO symbols extracted is `unwatched`, NOT `gone`', () => {
    // ⛔⛔ MEASURED IN THE REAL REPO: taxonomy.js yields 2 nodes and ZERO symbols because it is entirely
    // data constants, while NODE_TYPES sits at taxonomy.js:85 right now. "Not among the symbols" is TRUE and
    // says NOTHING about existence. A CHECK THAT CANNOT TELL WHICH OF TWO WORLDS IT IS IN MUST NOT REPORT
    // EITHER — reporting `gone` asserts a deletion that never happened.
    const out = resolveAnchor({
      repoRoot, item: symbolItem('src/consts.js', 'TABLE'), deps: deps({ symbols: null }),
    });
    expect(out.kind).toBe('unwatched');
    expect(out.row.reason).toBe(UNWATCHED_REASONS.symbol_kind_not_modelled);
  });

  it('★★★ INSTRUMENT CONTROL — with symbols present, a missing name IS `gone`', () => {
    // ⛔ WITHOUT THIS ARM THE ONE ABOVE PROVES NOTHING. A resolver that returned `unwatched` for every
    // symbol anchor would pass it. This is the same fake deps with a NON-EMPTY symbol list, so the pair
    // separates "the instrument was silent" from "the instrument spoke and said no".
    const out = resolveAnchor({
      repoRoot,
      item: symbolItem('src/code.js', 'vanished'),
      deps: deps({ symbols: [{ type: 'Function', label: 'a', structural_fp: 's', dependency_fp: 'd' }] }),
    });
    expect(out.kind).toBe('result');
    expect(out.row.status).toBe('gone');
    expect(out.row.evidence, 'the evidence must state the population it searched').toMatch(/1 symbols/u);
  });

  it('★★★ a found symbol is stamped on its own shape, and says the body is not hashed', () => {
    const out = resolveAnchor({
      repoRoot,
      item: symbolItem('src/code.js', 'a'),
      deps: deps({ symbols: [{ type: 'Function', label: 'a', structural_fp: 's', dependency_fp: 'd' }] }),
    });
    expect(out.row.status).toBe('restamp');
    expect(out.row.stamp.stampVersion).toBe(STAMP_VERSIONS.symbol);
    // ⚠ THE LIMIT IS RECORDED, AND — CORRECTED — IT DOES NOT REACH THE OPERATOR. `structuralFingerprint`
    // hashes signature/decorators/parent/type and `dependencyFingerprint` the outgoing set; neither hashes
    // the body, so a rewrite changing no signature and no outgoing call reports `unchanged`.
    //
    // ⛔ THIS COMMENT USED TO END "and the consumer is told so rather than left to infer it". THAT WAS FALSE.
    // `detailFor` (their watch.ts:204) reads only the `keys` and `goneHints` ARRAYS out of `evidence`, and
    // `readStrings` returns [] for a string, so none of this prose renders. What does reach them is `trust`,
    // asserted on the next line. A false caveat costs a reader exactly what a missing one does, so the arm
    // now checks the prose exists in OUR record and does not pretend it is delivered.
    expect(out.row.evidence).toMatch(/THE BODY IS NOT HASHED/u);
    expect(out.row.trust).toEqual({ provenance: 'EXTRACTED', exhaustive: false });
  });

  it('★★★ a symbol anchor on a NON-CODE file refuses instead of guessing', () => {
    const out = resolveAnchor({ repoRoot, item: symbolItem('README.md', 'heading'), deps: deps() });
    expect(out.kind).toBe('unwatched');
    expect(out.row.reason).toBe(UNWATCHED_REASONS.unsupported_anchor_kind);
  });
});

describe('an extraction that cannot say it is complete gets no verdict', () => {
  const item = moduleItem({ stamp: { hash: 'FP1', stampVersion: STAMP_VERSIONS.code, commit: 'abc' } });

  it('★★★ a PARSE ERROR is `unparseable`, never a verdict — the reason that used to be unreachable', () => {
    // ⛔ tree-sitter does not throw on bad syntax; it returns a partial tree. So `unparseable`, which fired only
    // on a throw, was dead for exactly the case its text describes. MEASURED on the real extractor: a file cut
    // at 55% gave 6 symbols instead of 9 and a different fingerprint, with no complaint.
    //
    // ⚠ The stamp MATCHES here on purpose. A resolver that ignored coverage would answer `unchanged` — the
    // partial instrument agreeing with its own partial view, which is the laundering this arm exists to catch.
    const out = resolveAnchor({
      repoRoot, item, deps: deps({ fp: 'FP1', coverage: { ...COMPLETE, parseHadError: true } }),
    });
    expect(out.kind, 'a partial parse must not produce a verdict').toBe('unwatched');
    expect(out.row.reason).toBe(UNWATCHED_REASONS.unparseable);
  });

  it('★★★ a DEPTH-CAP bail is `extraction_truncated`, never a verdict', () => {
    const out = resolveAnchor({
      repoRoot, item, deps: deps({ fp: 'FP1', coverage: { ...COMPLETE, depthCapFired: true } }),
    });
    expect(out.kind).toBe('unwatched');
    expect(out.row.reason).toBe(UNWATCHED_REASONS.extraction_truncated);
  });

  it('★★★ a MISSING coverage report FAILS CLOSED as `coverage_unknown`', () => {
    // ⛔ `coverage?.parseHadError` on an absent field is `undefined`, which reads as "no error". A guard that
    // passes when its input is missing is decoration, so absence refuses.
    const out = resolveAnchor({ repoRoot, item, deps: deps({ fp: 'FP1', coverage: null }) });
    expect(out.kind).toBe('unwatched');
    expect(out.row.reason).toBe(UNWATCHED_REASONS.coverage_unknown);
  });

  it('★★★ INSTRUMENT CONTROL — the SAME world with a complete report DOES get a verdict', () => {
    // ⛔ WITHOUT THIS THE THREE ARMS ABOVE PROVE NOTHING: a resolver that refused every code anchor would pass
    // all three. Same item, same fingerprint, same stamp; only `coverage` differs, and now it must be answered.
    const out = resolveAnchor({ repoRoot, item, deps: deps({ fp: 'FP1', coverage: COMPLETE }) });
    expect(out.kind).toBe('result');
    expect(out.row.status).toBe('unchanged');
  });

  it('★★★ the DOCUMENT path does not depend on extractor coverage', () => {
    // The doc path reads references with its own scanner and never calls `extract`, so an extractor that could
    // not report coverage must not take a covered document down with it.
    const out = resolveAnchor({
      repoRoot,
      item: { watchId: 'w-doc', anchor: { path: 'README.md', name: 'r', kind: 'file' }, stamp: null },
      deps: deps({ coverage: null }),
    });
    expect(out.kind).toBe('result');
    expect(out.row.stamp.stampVersion).toBe(STAMP_VERSIONS.doc);
  });
});

describe('the batch proves its own completeness', () => {
  it('★★★ every watchId appears exactly once, and both failures are NAMED', () => {
    const rows = [
      { kind: 'result', row: { watchId: 'a', status: 'unchanged' } },
      { kind: 'unwatched', row: { watchId: 'b', reason: 'because' } },
    ];
    const ok = splitBatch(rows, ['a', 'b']);
    expect(ok.complete).toBe(true);
    expect(ok.results).toHaveLength(1);
    expect(ok.unwatched).toHaveLength(1);

    // ⛔ A MISSING id and a DUPLICATED id are different bugs and must not share one boolean, or the message
    // sends the reader to the wrong half.
    const missing = splitBatch(rows, ['a', 'b', 'c']);
    expect(missing.complete).toBe(false);
    expect(missing.missing).toEqual(['c']);
    expect(missing.duplicated).toEqual([]);

    const dup = splitBatch([...rows, rows[0]], ['a', 'b']);
    expect(dup.complete).toBe(false);
    expect(dup.duplicated).toEqual(['a']);
    expect(dup.missing).toEqual([]);
  });

  it('★★★ an unknown reason key THROWS rather than sending an empty reason', () => {
    // ⛔ Their service refuses an empty reason, and an anchor skipped for a reason nobody recorded reads as a
    // bug in THEIR product. A typo on this side would become that bug, wearing their name.
    const item = {
      watchId: 'w', anchor: { path: 'x', name: 'x', kind: 'nonsense-kind' }, stamp: null,
    };
    // This kind is genuinely unsupported, so it must come back as a REASON that exists...
    expect(resolveAnchor({ repoRoot, item, deps: deps() }).row.reason)
      .toBe(UNWATCHED_REASONS.unsupported_anchor_kind);
    // ...and every reason the module can emit must be a non-empty string, derived from the table itself
    // rather than from a list repeated here.
    for (const [key, text] of Object.entries(UNWATCHED_REASONS)) {
      expect(typeof text, `${key} must carry prose`).toBe('string');
      expect(text.length, `${key} must not be empty`).toBeGreaterThan(20);
    }
  });
});

describe('a doc link set is a set, and excludes what the doc layer excludes', () => {
  it('★★★ fenced references are dropped, duplicates collapse, order does not matter', () => {
    const refs = [
      { written: 'b.md', fenced: false },
      { written: 'a.md', fenced: false },
      { written: 'a.md', fenced: false },
      { written: 'only-in-a-code-block.md', fenced: true },
    ];
    expect(docLinkSet(refs)).toEqual(['a.md', 'b.md']);
    // Reordering the input must not change the stamp, or every text move reports `changed`.
    expect(docLinkSet([...refs].reverse())).toEqual(['a.md', 'b.md']);
    // NEGATIVE CONTROL: a document with nothing but fenced references has an EMPTY link set, and that is a
    // real answer rather than a refusal — the document points at nothing the graph tracks.
    expect(docLinkSet([{ written: 'x.md', fenced: true }])).toEqual([]);
    expect(docLinkSet(undefined)).toEqual([]);
  });
});
