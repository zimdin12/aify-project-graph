// PRODUCER-EMISSION INVENTORY — the other direction from the consumer-list subset gate.
//
// ⛔ WHY BOTH EXIST. `type-lists-are-subsets-of-the-taxonomy.test.js` proves two enumerated CONSUMER
// lists name only declared types. It does NOT prove that every type a PRODUCER can emit is declared
// — a new extractor emitting a type absent from both lists leaves that gate green until a runtime
// census sees it on somebody's repo. That is how `BuildTarget`/`BuildTest` shipped undeclared and
// made every CMake repo report a false `present_but_undeclared` drift.
//
// ⛔⛔ THE FIRST VERSION OF THIS FILE WAS QUOTE-SENSITIVE AND I CALLED IT "LITERAL" COVERAGE.
// It matched `/type:\s*'([A-Z][A-Za-z]+)'/`. graph-senior-dev executed the other spellings:
// `type: "X"`, `"type": "X"` and `type: `X`` all returned nothing. One spelling of four, described
// as the class. It now parses (`scripts/lib/emitted-node-types.mjs`) so the property is found by
// its POSITION IN THE TREE, and the four spellings are pinned below as discriminators.
//
// ⚠ HONEST SCOPE OF THAT REPAIR: the AST finds exactly the same 18 types the regex did, so no
// undeclared type was escaping. The hole was LATENT — it would have opened the first time a
// producer was written with double quotes. A fix for a defect that had not yet fired is still a
// fix, but it is not a save, and reporting it as one would inflate the day's ledger.
//
// ⚠ WHAT THIS STILL CANNOT SEE: a computed value. `type: detectedType` is invisible to any literal
// inventory. That limit is MEASURED rather than asserted — the computed sites are counted, and the
// runtime census (`present_but_undeclared`) is the complement that covers them on real repos.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODE_TYPES } from '../../../mcp/stdio/storage/taxonomy.js';
import {
  emittedTypeLiterals,
  computedTypeSites,
  inventoryEmittedTypes,
  undeclaredTypes,
} from '../../../scripts/lib/emitted-node-types.mjs';

const MCP = fileURLToPath(new URL('../../../mcp/stdio', import.meta.url));
const PRODUCER_DIRS = [join(MCP, 'ingest'), join(MCP, 'analysis')];

const inventory = () => inventoryEmittedTypes(PRODUCER_DIRS);

