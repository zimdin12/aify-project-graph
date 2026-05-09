import { describe, it, expect } from 'vitest';
import { rankAndCap, RANKING_ORDER, DEFAULT_CAPS } from '../../../mcp/stdio/query/verbs/packet-budget.js';

describe('packet fact budget', () => {
  it('exposes the locked ranking order', () => {
    expect(RANKING_ORDER).toEqual(['changed_files', 'task_anchors', 'code_intel_confidence', 'recency']);
  });

  it('exposes default caps for known sections', () => {
    expect(typeof DEFAULT_CAPS).toBe('object');
    expect(DEFAULT_CAPS.evidence_records).toBeGreaterThan(0);
    expect(DEFAULT_CAPS.diagnostics).toBeGreaterThan(0);
    expect(DEFAULT_CAPS.affected_files).toBeGreaterThan(0);
  });

  it('ranks changed-files items before task anchors before code_intel_confidence before recency', () => {
    const items = [
      { file: 'a.cpp', score: { recency: 1 } },
      { file: 'b.cpp', score: { code_intel_confidence: 'high' } },
      { file: 'c.cpp', score: { task_anchors: 1 } },
      { file: 'd.cpp', score: { changed_files: 1 } }
    ];
    const ranked = rankAndCap(items, 4);
    expect(ranked.map(i => i.file)).toEqual(['d.cpp', 'c.cpp', 'b.cpp', 'a.cpp']);
  });

  it('caps by limit', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ file: `f${i}.cpp`, score: { recency: i } }));
    const ranked = rankAndCap(items, 5);
    expect(ranked.length).toBe(5);
  });

  it('breaks ties by code_intel_confidence (high > medium > low)', () => {
    const items = [
      { file: 'a.cpp', score: { changed_files: 1, code_intel_confidence: 'low' } },
      { file: 'b.cpp', score: { changed_files: 1, code_intel_confidence: 'high' } },
      { file: 'c.cpp', score: { changed_files: 1, code_intel_confidence: 'medium' } }
    ];
    const ranked = rankAndCap(items, 3);
    expect(ranked.map(i => i.file)).toEqual(['b.cpp', 'c.cpp', 'a.cpp']);
  });
});
