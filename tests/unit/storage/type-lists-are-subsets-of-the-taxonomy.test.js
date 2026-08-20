// ⛔ A TYPE LIST THAT GOVERNS BEHAVIOUR MUST NAME ONLY DECLARED TYPES.
//
// `BuildTarget` and `BuildTest` are produced by `ingest/frameworks/cmake.js`, documented in
// `server-instructions.js`, and named in the freshness orchestrator's `SPECIAL_TYPES` — the list
// deciding which nodes a full clear removes and which a per-file delete must NOT touch.
//
// They were absent from `NODE_TYPES`, the declared vocabulary. Measured consequence: on every CMake
// repo the census reported them as `present_but_undeclared` — a drift alarm for a legitimate shipped
// type. **A false alarm in the instrument built to detect unknown values is worse than a missing
// one: it teaches the reader to discount the report that would matter.**
//
// ⇒ Nobody was going to notice by reading. Two lists that must agree lived in different files with
// no check between them, which is the shape this repo has spent a day removing — a rule maintained
// in N places is a rule that will disagree with itself in one of them.
//
// ★ AND THE GATE IS THE GENERALISATION, not the fix. Every list that constrains behaviour by type
// name is checked against the declared vocabulary here, so the NEXT one to drift fails rather than
// producing a quiet false signal on somebody else's repo.
import { describe, it, expect } from 'vitest';
import { NODE_TYPES } from '../../../mcp/stdio/storage/taxonomy.js';
import { SEARCH_TYPES } from '../../../mcp/stdio/query/verbs/whereis.js';

// The freshness orchestrator's list is module-private, so it is read from source rather than
// imported. ⚠ That is a weaker instrument than an import and it is stated: a rename would make this
// arm silently vacuous, which is why the parse asserts it found something.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ORCHESTRATOR = fileURLToPath(
  new URL('../../../mcp/stdio/freshness/orchestrator.js', import.meta.url),
);

function specialTypesFromSource() {
  const src = readFileSync(ORCHESTRATOR, 'utf8');
  const m = src.match(/const SPECIAL_TYPES = \[([^\]]+)\]/);
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

describe('every behavioural type list is a subset of the declared vocabulary', () => {
  it('★★★ the parse works — a null here would make the next assertion vacuous', () => {
    // ⛔ POSITIVE CONTROL FIRST. "No undeclared types" is trivially true of a list that failed to
    // parse, and this repo has shipped that exact wrong-zero more than once today.
    const special = specialTypesFromSource();
    expect(special, 'SPECIAL_TYPES could not be read — the check below would prove nothing')
      .toBeTruthy();
    expect(special.length, 'and it is non-empty').toBeGreaterThan(3);
    expect(special, 'sanity: it contains a type we know is there').toContain('Directory');
  });

  it('★★★ SPECIAL_TYPES names only declared node types', () => {
    // This is the arm that was RED before `BuildTarget`/`BuildTest` were declared.
    const undeclared = specialTypesFromSource().filter((t) => !NODE_TYPES.includes(t));
    expect(undeclared, 'a type governing destruction must exist in the declared vocabulary')
      .toEqual([]);
  });

  it('★★★ SEARCH_TYPES names only declared node types', () => {
    const undeclared = SEARCH_TYPES.filter((t) => !NODE_TYPES.includes(t));
    expect(undeclared, 'a type the search verb offers must exist in the declared vocabulary')
      .toEqual([]);
  });

  it('★★★ the declared vocabulary has no duplicates', () => {
    // A duplicate would make `declared_but_empty` and `present_but_undeclared` count the same type
    // twice and quietly change every census ratio computed over it.
    expect(NODE_TYPES.length).toBe(new Set(NODE_TYPES).size);
  });

  it('★★★ CONTROL: the check can FAIL — an invented type is rejected', () => {
    // ⛔ Without this the three assertions above are satisfied by a comparison that always returns
    // an empty array. Proving the predicate can say NO is what makes its silence evidence.
    const invented = ['Directory', 'NotARealNodeType'].filter((t) => !NODE_TYPES.includes(t));
    expect(invented, 'the subset predicate discriminates').toEqual(['NotARealNodeType']);
  });
});
