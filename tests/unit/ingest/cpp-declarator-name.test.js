// ★ THE AST ALREADY ANSWERED — DO NOT THROW IT AWAY FOR A REGEX.
//
// extractCppFunctionSymbol walks the declarator chain, gets the real function name,
// and then — when that name was a plain identifier — fell THROUGH to a text
// fallback that re-parses the declarator's SOURCE TEXT. That text includes the
// parameter list, defaults and all.
//
// Found in field testing on echoes (2026-08-02):
//   inline CylindricalPositionId cylindricalIdFromWorldPos(
//       const glm::vec3& worldPosVoxels, ...,
//       const glm::vec3& spinAxis = glm::vec3(0, 1, 0), ...)
//
// The AST returned `cylindricalIdFromWorldPos`. The fallback regex then matched
// `glm::vec3(` from the DEFAULT ARGUMENT and named the function `vec3`, parent
// class `glm` — which also flipped its type from Function to Method.
//
// ★ WHY IT MATTERED MORE THAN A BAD LABEL: worldbuf.glsl also defines
// cylindricalIdFromWorldPos, so this is a C++/GLSL duplicate pair — exactly what
// the cross-language duplicate detector exists to surface. It could not fire,
// because the C++ node was not labelled with the shared name. The detector's
// silence is indistinguishable from "no duplicate exists": a missing LABEL reads
// as a missing RELATIONSHIP.
import { describe, it, expect } from 'vitest';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import cppConfig from '../../../mcp/stdio/ingest/languages/cpp.js';

const extract = (source) => extractFile({ filePath: 'x.h', source, config: cppConfig })
  .nodes.filter((n) => ['Function', 'Method'].includes(n.type));

describe('★ a default argument cannot rename the function', () => {
  it('names the function, not the type in its default argument', () => {
    const n = extract(`
      inline Id makeId(const glm::vec3& a,
                       const glm::vec3& spin = glm::vec3(0, 1, 0),
                       float r = 0.0f) { return Id{}; }
    `);
    expect(n.map((x) => x.label)).toContain('makeId');
    expect(n.map((x) => x.label)).not.toContain('vec3');
  });

  it('keeps it typed Function, not Method — a default arg is not a receiver', () => {
    const n = extract('inline Id makeId(const glm::vec3& s = glm::vec3(0,1,0)) { return Id{}; }');
    const f = n.find((x) => x.label === 'makeId');
    expect(f.type).toBe('Function');
    expect(f.extra.parent_class).toBe('');
  });

  it('is not confused by a qualified type anywhere in the parameter list', () => {
    const n = extract('void takeAll(std::vector<int> v, ns::Thing t, other::Kind k) {}');
    expect(n.map((x) => x.label)).toEqual(['takeAll']);
  });

  it('★ STILL resolves a genuine out-of-line method definition', () => {
    // The regex fallback exists for real Class::method definitions and must keep
    // working — the fix makes it a fallback, not an override.
    const n = extract('void MyClass::doThing(const glm::vec3& v) {}');
    const m = n.find((x) => x.label === 'doThing');
    expect(m).toBeTruthy();
    expect(m.type).toBe('Method');
    expect(m.extra.parent_class).toBe('MyClass');
  });

  it('still resolves an OUT-OF-LINE destructor', () => {
    expect(extract('MyClass::~MyClass() {}').map((x) => x.label)).toContain('~MyClass');
  });

  it('★ resolves an INLINE destructor — the case the qualified test never exercised', () => {
    // The original destructor test used `MyClass::~MyClass`, which is a QUALIFIED
    // name and takes an earlier branch — so it passed without ever touching the
    // AST-name path. An inline `~Foo()` does. Whole-repo extraction diffing caught
    // 20 destructors silently renamed to their own class before this shipped.
    const n = extract('struct Foo { ~Foo() {} };');
    expect(n.map((x) => x.label)).toContain('~Foo');
    expect(n.map((x) => x.label)).not.toContain('Foo');
  });

  it('★ keeps the operator token — a bare `operator` label collapses them all', () => {
    // Before returning operator_name whole, every overload was labelled `operator`,
    // so distinct operators shared a qname and merged into one node.
    const n = extract('struct K { bool operator==(const K& o) const { return true; } K& operator=(const K& o) { return *this; } };');
    const labels = n.map((x) => x.label);
    expect(labels).toContain('operator==');
    expect(labels).toContain('operator=');
    expect(labels).not.toContain('operator');
  });
});
