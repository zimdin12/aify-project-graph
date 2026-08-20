// EDGE LIFECYCLE OWNERSHIP — the ledger every derived relation needs, and did not have.
//
// From the roadmap's Phase 5, in dev's words: "Every derived cross-layer relation needs a producer,
// population, admission rule, provenance, freshness trigger, deletion trigger and consumer policy.
// Without that ledger, file rename / doc deletion / overlay drift leaves truthful-at-creation edges
// stale, and the foundation becomes wrong again without any extractor defect."
//
// ⛔ EIGHT DEFECTS ON 2026-08-20 WERE MISSING ENTRIES IN THIS LEDGER, ALL IN THE SAME COLUMN.
// Every one was a destructive operation that could not answer "which edges are mine to delete?":
//
//     a 0-file collection pruned 62,066 records         it deleted what it never observed
//     each resumed batch deleted the previous batch's   it claimed repo-wide, walked 154 files
//     `cpp-clangd#` was hardcoded for every provider    a label doing duty as a delete predicate
//     a 3-file collect could supersede 554 files        scoped observation, unscoped deletion
//
// ⇒ So this file is not documentation. The DELETION TRIGGER is executable: `deletePredicate()`
// returns the SQL a producer must use, and no producer restates it. A ledger that only describes
// the rule drifts from the rule — which is the entire finding of that session, four times over.
//
// ★ ADDING A CLASS IS THE CHEAP MOMENT TO ANSWER THESE QUESTIONS. Answering them later means
// answering them from the wreckage.

/**
 * @typedef {object} EdgeClass
 * @property {string}   id              stable key
 * @property {string}   producer        the ONE module entitled to write and delete this class
 * @property {string}   relation        the edges.relation value it emits
 * @property {string}   provenance      the edges.provenance value it stamps
 * @property {string}   extractor       exact extractor value, or the prefix when `prefixed`
 * @property {boolean}  prefixed        true when `extractor` is a prefix (rule variants below it)
 * @property {string[]} retiredExtractors  labels this producer still owns for cleanup only
 * @property {string}   population      what the class is ABOUT — the denominator of any claim
 * @property {string}   admission       when an edge is allowed to exist
 * @property {string}   freshnessTrigger what makes an existing edge suspect
 * @property {string}   deletionTrigger  what is entitled to remove it, and with what scope
 * @property {string}   consumer         who reads it, and what they may conclude
 */

