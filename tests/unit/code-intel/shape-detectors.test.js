// ⛔ CANDIDATES, NOT BINDINGS — and the tests exist to hold that ceiling.
//
// I first described detector 1 as "grep-level" while claiming a declaration PAIRS with a
// definition and that NO HEADER declares it. Pairing is semantic; a text match cannot establish
// it. Review caught the slide. These tests pin the honest claim AND the known false positives, so
// nobody can later quietly promote a spelling coincidence into a resolved edge.
//
// Every predicted-failure control below is a case the detector gets "wrong" ON PURPOSE. It must
// still fire, and it must disclose why — a detector that silently dropped them would be claiming a
// precision it does not have.
import { describe, it, expect } from 'vitest';
import {
  detectExternWithoutHeader, detectIncludedImplementationFile,
} from '../../../mcp/stdio/code-intel/shape-detectors.js';

const run = (fn, files) => fn({ files: Object.keys(files), readFile: (f) => files[f] });

describe('detector 1: extern declaration with no header', () => {
  it('⛔ POSITIVE: a real repeated extern across two .cpp with no header fires', () => {
    const out = run(detectExternWithoutHeader, {
      'src/weights.cpp': 'int computeWeight(int x) { return x * 2; }',
      'src/pipeline.cpp': 'extern int computeWeight(int);\nint runWeighting() { return computeWeight(21); }',
    });
    expect(out).toHaveLength(1);
    expect(out[0].spelling).toBe('computeWeight');
    expect(out[0].declaredIn).toBe('src/pipeline.cpp');
    expect(out[0].alsoIn).toContain('src/weights.cpp');
  });

  it('⛔ NEGATIVE: a symbol declared in a header does NOT fire', () => {
    const out = run(detectExternWithoutHeader, {
      'src/normalize.h': 'int normalizeInput(int x);',
      'src/normalize.cpp': 'extern int normalizeInput(int);\nint normalizeInput(int x) { return x - 1; }',
      'src/stage.cpp': 'int runNormalize() { return normalizeInput(9); }',
    });
    expect(out).toEqual([]);
  });

  it('⛔ NEGATIVE: a static / anonymous-namespace symbol does NOT fire', () => {
    const out = run(detectExternWithoutHeader, {
      'src/weights.cpp': 'namespace { int scaleFactor(int x) { return x + 1; } }\nint deriveScale(int x) { return scaleFactor(x); }',
      'src/other.cpp': 'int unrelated() { return 0; }',
    });
    expect(out).toEqual([]);
  });

  it('NEGATIVE: an extern with no second implementation file does NOT fire', () => {
    const out = run(detectExternWithoutHeader, {
      'src/only.cpp': 'extern int lonely(int);\nint use() { return lonely(1); }',
    });
    expect(out).toEqual([]);
  });

  it('⚠ PREDICTED FAILURE: a match inside a COMMENT still fires, and says comments are in scope', () => {
    const out = run(detectExternWithoutHeader, {
      'src/a.cpp': 'extern int ghosted(int);\nint use() { return ghosted(1); }',
      'src/b.cpp': '// ghosted is mentioned only in this comment\nint other() { return 0; }',
    });
    expect(out, 'the detector cannot tell a comment from code and must not pretend to').toHaveLength(1);
    expect(out[0].nonClaims.join(' ')).toMatch(/comments, string literals and inactive #if branches are INSIDE the scanned population/);
  });

  it('⚠ PREDICTED FAILURE: a match inside a STRING LITERAL still fires, disclosed', () => {
    const out = run(detectExternWithoutHeader, {
      'src/a.cpp': 'extern int labelled(int);\nint use() { return labelled(1); }',
      'src/b.cpp': 'const char* k = "labelled";',
    });
    expect(out).toHaveLength(1);
    expect(out[0].nonClaims.join(' ')).toMatch(/string literals/);
  });

  it('⚠ PREDICTED FAILURE: a match inside an INACTIVE #if branch still fires, disclosed', () => {
    const out = run(detectExternWithoutHeader, {
      'src/a.cpp': 'extern int gatedSym(int);\nint use() { return gatedSym(1); }',
      'src/b.cpp': '#if 0\nint gatedSym(int x) { return x; }\n#endif',
    });
    expect(out).toHaveLength(1);
    expect(out[0].nonClaims.join(' ')).toMatch(/inactive #if branches/);
  });

  it('⚠ KNOWN MISS, asserted so it cannot be mistaken for coverage: extern "C" block form', () => {
    const out = run(detectExternWithoutHeader, {
      'src/a.cpp': 'extern "C" {\nint blockForm(int);\n}\nint use() { return blockForm(1); }',
      'src/b.cpp': 'int blockForm(int x) { return x; }',
    });
    expect(out, 'the block form is NOT detected; this is a documented miss, not coverage').toEqual([]);
  });

  it('⛔ the claim ceiling is held — no finding asserts a call edge or graph miss', () => {
    const out = run(detectExternWithoutHeader, {
      'src/weights.cpp': 'int computeWeight(int x) { return x * 2; }',
      'src/pipeline.cpp': 'extern int computeWeight(int);\nint runWeighting() { return computeWeight(21); }',
    });
    const blob = JSON.stringify(out);
    expect(blob).not.toMatch(/defeats every/i);
    expect(out[0].nonClaims).toContain('not a proven call edge');
    expect(out[0].nonClaims).toContain('not proof that the graph missed anything');
  });
});

describe('detector 2: implementation file textually included', () => {
  it('⛔ POSITIVE: a real #include of a .cpp fires', () => {
    const out = run(detectIncludedImplementationFile, {
      'src/bundle.cpp': '#include "weights.cpp"\n#include "pipeline.cpp"',
    });
    expect(out).toHaveLength(2);
    expect(out.map((f) => f.includedFile).sort()).toEqual(['pipeline.cpp', 'weights.cpp']);
    expect(out[0].line).toBe(1);
  });

  it('⛔ NEGATIVE: a header include does NOT fire', () => {
    const out = run(detectIncludedImplementationFile, { 'src/stage.cpp': '#include "normalize.h"' });
    expect(out).toEqual([]);
  });

  it('⛔ NEGATIVE: the word .cpp in prose does NOT fire — this is a DIRECTIVE match', () => {
    // The whole reason detector 2 parses a directive instead of substring-matching.
    const out = run(detectIncludedImplementationFile, {
      'src/a.cpp': '// see weights.cpp for the definition\nconst char* s = "weights.cpp";',
    });
    expect(out).toEqual([]);
  });

  it('⛔ NEGATIVE: a COMMENTED-OUT include does NOT fire — better than preregistered', () => {
    // ⚠ THE PREREGISTRATION SAID COMMENTED DIRECTIVES WOULD FIRE. They do not: the pattern anchors
    // on `^\s*#`, so a leading `//` prevents the match. The implementation is more precise than
    // the spec I wrote, and I am correcting the SPEC to match measured behaviour rather than
    // leaving a document that describes a detector nobody built.
    //
    // This test was briefly named "still fires" while asserting length 0 — the name and the
    // assertion disagreed, which is exactly the slide between claims review warned about, made by
    // me inside the file whose purpose is preventing it.
    const out = run(detectIncludedImplementationFile, { 'src/a.cpp': '// #include "weights.cpp"' });
    expect(out).toHaveLength(0);
  });

  it('⚠ KNOWN MISS: a block-comment wrapped directive on its own line DOES fire', () => {
    // The anchor only defeats a leading //. A /* */ wrapper on the preceding line leaves the
    // directive line looking ordinary, so it fires. Asserted so the boundary is documented rather
    // than discovered later.
    const out = run(detectIncludedImplementationFile, {
      'src/a.cpp': '/* disabled for now\n#include "weights.cpp"\n*/',
    });
    expect(out, 'block-comment state is not tracked, so it fires — a documented boundary')
      .toHaveLength(1);
  });

  it('⚠ a CONDITIONAL include fires and says the condition was not evaluated', () => {
    const out = run(detectIncludedImplementationFile, {
      'src/a.cpp': '#if USE_UNITY\n#include "weights.cpp"\n#endif',
    });
    expect(out).toHaveLength(1);
    expect(out[0].conditional).toMatch(/not evaluated/);
  });

  it('⛔ the claim ceiling is held — it never asserts this IS a unity build', () => {
    const out = run(detectIncludedImplementationFile, { 'src/bundle.cpp': '#include "weights.cpp"' });
    expect(out[0].risk).toMatch(/may use unity/);
    expect(out[0].nonClaims).toContain('not proof this is a unity build — the build system was not consulted');
    expect(JSON.stringify(out)).not.toMatch(/defeats every/i);
  });

  it('findings dedupe on includedFrom + includedFile', () => {
    const out = run(detectIncludedImplementationFile, {
      'src/a.cpp': '#include "weights.cpp"\n#include "weights.cpp"',
    });
    expect(out).toHaveLength(1);
  });
});
