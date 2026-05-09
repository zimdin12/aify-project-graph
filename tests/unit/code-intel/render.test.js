import { describe, it, expect } from 'vitest';
import {
  renderEvidenceLine,
  formatProvenanceTag,
  formatThreeStateRefs
} from '../../../mcp/stdio/code-intel/render.js';

describe('render helpers', () => {
  it('renders provenance tag', () => {
    expect(formatProvenanceTag({ kind: 'reference', confidence: 'high', provenance: 'cpp-clangd@0.1.0' })).toBe('CODE_INTEL');
    expect(formatProvenanceTag({ kind: 'reference', provenance: 'tree-sitter' })).toBe('EXTRACTED');
    expect(formatProvenanceTag({ kind: 'reference', provenance: 'text-search', confidence: 'low' })).toBe('INFERRED');
    expect(formatProvenanceTag({ kind: 'overlay' })).toBe('OVERLAY');
  });

  it('formats found refs', () => {
    const out = formatThreeStateRefs({ state: 'found', count: 5, providerStatus: 'ok' });
    expect(out).toMatch(/found/);
    expect(out).toMatch(/5/);
  });

  it('formats not_found_after_retry distinctly from not_collected', () => {
    const found = formatThreeStateRefs({ state: 'not_found_after_retry', count: 0, providerStatus: 'ok' });
    expect(found).toMatch(/not_found_after_retry/);
    const notColl = formatThreeStateRefs({ state: 'not_collected', count: 0, providerStatus: 'partial', reason: 'partial_batch' });
    expect(notColl).toMatch(/not_collected/);
    expect(notColl).not.toMatch(/not_found_after_retry/);
  });

  it('renders a compact EVIDENCE line for unavailable code-intel', () => {
    const line = renderEvidenceLine({ available: false, reason: 'provider_missing' });
    expect(line).toMatch(/code_intel unavailable/);
    expect(line).toMatch(/provider_missing/);
  });

  it('renders an EVIDENCE line for partial state', () => {
    const line = renderEvidenceLine({
      available: true,
      provider: 'cpp-clangd',
      providerVersion: '0.1.0',
      operations: { definitions: { status: 'ok', count: 3 }, references: { status: 'partial', count: 2, notCollectedFiles: ['src/x.cpp'] } },
      status: 'partial'
    });
    expect(line).toMatch(/partial/);
    expect(line).toMatch(/references/);
  });
});
