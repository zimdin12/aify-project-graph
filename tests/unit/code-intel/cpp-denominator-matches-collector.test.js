// #7: the C++ coverage denominator counts every extension the C++ collector collects.
//
// The collector enumerates .cpp .cc .cxx .c .h .hpp .hh .hxx (compile-db.js), but the denominator listed only five of
// them, so in a repo with .c, .hh or .hxx files the covered count could include files the denominator never counted,
// and coverage read higher than it was. Not observed on this host: its one indexed C++ repo has only .cpp and .h.
import { describe, it, expect } from 'vitest';
import { CPP_EXTENSIONS } from '../../../mcp/stdio/code-intel/compile-db.js';
import { LANGUAGE_FILE_EXTENSIONS } from '../../../mcp/stdio/query/verbs/collect_code_intel.js';

describe('the C++ coverage denominator', () => {
  it('★★★ counts every extension the collector enumerates', () => {
    const missing = [...CPP_EXTENSIONS].filter((ext) => !LANGUAGE_FILE_EXTENSIONS.cpp.includes(ext));
    expect(missing).toEqual([]);
    expect(CPP_EXTENSIONS.size, 'control: the collector set is the populated one').toBeGreaterThanOrEqual(5);
  });
});
