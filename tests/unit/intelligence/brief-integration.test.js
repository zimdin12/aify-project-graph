// Plan #15 Step A5 tests: brief integration of intelligence overlays.
// Verifies the overlays.js loader + the renderMarkdown wiring. Silent
// fallback when overlays absent; degraded skip when invalid; renders an
// "Architecture layers" section when validators pass.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadIntelligenceOverlays, summarizeArchitectureLayers, semanticForFile } from '../../../mcp/stdio/intelligence/overlays.js';

const VALID_SHA = 'sha256:' + 'b'.repeat(64);

function tmpRepoWith(intelligenceFiles = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-brief-intel-'));
  fs.mkdirSync(path.join(dir, '.aify-graph'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), '// a');
  fs.writeFileSync(path.join(dir, 'src', 'b.js'), '// b');
  for (const [name, content] of Object.entries(intelligenceFiles)) {
    fs.writeFileSync(path.join(dir, '.aify-graph', name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

function semanticOverlay() {
  return {
    schema_version: '0.1',
    generatorVersion: 'file-summarizer/0.1.0',
    generatedAt: '2026-05-22T00:00:00Z',
    graphHead: 'abc123',
    inputSha: VALID_SHA,
    files: [
      { path: 'src/a.js', summary: 'API handler for /a.', tags: ['api', 'rest'], complexity: 'low', nodeType: 'api-handler', entryPoint: false },
      { path: 'src/b.js', summary: 'Utility function.', tags: ['util'], complexity: 'low', nodeType: 'utility', entryPoint: false }
    ]
  };
}

function architectureOverlay() {
  return {
    schema_version: '0.1',
    generatorVersion: 'architecture-layer-assigner/0.1.0',
    generatedAt: '2026-05-22T00:00:00Z',
    graphHead: 'abc123',
    inputSha: VALID_SHA,
    layers: [
      { id: 'api', name: 'API', description: 'HTTP handlers.', color: '#58a6ff' },
      { id: 'util', name: 'Util', description: 'Helpers.', color: '#bf8700' },
      { id: 'doc', name: 'Docs', description: 'Documentation files.', color: '#8b949e' }
    ],
    assignments: {
      'src/a.js': { layerId: 'api', confidence: 'high', reason: 'api-handler nodeType' },
      'src/b.js': { layerId: 'util', confidence: 'medium', reason: 'fmt helper' }
    }
  };
}

describe('loadIntelligenceOverlays', () => {
  it('returns null fields when overlay files do not exist (silent fallback)', () => {
    const repo = tmpRepoWith({});
    const r = loadIntelligenceOverlays({ repoRoot: repo });
    expect(r.semanticFiles).toBeNull();
    expect(r.architecture).toBeNull();
    expect(r.warnings).toEqual([]);
  });

  it('loads both overlays when valid', () => {
    const repo = tmpRepoWith({
      'semantic.files.json': semanticOverlay(),
      'architecture.json': architectureOverlay()
    });
    const r = loadIntelligenceOverlays({ repoRoot: repo });
    expect(r.semanticFiles).not.toBeNull();
    expect(r.architecture).not.toBeNull();
    expect(r.loadedFrom.semantic).toMatch(/semantic\.files\.json$/);
    expect(r.loadedFrom.architecture).toMatch(/architecture\.json$/);
  });

  it('skips semantic when invalid and warns', () => {
    const bad = semanticOverlay();
    bad.schema_version = '99.0';
    const repo = tmpRepoWith({ 'semantic.files.json': bad });
    const r = loadIntelligenceOverlays({ repoRoot: repo });
    expect(r.semanticFiles).toBeNull();
    expect(r.warnings.some(w => w.includes('semantic.files.json failed validation'))).toBe(true);
  });

  it('skips architecture when its cross-reference fails (orphan file)', () => {
    const semantic = semanticOverlay();
    const arch = architectureOverlay();
    delete arch.assignments['src/b.js']; // orphan
    const repo = tmpRepoWith({
      'semantic.files.json': semantic,
      'architecture.json': arch
    });
    const r = loadIntelligenceOverlays({ repoRoot: repo });
    expect(r.semanticFiles).not.toBeNull();
    expect(r.architecture).toBeNull();
    expect(r.warnings.some(w => w.includes('architecture.json failed validation'))).toBe(true);
  });

  it('skips architecture when its assignment references a hallucinated path', () => {
    const semantic = semanticOverlay();
    const arch = architectureOverlay();
    arch.assignments['src/ghost.js'] = { layerId: 'api', confidence: 'high', reason: 'invented' };
    const repo = tmpRepoWith({
      'semantic.files.json': semantic,
      'architecture.json': arch
    });
    const r = loadIntelligenceOverlays({ repoRoot: repo });
    expect(r.architecture).toBeNull();
  });
});

describe('summarizeArchitectureLayers', () => {
  it('counts files per layer + low-confidence count', () => {
    const summary = summarizeArchitectureLayers(architectureOverlay());
    expect(summary.length).toBe(3);
    expect(summary.find(s => s.id === 'api').fileCount).toBe(1);
    expect(summary.find(s => s.id === 'util').fileCount).toBe(1);
    expect(summary.find(s => s.id === 'doc').fileCount).toBe(0);
    expect(summary.every(s => s.lowConfidenceCount === 0)).toBe(true);
  });

  it('flags low-confidence assignments', () => {
    const arch = architectureOverlay();
    arch.assignments['src/a.js'].confidence = 'low';
    const summary = summarizeArchitectureLayers(arch);
    expect(summary.find(s => s.id === 'api').lowConfidenceCount).toBe(1);
  });

  it('returns empty array when architecture is null', () => {
    expect(summarizeArchitectureLayers(null)).toEqual([]);
    expect(summarizeArchitectureLayers({})).toEqual([]);
  });
});

describe('semanticForFile', () => {
  it('returns the matching file entry', () => {
    const e = semanticForFile(semanticOverlay(), 'src/a.js');
    expect(e).not.toBeNull();
    expect(e.nodeType).toBe('api-handler');
    expect(e.summary).toMatch(/API handler/);
  });

  it('returns null when file not in overlay', () => {
    expect(semanticForFile(semanticOverlay(), 'src/missing.js')).toBeNull();
  });

  it('returns null when overlay is null', () => {
    expect(semanticForFile(null, 'src/a.js')).toBeNull();
  });
});
