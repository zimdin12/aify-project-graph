// ⛔ C++-ONLY DETECTORS RAN ON A JAVASCRIPT QUERY, AND REPORTED OUR OWN TEST FIXTURES.
//
// Found live by ef-manager, 2026-09-05. A reference query for a `.js` symbol under `mcp/` came back
// with four warnings; three were about C++ files the caller never mentioned:
//
//     "computeWeight" is declared extern in tests/fixtures/linkage-scope/corpus/pipeline.cpp …
//     bundle.cpp:1 textually includes the implementation file "weights.cpp" …
//     bundle.cpp:2 textually includes the implementation file "pipeline.cpp" …
//
// Not cached and not stale — computed fresh and repo-wide. `listRepoSourceScope` enumerates every
// tracked C/C++ file, and the corpus that exists to MAKE THESE DETECTORS FIRE lives inside the
// detectors' own live scan. So every empty result in this repo, in any language, carried them.
//
// ⭐ THE FIX IS A LANGUAGE GATE, NOT A FIXTURE BLOCKLIST, and the difference matters. Excluding
// `tests/fixtures/` would silence the symptom in THIS repo, leave the defect in every other one, and
// hide real findings in a user repo whose fixtures are real code. The honest statement is that these
// detectors have nothing to say about a non-C++ query at all.
//
// ⭐ THE EXPECTATION BELOW IS DERIVED FROM THE DETECTORS' OWN EXTENSION TABLES, not from the
// predicate under test. IMPL_EXTS and HEADER_EXTS are what make the module C/C++-only; a test that
// read its answer out of `shapeScanAppliesTo` would only prove the function agrees with itself.
import { describe, it, expect } from 'vitest';
import {
  shapeScanAppliesTo, IMPL_EXTS, HEADER_EXTS, isImpl, isHeader,
} from '../../../mcp/stdio/code-intel/shape-detectors.js';
import { BACKENDS } from '../../../mcp/stdio/code-intel/backends.js';

describe('the shape scan runs only where its detectors mean something', () => {
  it('★★★ POSITIVE CONTROL: the detectors really are C/C++ only, by their own tables', () => {
    // If this ever stops holding, the gate below is wrong and should be revisited rather than kept.
    expect([...IMPL_EXTS, ...HEADER_EXTS].every((e) => /^\.(c|cc|cpp|cxx|c\+\+|h|hh|hpp|hxx|h\+\+|inc)$/.test(e)))
      .toBe(true);
    expect(isImpl('a.ts'), 'a TypeScript file is not an implementation file to these detectors').toBe(false);
    expect(isHeader('a.py')).toBe(false);
    expect(isImpl('a.cpp')).toBe(true);
  });

  it('★★★ every NON-C++ backend is excluded from the scan', () => {
    // Harvested from BACKENDS so a language added later is covered without editing this test.
    const others = Object.keys(BACKENDS).filter((l) => l !== 'cpp');
    expect(others.length, 'only one backend registered — the assertion would be vacuous')
      .toBeGreaterThan(0);
    for (const lang of others) {
      expect(shapeScanAppliesTo(lang), `${lang} has no C/C++ shapes to report`).toBe(false);
    }
  });

  it('★★★ C++ still runs the scan — the gate must not silence the case it was built for', () => {
    // ⛔ The failure mode of a gate is refusing everything. This is the direction that must survive.
    expect(shapeScanAppliesTo('cpp')).toBe(true);
  });

  it('★★★ an unknown or missing language does NOT run C++ detectors', () => {
    for (const lang of ['rust', 'zzq-not-a-language', '', null, undefined]) {
      expect(shapeScanAppliesTo(lang), `${lang} must not be handed C++ shape warnings`).toBe(false);
    }
  });
});
