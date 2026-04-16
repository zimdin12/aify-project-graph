import { describe, it, expect } from 'vitest';
import { renderNodeLine, renderEdgeLine, renderCompact, renderPath }
  from '../../../mcp/stdio/query/renderer.js';
import { estimateTokens, enforceBudget }
  from '../../../mcp/stdio/query/budget.js';
import { rankCallers }
  from '../../../mcp/stdio/query/rank.js';

// ── renderer ──────────────────────────────────────────────────

describe('renderer', () => {
  it('renders a node line', () => {
    const line = renderNodeLine({
      id: 'n_foo', type: 'Function', label: 'foo',
      file_path: 'src/a.py', start_line: 42,
    });
    expect(line).toBe('NODE n_foo function foo src/a.py:42');
  });

  it('renders an edge line', () => {
    const line = renderEdgeLine({
      from_id: 'n_caller', to_id: 'n_foo', relation: 'CALLS',
      source_file: 'src/b.py', source_line: 18, confidence: 0.95,
    });
    expect(line).toBe('EDGE n_caller→n_foo CALLS src/b.py:18 conf=0.95');
  });

  it('renderCompact emits nodes then edges then truncation', () => {
    const out = renderCompact({
      nodes: [{ id: 'a', type: 'Function', label: 'a', file_path: 'x.py', start_line: 1 }],
      edges: [
        { from_id: 'c', to_id: 'a', relation: 'CALLS', source_file: 'y.py', source_line: 2, confidence: 0.9 },
      ],
      truncated: 3,
      suggestion: 'top_k=10',
    });
    expect(out).toContain('NODE a function a x.py:1');
    expect(out).toContain('EDGE c→a CALLS y.py:2 conf=0.90');
    expect(out).toContain('TRUNCATED 3 more (use top_k=10)');
  });

  it('renderPath renders indented path lines', () => {
    const paths = [
      { symbol: 'handleRequest', file: 'src/server.ts', line: 10, confidence: 1.0, children: [
        { symbol: 'validateToken', file: 'src/auth.ts', line: 12, confidence: 0.95, children: [
          { symbol: 'jwt.verify', file: 'external', line: 0, confidence: 0.8, children: [] },
        ]},
        { symbol: 'User.findById', file: 'src/user.ts', line: 34, confidence: 0.9, children: [] },
      ]},
    ];
    const out = renderPath(paths);
    expect(out).toContain('PATH handleRequest src/server.ts:10');
    expect(out).toContain('  → validateToken src/auth.ts:12 conf=0.95');
    expect(out).toContain('    → jwt.verify external:0 conf=0.80');
    expect(out).toContain('  → User.findById src/user.ts:34 conf=0.90');
  });
});

// ── budget ────────────────────────────────────────────────────

describe('budget', () => {
  it('estimateTokens approximates at ~4 chars/token', () => {
    expect(estimateTokens('1234')).toBe(1);
    expect(estimateTokens('12345678')).toBe(2);
  });

  it('enforceBudget drops lowest-confidence edges first', () => {
    const edges = [
      { confidence: 0.9, depth: 1 },
      { confidence: 0.5, depth: 1 },
      { confidence: 0.7, depth: 2 },
    ];
    const out = enforceBudget(edges, 1);
    expect(out.kept.length).toBe(1);
    expect(out.kept[0].confidence).toBe(0.9);
    expect(out.dropped).toBe(2);
  });

  it('enforceBudget drops deepest after confidence ties', () => {
    const edges = [
      { confidence: 0.8, depth: 1 },
      { confidence: 0.8, depth: 3 },
    ];
    const out = enforceBudget(edges, 1);
    expect(out.kept[0].depth).toBe(1);
  });
});

// ── rank ──────────────────────────────────────────────────────

describe('rank', () => {
  it('orders by depth asc, confidence desc, test proximity, fan-in desc', () => {
    const edges = [
      { from_id: 'a', depth: 1, confidence: 0.8, from_type: 'Function', fan_in: 2 },
      { from_id: 'b', depth: 1, confidence: 0.9, from_type: 'Function', fan_in: 1 },
      { from_id: 'c', depth: 2, confidence: 1.0, from_type: 'Function', fan_in: 5 },
      { from_id: 't', depth: 1, confidence: 0.9, from_type: 'Test', fan_in: 1 },
    ];
    const ranked = rankCallers(edges);
    expect(ranked.map(e => e.from_id)).toEqual(['t', 'b', 'a', 'c']);
  });
});
