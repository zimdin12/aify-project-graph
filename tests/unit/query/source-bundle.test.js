// Unit tests for the shared source-bundle helper (Code-Intel v2 / P1-2+P1-3).
// Covers: cat -n correctness (1-based numbers matching the file), per-block +
// total budget caps, monotonic tier caps, skip-missing safety, and the framing
// header.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SOURCE_BUNDLE_HEADER,
  assertMonotonicTiers,
  getSourceBundleBudget,
  readSourceWindow,
  renderSourceBlock,
  renderSourceBundle,
} from '../../../mcp/stdio/query/source-bundle.js';

describe('source-bundle tiers', () => {
  it('tier caps are monotonic (a larger tier never gets a smaller cap)', () => {
    expect(() => assertMonotonicTiers()).not.toThrow();
  });

  it('rejects a non-monotonic tier table', () => {
    const bad = [
      { name: 'a', maxNodes: 100, perBlockLines: 100, totalLines: 100, maxBlocks: 5 },
      { name: 'b', maxNodes: 200, perBlockLines: 80, totalLines: 200, maxBlocks: 6 }, // perBlockLines shrank
    ];
    expect(() => assertMonotonicTiers(bad)).toThrow(/monotonicity/);
  });

  it('selects bigger budgets for bigger repos', () => {
    const tiny = getSourceBundleBudget(100);
    const huge = getSourceBundleBudget(50000);
    expect(huge.perBlockLines).toBeGreaterThanOrEqual(tiny.perBlockLines);
    expect(huge.totalLines).toBeGreaterThanOrEqual(tiny.totalLines);
    expect(huge.maxBlocks).toBeGreaterThanOrEqual(tiny.maxBlocks);
  });
});

describe('source-bundle rendering', () => {
  let repoRoot;
  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-srcbundle-'));
    // 10-line file with distinguishable content per line.
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1} content`);
    await writeFile(join(repoRoot, 'sample.cpp'), lines.join('\n') + '\n');
  });
  afterEach(async () => { await rm(repoRoot, { recursive: true, force: true }); });

  it('readSourceWindow returns the exact 1-based window, clamped to file extent', () => {
    const w = readSourceWindow(repoRoot, 'sample.cpp', 3, 5, 100);
    expect(w.missing).toBe(false);
    expect(w.startLine).toBe(3);
    expect(w.lines).toEqual(['line 3 content', 'line 4 content', 'line 5 content']);
    // beyond EOF is clamped, not an error
    const past = readSourceWindow(repoRoot, 'sample.cpp', 9, 999, 100);
    expect(past.lines).toEqual(['line 9 content', 'line 10 content']);
  });

  it('renderSourceBlock numbers lines cat -n style matching the file', () => {
    const { text } = renderSourceBlock({
      symbol: 'foo', filePath: 'sample.cpp', startLine: 3, endLine: 5, repoRoot, perBlockLines: 100,
    });
    expect(text).toContain('foo @ sample.cpp:3-5');
    // 1-based numbers matching the real file lines
    expect(text).toContain('3\tline 3 content');
    expect(text).toContain('4\tline 4 content');
    expect(text).toContain('5\tline 5 content');
    // does NOT renumber from 1
    expect(text).not.toContain('1\tline 3 content');
  });

  it('renderSourceBlock enforces the per-block cap and marks truncation', () => {
    const { text, lineCount } = renderSourceBlock({
      symbol: 'foo', filePath: 'sample.cpp', startLine: 1, endLine: 10, repoRoot, perBlockLines: 4,
    });
    expect(lineCount).toBe(4);
    expect(text).toContain('1\tline 1 content');
    expect(text).toContain('4\tline 4 content');
    expect(text).not.toContain('5\tline 5 content');
    expect(text).toContain('block truncated at 4 lines');
  });

  it('renderSourceBlock is safe on a missing file (skip-missing, no throw)', () => {
    const { text } = renderSourceBlock({
      symbol: 'gone', filePath: 'does-not-exist.cpp', startLine: 1, endLine: 5, repoRoot, perBlockLines: 100,
    });
    expect(text).toContain('source unavailable');
  });

  it('renderSourceBundle emits the framing header once and caps total lines', () => {
    const budget = { name: 'tiny', perBlockLines: 100, totalLines: 6, maxBlocks: 10 };
    const blocks = [
      { symbol: 'a', filePath: 'sample.cpp', startLine: 1, endLine: 5 },
      { symbol: 'b', filePath: 'sample.cpp', startLine: 6, endLine: 10 },
    ];
    const { text, rendered, dropped } = renderSourceBundle({ blocks, repoRoot, budget });
    // header present exactly once
    expect(text.indexOf(SOURCE_BUNDLE_HEADER)).toBe(text.lastIndexOf(SOURCE_BUNDLE_HEADER));
    // first block (5 lines) fits; second is squeezed to the 1 remaining line
    expect(rendered).toBe(2);
    expect(dropped).toBe(0);
    expect(text).toContain('1\tline 1 content');
  });

  it('renderSourceBundle drops blocks past maxBlocks and reports the count', () => {
    const budget = { name: 'tiny', perBlockLines: 100, totalLines: 1000, maxBlocks: 1 };
    const blocks = [
      { symbol: 'a', filePath: 'sample.cpp', startLine: 1, endLine: 2 },
      { symbol: 'b', filePath: 'sample.cpp', startLine: 3, endLine: 4 },
      { symbol: 'c', filePath: 'sample.cpp', startLine: 5, endLine: 6 },
    ];
    const { rendered, dropped } = renderSourceBundle({ blocks, repoRoot, budget });
    expect(rendered).toBe(1);
    expect(dropped).toBe(2);
  });
});
