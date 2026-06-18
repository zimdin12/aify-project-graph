// Borrow (codegraph #687 + agent-code-intel masking): when a static trace can't
// connect, name the dynamic-dispatch site honestly instead of guessing an edge.
import { describe, expect, it } from 'vitest';
import { blankCommentsAndStrings, scanDynamicBoundaries } from '../../../mcp/stdio/query/dynamic-boundaries.js';

describe('blankCommentsAndStrings', () => {
  it('blanks comment + string contents but preserves offsets/quotes/newlines', () => {
    const src = 'a(); // x[y](z)\nconst s = "p[q](r)";\n';
    const out = blankCommentsAndStrings(src, 'javascript');
    expect(out.length).toBe(src.length);             // offsets preserved
    expect(out.split('\n').length).toBe(src.split('\n').length); // newlines preserved
    expect(out).not.toContain('x[y](z)');            // comment blanked
    expect(out).not.toContain('p[q](r)');            // string contents blanked
    expect(out).toContain('"');                       // quotes kept
  });
});

describe('scanDynamicBoundaries', () => {
  it('detects a JS computed member call and extracts the literal key', () => {
    const source = 'function dispatch(a){\n  return handlers[a.type](a);\n}';
    const m = scanDynamicBoundaries({ source, language: 'javascript', baseLine: 10 });
    expect(m.some((x) => x.form === 'computed-call')).toBe(true);
    expect(m[0].line).toBe(11); // baseLine 10 + 1
  });

  it('detects a Python getattr dispatch with its key', () => {
    const source = 'def run(self, name):\n    fn = getattr(self, "handle_" + name)\n    return fn()';
    const m = scanDynamicBoundaries({ source, language: 'python', baseLine: 1 });
    expect(m.some((x) => x.form === 'getattr-dispatch')).toBe(true);
  });

  it('detects a C++ member-function-pointer call', () => {
    const source = 'void tick(Obj* o, Fn f){\n  (o->*f)(42);\n}';
    const m = scanDynamicBoundaries({ source, language: 'cpp', baseLine: 1 });
    expect(m.some((x) => x.form === 'member-pointer')).toBe(true);
  });

  it('does NOT fire on a dispatch shape that lives inside a comment or string', () => {
    const source = 'function f(){\n  // handlers[k](x)\n  const note = "registry[key](args)";\n  return 1;\n}';
    const m = scanDynamicBoundaries({ source, language: 'javascript', baseLine: 1 });
    expect(m).toHaveLength(0);
  });

  it('returns nothing for an ordinary static body', () => {
    const source = 'function add(a, b){\n  return a + b;\n}';
    expect(scanDynamicBoundaries({ source, language: 'javascript', baseLine: 1 })).toHaveLength(0);
  });
});
