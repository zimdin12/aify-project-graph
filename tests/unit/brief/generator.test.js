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
