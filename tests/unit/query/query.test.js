import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderNodeLine, renderEdgeLine, renderCompact, renderPath }
  from '../../../mcp/stdio/query/renderer.js';
import { estimateTokens, enforceBudget }
  from '../../../mcp/stdio/query/budget.js';
import { rankCallers }
  from '../../../mcp/stdio/query/rank.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';
import { buildPaths, selectBestRoot, trimPaths }
  from '../../../mcp/stdio/query/verbs/path.js';
import { collapseCallerEdges, expandClassRollupTargets }
  from '../../../mcp/stdio/query/verbs/target_rollup.js';

// ── renderer ──────────────────────────────────────────────────

describe('renderer', () => {
  it('renders a node line', () => {
    const line = renderNodeLine({
      id: 'n_foo', type: 'Function', label: 'foo',
      file_path: 'src/a.py', start_line: 42,
    });
    expect(line).toBe('NODE n_foo function foo src/a.py:42');
  });

  it('renders external nodes without a fake file location', () => {
    const line = renderNodeLine({
      id: 'ext_sdl', type: 'External', label: 'SDL_GetKeyboardState',
      file_path: '', start_line: 0,
    });
    expect(line).toBe('NODE ext_sdl external SDL_GetKeyboardState external');
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
    expect(out).toContain('    → jwt.verify external conf=0.80');
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

// ── path helpers ─────────────────────────────────────────────

describe('path helpers', () => {
  it('selectBestRoot prefers executable node types', () => {
    const root = selectBestRoot([
      { id: 'doc', type: 'Document', label: 'broadcast', file_path: 'docs/broadcast.md', start_line: 1, confidence: 1.0 },
      { id: 'fn', type: 'Function', label: 'broadcast', file_path: 'src/broadcast.py', start_line: 10, confidence: 0.9 },
      { id: 'route', type: 'Route', label: 'broadcast', file_path: 'routes.py', start_line: 5, confidence: 0.8 },
    ]);

    expect(root.id).toBe('route');
  });

  it('buildPaths allows sibling branches to revisit the same node', () => {
    const edgeMap = {
      root: [
        { node_id: 'alpha', label: 'alpha', node_type: 'Function', file_path: 'src/a.py', start_line: 10, node_confidence: 0.9, relation: 'CALLS', edge_confidence: 0.9 },
        { node_id: 'beta', label: 'beta', node_type: 'Function', file_path: 'src/b.py', start_line: 20, node_confidence: 0.9, relation: 'CALLS', edge_confidence: 0.8 },
      ],
      alpha: [
        { node_id: 'shared', label: 'shared', node_type: 'Function', file_path: 'src/shared.py', start_line: 30, node_confidence: 0.9, relation: 'CALLS', edge_confidence: 0.9 },
      ],
      beta: [
        { node_id: 'shared', label: 'shared', node_type: 'Function', file_path: 'src/shared.py', start_line: 30, node_confidence: 0.9, relation: 'CALLS', edge_confidence: 0.9 },
      ],
      shared: [],
    };

    const db = {
      all: (_sql, params) => edgeMap[params.id] ?? [],
    };

    const path = buildPaths(db, {
      id: 'root',
      label: 'handleRequest',
      file_path: 'src/server.py',
      start_line: 1,
      confidence: 1.0,
    }, {
      direction: 'out',
      maxDepth: 3,
      explorationWidth: 12,
      relations: ['CALLS'],
      visited: new Set(),
    });

    expect(path.children).toHaveLength(2);
    expect(path.children[0].children[0].symbol).toBe('shared');
    expect(path.children[1].children[0].symbol).toBe('shared');
  });

  it('buildPaths prefers PASSES_THROUGH middleware hops ahead of direct invokes', () => {
    const edgeMap = {
      route: [
        { node_id: 'mw', label: 'handle', node_type: 'Method', file_path: 'app/Http/Middleware/RequireToken.php', start_line: 10, node_confidence: 0.9, relation: 'PASSES_THROUGH', edge_confidence: 0.9 },
        { node_id: 'controller', label: 'show', node_type: 'Method', file_path: 'app/Http/Controllers/ProfileController.php', start_line: 20, node_confidence: 0.9, relation: 'INVOKES', edge_confidence: 0.8 },
      ],
      mw: [
        { node_id: 'controller', label: 'show', node_type: 'Method', file_path: 'app/Http/Controllers/ProfileController.php', start_line: 20, node_confidence: 0.9, relation: 'PASSES_THROUGH', edge_confidence: 0.9 },
      ],
      controller: [],
    };

    const db = {
      all: (_sql, params) => edgeMap[params.id] ?? [],
    };

    const path = buildPaths(db, {
      id: 'route',
      label: 'GET /profile',
      file_path: 'routes/api.php',
      start_line: 1,
      confidence: 1.0,
    }, {
      direction: 'out',
      maxDepth: 3,
      explorationWidth: 12,
      relations: ['PASSES_THROUGH', 'INVOKES', 'CALLS'],
      visited: new Set(),
    });

    expect(path.children[0].symbol).toBe('handle');
    expect(path.children[0].children[0].symbol).toBe('show');
    expect(path.children).toHaveLength(1);
  });

  it('buildPaths preserves middleware chain order across multi-hop PASSES_THROUGH', () => {
    // Pairs with the laravel-plugin conflict-order fixture: when the plugin
    // emits a chain Route -> mw1 -> mw2 -> controller in route-declared order,
    // buildPaths must render it in that same order — not reversed, not
    // deduplicated, not reordered by any ranking heuristic.
    const edgeMap = {
      route: [
        { node_id: 'mw1', label: 'handle', node_type: 'Method', file_path: 'app/Http/Middleware/RequireToken.php', start_line: 10, node_confidence: 0.9, relation: 'PASSES_THROUGH', edge_confidence: 0.9 },
      ],
      mw1: [
        { node_id: 'mw2', label: 'handle', node_type: 'Method', file_path: 'app/Http/Middleware/ThrottleNonIntrusive.php', start_line: 10, node_confidence: 0.9, relation: 'PASSES_THROUGH', edge_confidence: 0.9 },
      ],
      mw2: [
        { node_id: 'controller', label: 'show', node_type: 'Method', file_path: 'app/Http/Controllers/ProfileController.php', start_line: 20, node_confidence: 0.9, relation: 'PASSES_THROUGH', edge_confidence: 0.9 },
      ],
      controller: [],
    };

    const db = {
      all: (_sql, params) => edgeMap[params.id] ?? [],
    };

    const path = buildPaths(db, {
      id: 'route',
      label: 'GET /profile',
      file_path: 'routes/api.php',
      start_line: 1,
      confidence: 1.0,
    }, {
      direction: 'out',
      maxDepth: 4,
      explorationWidth: 12,
      relations: ['PASSES_THROUGH', 'INVOKES', 'CALLS'],
      visited: new Set(),
    });

    // Exactly one top-level branch (the chain, not a fan-out).
    expect(path.children).toHaveLength(1);

    // Flatten the single linear chain and assert the file order matches the
    // emission order: RequireToken → ThrottleNonIntrusive → ProfileController.
    const chain = [];
    let cursor = path.children[0];
    while (cursor) {
      chain.push(cursor.file);
      cursor = cursor.children?.[0];
    }

    expect(chain).toEqual([
      'app/Http/Middleware/RequireToken.php',
      'app/Http/Middleware/ThrottleNonIntrusive.php',
      'app/Http/Controllers/ProfileController.php',
    ]);
  });

  it('trimPaths keeps broader exploration but limits rendered branches', () => {
    const trimmed = trimPaths([{
      symbol: 'root',
      file: 'src/root.py',
      line: 1,
      confidence: 1,
      children: [
        { symbol: 'a', file: 'a.py', line: 1, confidence: 1, children: [] },
        { symbol: 'b', file: 'b.py', line: 1, confidence: 1, children: [] },
        { symbol: 'c', file: 'c.py', line: 1, confidence: 1, children: [] },
      ],
    }], 2);

    expect(trimmed[0].children.map((child) => child.symbol)).toEqual(['a', 'b']);
  });
});

// ── class rollup helpers ─────────────────────────────────────

describe('class rollup helpers', () => {
  it('expands class targets to include contained methods', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'apg-rollup-'));
    const db = openDb(join(dir, 'graph.sqlite'));

    try {
      upsertNode(db, {
        id: 'class:audio', type: 'Class', label: 'AudioSystem',
        file_path: 'engine/AudioSystem.h', start_line: 1, end_line: 30,
        language: 'cpp', confidence: 1, structural_fp: 's1', dependency_fp: 'd1',
        extra: { qname: 'AudioSystem' },
      });
      upsertNode(db, {
        id: 'method:init', type: 'Method', label: 'initialize',
        file_path: 'engine/AudioSystem.cpp', start_line: 5, end_line: 15,
        language: 'cpp', confidence: 1, structural_fp: 's2', dependency_fp: 'd2',
        extra: { qname: 'AudioSystem.initialize' },
      });
      upsertNode(db, {
        id: 'method:update', type: 'Method', label: 'update',
        file_path: 'engine/AudioSystem.cpp', start_line: 20, end_line: 35,
        language: 'cpp', confidence: 1, structural_fp: 's3', dependency_fp: 'd3',
        extra: { qname: 'AudioSystem.update' },
      });
      upsertEdge(db, {
        from_id: 'class:audio', to_id: 'method:init', relation: 'CONTAINS',
        source_file: 'engine/AudioSystem.cpp', source_line: 5, confidence: 1, extractor: 'cpp',
      });
      upsertEdge(db, {
        from_id: 'class:audio', to_id: 'method:update', relation: 'CONTAINS',
        source_file: 'engine/AudioSystem.cpp', source_line: 20, confidence: 1, extractor: 'cpp',
      });

      const rollup = expandClassRollupTargets(db, 'AudioSystem');
      expect(rollup.rolledUp).toBe(true);
      expect(rollup.targetIds).toEqual(expect.arrayContaining(['class:audio', 'method:init', 'method:update']));
      expect(rollup.header).toBe('ROLLUP Class "AudioSystem" across 2 methods');
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('collapses duplicate callers into one rolled-up row', () => {
    const collapsed = collapseCallerEdges([
      {
        from_id: 'fn:tick', depth: 1, confidence: 0.8, fan_in: 1,
        from_type: 'Function', from_label: 'tick', source_file: 'engine/Game.cpp', source_line: 10,
      },
      {
        from_id: 'fn:tick', depth: 1, confidence: 0.9, fan_in: 1,
        from_type: 'Function', from_label: 'tick', source_file: 'engine/Game.cpp', source_line: 12,
      },
    ], 'AudioSystem');

    expect(collapsed).toEqual([
      expect.objectContaining({
        from_id: 'fn:tick',
        fan_in: 2,
        confidence: 0.9,
        source_line: 12,
        to_label: 'AudioSystem',
      }),
    ]);
  });
});
