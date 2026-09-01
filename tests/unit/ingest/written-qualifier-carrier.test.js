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
import { QUALIFIED_DECLARATOR_TEXT_RE } from '../../../mcp/stdio/ingest/languages/cpp.js';

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


describe('the qualified regex fallback is DELETED, and qualified declarator text now refuses', () => {
  // A second producer of qualifier segments used to live here: a regex splitting declarator TEXT
  // on the scope operator. It was deleted because NO INPUT REACHED IT across 28 probed shapes, and
  // a producer no input reaches cannot be killed by mutating it — the mutant stamping its segments
  // with the AST authority was pre-registered as expected-inert, run, and SURVIVED.
  //
  // Deleting it fails CLOSED: text that still looks qualified yields no symbol rather than falling
  // through to the unqualified matcher and quietly becoming a top-level Function. That would invent
  // a free function named `render` out of `Widget::render` and hide the extraction gap entirely.
  //
  // ⚠ CEILING — THIS TESTS THE GUARD, NOT A ROUTE. The refusal fires on exactly the condition the
  // deleted fallback consumed, so it sits on the same unreachable path. No extraction-level test
  // can exercise it, and a mutant deleting the refusal would survive for that same reason. The
  // predicate is asserted directly and labelled as the weaker evidence it is. What DOES carry
  // weight is the whole-corpus C++ differential recorded in the finding: the deletion changed no
  // extracted C++ symbol.

  it('DENIAL: the guard matches declarator text that looks qualified', () => {
    for (const text of ['void Widget::render()', 'MYAPI void a::B::c()', 'int Outer::Inner::run() const', 'Widget::~Widget()']) {
      expect(QUALIFIED_DECLARATOR_TEXT_RE.test(text), text).toBe(true);
    }
  });

  it('POSITIVE CONTROL: the guard does NOT match genuinely unqualified declarators', () => {
    // Without this the guard could match everything, refuse everything, and still pass above.
    for (const text of ['void standalone()', 'int main(int argc)', 'static void helper()']) {
      expect(QUALIFIED_DECLARATOR_TEXT_RE.test(text), text).toBe(false);
    }
  });

  it('POSITIVE CONTROL: the retained UNQUALIFIED fallback still names a plain shape', () => {
    const [fn] = symbolsOf('src/plain.cpp', 'void standalone() {}');
    expect(fn.label).toBe('standalone');
    expect(fn.type).toBe('Function');
  });

  it('POSITIVE CONTROL: qualified definitions still extract through the AST branch', () => {
    const [fn] = symbolsOf('src/q.cpp', 'void Widget::render() {}');
    expect(fn.type).toBe('Method');
    expect(fn.extra.written_qualifier).toEqual([
      { segment: 'Widget', authority: 'cpp_qualified_identifier_ast' },
    ]);
  });

  it('the deleted authority value is emitted by nothing', () => {
    const sources = ['void Widget::render() {}', 'void standalone() {}', 'Widget::~Widget() {}', 'void Outer::Inner::run() {}'];
    const authorities = sources.flatMap((source) =>
      symbolsOf('src/probe.cpp', source).flatMap((node) =>
        (node.extra?.written_qualifier ?? []).map((entry) => entry.authority)));
    expect(authorities.length).toBeGreaterThan(2);
    expect(authorities).not.toContain('cpp_declarator_regex_fallback');
  });
});
