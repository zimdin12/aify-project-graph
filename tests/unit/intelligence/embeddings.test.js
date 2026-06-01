import { describe, it, expect, afterEach } from 'vitest';
import { cosineSimilarity, rankBySimilarity, embedderFromEnv, composeSemanticText } from '../../../mcp/stdio/intelligence/embeddings.js';

describe('similarity primitives', () => {
  it('cosineSimilarity: identical=1, orthogonal=0', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6); // same direction
  });
  it('cosineSimilarity is defensive on zero/short vectors', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
  it('rankBySimilarity returns top-k by similarity desc with scores', () => {
    const items = [{ id: 'a', vec: [1, 0] }, { id: 'b', vec: [0, 1] }, { id: 'c', vec: [0.9, 0.1] }];
    const ranked = rankBySimilarity([1, 0], items, 2);
    expect(ranked.map((r) => r.id)).toEqual(['a', 'c']);
    expect(ranked[0].similarity).toBeGreaterThan(ranked[1].similarity);
  });
  it('composeSemanticText combines label + kind + path (+ overlay summary)', () => {
    const t = composeSemanticText({ label: 'GravityBody', type: 'Class', file_path: 'sim/Gravity.cpp' }, { summary: 'applies gravity to bodies', tags: ['physics'] });
    expect(t).toMatch(/GravityBody/);
    expect(t).toMatch(/sim\/Gravity\.cpp/);
    expect(t).toMatch(/gravity to bodies/);
  });
});

describe('embedderFromEnv', () => {
  afterEach(() => { delete process.env.APG_EMBED_ENDPOINT; });
  it('returns null when no endpoint configured (graceful degrade)', () => {
    delete process.env.APG_EMBED_ENDPOINT;
    expect(embedderFromEnv()).toBeNull();
  });
  it('returns an object with embedTexts when configured', () => {
    process.env.APG_EMBED_ENDPOINT = 'http://localhost:11434/v1/embeddings';
    const e = embedderFromEnv();
    expect(e).toBeTruthy();
    expect(typeof e.embedTexts).toBe('function');
  });
});
