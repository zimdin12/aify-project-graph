// Audit finding #11 — the trust banner must attribute a verified edge to its OWN
// backend, not always clangd. verifiedEdgeLanguage derives the language from the
// edge's extractor tag so buildTrustLine selects the matching collection.
import { describe, expect, it } from 'vitest';
import { verifiedEdgeLanguage } from '../../../mcp/stdio/query/lsp-evidence.js';

const verified = (extractor) => ({ provenance: 'LSP_VERIFIED', extractor });

describe('verifiedEdgeLanguage', () => {
  it('maps the clangd extractor tag to cpp', () => {
    expect(verifiedEdgeLanguage([verified('cpp-clangd#deadbeef')])).toBe('cpp');
  });
  it('maps the ts-langserver tag to typescript', () => {
    expect(verifiedEdgeLanguage([verified('ts-langserver#abc123')])).toBe('typescript');
  });
  it('maps the pyright tag to python', () => {
    expect(verifiedEdgeLanguage([verified('pyright#0.1.0')])).toBe('python');
  });
  it('returns null when there is no verified edge or the tag is unknown', () => {
    expect(verifiedEdgeLanguage([{ provenance: 'EXTRACTED', extractor: 'cpp' }])).toBeNull();
    expect(verifiedEdgeLanguage([verified('mystery-backend#x')])).toBeNull();
    expect(verifiedEdgeLanguage([])).toBeNull();
  });
});