/** @type {EdgeClass[]} */
export const EDGE_CLASSES = [
  {
    id: 'doc_link',
    producer: 'mcp/stdio/analysis/doc-links.js',
    relation: 'LINKS_TO',
    provenance: 'EXTRACTED',
    extractor: 'doc_link:',
    prefixed: true,
    retiredExtractors: [],
    population: 'Document nodes in the graph; targets are File nodes resolved from written paths',
    admission: 'a markdown link or inline path that resolves to exactly one indexed file, at or '
      + 'above the graded confidence floor for its rule',
    freshnessTrigger: 'the source Document changed, or the target file was renamed or deleted',
    deletionTrigger: 'a full re-detect by the producer; scoped to this extractor prefix and NEVER '
      + 'to another producer\'s LINKS_TO edges',
    consumer: 'graph_pull docs and the packet doc layer — read as "this doc points here", never as '
      + '"this doc is about this"',
  },
  {
    id: 'doc_ref',
    producer: 'mcp/stdio/analysis/doc-refs.js',
    relation: 'MENTIONS',
    provenance: 'EXTRACTED',
    extractor: 'doc_ref:',
    prefixed: true,
    // Owned for cleanup only: no new edge is written under these, and only this producer may
    // retire them. Recorded here so "who deletes this?" has an answer for rows nobody writes.
    //
    // ⚠ I FIRST WROTE `['doc_ref:bare', 'doc_ref:snake']` HERE FROM MEMORY. The real value is
    // `['mentions']` — the pre-prefix label, which does not share the prefix at all. Two invented
    // strings that looked exactly like the rule, in the file whose entire purpose is to stop
    // deletion rules being restated from memory. Read the producer, then write the ledger.
    retiredExtractors: ['mentions'],
    population: 'Document nodes; targets are Symbol nodes resolved from a written reference',
    admission: 'a qualified, path-scoped or shaped reference resolving to exactly one symbol, at '
      + 'or above that rule\'s graded precision floor',
    freshnessTrigger: 'the source Document changed, or the target symbol moved, was renamed, or '
      + 'was deleted',
    deletionTrigger: 'a full re-detect by the producer; scoped to this prefix plus its own retired '
      + 'labels',
    consumer: 'doc→symbol navigation. Recall is a FLOOR and is never claimed as exhaustive',
  },
  {
    id: 'virtual_override',
    producer: 'mcp/stdio/ingest/frameworks/virtual_overrides.js',
    relation: 'OVERRIDDEN_BY',
    provenance: 'INFERRED',
    extractor: 'virtual-overrides',
    prefixed: false,
    retiredExtractors: [],
    population: 'virtual/abstract method declarations and their overriding definitions',
    admission: 'a subtype relationship plus a matching signature, both already in the graph',
    freshnessTrigger: 'either type\'s file changed',
    // ⚠ These carry source_file = '' deliberately, so the per-file reindex does NOT reap them —
    // they are synthesized from graph shape, not extracted from one file's text. That is the
    // opposite choice from LSP edges below, and both are correct for their producer.
    deletionTrigger: 'a full re-synthesis by the producer; matched by exact extractor value',
    consumer: 'graph_callers / graph_impact virtual dispatch — INFERRED, never compiler-verified',
  },
  {
    id: 'lsp_verified',
    producer: 'mcp/stdio/ingest/code-intel/importer.js',
    relation: 'CALLS',
    provenance: 'LSP_VERIFIED',
    // ⛔ Per-provider by construction since d2546ea. It was the literal `cpp-clangd#` for EVERY
    // provider, and since the invalidation DELETE matched on it, a C++ collect was entitled to
    // delete TypeScript evidence.
    extractor: '<provider>#',
    prefixed: true,
    retiredExtractors: ['cpp-clangd#'],
    population: 'symbols the collection actually queried — its declared file scope, not the repo',
    admission: 'a language server returned a reference whose callsite resolves to an enclosing '
      + 'caller in the graph',
    freshnessTrigger: 'the file the evidence came from changed — LSP edges carry a real '
      + 'source_file precisely so the per-file reindex reaps them',
    // ⚠ The one that cost the most. Both halves are load-bearing.
    deletionTrigger: 'a collection with authority under `collectionAuthority()`, scoped to callees '
      + 'in its declared files; a run that observed nothing, continued a resume, or declared a '
      + 'file scope may NOT supersede a collection',
    consumer: 'graph_callers exhaustiveness — the only class that may be read as compiler-verified',
  },
];

const byId = new Map(EDGE_CLASSES.map((c) => [c.id, c]));

/** @param {string} id */
export function edgeClass(id) {
  const c = byId.get(id);
  if (!c) throw new Error(`unknown edge class "${id}" — add it to EDGE_CLASSES with its lifecycle`);
  return c;
}

/**
 * The SQL fragment identifying the edges a class owns, plus its bound parameters.
 *
 * ⛔ PRODUCERS MUST NOT RESTATE THIS. A deletion rule written twice is a deletion rule that will
 * differ in one of the two places — which is exactly how the record prune and the edge
 * invalidation drifted 600 lines apart and cost 62,066 records.
 *
 * @param {string} id
 * @param {{provider?: string}} [opts] provider name, required for per-provider classes
 */
export function ownedEdgesPredicate(id, { provider } = {}) {
  const c = edgeClass(id);
  const extractor = c.extractor.includes('<provider>')
    ? c.extractor.replace('<provider>', String(provider ?? ''))
    : c.extractor;
  if (c.extractor.includes('<provider>') && !provider) {
    // Fails closed: a missing provider would otherwise produce the prefix `#`, which matches
    // every provider's edges — the defect this class was fixed for, reintroduced by omission.
    throw new Error(`edge class "${id}" is per-provider; pass { provider } or it would match all`);
  }
  const labels = [extractor, ...c.retiredExtractors];
  const params = {};
  const terms = labels.map((label, i) => {
    params[`ec${i}`] = c.prefixed && label === extractor ? `${label}%` : label;
    return c.prefixed && label === extractor ? `extractor LIKE $ec${i}` : `extractor = $ec${i}`;
  });
  params.ecRelation = c.relation;
  return { sql: `relation = $ecRelation AND (${terms.join(' OR ')})`, params };
}
