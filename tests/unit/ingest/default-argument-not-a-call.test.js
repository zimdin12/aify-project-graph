// ★ A DEFAULT ARGUMENT IS EVALUATED BY THE CALLER, NOT INSIDE THE FUNCTION.
//
//     int cylindricalIdFromWorldPos(const glm::vec3& worldPos,
//                                   const glm::vec3& spinAxis = glm::vec3(0, 1, 0))
//
// That `glm::vec3(0,1,0)` is a call_expression in the PARAMETER LIST. The generic call
// rule matched it and recorded a CALLS ref from `cylindricalIdFromWorldPos` — a call the
// function never makes. The caller makes it, at the call site, only when the argument is
// omitted.
//
// ⛔ THIS IS THE ROOT OF THE `vec3` PHANTOM, AND I FIXED ITS CONSUMERS TWICE BEFORE
// FINDING IT:
//
//   1. `tests_adjacent` used it as `via_symbol` and SUPPRESSED `no_test_coverage`, so the
//      safety axis reported SAFE on untested symbols. Fixed at the consumer.
//   2. `graph_trace` then listed `vec3 @ CylindricalPosition.h:213` in a callee list —
//      found by ef-manager on real C++ AFTER that consumer fix.
//
// ★ THE RULE THAT KEPT BEING RELEARNED: a fix at one layer does not cover the other
// consumers of the same bad data. Two consumers patched, the data untouched, and it
// resurfaced in a third. Fixing it here means every reader of CALLS inherits it at once.
//
// ⚠ And no JS fixture could have produced it: JS has no C++-style default-argument
// constructor call in a typed parameter list. Same corpus gap that hid the
// header/declaration defect — see trace-cpp-declaration.test.js.
import { describe, it, expect } from 'vitest';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import { getLanguageConfig } from '../../../mcp/stdio/ingest/languages/index.js';

const FILE = 'engine/voxel/CylindricalPosition.h';

const SOURCE = `#pragma once
#include <glm/glm.hpp>

namespace tesseract {

inline int cylindricalIdFromWorldPos(const glm::vec3& worldPos,
                                     const glm::vec3& spinAxis = glm::vec3(0, 1, 0),
                                     float radius = 1.0f) {
  return 0;
}

inline glm::vec3 gravityDirection(const glm::vec3& p) {
  return glm::vec3(0.0f, -1.0f, 0.0f);
}

}
`;

function callsFrom(refs, label) {
  return refs.filter((r) => r.from_label === label && r.target);
}

describe('a constructor call in a default argument is not a call by the function', () => {
  const config = getLanguageConfig(FILE);
  const out = extractFile({ filePath: FILE, source: SOURCE, config });
  const refs = out.refs ?? [];

  it('★★ the DEFAULT-ARGUMENT call is NOT attributed to the declaring function', () => {
    const bogus = callsFrom(refs, 'cylindricalIdFromWorldPos');
    expect(bogus, 'this function calls nothing — its default argument is the caller\'s work')
      .toEqual([]);
  });

  it('★ but a REAL constructor call in a body IS still recorded', () => {
    // Without this, "drop everything in a parameter list" could be over-applied, or the
    // whole call rule disabled, and the case above would pass vacuously. The true
    // positive must survive the fix that kills the false one.
    const real = callsFrom(refs, 'gravityDirection');
    expect(real.length, 'gravityDirection genuinely constructs a glm::vec3').toBeGreaterThan(0);
    expect(real.map((r) => r.target)).toContain('glm.vec3');
  });

  it('the functions themselves are still extracted', () => {
    // Harness sanity: if extraction produced nothing, both assertions above would be
    // trivially satisfied and prove nothing about the rule.
    const labels = out.nodes.map((n) => n.label);
    expect(labels).toContain('cylindricalIdFromWorldPos');
    expect(labels).toContain('gravityDirection');
  });
});
