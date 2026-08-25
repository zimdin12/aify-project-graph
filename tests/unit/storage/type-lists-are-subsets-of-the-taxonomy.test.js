// ⛔ TWO GOVERNED CONSUMER LISTS MUST NAME ONLY DECLARED TYPES.
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
// ⛔⛔ THE CLAIM LIMIT, STATED BECAUSE I OVER-CLAIMED IT ONCE. This file proves that TWO ENUMERATED
// CONSUMER LISTS are subsets of the declared vocabulary. It does NOT prove that every node type a
// producer can emit is declared: a future extractor emitting a type absent from both lists leaves
// this gate GREEN until a runtime census sees it on somebody's repo.
//
// ⇒ the reviewer's ruling, and they were right to refuse the wider wording — "every behavioural
// type list" is a claim about a population this file never enumerates. The wider guarantee needs a
// PRODUCER-EMISSION INVENTORY checked against NODE_TYPES, which is a different instrument and is
// not built here.
import { describe, it, expect } from 'vitest';
import { NODE_TYPES } from '../../../mcp/stdio/storage/taxonomy.js';
import { SEARCH_TYPES } from '../../../mcp/stdio/query/verbs/whereis.js';

// ⚠ IMPORTED, NOT PARSED. The first version read `SPECIAL_TYPES` out of the orchestrator's SOURCE
// with a regex, because the list was module-private. the reviewer: "a source parse is
// intentionally weaker than structural ownership" — a rename makes the parse vacuous and the arm
// goes quietly green. The list is now exported and this observes the runtime object.
import { SPECIAL_TYPES } from '../../../mcp/stdio/freshness/orchestrator.js';

describe('the two governed consumer lists are subsets of the declared vocabulary', () => {
  it('★★★ the list is real and non-empty — an empty one makes the next assertion vacuous', () => {
    // ⛔ POSITIVE CONTROL FIRST. "No undeclared types" is trivially true of a list that failed to
    // parse, and this repo has shipped that exact wrong-zero more than once today.
    const special = SPECIAL_TYPES;
    expect(special, 'SPECIAL_TYPES must be a real array, not a parse result').toBeInstanceOf(Array);
    expect(special.length, 'and it is non-empty').toBeGreaterThan(3);
    expect(special, 'sanity: it contains a type we know is there').toContain('Directory');
  });

  it('★★★ SPECIAL_TYPES names only declared node types', () => {
    // This is the arm that was RED before `BuildTarget`/`BuildTest` were declared.
    const undeclared = SPECIAL_TYPES.filter((t) => !NODE_TYPES.includes(t));
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
