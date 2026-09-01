// The WRITTEN QUALIFIER carrier — the sibling of `lexical_scope`, and why it had to exist.
//
// `namespace alpha { void Widget::render() {} }` and `void alpha::Widget::render() {}` converge on
// the qname `alpha.Widget.render`. Before this carrier, the only thing separating them was that
// `lexical_scope` was ABSENT on the second — the distinction was an inference performed by the
// reader, not a source recorded by the producer. Any other cause of an absent lexical scope would
// have been read as "written qualification", silently.
//
// Now both are positively recorded, and they differ in CONTENT rather than in presence:
//   lexical form → lexical_scope [alpha]        + written_qualifier [Widget]
//   written form → written_qualifier [alpha, Widget], no lexical scope
//
// ⚠ CLAIM CEILING — AST-DERIVED CANONICAL SEGMENTS, NOT VERBATIM SPELLING.
// `extractQualifiedScopeSegments` recurses through `template_type` into its `name` field, so
// `Widget<T>::render` records the segment `Widget`. The authority claims the segments came from
// walking the AST. It does NOT claim byte preservation, template arguments, or that the source
// spelling can be reconstructed. Exact spelling would be a separate per-segment field with its own
// named normalization — not an inference from this authority.
//
// ⚠ These carriers have NO PRODUCTION CONSUMER today. Step C is the intended consumer. Until it
// lands they are recorded and unread, which is a real cost, not a hidden one.
import { describe, it, expect } from 'vitest';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import { getLanguageConfig } from '../../../mcp/stdio/ingest/languages/index.js';

function symbolsOf(filePath, source) {
  const result = extractFile({ filePath, source, config: getLanguageConfig(filePath) });
  return (result.nodes ?? []).filter((node) => ['Function', 'Method'].includes(node.type));
}

const LEXICAL_FORM = 'namespace alpha { class Widget { public: void render(); };\nvoid Widget::render() {} }';
const WRITTEN_FORM = 'namespace alpha { class Widget { public: void render(); }; }\nvoid alpha::Widget::render() {}';

const definitionIn = (filePath, source) =>
  symbolsOf(filePath, source).find((node) => node.extra?.qname === 'alpha.Widget.render');

describe('written_qualifier — the second evidence source', () => {
  it('an AST-qualified declarator records every qualifier segment with AST authority', () => {
    const definition = definitionIn('src/exp.cpp', WRITTEN_FORM);
    expect(definition.extra.written_qualifier).toEqual([
      { segment: 'alpha', authority: 'cpp_qualified_identifier_ast' },
      { segment: 'Widget', authority: 'cpp_qualified_identifier_ast' },
    ]);
  });

  it('★ the two sources are distinguished by CONTENT, not by one of them being absent', () => {
    // This is the whole reason the carrier exists. Both qnames are identical; a consumer that
    // could only see `lexical_scope` would have to infer the second case from an absence.
    const lexical = definitionIn('src/lex.cpp', LEXICAL_FORM);
    const written = definitionIn('src/exp.cpp', WRITTEN_FORM);

    expect(lexical.extra.qname).toBe(written.extra.qname);

    expect(lexical.extra.lexical_scope).toEqual([{ segment: 'alpha', authority: 'lexical_ast' }]);
    expect(lexical.extra.written_qualifier).toEqual([
      { segment: 'Widget', authority: 'cpp_qualified_identifier_ast' },
    ]);

    expect(written.extra.lexical_scope).toBeUndefined();
    expect(written.extra.written_qualifier.map((s) => s.segment)).toEqual(['alpha', 'Widget']);

    // `alpha` is present in BOTH cases and attributed differently — the discriminating assertion.
    const alphaAuthority = (node) =>
      [...(node.extra.lexical_scope ?? []), ...(node.extra.written_qualifier ?? [])]
        .filter((s) => s.segment === 'alpha')
        .map((s) => s.authority);
    expect(alphaAuthority(lexical)).toEqual(['lexical_ast']);
    expect(alphaAuthority(written)).toEqual(['cpp_qualified_identifier_ast']);
  });

  it('CEILING: a templated owner records the canonical segment, not the written spelling', () => {
    const [definition] = symbolsOf('src/tpl.cpp', 'template <typename T> void Widget<T>::render() {}');
    expect(definition.extra.written_qualifier).toEqual([
      { segment: 'Widget', authority: 'cpp_qualified_identifier_ast' },
    ]);
    // Stated as an assertion so the ceiling cannot quietly drift into a byte-preservation claim.
    expect(definition.extra.written_qualifier[0].segment).not.toBe('Widget<T>');
  });

  it('POSITIVE CONTROL: unqualified C++ has NO carrier, not an empty one', () => {
    const [fn] = symbolsOf('src/plain.cpp', 'void standalone() {}');
    expect(fn.extra.written_qualifier).toBeUndefined();
  });

  it('POSITIVE CONTROL: non-C++ never grows the field, including a class method', () => {
    const [fn] = symbolsOf('src/mod.js', 'export function alone() { return 1; }');
    expect(fn.extra.written_qualifier).toBeUndefined();
    // A JS method's owner comes from AST containment, which is neither of these two sources.
    const [method] = symbolsOf('src/cls.js', 'export class Box { grow() { return 1; } }');
    expect(method.extra.qname).toBe('src.cls.Box.grow');
    expect(method.extra.written_qualifier).toBeUndefined();
    expect(method.extra.lexical_scope).toBeUndefined();
  });

  it('every emitted segment carries its own authority, so provenance survives projection', () => {
    // Kills a shape where authority is stored once per field. A later projection that keeps only
    // the segments would silently lose provenance, and step C would weigh text as AST.
    const definition = definitionIn('src/exp.cpp', WRITTEN_FORM);
    for (const entry of definition.extra.written_qualifier) {
      expect(Object.keys(entry).sort()).toEqual(['authority', 'segment']);
      expect(typeof entry.authority).toBe('string');
    }
  });
});

