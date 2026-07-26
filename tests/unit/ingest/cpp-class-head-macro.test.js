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

  it('leaves a shouty CLASS NAME alone (no following identifier)', () => {
    // `class WIDGET {` — WIDGET is the name, not a macro. The rule requires
    // ANOTHER identifier after the candidate, which is what disambiguates.
    const src = 'class WIDGET { void Draw(); };';
    expect(blankCppClassHeadMacros(src)).toBe(src);
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
