import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { resolveRefs } from '../../../mcp/stdio/ingest/resolver.js';
import { invokesRef } from '../../../mcp/stdio/ingest/frameworks/_plugin_utils.js';

// ⚠ INVOKES IS NOT MATERIALISED AS AN EXTERNAL STUB ON ITS OWN. `shouldMaterializeExternal` lists
// CALLS / PASSES_THROUGH / USES_TYPE / REFERENCES — not INVOKES — so an unresolved INVOKES ref goes
// to the dirty-edge list instead. In the real Express index the stub was minted by the middleware
// chain's PASSES_THROUGH ref and the INVOKES ref then bound to it, which is ORDER-DEPENDENT
// behaviour my first draft of this file mistook for "INVOKES materialises".
// ⇒ The chain relation is used wherever a stub is the thing under test.
// ⚠ `omitLanguage`, NOT `language: undefined`. A destructuring default substitutes when the value
// IS undefined, so passing it explicitly still yielded node.language and the ref bound — the
// "pinned defect" test was green against the very behaviour it claimed to pin.
const chainRef = (node, target, { omitLanguage = false, line = 6 } = {}) => ({
  from_id: node.id, from_label: node.label,
  relation: 'PASSES_THROUGH', target,
  source_file: 'src/routes.js', source_line: line,
  confidence: 0.72, provenance: 'INFERRED', extractor: 'node-web',
  ...(omitLanguage ? {} : { language: node.language }),
});

// ⛔ THE FRAMEWORK LAYER AND THE CODE LAYER DID NOT TOUCH, AND AN EXTRACTOR TAG IS WHY.
//
// `filterByLanguageFamily` computed `languageFamily(ref.extractor)`, and `languageFamily` returns
// its input unchanged for anything it does not recognise. So `extractor: 'node-web'` became the
// family "node-web", which matches no real node — and INVOKES / PASSES_THROUGH are HARD-GATED
// relations, so the filter returned `[]`, resolution failed, and the routed target was materialised
// as an `External` stub sitting beside the very function it should have bound to.
//
// ⛔⛔ MEASURED ON A REAL EXPRESS APP indexed by the real `reindex.mjs`: 4 of 4 routed symbols
// existed as BOTH a `Function` node and an unlinked `External` twin. `formatMoney`, defined in the
// same file but never routed, had no twin — so the framework path caused it, not every function.
// Consequence: `graph_callers("createOrderHandler")` could not see the route that routes to it.
//
// ⛔⛔⛔ AND IT HAD BEEN HIT BEFORE AND FIXED FOR ONE FRAMEWORK. `LANGUAGE_FAMILY` carries a lone
// `['laravel', 'php']` entry commented "Laravel plugin emits routes as PHP". Enumerated across every
// framework extractor tag in this repo, laravel was the ONLY one that resolved; nine others —
// nestjs, node-web, python-web, django, rails, spring, qt, cmake, shader-bindings — were left.
// A hand-written map is a defect with a delay on it.
//
// ⇒ THE FIX DERIVES INSTEAD OF LISTING. The plugin already computes the language per file and puts
// it on the Route node; `invokesRef` now carries it onto the ref, and the resolver prefers it over
// the framework tag. Refs without a language behave exactly as before.

