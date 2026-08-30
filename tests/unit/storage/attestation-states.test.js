// FOUR STATES, AND EVERY UNKNOWN FAILS CLOSED UNDER ITS OWN WORDING.
//
// This is the comparison the whole generation-publication unit collapses to: one integer from the
// database against one integer from the manifest. Three file formats needing their own contract
// became this. It must not quietly widen into a guess.
import { describe, it, expect } from 'vitest';
import { ATTESTATION, classifyAttestation } from '../../../mcp/stdio/storage/publication-schema.js';

describe('classifyAttestation separates four states that look alike from a denial', () => {
  it('POSITIVE CONTROL: matching generations are ATTESTED', () => {
    // Without this the classifier could return a refusal unconditionally and every case below
    // would still pass.
    expect(classifyAttestation({ dbGeneration: 7, manifestGeneration: 7 })).toBe(ATTESTATION.ATTESTED);
  });

  it('⛔ no table is LEGACY — the question cannot be asked of this graph', () => {
    for (const dbGeneration of [null, undefined]) {
      expect(classifyAttestation({ dbGeneration, manifestGeneration: 3 })).toBe(ATTESTATION.LEGACY_UNATTESTED);
    }
  });

  it('⛔ generation 0 is NEVER_COMPLETED, which is NOT legacy', () => {
    // The table exists, so the question WAS asked; the answer is that nothing has ever been
    // published. An empty graph presenting as a real one. Collapsing this into legacy would send a
    // reader to the same remedy for two different problems.
    expect(classifyAttestation({ dbGeneration: 0, manifestGeneration: 0 })).toBe(ATTESTATION.NEVER_COMPLETED);
    expect(classifyAttestation({ dbGeneration: 0, manifestGeneration: 0 }))
      .not.toBe(ATTESTATION.LEGACY_UNATTESTED);
  });

  it('⛔ a database ahead of its manifest is a MISMATCH — the crash window', () => {
    // The rebuild committed and the manifest write never landed. The graph is whole and unattested.
    expect(classifyAttestation({ dbGeneration: 8, manifestGeneration: 7 })).toBe(ATTESTATION.GENERATION_MISMATCH);
  });

  it('⛔ a manifest with NO generation against a real one is a mismatch, not legacy', () => {
    // The database is past the upgrade and the manifest is behind it. Reporting legacy here would
    // describe the graph as older than it is and hide a genuine torn publication.
    for (const manifestGeneration of [null, undefined]) {
      expect(classifyAttestation({ dbGeneration: 4, manifestGeneration }))
        .toBe(ATTESTATION.GENERATION_MISMATCH);
    }
  });

  it('⛔ a non-integer generation is a mismatch, not silently coerced', () => {
    // '7' == 7 in the language and NOT here. A string generation means something upstream wrote a
    // field it did not understand, and comparing loosely would let it pass as attested.
    expect(classifyAttestation({ dbGeneration: '7', manifestGeneration: '7' }))
      .toBe(ATTESTATION.GENERATION_MISMATCH);
  });

  it('called with nothing at all, it refuses rather than throwing', () => {
    expect(classifyAttestation()).toBe(ATTESTATION.LEGACY_UNATTESTED);
  });
});
