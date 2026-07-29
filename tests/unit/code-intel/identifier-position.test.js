// EVERY LSP REQUEST MUST LAND ON THE IDENTIFIER.
//
// clangd 18.x returns flat SymbolInformation[] whose range covers the whole
// declaration and carries NO identifier column, so we locate the name in the
// source ourselves. Every downstream request — definition, references,
// prepareCallHierarchy — is issued at that position, and clangd answers about
// whatever token sits under it.
//
// The old implementation was `declLine.indexOf(leafName)`: the first SUBSTRING
// hit. On `Builder Builder::build()` looking for `build`, that matches inside the
// return type `Builder` at column 0, so every request landed on a TYPE instead of
// the method. One line, three field symptoms:
//   - code_intel_hierarchy returned zero (a type has no call hierarchy);
//   - type references surfaced as CALLS [lsp✓] (they were references TO THE TYPE);
//   - verbs disagreed about a symbol's line.
import { describe, it, expect } from 'vitest';
import {
  identifierColumn,
  findIdentifierPosition,
  leafNameOf,
} from '../../../mcp/stdio/code-intel/identifier-position.js';

describe('identifierColumn', () => {
  it('does not match inside a longer identifier (the Builder::build defect)', () => {
    const line = 'Builder Builder::build() {';
    const col = identifierColumn(line, 'build');
    // Must point at the method name after `::`, NOT at column 0 (`Builder`).
    expect(col).toBe(line.indexOf('::build') + 2);
    expect(line.slice(col, col + 5)).toBe('build');
  });

  it('prefers the qualified declarator when the name repeats', () => {
    // Constructor taking its own type: three whole-word `Foo` hits.
    const line = 'Foo Foo::Foo(const Foo& other) {';
    const col = identifierColumn(line, 'Foo');
    expect(col).toBe(line.indexOf('::Foo') + 2);
  });

  it('falls back to the name followed by ( when nothing is :: qualified', () => {
    const line = 'static void reset(int reset_flags) {';
    const col = identifierColumn(line, 'reset');
    expect(col).toBe(line.indexOf('reset('));
  });

  it('handles a plain single occurrence', () => {
    const line = '  int computeTotal(int a) {';
    expect(identifierColumn(line, 'computeTotal')).toBe(line.indexOf('computeTotal'));
  });

  it('reports -1 rather than a wrong column when the name is absent', () => {
    expect(identifierColumn('int something_else() {', 'missing')).toBe(-1);
    expect(identifierColumn('', 'x')).toBe(-1);
    expect(identifierColumn('int x;', '')).toBe(-1);
  });

  it('treats a name that appears only as a substring as absent', () => {
    // `build` occurs inside `Builder` only — a substring match would return 0
    // and send clangd to the wrong token.
    expect(identifierColumn('using Builder = detail::BuilderImpl;', 'build')).toBe(-1);
  });
});

describe('findIdentifierPosition', () => {
  it('finds a name on a wrapped signature line below the range start', () => {
    const lines = [
      'template <typename T>',
      'std::unique_ptr<Widget>',
      'WidgetFactory::create(const Spec& spec) {',
    ];
    const pos = findIdentifierPosition(lines, 0, 'create');
    expect(pos.guessed).toBe(false);
    expect(pos.line).toBe(2);
    expect(lines[pos.line].slice(pos.character, pos.character + 6)).toBe('create');
  });

  it('marks the position as guessed when the identifier cannot be found', () => {
    // The LINE stays correct (better than 0,0), but the caller must be able to
    // report that a clangd answer here is not ground truth.
    const pos = findIdentifierPosition(['int opaque_macro_decl();'], 0, 'mystery');
    expect(pos).toEqual({ line: 0, character: 0, guessed: true });
  });

  it('does not scan beyond a small window', () => {
    const lines = ['a', 'b', 'c', 'd', 'target() {'];
    expect(findIdentifierPosition(lines, 0, 'target').guessed).toBe(true);
  });
});

describe('leafNameOf', () => {
  it('handles the separators the three backends actually emit', () => {
    expect(leafNameOf('Engine::Renderer::draw')).toBe('draw');   // clangd
    expect(leafNameOf('module.Class.method')).toBe('method');    // pyright / tsserver
    expect(leafNameOf('Class#member')).toBe('member');
    expect(leafNameOf('bare')).toBe('bare');
    expect(leafNameOf(undefined)).toBe('');
  });

  it('prefers the qualified declarator for a dotted language too', () => {
    // `def run(self, run):` — Python parameter shadowing the method name.
    const line = 'class Job:  # Job.run defined below';
    expect(identifierColumn(line, 'run')).toBe(line.indexOf('.run') + 1);
  });
});