describe('framework refs bind to repo-local symbols, not External stubs', () => {
  let dir;
  let db;

  const routeNode = (id, label, language) => ({
    id, type: 'Route', label, file_path: 'src/routes.js', start_line: 5, end_line: 5,
    language, confidence: 0.75, structural_fp: '', dependency_fp: '', extra: {},
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apg-fwrefs-'));
    db = openDb(join(dir, 'graph.sqlite'));
    // The handler the route should bind to — a real repo symbol, in another file.
    upsertNode(db, {
      id: 'fn:handler', type: 'Function', label: 'createOrderHandler', file_path: 'src/handlers.js',
      start_line: 1, end_line: 3, language: 'javascript', confidence: 1,
      structural_fp: '', dependency_fp: '', extra: {},
    });
  });

  afterEach(() => {
    try { db.close(); } catch { /* already closed */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('⛔ an INVOKES ref carrying a language binds to the repo function', () => {
    const node = routeNode('route:post-orders', 'POST /orders', 'javascript');
    const { edges, nodes } = resolveRefs({
      db,
      refs: [invokesRef({ node, target: 'createOrderHandler', extractor: 'node-web', sourceFile: 'src/routes.js', sourceLine: 6 })],
    });

    expect(edges).toHaveLength(1);
    expect(edges[0].to_id).toBe('fn:handler');
    // And no stub was minted beside it — the duplication is what made the layers separate.
    expect(nodes.filter((n) => n.type === 'External')).toHaveLength(0);
  });

  it('⛔ WITHOUT a language it still fails — this is the defect, pinned', () => {
    // Documents the exact behaviour being fixed, so a regression is recognisable rather than merely
    // red. The ref is identical except that the framework tag is all the resolver has to go on.
    const node = routeNode('route:post-orders', 'POST /orders', 'javascript');
    const { edges, nodes } = resolveRefs({ db, refs: [chainRef(node, 'createOrderHandler', { omitLanguage: true })] });
    expect(nodes.filter((n) => n.type === 'External')).toHaveLength(1);
    expect(edges[0].to_id).not.toBe('fn:handler');
  });

  it('⭐ NEGATIVE CONTROL: a third-party target STAYS External', () => {
    // `cors` is imported from a package and defined nowhere in the repo. Binding it would be wrong,
    // so the fix must not simply resolve everything — External is the correct answer here.
    const node = routeNode('route:get-public', 'GET /public', 'javascript');
    const { edges, nodes } = resolveRefs({
      db,
      refs: [chainRef(node, 'cors', { line: 9 })],
    });

    const external = nodes.filter((n) => n.type === 'External');
    expect(external).toHaveLength(1);
    expect(external[0].label).toBe('cors');
    expect(edges[0].to_id).toBe(external[0].id);
    // ⛔ AND THE STUB CARRIES THE REF LANGUAGE, NOT THE FRAMEWORK TAG. A materialised External is
    // registered with the resolver, so a later ref of the same family must be able to find it. When
    // this was derived from `extractor`, the stub was stamped "node-web" — a family nothing else in
    // the graph belongs to, so it could never be re-used and a second stub would be minted instead.
    expect(external[0].language, 'External stubs must join a real language family').toBe('js_ts');
  });

  it('⛔ THE LANGUAGE GATE STILL GATES — a same-named symbol in another language is not bound', () => {
    // The gate exists so a PHP ref never resolves to a CSS node. Carrying a language must not
    // disable it: a JavaScript route must not bind to a Python function of the same name.
    upsertNode(db, {
      id: 'fn:py', type: 'Function', label: 'pythonOnlyHandler', file_path: 'app/views.py',
      start_line: 1, end_line: 2, language: 'python', confidence: 1,
      structural_fp: '', dependency_fp: '', extra: {},
    });
    const node = routeNode('route:get-x', 'GET /x', 'javascript');
    const { edges, nodes } = resolveRefs({
      db,
      refs: [chainRef(node, 'pythonOnlyHandler', { line: 7 })],
    });

    expect(edges[0].to_id).not.toBe('fn:py');
    expect(nodes.filter((n) => n.type === 'External')).toHaveLength(1);
  });

  it('⭐ IT DISCRIMINATES: of four refs, exactly the two repo-local ones bind', () => {
    // Each assertion above passes individually for a resolver that binds everything, or nothing.
    // Counting both outcomes in one pass is the cheapest proof it is doing neither.
    upsertNode(db, {
      id: 'fn:auth', type: 'Function', label: 'requireAuth', file_path: 'src/middleware.js',
      start_line: 1, end_line: 2, language: 'javascript', confidence: 1,
      structural_fp: '', dependency_fp: '', extra: {},
    });
    const node = routeNode('route:multi', 'POST /multi', 'javascript');
    const targets = ['createOrderHandler', 'requireAuth', 'cors', 'helmet'];
    const { edges } = resolveRefs({
      db,
      refs: targets.map((t, i) => chainRef(node, t, { line: 10 + i })),
    });

    const bound = edges.filter((e) => e.to_id === 'fn:handler' || e.to_id === 'fn:auth');
    const stubs = edges.filter((e) => String(e.to_id).startsWith('external:'));
    expect(bound).toHaveLength(2);
    expect(stubs).toHaveLength(2);
  });

  it('⛔ THE MIDDLE LINK OF A CHAIN BINDS TOO — resolveOwner must carry the language forward', () => {
    // ⛔ THIS GAP SURVIVED THE FIRST MUTANT SWEEP. `resolveOwner` rebuilds a synthetic ref to look
    // up `from_target`, and that re-wrap dropped `language` — so on the real Express app the FIRST
    // and INTERMEDIATE links of a middleware chain kept materialising as External while the LAST
    // one bound correctly. Nothing here covered it until a mutant that re-broke it stayed green.
    //
    // ⇒ A ref whose SOURCE is symbolic exercises a different code path from one whose source is an
    // id. Both need a test, and only the real indexer showed me they differ.
    upsertNode(db, {
      id: 'fn:auth', type: 'Function', label: 'requireAuth', file_path: 'src/middleware.js',
      start_line: 1, end_line: 2, language: 'javascript', confidence: 1,
      structural_fp: '', dependency_fp: '', extra: {},
    });
    upsertNode(db, {
      id: 'fn:rate', type: 'Function', label: 'rateLimit', file_path: 'src/middleware.js',
      start_line: 4, end_line: 5, language: 'javascript', confidence: 1,
      structural_fp: '', dependency_fp: '', extra: {},
    });

    const { edges, nodes } = resolveRefs({
      db,
      refs: [{
        from_target: 'requireAuth', from_label: 'requireAuth',
        relation: 'PASSES_THROUGH', target: 'rateLimit',
        source_file: 'src/routes.js', source_line: 6,
        confidence: 0.72, provenance: 'INFERRED', extractor: 'node-web',
        language: 'javascript',
      }],
    });

    expect(edges).toHaveLength(1);
    expect(edges[0].from_id, 'the chain SOURCE must bind, not become a stub').toBe('fn:auth');
    expect(edges[0].to_id).toBe('fn:rate');
    expect(nodes.filter((n) => n.type === 'External')).toHaveLength(0);
  });
});

// ⛔ A SECOND GATE, BEHIND THE FIRST. Carrying a language unblocked five frameworks and did nothing
// for Qt, because a ref whose SOURCE is a name (`from_target`, no `from_id`) is rejected outright
// unless its relation is in SYMBOLIC_CHAIN_RELATIONS — and CALLS was not. `cpp_frameworks` emits
// `emit progressChanged()` as CALLS from the enclosing function NAME, exactly that shape, so its
// refs reached the dirty-edge sidecar carrying a correct `language: cpp` and were never looked at.
//
// ⭐ BLAST RADIUS MEASURED BEFORE THE CHANGE, probe positive-controlled in the same pass:
// symbolic-source refs of any relation across fmt (1,894 dirty edges), click (3,298), fast-route
// (163), p-queue (86) and this repo (18,194) = ZERO; the qt fixture = 2, both CALLS. The zeros are
// real rather than a dead probe because the control found the two it was meant to.
//
// ⚠ AND THE TWO EARLY FAILURES WERE FIXTURE PROPERTIES, NOT THE CHANGE. A class member declared
// in-class AND defined out-of-line yields TWO nodes of the same label, which is genuinely ambiguous;
// a bare prototype yields no node at all. With both sides defined once, 2 of 3 edges bind and the
// undefined third correctly stays External.
describe('a CALLS ref may name its source — the Qt signal shape', () => {
  let dir;
  let db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apg-symcalls-'));
    db = openDb(join(dir, 'graph.sqlite'));
    const fn = (id, label) => ({
      id, type: 'Function', label, file_path: 'src/worker.cpp', start_line: 1, end_line: 3,
      language: 'cpp', confidence: 1, structural_fp: '', dependency_fp: '', extra: {},
    });
    upsertNode(db, fn('fn:run', 'runTask'));
    upsertNode(db, fn('fn:progress', 'progressChanged'));
  });

  afterEach(() => {
    try { db.close(); } catch { /* already closed */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const qtRef = (target) => ({
    from_target: 'runTask', from_label: 'runTask',
    relation: 'CALLS', target,
    source_file: 'src/worker.cpp', source_line: 9,
    confidence: 0.72, provenance: 'INFERRED', extractor: 'qt', language: 'cpp',
  });

  it('⛔ binds BOTH ends when both are defined in the repository', () => {
    const { edges, nodes } = resolveRefs({ db, refs: [qtRef('progressChanged')] });
    expect(edges).toHaveLength(1);
    expect(edges[0].from_id, 'the named SOURCE must resolve, not become a stub').toBe('fn:run');
    expect(edges[0].to_id).toBe('fn:progress');
    expect(nodes.filter((n) => n.type === 'External')).toHaveLength(0);
  });

  it('⭐ NEGATIVE CONTROL: an undefined target still becomes External', () => {
    // A signal only declared, never defined, has no node to bind to. External is the right answer,
    // and the fix must not manufacture a binding for it.
    const { edges, nodes } = resolveRefs({ db, refs: [qtRef('thirdPartySignal')] });
    expect(edges[0].from_id).toBe('fn:run');
    const external = nodes.filter((n) => n.type === 'External');
    expect(external).toHaveLength(1);
    expect(external[0].label).toBe('thirdPartySignal');
  });

  it('⛔ THE GATE STILL GATES — a relation outside the set is still refused a named source', () => {
    // Opening it for CALLS must not open it for everything. USES_TYPE with a symbolic source has to
    // stay unresolved, or the set has stopped meaning anything.
    const { edges } = resolveRefs({ db, refs: [{ ...qtRef('progressChanged'), relation: 'USES_TYPE' }] });
    expect(edges).toHaveLength(0);
  });

  it('⭐ IT DISCRIMINATES: of three refs, exactly the two resolvable ones bind fully', () => {
    const { edges } = resolveRefs({
      db,
      refs: [qtRef('progressChanged'), qtRef('thirdPartySignal'), { ...qtRef('progressChanged'), relation: 'USES_TYPE' }],
    });
    const bound = edges.filter((e) => e.from_id === 'fn:run' && e.to_id === 'fn:progress');
    const stubbed = edges.filter((e) => String(e.to_id).startsWith('external:'));
    expect(bound).toHaveLength(1);
    expect(stubbed).toHaveLength(1);
    expect(edges).toHaveLength(2);
  });
});
