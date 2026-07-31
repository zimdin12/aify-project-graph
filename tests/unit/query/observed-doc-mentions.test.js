// THE SAFETY VERB MISSED THE BINDING CONTRACT THE BROWSE VERB FOUND.
//
// ef-manager, 2026-07-31, blast-radius experiment on engine/voxel/ChunkDataCache.h:
// graph_consequences listed two contracts with ZERO textual mention of the file
// and MISSED docs/contracts/worldbuffer-authority.md, which names it 22 times.
// graph_pull's docs layer surfaced it immediately — same DB, same minute.
//
// The gap was mechanism, not data. Contracts came only from feature.contracts, a
// curated feature-level field; the MENTIONS edge sat unqueried. Curation is the
// right default — it encodes intent text cannot — but on the verb whose whole job
// is "what could this break", being quietly incomplete is the worst failure mode.
//
// Two things are pinned here, because fixing the first silently broke the second:
//   1. observed mentions are surfaced alongside the inferred/declared contracts
//   2. the RANKING carries signal — COUNT(*) over deduped MENTIONS rows returns 1
//      for every document, which surfaces the binding contract and then buries it
//      in a flat list of 15. That is the "partial remediation that looks complete"
//      shape, and it was invisible until the counts were actually read.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const consequences = readFileSync(
  join(here, '../../../mcp/stdio/query/verbs/consequences.js'),
  'utf8',
);

describe('observed document mentions supplement curated contracts', () => {
  it('queries the MENTIONS edge rather than trusting feature.contracts alone', () => {
    expect(consequences).toMatch(/documents_mentioning/);
    expect(consequences).toMatch(/e\.relation = 'MENTIONS'/);
  });

  it("uses the edge table's real column name", () => {
    // edges has (from_id, to_id, relation, ...) — there is no `type` column.
    // The first draft used e.type and threw SQLITE_ERROR on every call.
    expect(consequences).not.toMatch(/e\.type = 'MENTIONS'/);
  });

  it('ranks by DISTINCT mentioned nodes, not raw row count', () => {
    // MENTIONS is deduped per (document, node): COUNT(*) is 1 for every doc.
    expect(consequences).toMatch(/COUNT\(DISTINCT n\.id\) AS mention_count/);
    expect(consequences).toMatch(/ORDER BY mention_count DESC/);
  });

  it('matches documents by declared LABEL, not only by file_path', () => {
    // A contract names a TYPE; the node the edge lands on is often a forward
    // decl or External in another file. file_path-only matching collapsed every
    // document to a single mention and flattened the ranking.
    expect(consequences).toMatch(/const mentionLabels = new Set/);
    expect(consequences).toMatch(/fileLabelRows/);
  });

  it('does not re-report a document the feature overlay already declared', () => {
    expect(consequences).toMatch(/declaredDocSet/);
  });

  it('labels the new field observed, distinguishing it from the inferred ones', () => {
    expect(consequences).toMatch(/documents_mentioning: 'observed'/);
    expect(consequences).toMatch(/contracts_potentially_affected: 'inferred'/);
  });
});
