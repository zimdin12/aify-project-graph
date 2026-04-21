// Feature coverage gradient — composite health tier in brief.json features.
// Per echoes PM 2026-04-21: "features are binary today (resolved/not).
// pcas-simulation (22 tasks, 0 tests) and world-buffer (1 contract, strong
// test coverage) both read ✓." This tier surfaces the gradient.

import { describe, expect, it } from 'vitest';
import { computeCoverage } from '../../../mcp/stdio/brief/generator.js';

describe('computeCoverage — feature health tier', () => {
  it('returns 🟢 healthy when anchors resolve + has contract + low tasks', () => {
    const r = computeCoverage({ resolved: 4, declared: 4, taskCount: 2, contractCount: 1 });
    expect(r.tier).toBe('🟢');
    expect(r.label).toBe('healthy');
  });

  it('returns 🔴 risk when anchors do not fully resolve', () => {
    const r = computeCoverage({ resolved: 2, declared: 4, taskCount: 0, contractCount: 1 });
    expect(r.tier).toBe('🔴');
    expect(r.label).toBe('risk');
    expect(r.reason).toMatch(/broken anchors/);
  });

  it('returns 🔴 risk on severe task overhang (>20)', () => {
    const r = computeCoverage({ resolved: 4, declared: 4, taskCount: 22, contractCount: 1 });
    expect(r.tier).toBe('🔴');
    expect(r.reason).toMatch(/22 open tasks/);
  });

  it('returns 🟡 watch on moderate task overhang (10-20)', () => {
    const r = computeCoverage({ resolved: 4, declared: 4, taskCount: 12, contractCount: 1 });
    expect(r.tier).toBe('🟡');
    expect(r.label).toBe('watch');
  });

  it('returns 🟡 watch when anchors resolve but no contract', () => {
    const r = computeCoverage({ resolved: 4, declared: 4, taskCount: 2, contractCount: 0 });
    expect(r.tier).toBe('🟡');
    expect(r.reason).toMatch(/no contract/);
  });

  it('does not crash on zero-anchors feature', () => {
    const r = computeCoverage({ resolved: 0, declared: 0, taskCount: 0, contractCount: 0 });
    expect(['🟢', '🟡', '🔴']).toContain(r.tier);
  });
});
