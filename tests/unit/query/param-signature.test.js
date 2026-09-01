// ★ The parameter-list normalizer, tested against the two failures it exists for.
//
// Preregistered at docs/evidence/m1b-overloads/PREREGISTRATION-param-list-key.md. The DISCRIMINATION
// control there is the load-bearing pair: the normalizer must SEPARATE `(int value)` from
// `(double value)` — otherwise overloads stay merged and the change buys nothing — and must MERGE
// `(int value)` with `(int v)` — otherwise a C++ decl/def pair forks and `6372aae` is undone.
// A normalizer that only did one of those would pass a weaker test and be useless or harmful.
import { describe, it, expect } from 'vitest';
import { normalizedParamList } from '../../../mcp/stdio/query/param-signature.js';

describe('normalizedParamList — parameter identity, not parameter text', () => {
  it('★ DISCRIMINATION: separates overloads that differ by parameter TYPE', () => {
    // The exact pair from tests/fixtures/identity-hostile that M1b is open on.
    expect(normalizedParamList('clamp(int value)'))
      .not.toBe(normalizedParamList('clamp(double value)'));
  });

  it('★ DISCRIMINATION: merges a decl/def pair that differs only by parameter NAME', () => {
    expect(normalizedParamList('int clamp(int value)')).toBe(normalizedParamList('clamp(int v)'));
  });

  it('★ REGRESSION GUARD: the qualifier prefix does not reach the result', () => {
    // `Widget::render()` (definition) vs `render()` (declaration) — the divergence that makes the
    // FULL signature unusable as identity. Measured on tests/fixtures/identity-callers.
    expect(normalizedParamList('Widget::render()')).toBe(normalizedParamList('render()'));
    expect(normalizedParamList('Widget::render()')).toBe('()');
  });

  it('⛔ an unnamed builtin tail is NOT stripped — f(unsigned int) must not become "unsigned"', () => {
    // Without the builtin guard this is the wrong-fork case: a declaration written `f(unsigned int)`
    // and a definition written `f(unsigned int x)` would normalize differently.
    expect(normalizedParamList('f(unsigned int)')).toBe('(unsigned int)');
    expect(normalizedParamList('f(unsigned int x)')).toBe('(unsigned int)');
  });

  it('a single unnamed parameter keeps its type', () => {
    expect(normalizedParamList('f(int)')).toBe('(int)');
    expect(normalizedParamList('f(int)')).toBe(normalizedParamList('f(int n)'));
  });

  it('a template argument comma does not split one parameter into two', () => {
    // `std::map<int, string> m` is ONE parameter. A naive split(',') reads it as two and would
    // produce a different arity than the same signature written with a typedef.
    expect(normalizedParamList('f(std::map<int, string> m)')).toBe('(std::map<int, string>)');
  });

  it('a default argument is not identity', () => {
    expect(normalizedParamList('f(int flags = 0)')).toBe(normalizedParamList('f(int flags)'));
  });

  it('reference and pointer types survive with their name removed', () => {
    expect(normalizedParamList('f(const std::vector<int>& items)')).toBe('(const std::vector<int>&)');
    expect(normalizedParamList('f(char* name)')).toBe('(char*)');
  });

  it('⛔ NO SIGNATURE YIELDS null — absence must contribute nothing to a key', () => {
    // If absence produced a value, every unsignatured symbol would form its own group and the
    // change would fork far more than it fixes.
    expect(normalizedParamList(undefined)).toBeNull();
    expect(normalizedParamList(null)).toBeNull();
    expect(normalizedParamList('render')).toBeNull();
    expect(normalizedParamList('')).toBeNull();
  });

  it('arity alone still separates when types are absent (JS-shaped signatures)', () => {
    expect(normalizedParamList('handler(a, b)')).not.toBe(normalizedParamList('handler(a)'));
  });
});
