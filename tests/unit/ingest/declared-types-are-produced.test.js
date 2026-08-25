// A TYPE THE QUERY LAYER SEARCHES MUST BE A TYPE SOME EXTRACTOR CAN PRODUCE.
//
// ⛔ MEASURED 2026-08-19, and it had been true for months. `whereis.js:SEARCH_TYPES` lists nine
// declaration types. This repo's own graph has ZERO nodes for four of them — Interface, Type,
// Variable, Route — because no JS/TS extraction path emits them. `Variable` in particular has
// exactly one producer in the whole codebase, `ingest/code-intel/schema.js` mapping the LSP
// `variable`/`field` kinds, which needs a code-intel collection most repos do not have.
//
// ⇒ So `graph_whereis` advertised a search over a population that could not exist, and answered
// `NO MATCH` for every module constant in the repository. The code reads correct in isolation:
// the query layer INCLUDES 'Variable', and nothing in it can know the extractor never funds it.
// That is exactly why it survived review — the defect lives in the JOIN between two files that
// are each locally consistent.
//
// ★ BORROWED FROM codegraph's release check (docs/SEARCH_QUALITY_LOOP.md): run the node-kind
// histogram and treat a declared kind with zero count as a missing extractor rule. Their note
// is the whole idea — "If an expected node kind has 0 count, the language extractor is missing
// that AST type." A check like this at any point in the last four months would have caught ours.
//
// ⚠ THE GAP IS RECORDED, NOT HIDDEN. `KNOWN_UNPRODUCED` is a ratchet in BOTH directions: adding
// a type to a search list without an extractor fails here, and landing an extractor fails here
// until its entry is deleted. An empty-set assertion would have to be disabled today, and a
// disabled test is how a known gap becomes an unknown one.
import { describe, it, expect } from 'vitest';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import { getLanguageConfig } from '../../../mcp/stdio/ingest/languages/index.js';
import { SEARCH_TYPES } from '../../../mcp/stdio/query/verbs/whereis.js';

// Every construct whose declaration type the query layer claims to search, in one file, so a
// zero count means "no rule for this AST shape" and not "the fixture never exercised it".
const TS_SOURCE = `
export interface Shape { kind: string; }
export type Alias = Shape | null;
export enum Mode { A, B }
export class Widget {
  render(): string { return 'x'; }
}
export function build(): Widget { return new Widget(); }
export const makeWidget = (): Widget => new Widget();
export const MAX_RETRIES = 3;
export const CONFIG = { retries: MAX_RETRIES };
`;

// Types the query layer searches that NO extraction path currently produces, each with the
// reason. Delete an entry the moment its extractor lands.
const KNOWN_UNPRODUCED = {
  Variable: 'no tree-sitter rule emits it; the only producer is the code-intel LSP importer '
    + '(ingest/code-intel/schema.js maps variable/field), so a repo without a collection has '
    + 'none. This is the gap that makes every module constant answer NO MATCH.',
  // ⚠ FOUND BY THIS TEST, not predicted by me — which is the point of running an instrument
  // instead of reasoning about the list. TS extraction maps interface, type alias AND enum all
  // onto `Type` (verified: the fixture yields Type Shape / Type Alias / Type Mode and no
  // Interface node). `Interface` therefore has the same single producer as `Variable`:
  // code-intel/schema.js:17. Searching for it without a collection can never match.
  Interface: 'tree-sitter maps interface -> Type; the only producer of a literal Interface node '
    + 'is the code-intel LSP importer (ingest/code-intel/schema.js maps the interface kind).',
  Route: 'emitted only by framework plugins (express/django/laravel) against their own '
    + 'fixtures, never by base language extraction.',
};

describe('the declaration types the query layer searches', () => {
  it('★★★ every searched type is either produced by extraction or a RECORDED gap', () => {
    const config = getLanguageConfig('app.ts');
    expect(config, 'sanity: the TS language config must resolve').toBeTruthy();
    const { nodes } = extractFile({ filePath: 'app.ts', source: TS_SOURCE, config });
    expect(nodes.length, 'sanity: the fixture must extract something').toBeGreaterThan(3);

    const produced = new Set(nodes.map((n) => n.type));
    const missing = SEARCH_TYPES.filter((t) => !produced.has(t));

    // Types only other languages/plugins produce are legitimately absent from a TS fixture, so
    // the assertion is scoped to what THIS language is expected to cover.
    const tsRelevant = missing.filter((t) => !['Method', 'Test', 'Entrypoint'].includes(t));

    expect(
      tsRelevant.sort(),
      'a searched type with no producer means the query layer advertises a population that '
        + 'cannot exist — record it in KNOWN_UNPRODUCED with a reason, or add the extractor',
    ).toEqual(Object.keys(KNOWN_UNPRODUCED).sort());
  });

  it('★★★ every RECORDED gap is still a gap — delete the entry when the extractor lands', () => {
    const config = getLanguageConfig('app.ts');
    const { nodes } = extractFile({ filePath: 'app.ts', source: TS_SOURCE, config });
    const produced = new Set(nodes.map((n) => n.type));
    for (const [type, reason] of Object.entries(KNOWN_UNPRODUCED)) {
      expect(produced.has(type), `${type} IS produced now — remove it from KNOWN_UNPRODUCED (${reason})`)
        .toBe(false);
    }
  });

  it('★★★ the arrow-const path still produces a Function, so the gap is scoped to DATA consts', () => {
    // the reviewer's refutation of my first wording, pinned: `export const f = () => …`
    // DOES become a Function. The gap is non-function bindings, and conflating the two is how
    // a measured 84/89 turns into a claim about "module constants" that is not true.
    const config = getLanguageConfig('app.ts');
    const { nodes } = extractFile({ filePath: 'app.ts', source: TS_SOURCE, config });
    const labels = nodes.filter((n) => n.type === 'Function').map((n) => n.label);
    expect(labels, 'the arrow-bound const is a Function').toContain('makeWidget');
    expect(labels, 'the data const must NOT be mislabelled as a Function').not.toContain('MAX_RETRIES');
  });
});
