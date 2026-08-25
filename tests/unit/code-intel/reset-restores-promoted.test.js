// A RESET MUST BE A REVERT, NOT A WIPE.
//
// Promoted edges are real tree-sitter edges that clangd merely UPGRADED to
// LSP_VERIFIED; their origin is stashed in the extractor column. Deleting them
// outright silently loses call sites that genuinely exist — they read afterwards as
// "these call sites don't exist", which is the worst failure this codebase has.
// the field fleet's tree had 891 of them.
//
// THE BUG THIS PINS. reset-code-intel.mjs originally REIMPLEMENTED the stash
// decoder and split the payload on '|' when the real component separator is '::'.
// For a stash of `EXTRACTED::generic::1` it would have written
// provenance="EXTRACTED::generic::1", extractor="", confidence=0.5 — corrupting all
// 891 edges the restore exists to protect, while reporting success. Caught by
// reading the encoder before authorising the run on someone else's repo.
//
// The fix is not "read more carefully": a parser duplicated away from its encoder
// WILL drift. The script imports decodeStash so drift is impossible, and this test
// pins encode/decode as a round-trip so neither side can move alone.
import { describe, it, expect } from 'vitest';
import { decodeStash, STASH_SEP } from '../../../mcp/stdio/ingest/code-intel/importer.js';

describe('stash round-trip', () => {
  // Mirrors encodeStash exactly. If the encoder changes shape, this and the script
  // fail together rather than the script failing silently in the field.
  const encode = (lspExtractor, o) =>
    `${lspExtractor}${STASH_SEP}${o.provenance}::${o.extractor}::${o.confidence}`;

  it('decodes what the importer encodes', () => {
    const origin = { provenance: 'EXTRACTED', extractor: 'generic', confidence: 1 };
    expect(decodeStash(encode('cpp-clangd#abc123', origin))).toEqual(origin);
  });

  it('the naive `|` split — what the script first did — produces garbage', () => {
    // Kept as an executable record of the defect, so nobody reintroduces it
    // thinking it looks equivalent.
    const payload = encode('cpp-clangd#abc', { provenance: 'EXTRACTED', extractor: 'generic', confidence: 1 })
      .split(STASH_SEP)[1];
    const [prov, ext, conf] = payload.split('|');
    expect(prov).toBe('EXTRACTED::generic::1');   // the whole payload, not the provenance
    expect(ext).toBeUndefined();                  // extractor lost entirely
    expect(Number.isNaN(Number(conf))).toBe(true); // confidence lost
    // And what it SHOULD be:
    expect(decodeStash(encode('cpp-clangd#abc', { provenance: 'EXTRACTED', extractor: 'generic', confidence: 1 })))
      .toEqual({ provenance: 'EXTRACTED', extractor: 'generic', confidence: 1 });
  });

  it('survives an extractor containing the component separator', () => {
    // `::` inside the extractor must not shift the fields — decodeStash rejoins
    // the middle, which a naive 3-way split would get wrong.
    const origin = { provenance: 'INFERRED', extractor: 'cpp::qt::signals', confidence: 0.72 };
    expect(decodeStash(encode('cpp-clangd#x', origin))).toEqual(origin);
  });

  it('returns null rather than a wrong answer on undecodable input', () => {
    // The script leaves undecodable rows ALONE rather than deleting them: a
    // restore that cannot establish the origin must not destroy the edge.
    expect(decodeStash('cpp-clangd#nostash')).toBeNull();
    expect(decodeStash(`cpp-clangd#x${STASH_SEP}truncated`)).toBeNull();
    expect(decodeStash(null)).toBeNull();
  });
});
