// ⛔ TWO SYMBOLS IN DIFFERENT NAMESPACES ARE CURRENTLY BYTE-IDENTICAL.
//
// `visit()` carries only `parentClass`, and generic.js advances it on one condition —
// `resolvedType === 'Class'`. A `namespace_definition` DOES match a rule (cpp.js, emitted as
// `Module`), so the namespace exists as a node; it simply never enters the scope chain. So
// `alpha::W::go` and `beta::W::go` produce the same qname, and the only thing distinguishing them
// lives in a node the qname never consults.
//
// ⛔ THE CHEAP FIX IS A DATA-CORRUPTION PATH, NOT A NAMING COMPLAINT. Feeding namespaces through
// `parent_class` would hit `resolvedType = explicitType === 'Function' && parentClassLabel ?
// 'Method' : explicitType` — turning EVERY FREE FUNCTION IN A NAMESPACE into a Method, then
// propagating that through containment edges, fingerprints and test detection.
//
// ⛔ AND A FALLBACK WOULD SILENTLY FAIL GATE 5. generic.js reads
// `symbolInfo?.parentClassQname ?? parentClass?.extra?.qname ?? parentClassLabel` — symbolInfo
// WINS. For `namespace alpha { void Widget::render() {} }` the C++ extractor returns
// `parentClassQname: 'Widget'`, so lexical scope inserted after that `??` chain never fires. The
// scope must be COMPOSED, not offered as a default.
//
// Preregistration, with all seven gates: docs/evidence/m1a-step-b/PREREGISTRATION.md
// ⚠ Claim ceiling: lexical scope AS WRITTEN reaches the qname. Not resolved semantic identity,
// not linkage, not a claim that two sites are the same symbol — those are step C.
import { describe, it, expect } from 'vitest';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import { getLanguageConfig } from '../../../mcp/stdio/ingest/languages/index.js';

const src = (...rows) => `${rows.join('\n')}\n`;
const SYMBOLS = new Set(['Function', 'Method', 'Class', 'Struct', 'Test']);

const symbolsOf = (relPath, source) => (extractFile({
  filePath: relPath, source, config: getLanguageConfig(relPath),
})?.nodes ?? []).filter((n) => SYMBOLS.has(n.type));

const qnamesOf = (relPath, source, label) =>
  symbolsOf(relPath, source).filter((n) => n.label === label).map((n) => n.extra.qname);

describe('step B gate 3 — same leaf name in two namespaces is DISTINCT', () => {
  const TWO_NS = src(
    'namespace alpha { class W { public: void go(); }; void W::go() {} }',
    'namespace beta  { class W { public: void go(); }; void W::go() {} }',
  );

  it('⛔ the two DECLARATION sites do not share a qname', () => {
    const decls = symbolsOf('src/ns.cpp', TWO_NS)
      .filter((n) => n.label === 'go' && n.extra.site_kind === 'declaration')
      .map((n) => n.extra.qname);
    expect(decls.length, 'both declarations must exist — step A guarantees this').toBe(2);
    expect(new Set(decls).size, 'alpha::W::go and beta::W::go are different symbols').toBe(2);
  });

  it('⛔ the two DEFINITION sites do not share a qname', () => {
    const defs = symbolsOf('src/ns.cpp', TWO_NS)
      .filter((n) => n.label === 'go' && n.extra.site_kind === 'definition')
      .map((n) => n.extra.qname);
    expect(defs.length).toBe(2);
    expect(new Set(defs).size, 'the definitions are different symbols too').toBe(2);
  });
});

describe('step B gate 4 — nested namespaces compose IN ORDER', () => {
  it('⛔ an inner namespace does not erase or reorder the outer one', () => {
    const nested = src('namespace outer { namespace inner { void deep() {} } }');
    const [qname] = qnamesOf('src/nested.cpp', nested, 'deep');
    expect(qname, 'the qname must carry both scopes').toMatch(/outer/);
    expect(qname).toMatch(/inner/);
    expect(qname.indexOf('outer'), 'outer must precede inner').toBeLessThan(qname.indexOf('inner'));
  });
});

