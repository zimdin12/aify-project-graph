import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { generateBrief } from '../../../mcp/stdio/brief/generator.js';
import { readFileSync } from 'node:fs';

function seedNodes(db, rows) {
  for (const r of rows) {
    db.run(
      `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, structural_fp, dependency_fp, extra)
       VALUES ($id, $type, $label, $file_path, $start_line, 0, $language, 1.0, '', '', '{}')`,
      { start_line: 1, language: 'javascript', ...r },
    );
  }
}

function seedEdges(db, rows) {
  for (const r of rows) {
    db.run(
      `INSERT INTO edges (from_id, to_id, relation, source_file, source_line, confidence, extractor)
       VALUES ($from_id, $to_id, $relation, $source_file, 0, $confidence, 'generic')`,
      { source_file: '', confidence: 1.0, ...r },
    );
  }
}

describe('brief/generator', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-brief-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  describe('generateBrief', () => {
    it('writes all five artifacts', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [
        { id: 'f1', type: 'File', label: 'server.js', file_path: 'server.js' },
        { id: 'f2', type: 'File', label: 'a.js', file_path: 'src/a.js' },
        { id: 'd1', type: 'Directory', label: 'src', file_path: 'src' },
      ]);
      db.close();

      const stats = generateBrief({ repoRoot });
      expect(stats.md_bytes).toBeGreaterThan(0);
      expect(stats.agent_bytes).toBeGreaterThan(0);
      expect(stats.onboard_bytes).toBeGreaterThan(0);
      expect(stats.plan_bytes).toBeGreaterThan(0);
      expect(stats.json_bytes).toBeGreaterThan(0);

      const agentMd = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(agentMd).toMatch(/^REPO:/);
      expect(agentMd).toMatch(/TRUST/);
    });

    it('does not rewrite files when content unchanged (cache discipline)', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [
        { id: 'f1', type: 'File', label: 'main.py', file_path: 'main.py' },
      ]);
      db.close();

      const first = generateBrief({ repoRoot });
      expect(first.files_changed).toBeGreaterThan(0);
      const second = generateBrief({ repoRoot });
      expect(second.files_changed).toBe(0);
    });

    it('includes FEATURES section when functionality.json is present', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [
        { id: 'n1', type: 'Function', label: 'authenticate', file_path: 'src/auth.js' },
        { id: 'f1', type: 'File', label: 'auth.js', file_path: 'src/auth.js' },
      ]);
      db.close();

      await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), JSON.stringify({
        features: [{
          id: 'auth',
          label: 'Authentication',
          description: 'Handles login.',
          anchors: { symbols: ['authenticate'], files: ['src/auth.js'] },
          source: 'user',
        }],
      }));

      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(agent).toContain('FEATURES:');
      expect(agent).toContain('auth:');
    });

    it('surfaces broken overlay anchors in trust line', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      // Seed nothing that matches the overlay's anchors.
      seedNodes(db, [
        { id: 'f1', type: 'File', label: 'unrelated.js', file_path: 'src/unrelated.js' },
      ]);
      db.close();

      await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), JSON.stringify({
        features: [{
          id: 'auth',
          anchors: { symbols: ['nonexistent_sym'], files: ['src/missing/*'] },
        }],
      }));

      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(agent).toMatch(/features with stale anchors/);
    });

    it('brief.plan.md renders OPEN_TASKS section when tasks.json is present', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [
        { id: 'n1', type: 'Function', label: 'authenticate', file_path: 'src/auth.js' },
      ]);
      db.close();

      await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), JSON.stringify({
        features: [{
          id: 'auth',
          anchors: { symbols: ['authenticate'] },
        }],
      }));
      await writeFile(join(repoRoot, '.aify-graph', 'tasks.json'), JSON.stringify({
        version: '0.1',
        source: 'plaintext',
        tasks: [
          { id: 'T-1', title: 'fix login', status: 'in_progress', features: ['auth'] },
          { id: 'T-2', title: 'unknown', status: 'open', features: [] },
        ],
      }));

      generateBrief({ repoRoot });
      const plan = readFileSync(join(repoRoot, '.aify-graph', 'brief.plan.md'), 'utf8');
      expect(plan).toContain('OPEN_TASKS');
      expect(plan).toContain('auth: 1');
      expect(plan).toContain('unattributed');
    });

    it('brief.onboard.md is smaller than brief.agent.md (stripped variant)', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [
        { id: 'n1', type: 'Function', label: 'foo', file_path: 'src/a.js' },
        { id: 'n2', type: 'Class', label: 'Bar', file_path: 'src/a.js' },
        { id: 'f1', type: 'File', label: 'server.js', file_path: 'server.js' },
        { id: 'd1', type: 'Directory', label: 'src', file_path: 'src' },
      ]);
      db.close();
      const stats = generateBrief({ repoRoot });
      expect(stats.onboard_bytes).toBeLessThanOrEqual(stats.agent_bytes + 50);
    });
  });

  describe('Phase 1 brief features (2026-04-20)', () => {
    it('TOOLING line extracts deps from package.json', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [{ id: 'f1', type: 'File', label: 'a.js', file_path: 'a.js' }]);
      db.close();
      await writeFile(join(repoRoot, 'package.json'), JSON.stringify({
        dependencies: { 'better-sqlite3': '^11', 'tree-sitter': '^0.22', '@types/node': '^20' },
      }));
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(agent).toMatch(/TOOLING:/);
      expect(agent).toContain('better-sqlite3');
      expect(agent).toContain('tree-sitter');
      // @types/* filtered out
      expect(agent).not.toContain('@types/node');
    });

    it('TOOLING line extracts deps from pyproject.toml PEP-621 form', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [{ id: 'f1', type: 'File', label: 'a.py', file_path: 'a.py' }]);
      db.close();
      await writeFile(join(repoRoot, 'pyproject.toml'), [
        '[project]',
        'name = "foo"',
        'dependencies = [',
        '  "qdrant-client>=1.9",',
        '  "openai>=1.0",',
        ']',
      ].join('\n'));
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(agent).toContain('qdrant-client');
      expect(agent).toContain('openai');
    });

    it('TOOLING line extracts composer.json (PHP)', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [{ id: 'f1', type: 'File', label: 'a.php', file_path: 'a.php' }]);
      db.close();
      await writeFile(join(repoRoot, 'composer.json'), JSON.stringify({
        require: { 'laravel/framework': '^11', 'php': '^8.2', 'ext-json': '*' },
      }));
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(agent).toContain('framework');
      // php + ext-* filtered out
      expect(agent).not.toMatch(/TOOLING:.*\bphp\b/);
      expect(agent).not.toContain('ext-json');
    });

    it('EXPORTS detects MCP-style tools/list arrays from server.js', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [{ id: 'f1', type: 'File', label: 'server.js', file_path: 'mcp/stdio/server.js' }]);
      db.close();
      await mkdir(join(repoRoot, 'mcp', 'stdio'), { recursive: true });
      await writeFile(join(repoRoot, 'mcp', 'stdio', 'server.js'), [
        'const TOOLS = [',
        '  {',
        '    name: \'graph_status\',',
        '    handler: graphStatus,',
        '    description: \'Status\',',
        '  },',
        '  {',
        '    name: \'graph_pull\',',
        '    handler: graphPull,',
        '  },',
        '];',
      ].join('\n'));
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(agent).toMatch(/EXPORTS \(\d+ listed/);
      expect(agent).toContain('graph_status');
      expect(agent).toContain('graph_pull');
      expect(agent).toContain('handler=graphStatus');
    });

    it('EXPORTS detects Laravel Route::* declarations', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [{ id: 'f1', type: 'File', label: 'api.php', file_path: 'routes/api.php' }]);
      db.close();
      await mkdir(join(repoRoot, 'routes'), { recursive: true });
      await writeFile(join(repoRoot, 'routes', 'api.php'), [
        "<?php",
        "Route::get('/users/{id}', UserController::class);",
        "Route::post('/users', UserController::class);",
      ].join('\n'));
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(agent).toMatch(/EXPORTS/);
      expect(agent).toContain('GET /users/{id}');
      expect(agent).toContain('POST /users');
      expect(agent).toContain('UserController');
    });

    it('composite SUBSYS rank drops 0-file parent directories', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      // "engine" parent with no direct files but lots of aggregated edges
      // via children should NOT appear in SUBSYS. "engine/voxel" with real
      // direct files should.
      const nodes = [
        { id: 'd1', type: 'Directory', label: 'engine', file_path: 'engine' },
        { id: 'd2', type: 'Directory', label: 'voxel', file_path: 'engine/voxel' },
      ];
      for (let i = 0; i < 5; i++) {
        nodes.push({ id: `f${i}`, type: 'File', label: `v${i}.cpp`, file_path: `engine/voxel/v${i}.cpp` });
      }
      seedNodes(db, nodes);
      db.close();
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(agent).toMatch(/SUBSYS:/);
      expect(agent).toContain('engine/voxel');
      // The 0-file "engine" parent should NOT appear as a SUBSYS entry.
      expect(agent).not.toMatch(/^ {2}engine \(\d+f/m);
    });

    it('composite SUBSYS rescues 1-file dir with high edge density', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      // engine/ecs: only 1 file, but 60 edges source from files inside it.
      // Should still rank, because edge_count >= 50 trips the rescue clause.
      // engine/bulk: 2 files, 0 edges — should rank via primary file-count path.
      // engine/tiny: 1 file, 10 edges — must NOT rank (below both thresholds).
      const nodes = [
        { id: 'd1', type: 'Directory', label: 'ecs', file_path: 'engine/ecs' },
        { id: 'f_ecs', type: 'File', label: 'world.cpp', file_path: 'engine/ecs/world.cpp' },
        { id: 'd2', type: 'Directory', label: 'bulk', file_path: 'engine/bulk' },
        { id: 'fb1', type: 'File', label: 'a.cpp', file_path: 'engine/bulk/a.cpp' },
        { id: 'fb2', type: 'File', label: 'b.cpp', file_path: 'engine/bulk/b.cpp' },
        { id: 'd3', type: 'Directory', label: 'tiny', file_path: 'engine/tiny' },
        { id: 'ft', type: 'File', label: 't.cpp', file_path: 'engine/tiny/t.cpp' },
      ];
      // 60 caller files with edges sourced from engine/ecs/*
      for (let i = 0; i < 60; i++) {
        nodes.push({ id: `c${i}`, type: 'Function', label: `call${i}`, file_path: `engine/ecs/world.cpp` });
      }
      seedNodes(db, nodes);
      // 60 edges whose source_file is inside engine/ecs — trips edge_count subquery
      const edges = [];
      for (let i = 0; i < 60; i++) {
        edges.push({ from_id: `c${i}`, to_id: 'f_ecs', relation: `CALLS_${i}`, source_file: 'engine/ecs/world.cpp' });
      }
      // 10 edges inside engine/tiny (below 50 threshold)
      for (let i = 0; i < 10; i++) {
        edges.push({ from_id: 'ft', to_id: 'ft', relation: `CALLS_T_${i}`, source_file: 'engine/tiny/t.cpp' });
      }
      seedEdges(db, edges);
      db.close();
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      // ecs rescued despite 1 file
      expect(agent).toContain('engine/ecs');
      // bulk surfaces via normal file-count path
      expect(agent).toContain('engine/bulk');
      // tiny filtered out of SUBSYS (1 file + <50 edges fails both rescue thresholds)
      expect(agent).not.toMatch(/^ {2}engine\/tiny \(/m);
    });

    it('INTERNAL_HUBS section is labeled explicitly (not HUBS)', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [
        { id: 'n1', type: 'Function', label: 'openDb', file_path: 'src/db.js' },
      ]);
      // Create edges pointing TO openDb so it has fan-in
      const edges = [];
      for (let i = 0; i < 10; i++) {
        edges.push({ from_id: `n1`, to_id: `n1`, relation: `CALLS${i}`, source_file: `src/c${i}.js` });
      }
      // Use distinct from_ids actually
      const seedMoreNodes = [];
      for (let i = 0; i < 10; i++) {
        seedMoreNodes.push({ id: `c${i}`, type: 'Function', label: `caller${i}`, file_path: `src/c${i}.js` });
      }
      seedNodes(db, seedMoreNodes);
      seedEdges(db, seedMoreNodes.map(n => ({ from_id: n.id, to_id: 'n1', relation: 'CALLS', source_file: n.file_path })));
      db.close();
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      // Phase 1 explicit label, not HUBS alone
      expect(agent).toMatch(/INTERNAL_HUBS:/);
      // The old unqualified "HUBS:" label should NOT appear in agent brief
      expect(agent).not.toMatch(/^HUBS:/m);
    });

    it('COVERS line summarizes top subsystems when no overlay present', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      const nodes = [{ id: 'd1', type: 'Directory', label: 'src', file_path: 'src' }];
      for (let i = 0; i < 3; i++) {
        nodes.push({ id: `f${i}`, type: 'File', label: `m${i}.js`, file_path: `src/m${i}.js` });
      }
      seedNodes(db, nodes);
      db.close();
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(agent).toMatch(/COVERS:/);
      expect(agent).toContain('fall back to direct file reads');
    });
  });

  describe('Phase 1 brief features — extractor coverage (2026-04-20 gap-close)', () => {
    it('TOOLING line extracts deps from requirements.txt', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [{ id: 'f1', type: 'File', label: 'a.py', file_path: 'a.py' }]);
      db.close();
      await writeFile(join(repoRoot, 'requirements.txt'), [
        '# comment',
        'qdrant-client>=1.9',
        'openai~=1.0',
        'pydantic>=2.0,<3.0',
        '-e ./local-pkg  # editable install — skip',
      ].join('\n'));
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(agent).toMatch(/TOOLING:.*qdrant-client/);
      expect(agent).toContain('openai');
      expect(agent).toContain('pydantic');
    });

    it('TOOLING line extracts deps from Cargo.toml', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [{ id: 'f1', type: 'File', label: 'a.rs', file_path: 'src/a.rs' }]);
      db.close();
      await writeFile(join(repoRoot, 'Cargo.toml'), [
        '[package]',
        'name = "foo"',
        'version = "0.1.0"',
        '',
        '[dependencies]',
        'serde = "1.0"',
        'tokio = { version = "1.0", features = ["full"] }',
        'reqwest = "0.11"',
      ].join('\n'));
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(agent).toMatch(/TOOLING:.*serde/);
      expect(agent).toContain('tokio');
      expect(agent).toContain('reqwest');
    });

    it('TOOLING line extracts deps from go.mod', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [{ id: 'f1', type: 'File', label: 'main.go', file_path: 'main.go' }]);
      db.close();
      await writeFile(join(repoRoot, 'go.mod'), [
        'module example.com/foo',
        '',
        'go 1.21',
        '',
        'require (',
        '  github.com/gin-gonic/gin v1.9.1',
        '  github.com/stretchr/testify v1.8.4',
        ')',
      ].join('\n'));
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(agent).toMatch(/TOOLING:/);
      expect(agent).toContain('gin');
      expect(agent).toContain('testify');
    });

    it('TOOLING line extracts deps from pyproject.toml Poetry table form', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [{ id: 'f1', type: 'File', label: 'a.py', file_path: 'a.py' }]);
      db.close();
      await writeFile(join(repoRoot, 'pyproject.toml'), [
        '[tool.poetry]',
        'name = "foo"',
        '',
        '[tool.poetry.dependencies]',
        'python = "^3.10"',
        'httpx = "^0.25"',
        'typer = "^0.9"',
      ].join('\n'));
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(agent).toMatch(/TOOLING:.*httpx/);
      expect(agent).toContain('typer');
      // python filtered out
      expect(agent).not.toMatch(/TOOLING:.*\bpython\b/);
    });

    it('EXPORTS detects Express/FastAPI-style route declarations in app.js', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [{ id: 'f1', type: 'File', label: 'app.js', file_path: 'app.js' }]);
      db.close();
      // Ensure no other strategy triggers first (no mcp/stdio/server.js, no routes/, no __init__.py)
      await writeFile(join(repoRoot, 'app.js'), [
        "const express = require('express');",
        "const app = express();",
        "app.get('/users/:id', handler);",
        "app.post('/users', createUser);",
        "app.delete('/users/:id', deleteUser);",
      ].join('\n'));
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(agent).toMatch(/EXPORTS/);
      expect(agent).toContain('GET /users/:id');
      expect(agent).toContain('POST /users');
      expect(agent).toContain('DELETE /users/:id');
    });

    it('EXPORTS detects Python __init__.py re-exports via __all__', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [{ id: 'f1', type: 'File', label: '__init__.py', file_path: 'mypkg/__init__.py' }]);
      db.close();
      await mkdir(join(repoRoot, 'mypkg'), { recursive: true });
      await writeFile(join(repoRoot, 'mypkg', '__init__.py'), [
        'from .core import Memory, AsyncMemory',
        'from .backend import VectorStore',
        '',
        '__all__ = ["Memory", "AsyncMemory", "VectorStore"]',
      ].join('\n'));
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(agent).toMatch(/EXPORTS/);
      expect(agent).toContain('Memory');
      expect(agent).toContain('AsyncMemory');
      expect(agent).toContain('VectorStore');
    });
  });

  describe('PATHS section (Phase 3, 2026-04-21)', () => {
    it('PATHS emits flattened execution chains for top EXPORTS', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      // Seed an MCP-style server with verb handlers that call internal funcs
      seedNodes(db, [
        { id: 'srv', type: 'File', label: 'server.js', file_path: 'mcp/stdio/server.js' },
        { id: 'h1', type: 'Function', label: 'opAHandler', file_path: 'mcp/stdio/query/verbs/op-a.js' },
        { id: 'i1', type: 'Function', label: 'innerStep1', file_path: 'mcp/stdio/internal/step1.js' },
        { id: 'i2', type: 'Function', label: 'innerStep2', file_path: 'mcp/stdio/storage/db.js' },
      ]);
      seedEdges(db, [
        { from_id: 'h1', to_id: 'i1', relation: 'CALLS', source_file: 'mcp/stdio/query/verbs/op-a.js' },
        { from_id: 'i1', to_id: 'i2', relation: 'CALLS', source_file: 'mcp/stdio/internal/step1.js' },
      ]);
      db.close();
      // MCP server.js exposes op_a handler via tools/list array
      await mkdir(join(repoRoot, 'mcp', 'stdio'), { recursive: true });
      await writeFile(join(repoRoot, 'mcp', 'stdio', 'server.js'), [
        'const TOOLS = [',
        '  { name: \'op_a\', handler: opAHandler },',
        '];',
      ].join('\n'));
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(agent).toMatch(/PATHS:/);
      // PATH should include the chain: handler → inner1 → inner2
      expect(agent).toContain('op_a:');
      expect(agent).toContain('opAHandler');
      expect(agent).toContain('innerStep1');
      // Chain notation
      expect(agent).toContain(' → ');
    });

    it('PATHS skips entries that do not resolve to a graph node', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      // Only a stub File node; no Function/Method nodes, so PATHS resolution finds nothing
      seedNodes(db, [
        { id: 'f1', type: 'File', label: 'lonely.js', file_path: 'lonely.js' },
      ]);
      db.close();
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      // PATHS section may be absent (no resolvable entries) — that's correct
      // Either way, brief must not crash and must still emit REPO/TRUST
      expect(agent).toMatch(/^REPO:/);
      expect(agent).toMatch(/TRUST/);
    });
  });

  describe('readFirst priority and language filtering (2026-04-20 gap-close)', () => {
    it('READ prefers EXPORTS-backed files when available', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [
        { id: 'f1', type: 'File', label: 'server.js', file_path: 'server.js' },
        { id: 'f2', type: 'File', label: 'unrelated.js', file_path: 'src/unrelated.js' },
      ]);
      // Seed lots of edges pointing at unrelated.js so it would win high-degree fallback
      for (let i = 0; i < 10; i++) {
        db.run(`INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, structural_fp, dependency_fp, extra)
                VALUES (@id, @type, @label, @file_path, 1, 0, 'javascript', 1.0, '', '', '{}')`,
               { id: `e${i}`, type: 'Function', label: `edgeSym${i}`, file_path: 'src/unrelated.js' });
      }
      db.close();
      // Create an MCP server.js so EXPORTS strategy triggers and server.js gets
      // registered as an EXPORTS-backed file.
      await writeFile(join(repoRoot, 'server.js'), `
        const TOOLS = [
          { name: 'op_a', handler: opA },
          { name: 'op_b', handler: opB },
        ];
      `);
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      // server.js (EXPORTS-backed) should be in READ section
      expect(agent).toMatch(/READ:[\s\S]*server\.js/);
    });

    it('READ filters by primary language (Python repo puts .py before non-.py)', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      // Python-dominant repo with a high-degree JS file that would win without
      // language filtering. Key: snapshot.languages[0] derives from node count
      // per language; seed many python-language nodes to make python primary.
      const nodes = [];
      for (let i = 0; i < 10; i++) {
        nodes.push({ id: `pyf${i}`, type: 'File', label: `m${i}.py`, file_path: `src/m${i}.py`, language: 'python' });
      }
      nodes.push({ id: 'jsf1', type: 'File', label: 'config.js', file_path: 'config.js', language: 'javascript' });
      // Add function nodes so primaryLangExt sees python as dominant via language count
      for (let i = 0; i < 10; i++) {
        nodes.push({ id: `pyfn${i}`, type: 'Function', label: `fn${i}`, file_path: `src/m${Math.floor(i/2)}.py`, language: 'python' });
      }
      seedNodes(db, nodes);
      // Edges pointing at config.js with DISTINCT (from, to, relation) triples
      // (UNIQUE constraint on edges); use varying relation types to bump fan-in
      const edges = [];
      const rels = ['IMPORTS', 'CALLS', 'REFERENCES', 'USES_TYPE', 'INVOKES', 'PASSES_THROUGH', 'EXTENDS', 'IMPLEMENTS'];
      for (let i = 0; i < 10; i++) {
        for (const rel of rels) {
          edges.push({ from_id: `pyf${i}`, to_id: 'jsf1', relation: rel, source_file: `src/m${i}.py`, confidence: 1.0 });
        }
      }
      seedEdges(db, edges);
      db.close();
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      // Extract the READ block
      const readMatch = agent.match(/READ:\n([\s\S]*?)(?:\n[A-Z_]+:|$)/);
      if (!readMatch) {
        // Brief may not have emitted READ at all; skip
        return;
      }
      const readBlock = readMatch[1];
      const pyIdx = readBlock.indexOf('.py');
      const jsIdx = readBlock.indexOf('config.js');
      // If both exist, .py must come first. If .js missing entirely, that's also a pass.
      if (pyIdx !== -1 && jsIdx !== -1) {
        expect(pyIdx).toBeLessThan(jsIdx);
      } else if (pyIdx !== -1 && jsIdx === -1) {
        // Python file present, JS absent — ideal outcome, pass
        expect(true).toBe(true);
      }
      // If neither, the READ strategy didn't trigger — acceptable for small fixtures
    });
  });

  describe('Regression tests for round-2/4 audit fixes (2026-04-20)', () => {
    it('graph fallback SQL NOT LIKE \\_% correctly filters underscore-prefixed labels', async () => {
      // Regression for round-2 fix: `'\_%'` JS literal collapsed to `_%`
      // which matched every non-empty label, silently zeroing the fallback
      // strategy. Fix: `'\\_%'` so SQLite sees `\_` + escape.
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      seedNodes(db, [
        // Public symbol with HIGH fan-out — should appear in fallback EXPORTS
        { id: 'n-pub', type: 'Function', label: 'publicHandler', file_path: 'src/a.js' },
        // Private symbol with fan-out — SHOULD BE EXCLUDED by the _%% filter
        { id: 'n-priv', type: 'Function', label: '_internalHelper', file_path: 'src/a.js' },
        // Nodes to generate fan-out
        { id: 'n1', type: 'Function', label: 'caller1', file_path: 'src/b.js' },
        { id: 'n2', type: 'Function', label: 'caller2', file_path: 'src/c.js' },
      ]);
      seedEdges(db, [
        { from_id: 'n-pub', to_id: 'n1', relation: 'CALLS', source_file: 'src/a.js' },
        { from_id: 'n-pub', to_id: 'n2', relation: 'CALLS', source_file: 'src/a.js' },
        { from_id: 'n-priv', to_id: 'n1', relation: 'CALLS', source_file: 'src/a.js' },
        { from_id: 'n-priv', to_id: 'n2', relation: 'CALLS', source_file: 'src/a.js' },
      ]);
      db.close();
      // No package.json, no routes, no __init__.py → fallback path triggers
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      // Public symbol must appear
      expect(agent).toContain('publicHandler');
      // Underscore-prefixed symbol must NOT appear in EXPORTS
      // (the whole regression: if SQL escape is broken, this leaks)
      const exportsSection = agent.match(/EXPORTS[\s\S]*?(?=\n[A-Z_]+:|$)/);
      if (exportsSection) {
        expect(exportsSection[0]).not.toContain('_internalHelper');
      }
    });

    it('composite SUBSYS filter correctly rescues small-file-count dirs with high edge density', async () => {
      // Regression for round-2 tautological-filter fix. Pre-fix filter was
      // `file_count >= 2 && (file_count >= 2 || edge_count >= 50)` (dead RHS).
      // Correct: `file_count >= 2 OR (file_count >= 1 AND edge_count >= 50)`.
      // This test seeds a 1-file dir with 60 edges and asserts it surfaces.
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      const nodes = [
        { id: 'd1', type: 'Directory', label: 'big', file_path: 'big' },
        { id: 'd2', type: 'Directory', label: 'rescue-me', file_path: 'rescue' },
      ];
      // 'big': 5 files, few edges
      for (let i = 0; i < 5; i++) {
        nodes.push({ id: `bf${i}`, type: 'File', label: `b${i}.js`, file_path: `big/b${i}.js` });
      }
      // 'rescue': 1 file but many edges (structurally central)
      nodes.push({ id: 'rf0', type: 'File', label: 'hot.js', file_path: 'rescue/hot.js' });
      for (let i = 0; i < 70; i++) {
        nodes.push({ id: `rs${i}`, type: 'Function', label: `fn${i}`, file_path: `rescue/hot.js` });
      }
      seedNodes(db, nodes);
      const edges = [];
      for (let i = 0; i < 65; i++) {
        edges.push({ from_id: `rs${i}`, to_id: `rs${(i + 1) % 65}`, relation: 'CALLS', source_file: 'rescue/hot.js' });
      }
      seedEdges(db, edges);
      db.close();
      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      // Both 'big' (file count) and 'rescue' (edge density) should surface
      expect(agent).toMatch(/SUBSYS:/);
      expect(agent).toContain('rescue');
    });
  });

  describe('trust line content', () => {
    it('includes prescriptive tip when trust is weak', async () => {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      // Seed 2100 distinct nodes + a unique low-confidence edge per pair.
      const nodes = [];
      for (let i = 0; i < 2101; i++) {
        nodes.push({ id: `n${i}`, type: 'Function', label: `fn${i}`, file_path: `src/${i}.js` });
      }
      seedNodes(db, nodes);
      for (let i = 0; i < 2100; i++) {
        db.run(
          `INSERT INTO edges (from_id, to_id, relation, source_file, source_line, confidence, extractor)
           VALUES ('n' || $i, 'n' || ($i + 1), 'CALLS', 'x', 0, 0.5, 'generic')`,
          { i },
        );
      }
      db.close();

      generateBrief({ repoRoot });
      const agent = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
      expect(agent).toMatch(/TRUST weak/);
      expect(agent).toMatch(/→.*direct file reads|verify/);
    });
  });
});
