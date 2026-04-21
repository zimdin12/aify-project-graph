// Regression tests for the 2026-04-22 "graph_consequences misses
// task→file links" bug. Echoes manager's 3-round 9-agent bench found
// graph_consequences("engine/voxel/ChunkTimeSkip.cpp") returned empty
// features_touching even though tasks.json mapped the file to a
// feature via a task. Fix adds a third anchor_match path: 'task'.
//
// Two confidence tiers on task→file matching:
//   high — task.files_hint[] exact or suffix-match
//   low  — task.title substring-matches a file basename >=8 chars
//          OR containing uppercase (CamelCase convention)

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphConsequences } from '../../../mcp/stdio/query/verbs/consequences.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

function initGit(repoRoot) {
  const runGit = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { stdio: 'ignore' });
  runGit('init', '-q');
  runGit('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init');
}

function insertNode(db, node) {
  db.run(
    `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
     VALUES ($id, $type, $label, $file_path, $start_line, $end_line, $language, $confidence, $extra)`,
    { start_line: 1, end_line: 1, language: 'cpp', confidence: 1, extra: '{}', ...node }
  );
}

describe('graph_consequences — task→file reverse lookup', () => {
  let repoRoot;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-cons-rev-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    initGit(repoRoot);
    const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
      schemaVersion: 3, extractorVersion: '0.1.0',
      status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    }));
  });

  afterEach(async () => {
    if (repoRoot) {
      try { await rm(repoRoot, { recursive: true, force: true }); } catch {}
    }
  });

  it('surfaces feature when task.files_hint references the target file (high-confidence)', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'f1', type: 'File', label: 'ChunkTimeSkip.cpp', file_path: 'engine/voxel/ChunkTimeSkip.cpp' });
    db.close();

    // Feature does NOT anchor the file directly. Link comes via task only.
    await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), JSON.stringify({
      features: [{
        id: 'chunk-management',
        label: 'Chunk Management',
        anchors: { symbols: [], files: ['engine/voxel/Chunk.cpp'] }, // notably NOT ChunkTimeSkip
      }],
    }));
    await writeFile(join(repoRoot, '.aify-graph', 'tasks.json'), JSON.stringify({
      tasks: [{
        id: 'CU-1', title: 'Fix time skip bug', status: 'open',
        features: ['chunk-management'],
        files_hint: ['engine/voxel/ChunkTimeSkip.cpp'],
      }],
    }));

    const result = await graphConsequences({ repoRoot, target: 'engine/voxel/ChunkTimeSkip.cpp' });
    expect(result.features_touching.map((f) => f.id)).toContain('chunk-management');
    const hit = result.features_touching.find((f) => f.id === 'chunk-management');
    expect(hit.anchor_match).toBe('task');
    expect(hit.reached_via_tasks).toEqual([{ id: 'CU-1', match: 'files_hint' }]);
  });

  it('matches CamelCase basename in task.title as low-confidence fallback', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'f1', type: 'File', label: 'ChunkTimeSkip.cpp', file_path: 'engine/voxel/ChunkTimeSkip.cpp' });
    db.close();

    await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), JSON.stringify({
      features: [{ id: 'chunk-management', anchors: { symbols: [], files: [] } }],
    }));
    // No files_hint — title is the only signal.
    await writeFile(join(repoRoot, '.aify-graph', 'tasks.json'), JSON.stringify({
      tasks: [{ id: 'CU-2', title: 'ChunkTimeSkip: handle large jumps', status: 'open', features: ['chunk-management'] }],
    }));

    const result = await graphConsequences({ repoRoot, target: 'engine/voxel/ChunkTimeSkip.cpp' });
    const hit = result.features_touching.find((f) => f.id === 'chunk-management');
    expect(hit).toBeTruthy();
    expect(hit.anchor_match).toBe('task');
    expect(hit.reached_via_tasks[0].match).toBe('title_substring');
  });

  it('rejects short lowercase basenames in title-substring match (false-positive guard)', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'f1', type: 'File', label: 'helpers.ts', file_path: 'src/helpers.ts' });
    db.close();

    await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), JSON.stringify({
      features: [{ id: 'utilities', anchors: { symbols: [], files: [] } }],
    }));
    // Title incidentally contains "helpers" but the file is a lowercase 7-char
    // basename. This would be a huge false-positive source. Must be rejected.
    await writeFile(join(repoRoot, '.aify-graph', 'tasks.json'), JSON.stringify({
      tasks: [{ id: 'CU-3', title: 'Clean up test helpers and fixtures', status: 'open', features: ['utilities'] }],
    }));

    const result = await graphConsequences({ repoRoot, target: 'src/helpers.ts' });
    expect(result.features_touching).toEqual([]); // no fuzzy title match
  });

  it('surfaces co_consumer_files from same feature anchors', async () => {
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    insertNode(db, { id: 'f1', type: 'File', label: 'sharc_update.comp.glsl', file_path: 'shaders/sharc_update.comp.glsl' });
    db.close();

    await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), JSON.stringify({
      features: [{
        id: 'sharc-radiance',
        anchors: {
          symbols: [],
          files: ['shaders/sharc_update.comp.glsl', 'shaders/sharc_resolve.comp.glsl', 'shaders/sharc_clear.comp.glsl'],
        },
      }],
    }));

    const result = await graphConsequences({ repoRoot, target: 'shaders/sharc_update.comp.glsl' });
    const peers = result.co_consumer_files.map((c) => c.file);
    expect(peers).toContain('shaders/sharc_resolve.comp.glsl');
    expect(peers).toContain('shaders/sharc_clear.comp.glsl');
    expect(peers).not.toContain('shaders/sharc_update.comp.glsl'); // not itself
  });
});