describe('step B gate 5 — both qualification forms CONVERGE, without double-prefixing', () => {
  // The gate a fallback implementation passes on one side and fails on the other.
  const LEXICAL = src('namespace alpha { class Widget { public: void render(); };', 'void Widget::render() {} }');
  const EXPLICIT = src('namespace alpha { class Widget { public: void render(); }; }', 'void alpha::Widget::render() {}');

  it('⛔ the lexical-relative definition carries the enclosing namespace', () => {
    const defs = symbolsOf('src/lex.cpp', LEXICAL)
      .filter((n) => n.label === 'render' && n.extra.site_kind === 'definition');
    expect(defs.length, 'the definition must exist').toBeGreaterThan(0);
    expect(defs[0].extra.qname, 'alpha is lexical here, and must still reach the qname').toMatch(/alpha/);
  });

  it('⛔ ANTI-DOUBLE-PREFIX: explicit qualification does not repeat the namespace', () => {
    // Composing a lexical scope onto an already-qualified name is the obvious way to break this.
    const defs = symbolsOf('src/exp.cpp', EXPLICIT).filter((n) => n.label.includes('render'));
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) {
      const hits = (String(d.extra.qname).match(/alpha/g) ?? []).length;
      expect(hits, `"${d.extra.qname}" repeats the namespace`).toBeLessThanOrEqual(1);
    }
  });
});

describe('step B gate 2 — a namespace is NEVER a parent class', () => {
  it('⛔ a free function in a namespace stays a Function, never a Method', () => {
    // generic.js derives Method from `parentClassLabel` being truthy. If a namespace ever reaches
    // that field, every namespaced free function silently becomes a Method and the corruption
    // propagates into containment edges, fingerprints and test detection.
    const freeFn = src('namespace alpha { void loose() {} }');
    const [fn] = symbolsOf('src/free.cpp', freeFn).filter((n) => n.label === 'loose');
    expect(fn, 'the function must be extracted').toBeTruthy();
    expect(fn.type, 'a namespace is not a class').toBe('Function');
    expect(fn.extra.parent_class ?? '', 'parent_class must stay a CLASS relationship').toBe('');
  });
});

describe('step B gate 6 — namespace-free C++ is BYTE-IDENTICAL', () => {
  it('POSITIVE CONTROL: a symbol outside any namespace keeps its exact qname', () => {
    // Without this, "scope now appears" could be an unconditional prefix applied to everything.
    const plain = src('void standalone() {}');
    expect(qnamesOf('src/plain.cpp', plain, 'standalone')).toEqual(['src.plain.standalone']);
  });
});

describe('step B gate 1 — non-C++ is untouched', () => {
  it('POSITIVE CONTROL: a JavaScript qname is byte-identical', () => {
    // A generic-walker PLUMBING change is allowed; a generic BEHAVIOUR change is not. 629 of this
    // repo's 795 Module nodes are JavaScript, so this is the population that would move if the
    // composition leaked out of the C++ opt-in.
    const js = src('export function alone() { return 1; }');
    expect(qnamesOf('src/mod.js', js, 'alone')).toEqual(['src.mod.alone']);
  });

  it('POSITIVE CONTROL: a Python qname is byte-identical', () => {
    const py = src('def solo():', '    return 1');
    expect(qnamesOf('src/mod.py', py, 'solo')).toEqual(['src.mod.solo']);
  });
});

// ⛔ GATE 5 AS THE PREREGISTRATION ACTUALLY WROTE IT — EXACT EQUALITY.
//
// The first version of this gate asserted "the lexical form contains alpha" and, separately, "the
// explicit form contains alpha at most once". Both passed while the product produced
// `alpha.Widget.render` and `alpha.Widget::render` — two different qnames. A gate split into two
// half-assertions cannot see a convergence failure, and I reported it green.
describe('step B gate 5 (EXACT) — the two qualification forms yield the SAME qname', () => {
  const defQname = (relPath, source) => {
    const defs = symbolsOf(relPath, source)
      .filter((n) => n.extra.site_kind === 'definition' && String(n.extra.qname).includes('render'));
    expect(defs.length, 'exactly one definition must be found, or the comparison is ambiguous').toBe(1);
    return defs[0].extra.qname;
  };

  it('⛔ lexical-relative and explicit-global definitions are byte-identical', () => {
    const lexical = defQname('src/lex.cpp', src(
      'namespace alpha { class Widget { public: void render(); };',
      'void Widget::render() {} }',
    ));
    const explicit = defQname('src/exp.cpp', src(
      'namespace alpha { class Widget { public: void render(); }; }',
      'void alpha::Widget::render() {}',
    ));
    expect(lexical).toBe(explicit);
    // Pinned, so a future change that made both wrong IDENTICALLY could not pass.
    expect(lexical).toBe('alpha.Widget.render');
  });
});

