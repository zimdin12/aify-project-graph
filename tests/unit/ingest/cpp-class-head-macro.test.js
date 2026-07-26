// A dllexport/visibility macro between `class`/`struct` and the type name makes
// tree-sitter misread the declaration, and the class AND EVERY MEMBER vanish
// from the graph. Measured 2026-07-26 before the fix:
//
//   class MYLIB_API Widget { public: void Draw(); };   ->  *** NOTHING ***
//   class Widget            { public: void Draw(); };   ->  Class:Widget, Method:Draw
//
// That is silent false absence on our primary language: the symbols are simply
// not there, so "no callers" on them is wrong rather than merely incomplete.
// The damage is contained to the affected class (later classes in the same file
// survive), which is exactly why it goes unnoticed.
//
// The fix blanks the macro with the SAME NUMBER OF SPACES, so every byte offset —
// and therefore every reported line/column — is unchanged.
import { describe, expect, it } from 'vitest';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import cpp, { blankCppClassHeadMacros } from '../../../mcp/stdio/ingest/languages/cpp.js';

const symbolsOf = (source, filePath = 'src/probe.cpp') =>
  extractFile({ filePath, source, config: cpp })
    .nodes.filter((n) => ['Class', 'Method', 'Function'].includes(n.type))
    .map((n) => `${n.type}:${n.label}`);

describe('blankCppClassHeadMacros', () => {
  it('preserves length and line structure exactly (offsets must not move)', () => {
    const src = 'class MYLIB_API Widget {\n  void Draw();\n};\n';
    const out = blankCppClassHeadMacros(src);
    expect(out).toHaveLength(src.length);
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
    expect(out.split('\n')[0]).toBe('class           Widget {');
  });

  it('blanks a macro that carries an argument list, keeping length', () => {
    const src = 'class API_EXPORT(2) Widget {};';
    const out = blankCppClassHeadMacros(src);
    expect(out).toHaveLength(src.length);
    expect(out).toBe('class               Widget {};');
  });

  it('leaves a shouty CLASS NAME alone', () => {
    // `class WIDGET {` — WIDGET is the NAME, not a macro. The rule needs a macro
    // AND a following type name before the body; here the body follows directly,
    // so there is no second identifier to be the real name.
    const src = 'class WIDGET { void Draw(); };';
    expect(blankCppClassHeadMacros(src)).toBe(src);
    // Same for an enum with a shouty name and a base type.
    expect(blankCppClassHeadMacros('enum class LOG_LEVEL : int { A };'))
      .toBe('enum class LOG_LEVEL : int { A };');
  });

  it('leaves ordinary declarations untouched', () => {
    const src = 'class Widget : public Base { void Draw(); };';
    expect(blankCppClassHeadMacros(src)).toBe(src);
  });

  // False positives found by reviewing the rule against real C/C++ shapes. Each
  // of these is lexically identical to a class head; only the absence of a body
  // (`{`) or base-clause (`:`) distinguishes them.
  it('does NOT touch an elaborated-type variable declaration (valid C)', () => {
    // `struct RECT r;` — RECT is the TYPE, not a macro. Blanking it destroyed a
    // real type reference before the body requirement was added.
    const src = 'void f() { struct RECT r; use(r); }';
    expect(blankCppClassHeadMacros(src)).toBe(src);
    expect(blankCppClassHeadMacros('void g(struct RECT r);')).toBe('void g(struct RECT r);');
  });

  it('does NOT touch a forward declaration', () => {
    // Declares no members, so nothing is lost by skipping it — and it is
    // indistinguishable from `struct RECT r;` without a body.
    const src = 'class MYLIB_API Widget;';
    expect(blankCppClassHeadMacros(src)).toBe(src);
  });

  it('does NOT fire inside a string literal or a comment', () => {
    const inString = 'const char* s = "class MYLIB_API Widget {";';
    expect(blankCppClassHeadMacros(inString)).toBe(inString);
    const inComment = '// class MYLIB_API Widget {\nclass Real { void go(); };';
    expect(blankCppClassHeadMacros(inComment)).toBe(inComment);
  });

  it('leaves enum class and alignas alone', () => {
    expect(blankCppClassHeadMacros('enum class FOO { A, B };')).toBe('enum class FOO { A, B };');
    expect(blankCppClassHeadMacros('enum class FOO : int { A };')).toBe('enum class FOO : int { A };');
    expect(blankCppClassHeadMacros('class alignas(16) Aligned { void go(); };'))
      .toBe('class alignas(16) Aligned { void go(); };');
  });

  // M1 (adversarial review): `final` sits between the name and the body, so the
  // body requirement skipped it and the ORIGINAL bug survived for this spelling —
  // which is common on exported types.
  it('handles `final` between the type name and the body', () => {
    expect(symbolsOf('class MYLIB_API Widget final : public Base {\npublic:\n  void Draw();\n};'))
      .toEqual(['Class:Widget', 'Method:Draw']);
    expect(symbolsOf('class MYLIB_API Widget final {\npublic:\n  void Draw();\n};'))
      .toEqual(['Class:Widget', 'Method:Draw']);
  });

  // M6: an elaborated type with BRACE INITIALIZATION is still lexically a class
  // head. Blanking it destroyed a type reference AND invented a phantom class
  // named after the variable.
  it('does NOT touch an elaborated type with brace initialization', () => {
    const src = 'void f() {\n  struct POINT_T p {1,2};\n  use(p);\n}';
    expect(blankCppClassHeadMacros(src)).toBe(src);
    expect(symbolsOf(src)).not.toContain('Class:p');
  });

  it('still blanks a class with an EMPTY body (not an initializer)', () => {
    expect(blankCppClassHeadMacros('class API_EXPORT(2) Widget {};'))
      .toBe('class               Widget {};');
  });

  it('still handles a templated class carrying an export macro', () => {
    const out = blankCppClassHeadMacros('template<typename T> class MYLIB_API Holder { void go(); };');
    expect(out).toBe('template<typename T> class           Holder { void go(); };');
  });
});

describe('C++ extraction survives an export macro in the class head', () => {
  it('extracts the class and its members through the macro', () => {
    expect(symbolsOf('class MYLIB_API Widget { public: void Draw(); int Width() const; };'))
      .toEqual(['Class:Widget', 'Method:Draw', 'Method:Width']);
  });

  it('handles struct, a base-clause, and macro arguments', () => {
    expect(symbolsOf('struct MYLIB_API Point { void Reset(); };')).toContain('Class:Point');
    expect(symbolsOf('class MYLIB_API Widget : public Base { public: void Draw(); };')).toContain('Method:Draw');
    expect(symbolsOf('class API_EXPORT(2) Widget { public: void Draw(); };')).toContain('Method:Draw');
  });

  it('reports ORIGINAL line numbers (blanking must not shift positions)', () => {
    const src = [
      '// line 1',
      '#define MYLIB_API __declspec(dllexport)',
      '// line 3',
      'class MYLIB_API Widget {',
      'public:',
      '  void Draw();',
      '};',
    ].join('\n');
    const nodes = extractFile({ filePath: 'src/w.cpp', source: src, config: cpp }).nodes;
    expect(nodes.find((n) => n.label === 'Widget')?.start_line).toBe(4);
    expect(nodes.find((n) => n.label === 'Draw')?.start_line).toBe(6);
  });

  it('does not disturb a class without a macro in the same file', () => {
    expect(symbolsOf('class MYLIB_API Broken { public: void Gone(); };\nclass Healthy { public: void Survives(); };'))
      .toEqual(['Class:Broken', 'Method:Gone', 'Class:Healthy', 'Method:Survives']);
  });
});
