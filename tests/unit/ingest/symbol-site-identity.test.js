// ⛔ EXTRACTION MUST NOT LOSE A SYMBOL BECAUSE ANOTHER ONE IS SPELLED THE SAME.
//
// Node identity was `stableId([type, filePath, qname])`, and `qname` carries no signature and no
// resolved scope. `symbolsById` deduplicates before storage, `nodes.id` is the sole primary key,
// and `upsertNode` overwrites on conflict — so a second symbol with the same (type, file, qname)
// is DELETED, not merged.
//
// Measured consequences before this file existed (docs/evidence/identity-qualification/):
//   · two classes sharing a leaf name in different namespaces — the second class and its methods
//     vanish, and NOTHING records it, because the `overloads` disclosure only fires when the
//     signatures DIFFER and identical signatures are exactly the collision case;
//   · in this repo's own graph, `code_intel_hierarchy.js` has two local helpers named `expand`
//     with identical declarators; one node survives and `walkTypeHierarchy`'s call is attached to
//     the WRONG one. A false CALLS edge, unmarked. On that symbol grep beats us.
//
// ⚠ SCOPE. These are STEP A assertions: every extracted occurrence SURVIVES as its own row.
// They deliberately do NOT assert that a call resolves to the correct site — choosing the
// lexically enclosing local function needs scope/binding resolution, which is a later step. Two
// retained sites plus an unresolved call is a sound outcome here, and requiring the positive edge
// now would invite a heuristic that passes this case for the wrong reason.
//
// Design + acceptance: docs/M1a-A-site-identity-design.md
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import { getLanguageConfig } from '../../../mcp/stdio/ingest/languages/index.js';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const FIXTURE = join(REPO, 'tests', 'fixtures', 'identity-hostile');

const SYMBOL_TYPES = new Set(['Function', 'Method', 'Class', 'Struct', 'Test']);

function symbolsOf(relPath, source) {
  const result = extractFile({ filePath: relPath, source, config: getLanguageConfig(relPath) });
  return (result?.nodes ?? []).filter((n) => SYMBOL_TYPES.has(n.type));
}

function fixtureSymbols(name) {
  const rel = `src/${name}`;
  return symbolsOf(rel, readFileSync(join(FIXTURE, 'src', name), 'utf8'));
}

const at = (nodes, line) => nodes.filter((n) => n.start_line === line);

