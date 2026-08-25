// A SUGGESTION THAT IS THE QUERY IS NOT A SUGGESTION, AND ITS REASON WAS FALSE.
//
// ⛔ Observed on this repo's own graph, 2026-08-19:
//   graph_whereis("CODE_INTEL_SCHEMA_VERSION")
//   → NO MATCH … Did you mean:
//       CODE_INTEL_SCHEMA_VERSION (external)  [same name, different case]
//     Re-run with one of these, or graph_search(…) for a wider search.
//
// Two separate wrongs in three lines:
//
// 1. THE REASON IS FALSE. The case is IDENTICAL. `lower === q` catches the exact match and the
//    case variant with one branch and prints the case-variant wording for both. Same class as
//    the `leafOf` defect the field test found in the field — a printed basis that is not the basis.
//    A stated reason is strong enough to act on, so a wrong one is worse than none.
//
// 2. THE REMEDY LOOPS. "Re-run with one of these" offers the caller the string they just
//    passed. Re-running produces this identical output forever. The verb matched over
//    declaration types; the suggester searched a wider set and offered back a node the verb
//    can never return.
//
// ★ The EXTERNAL row is genuinely informative and must not simply be dropped: it means the
// name IS referenced in this repo and no declaration was ever bound to it. That is the answer
// to "does this exist" — it just is not a name suggestion. Say what it is instead of dressing
// it up as a spelling hint.
import { describe, it, expect } from 'vitest';
import { rankSuggestions, noMatchMessage } from '../../../mcp/stdio/query/did-you-mean.js';

// Minimal db stub: findSimilarSymbols only ever calls `all`.
const dbWith = (rows) => ({ all: () => rows });

describe('did-you-mean on an exact-name hit', () => {
  it('★★★ does not claim a case difference when the case is identical', () => {
    const [s] = rankSuggestions('CODE_INTEL_SCHEMA_VERSION', [
      { label: 'CODE_INTEL_SCHEMA_VERSION', type: 'External', file_path: '', start_line: null },
    ]);
    expect(s._why, 'the bytes are identical — a stated reason must be the actual reason')
      .not.toMatch(/different case/i);
  });

  it('★★★ still reports a genuine case variant as a case variant', () => {
    const [s] = rankSuggestions('parsebuffer', [
      { label: 'parseBuffer', type: 'Function', file_path: 'a.js', start_line: 4 },
    ]);
    expect(s._why, 'this arm DOES differ only by case; the fix must not flatten it')
      .toMatch(/different case/i);
  });

  it('★★★ does not tell the reader to re-run with the string they just passed', () => {
    const out = noMatchMessage(
      dbWith([{ label: 'CODE_INTEL_SCHEMA_VERSION', type: 'External', file_path: '', start_line: null }]),
      'CODE_INTEL_SCHEMA_VERSION',
    );
    expect(out, 'the only candidate IS the query — re-running yields this same text forever')
      .not.toMatch(/Re-run with one of these/);
  });

  it('★★★ says what an unresolved external reference actually means', () => {
    const out = noMatchMessage(
      dbWith([{ label: 'CODE_INTEL_SCHEMA_VERSION', type: 'External', file_path: '', start_line: null }]),
      'CODE_INTEL_SCHEMA_VERSION',
    );
    expect(out, 'referenced-but-unresolved is the ANSWER to "does this exist", not a typo hint')
      .toMatch(/referenced/i);
  });

  it('★★★ keeps the ordinary suggestion route intact when the query is a real near-miss', () => {
    const out = noMatchMessage(
      dbWith([{ label: 'parseBuffer', type: 'Function', file_path: 'a.js', start_line: 4 }]),
      'parsebuffer',
    );
    expect(out, 'a genuine alternative still deserves the re-run instruction')
      .toMatch(/Re-run with one of these/);
  });
});