describe('producers emit only declared node types', () => {
  it('★★★ THE PARSER IS QUOTE-BLIND — four spellings, one capture', () => {
    // ⛔ THE ARM THAT FAILED. Each of these is an equally real emission of the same type; the old
    // regex saw only the first. Built by concatenation rather than typed inline so the assertion
    // cannot be satisfied by this file's own quoting being rewritten to match the parser.
    const Q = String.fromCharCode(39);   // '
    const D = String.fromCharCode(34);   // "
    const B = String.fromCharCode(96);   // `
    const spellings = {
      'single-quoted value': `const n = { type: ${Q}BuildTarget${Q} };`,
      'double-quoted value': `const n = { type: ${D}BuildTarget${D} };`,
      'quoted key         ': `const n = { ${D}type${D}: ${D}BuildTarget${D} };`,
      'template value     ': `const n = { type: ${B}BuildTarget${B} };`,
    };
    for (const [label, src] of Object.entries(spellings)) {
      expect(emittedTypeLiterals(src).map((h) => h.value), label).toEqual(['BuildTarget']);
    }
  });

  it('★★★ a template WITH substitutions is computed, not literal', () => {
    // The boundary of the word "literal". Reporting it as literal coverage would be the same
    // over-claim in a new place: an interpolated value is not knowable from the syntax.
    const B = String.fromCharCode(96);
    const src = `const n = { type: ${B}\${prefix}Node${B} };`;
    expect(emittedTypeLiterals(src), 'not counted as a literal').toEqual([]);
    expect(computedTypeSites(src).length, 'and reported as computed instead').toBe(1);
  });

  it('★★★ THE INSTRUMENT WORKS — it finds types we know are emitted', () => {
    // ⛔ POSITIVE CONTROL FIRST. "No undeclared types" is trivially true of a walk that found
    // nothing, and a wrong zero here agrees with exactly what we hope to see, so nothing collides
    // with it. This repo has shipped that failure more than once.
    const { literals, filesWalked } = inventory();
    expect(filesWalked.length, 'the walk reached a real population').toBeGreaterThanOrEqual(40);
    expect(literals.size, 'and found a substantial type set').toBeGreaterThanOrEqual(12);
    for (const known of ['Document', 'Config', 'Directory', 'BuildTarget', 'BuildTest']) {
      expect([...literals.keys()], `${known} is emitted and must be seen`).toContain(known);
    }
    expect([...literals.keys()], 'and it discriminates').not.toContain('NotARealNodeType');
  });

  it('★★★ every literally-emitted type is declared in NODE_TYPES', () => {
    // The arm that was RED before BuildTarget/BuildTest were declared — the one that would have
    // caught them at author time instead of on a user's CMake repo.
    //
    // ⛔ NO SHAPE FILTER. The old version only considered `[A-Z][A-Za-z]+` values, so a producer
    // emitting `type: 'buildTarget'` would have been skipped rather than caught. Measured: ZERO
    // non-capitalised `type:` literals exist in these trees, so the heuristic bought nothing and
    // was deleted. Deriving membership from what the tree contains beats a lexical guess.
    //
    // ⚠ IF A NON-NODE `type:` FIELD IS EVER ADDED HERE, THIS REDDENS. That is intended: the cost
    // lands on the author who just added it, who can see immediately whether it is a node type.
    // (Distinct from the CMake false drift, where a user-facing alarm fired on legitimate data for
    // a reader with no way to judge it. Audience decides whether a false alarm is noise or a prompt.)
    const { literals } = inventory();
    expect(undeclaredTypes(literals, NODE_TYPES), 'an undeclared emitted type creates a false census drift')
      .toEqual([]);
  });

  it('★★★ CONTROL: the real predicate reds on an undeclared DOUBLE-QUOTED emission', () => {
    // ⛔ THE WITNESS FOR THE DEFECT THAT WAS FOUND. Not a reimplementation of the check — the
    // synthetic module is parsed by the same extractor and judged by the same `undeclaredTypes`
    // the gate above calls. A control that exercises a parallel route cannot fail with the gate.
    const D = String.fromCharCode(34);
    const src = `export function make() { return { ${D}type${D}: ${D}UndeclaredType${D}, name: 'x' }; }`;
    const literals = new Map(
      emittedTypeLiterals(src, 'synthetic.js').map((h) => [h.value, { file: 'synthetic.js', line: h.line }]),
    );
    expect([...literals.keys()], 'the parser saw the double-quoted emission').toEqual(['UndeclaredType']);
    expect(undeclaredTypes(literals, NODE_TYPES), 'and the gate predicate rejects it')
      .toEqual(['UndeclaredType (emitted by synthetic.js:1)']);
  });

  it('★★★ the computed sites are COUNTED, so the stated limitation cannot quietly lapse', () => {
    // ⚠ A prose caveat decays; a number moves. If a producer adds a computed `type:`, this changes
    // and forces a look at whether the runtime census still covers what the inventory cannot see.
    // `generic.js` is named because it is the known instance the limitation was written from.
    const { computed } = inventory();
    expect(computed.length, 'computed type: sites the literal inventory cannot resolve').toBe(5);
    expect(computed.map((c) => c.file).join('|')).toMatch(/generic\.js/);
  });

  it('★★★ the population claim is scoped to the trees actually walked', () => {
    // ⛔ A COMPLETION CLAIM NAMES ITS POPULATION. This gate says nothing about node types emitted
    // outside ingest/ and analysis/; pinning the walked roots keeps the claim and the walk in the
    // same place, so widening one without the other is visible.
    const { dirs } = inventory();
    expect(dirs.map((d) => d.slice(d.indexOf('stdio')).replace(/\\/g, '/')))
      .toEqual(['stdio/ingest', 'stdio/analysis']);
  });

  it('★★★ the known computed instance still exists', () => {
    // If `generic.js` ever stops computing its type, the limitation narrows and this file should
    // be revisited rather than left claiming a caveat that no longer applies.
    const generic = readFileSync(join(MCP, 'ingest', 'extractors', 'generic.js'), 'utf8');
    expect(computedTypeSites(generic, 'generic.js').length, 'a computed type the scan cannot resolve')
      .toBeGreaterThan(0);
  });
});