describe('⛔ the regex fallback authority is currently UNREACHABLE through extractFile', () => {
  // cpp.js has a SECOND producer of qualifier segments: a regex over declarator text, kept for
  // "shapes the AST cannot resolve". It stamps `cpp_declarator_regex_fallback` rather than the AST
  // authority, because segments split out of text are not segments walked out of a tree.
  //
  // ⛔ No input found so far reaches it. 28 shapes were probed — plain, templated, destructor,
  // operator, conversion operator, ctor-with-init-list, const/ref-qualified, trailing return,
  // function-pointer and array returns, nested classes, anonymous namespaces, macro-prefixed
  // declarators, and several deliberately malformed ones. Every qualified shape was caught by the
  // AST branch; every macro-mangled shape produced no qualified symbol at all.
  //
  // ⚠ CLAIM CEILING: "no input among the probed shapes reaches it", NOT "unreachable in general".
  // This is a tripwire, not a proof. If a future change to the AST branch lets the fallback fire,
  // this test fails and the fallback stops being untested-by-assumption.
  const SHAPES = [
    ['plain', 'void Widget::render() {}'],
    ['templated owner', 'template <typename T> void Widget<T>::render() {}'],
    ['destructor', 'Widget::~Widget() {}'],
    ['operator', 'void Widget::operator<<(int x) {}'],
    ['conversion operator', 'Widget::operator int() const {}'],
    ['ctor init list', 'Widget::Widget() : x_(0) {}'],
    ['const member', 'int Widget::value() const {}'],
    ['ref qualified', 'void Widget::render() & {}'],
    ['trailing return', 'auto Widget::render() -> void {}'],
    ['function ptr return', 'void (*Widget::getCb())() {}'],
    ['array return', 'int (&Widget::grid())[4] {}'],
    ['nested class', 'void Outer::Inner::run() {}'],
    ['anonymous namespace', 'namespace { void Widget::render() {} }'],
    ['macro return type', 'API_EXPORT void Widget::render() {}'],
    ['macro noexcept', 'MYAPI void Widget::render() noexcept {}'],
    ['pointer return + macro', 'MYAPI char* Widget::name() {}'],
  ];

  it('no probed shape emits the fallback authority', () => {
    const authorities = SHAPES.flatMap(([, source]) =>
      symbolsOf('src/probe.cpp', source).flatMap((node) =>
        (node.extra?.written_qualifier ?? []).map((entry) => entry.authority),
      ),
    );
    expect(authorities).not.toContain('cpp_declarator_regex_fallback');
  });

  it('POSITIVE CONTROL: the probe corpus does produce carriers, so the zero above is a real zero', () => {
    // Without this, deleting the carrier entirely would make the assertion above pass. An empty
    // authority list cannot contain the fallback value either.
    const authorities = SHAPES.flatMap(([, source]) =>
      symbolsOf('src/probe.cpp', source).flatMap((node) =>
        (node.extra?.written_qualifier ?? []).map((entry) => entry.authority),
      ),
    );
    expect(authorities.length).toBeGreaterThan(10);
    expect(new Set(authorities)).toEqual(new Set(['cpp_qualified_identifier_ast']));
  });
});