describe('step A — every extracted occurrence survives as its own site row', () => {
  it('⛔ two same-name overloads in ONE file produce TWO nodes', () => {
    // `int clamp(int)` at :14 and `double clamp(double)` at :15 of the hostile fixture. A
    // compiler keeps them apart; so must we. Before step A this produced ONE node carrying
    // `overload_signatures: [both]` — the merge, disclosed rather than avoided.
    const nodes = fixtureSymbols('shapes.cpp').filter((n) => n.label === 'clamp');
    expect(nodes.map((n) => n.start_line).sort((a, b) => a - b)).toEqual([14, 15]);
    expect(new Set(nodes.map((n) => n.id)).size, 'the two overloads must not share an id').toBe(2);
  });

  it('⛔ a leaf name reused in a second namespace is NOT deleted', () => {
    // `class Widget` exists in namespace alpha (:5) and namespace beta (:27) of shapes.h. Both
    // are real classes. Before step A the beta one was absent from the graph entirely, and a
    // rename contrast (14 -> 17 nodes) proved the parser had seen it and identity discarded it.
    const widgets = fixtureSymbols('shapes.h').filter((n) => n.label === 'Widget' && n.type === 'Class');
    expect(widgets.map((n) => n.start_line).sort((a, b) => a - b)).toEqual([5, 27]);
  });

  it('⛔ two methods with the SAME declarator in two namespaces both survive', () => {
    // alpha::Widget::render at shapes.h:7 and beta::Widget::render at shapes.h:29. Identical
    // signature, so the `overloads` disclosure could never have fired — this is the silent case.
    const renders = fixtureSymbols('shapes.h').filter((n) => n.label === 'render');
    expect(renders.map((n) => n.start_line).sort((a, b) => a - b)).toEqual([7, 29]);
  });

  it('⛔ the production shape: same-signature local twins in one file both survive', () => {
    // The real defect from mcp/stdio/query/verbs/code_intel_hierarchy.js, reduced to its shape and
    // frozen here rather than pinned to that file's line numbers — a durable oracle must not rot
    // when the file is edited for unrelated reasons.
    const source = [
      'async function walkCall(root) {',
      '  async function expand(item, node, level) { return [item, node, level]; }',
      '  return expand(root, root, 0);',
      '}',
      'async function walkType(root) {',
      '  async function expand(item, node, level) { return [node, item, level]; }',
      '  return expand(root, root, 0);',
      '}',
    ].join('\n');
    const expands = symbolsOf('src/twins.js', source).filter((n) => n.label === 'expand');
    expect(expands.length, 'both local helpers are distinct functions and must both exist').toBe(2);
    expect(new Set(expands.map((n) => n.id)).size).toBe(2);
  });

  it('⛔ ZERO merge metadata — a merge that is merely disclosed is still a merge', () => {
    // ⚠ A weaker gate ("no overload_signatures without overloads") would still permit the
    // disclosed two-signature merge: the same lossy model with better metadata. Step A's contract
    // is no occurrence merging AT ALL, so the presence of either field is evidence it failed.
    const all = [...fixtureSymbols('shapes.cpp'), ...fixtureSymbols('shapes.h'), ...fixtureSymbols('other.cpp')];
    const withSignatures = all.filter((n) => n.extra?.overload_signatures !== undefined);
    const withCount = all.filter((n) => n.extra?.overloads !== undefined);
    expect(withSignatures.map((n) => `${n.label}@${n.start_line}`)).toEqual([]);
    expect(withCount.map((n) => `${n.label}@${n.start_line}`)).toEqual([]);
  });

  it('every symbol carries a typed site_kind — absence is not silently "definition"', () => {
    // Site kind is a REQUIRED sibling row field and never an input to the id: declaration-vs-
    // definition is an extractor classification, so hashing it would remint the site whenever the
    // classification improved, turning a semantic correction into delete + add.
    const all = [...fixtureSymbols('shapes.cpp'), ...fixtureSymbols('shapes.h')];
    const allowed = new Set(['declaration', 'definition', 'declaration_definition', 'unknown']);
    const bad = all.filter((n) => !allowed.has(n.extra?.site_kind));
    expect(bad.map((n) => `${n.label}@${n.start_line}:${n.extra?.site_kind}`)).toEqual([]);
  });

  it('⛔ site_kind is not merely WELL-TYPED — it must be RIGHT, and it was not', () => {
    // The assertion above only checks membership of the allowed set. My first `siteKindOf` read
    // `body` on the matched node and called everything else a declaration, which labelled 634
    // JavaScript symbols `declaration` across this repo — every `const f = () => {...}`, whose
    // body hangs off a nested arrow node. A well-typed wrong answer passed that test cleanly.
    const js = symbolsOf('src/kinds.js', [
      'function classic() { return 1; }',
      'const arrow = () => { return 2; };',
      'const expr = function () { return 3; };',
    ].join('\n'));
    expect(js.map((n) => [n.label, n.extra.site_kind])).toEqual([
      ['classic', 'definition'], ['arrow', 'definition'], ['expr', 'definition'],
    ]);
  });

  it('⛔ and a C++ header declaration IS distinguished from its definition', () => {
    // The case the field exists for. If this collapses to one value the field is decoration.
    const cpp = symbolsOf('src/x.h', 'class W {\n public:\n  void render();\n};\nvoid W::render() {}\n')
      .filter((n) => n.label === 'render');
    expect(cpp.map((n) => n.extra.site_kind)).toEqual(['declaration', 'definition']);
  });

  it('POSITIVE CONTROL: a symbol with one definition still yields exactly one node', () => {
    // Without this, an id scheme that emitted a fresh row per AST visit would pass every
    // assertion above while multiplying every ordinary symbol.
    const uses = fixtureSymbols('shapes.cpp').filter((n) => n.label === 'use_helper');
    expect(uses).toHaveLength(1);
    expect(at(uses, 31)).toHaveLength(1);
  });

  it('NEGATIVE CONTROL: a spelling that is not in the source yields zero nodes', () => {
    // A probe that cannot return zero cannot return a count.
    const ghosts = fixtureSymbols('shapes.cpp').filter((n) => n.label === 'no_such_symbol_m1a');
    expect(ghosts).toHaveLength(0);
  });

  it('POSITIVE CONTROL: the fixture is being read at all', () => {
    // Liveness. If the fixture stopped parsing, every assertion above would pass vacuously on
    // empty arrays — except the two that demand specific lines, which is why those exist.
    expect(fixtureSymbols('shapes.cpp').length).toBeGreaterThan(4);
  });
});

describe('step A — File and Module identities are NOT in scope', () => {
  it('⛔ a File node keeps its existing identity scheme', () => {
    // The change is scoped to code symbol sites. Four separate `stableId` helpers exist in the
    // ingest tree, and "scoped" is exactly the property that gets violated silently — so this
    // pins that File ids are byte-identical to what the old scheme produced.
    const result = extractFile({
      filePath: 'src/shapes.cpp',
      source: readFileSync(join(FIXTURE, 'src', 'shapes.cpp'), 'utf8'),
      config: getLanguageConfig('src/shapes.cpp'),
    });
    const file = (result?.nodes ?? []).find((n) => n.type === 'File');
    expect(file, 'the fixture must produce a File node, or this control proves nothing').toBeTruthy();
    expect(file.id).toBe('962481826c6555b9d016787e05f25feeef265cab');
  });
});