// ⛔ HOSTILE TERMINALS UNDER A NESTED QUALIFIER — where "take the last segment" could misfire.
//
// At ONE qualifier level these were already correct; the defect needs two or more, which is when
// tree-sitter nests the qualified_identifier. The template case is the discriminating one: its
// DECLARATION side already stripped `<T>` while its definition side did not, proving the two paths
// had diverged rather than that templates were unhandled.
describe('step B — nested qualifiers with hostile terminals', () => {
  const pairs = [
    ['destructor', src('namespace a { struct W { ~W(); }; }', 'a::W::~W() {}'), 'W::~W', 'a.W.~W'],
    ['operator', src('namespace a { struct W { void operator<<(int); }; }', 'void a::W::operator<<(int x) {}'), 'W::operator<<', 'a.W.operator<<'],
    ['template owner', src('namespace a { template<class T> struct W { void render(); }; }', 'template<class T> void a::W<T>::render() {}'), 'W<T>::render', 'a.W.render'],
  ];

  for (const [what, source, expectedLabel, expectedQname] of pairs) {
    it(`⛔ ${what}: canonical qname, and the display label is UNCHANGED`, () => {
      const def = symbolsOf('src/h.cpp', source).find((n) => n.extra.qname === expectedQname);
      expect(def, `no symbol with qname ${expectedQname}`).toBeTruthy();
      // The qname is canonicalised; the label keeps its source spelling. Fixing identity is not
      // licence to move every label consumer — that inconsistency stays its own contract.
      expect(def.label, 'the display label must be byte-identical to its pre-fix spelling').toBe(expectedLabel);
    });
  }

  it('POSITIVE CONTROL: a ONE-level qualifier is unchanged by the fix', () => {
    // These were already correct before the change. If they moved, the fix reached further than
    // the nested case it was built for.
    const one = symbolsOf('src/one.cpp', src('struct W { void render(); };', 'void W::render() {}'));
    expect(one.filter((n) => n.label === 'render').map((n) => n.extra.qname).sort())
      .toEqual(['W.render', 'src.one.W.render']);
  });
});

// ⛔ THE PERSISTED SCOPE CARRIER — preregistered, and originally NOT IMPLEMENTED.
//
// The preregistration promised a sibling field recording lexical scope with provenance so step C
// could tell extracted scope from guessed scope. The first implementation consumed the transient
// array and stored nothing, leaving qname as the only carrier — a promise in a design document
// with no product behind it. Review found it by reading the diff against the preregistration.
describe('step B — lexical scope is PERSISTED, with per-segment provenance', () => {
  it('⛔ each segment carries its own authority, not one flattened string', () => {
    const nested = src('namespace outer { namespace inner { void deep() {} } }');
    const [fn] = symbolsOf('src/carrier.cpp', nested).filter((n) => n.label === 'deep');
    expect(fn.extra.lexical_scope).toEqual([
      { segment: 'outer', authority: 'lexical_ast' },
      { segment: 'inner', authority: 'lexical_ast' },
    ]);
  });

  it('⛔ the two EVIDENCE SOURCES stay distinguishable even though the qnames converge', () => {
    // This is the whole reason the carrier exists. Both forms yield alpha.Widget.render; only the
    // carrier records WHERE the `alpha` came from, and step C has to weigh those differently.
    const lexical = symbolsOf('src/lex.cpp', src(
      'namespace alpha { class Widget { public: void render(); };', 'void Widget::render() {} }',
    )).find((n) => n.extra.qname === 'alpha.Widget.render');
    const explicit = symbolsOf('src/exp.cpp', src(
      'namespace alpha { class Widget { public: void render(); }; }', 'void alpha::Widget::render() {}',
    )).find((n) => n.extra.qname === 'alpha.Widget.render');

    expect(lexical.extra.qname).toBe(explicit.extra.qname);
    // ...and yet:
    expect(lexical.extra.lexical_scope, 'alpha was LEXICAL here').toEqual([{ segment: 'alpha', authority: 'lexical_ast' }]);
    expect(explicit.extra.lexical_scope, 'alpha was WRITTEN here — no lexical scope at all').toBeUndefined();
  });

  it('POSITIVE CONTROL: namespace-free C++ has NO carrier, not an empty one', () => {
    // Absent means "no enclosing namespace was written". An empty array would invite a reader to
    // treat the field as always present and therefore authoritative.
    const [fn] = symbolsOf('src/plain.cpp', src('void standalone() {}')).filter((n) => n.label === 'standalone');
    expect(fn.extra.lexical_scope).toBeUndefined();
  });

  it('POSITIVE CONTROL: non-C++ never grows the field', () => {
    const [js] = symbolsOf('src/mod.js', src('export function alone() { return 1; }')).filter((n) => n.label === 'alone');
    expect(js.extra.lexical_scope).toBeUndefined();
  });
});
