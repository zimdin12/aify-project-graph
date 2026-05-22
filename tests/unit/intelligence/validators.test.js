// Plan #15 Step A2 tests: validators for semantic.files.json + architecture.json.
// Covers both happy path and every cross-reference failure mode flagged in
// senior-dev's review (hallucinated paths, duplicate paths, unknown layer
// ids, orphan files, schema-version mismatch, enum violations).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validate as validateSemantic } from '../../../mcp/stdio/intelligence/validators/semantic-files.js';
import { validate as validateArchitecture } from '../../../mcp/stdio/intelligence/validators/architecture.js';

const VALID_SHA = 'sha256:' + 'a'.repeat(64);

function semanticEnvelope(files = []) {
  return {
    schema_version: '0.1',
    generatorVersion: 'file-summarizer/0.1.0',
    generatedAt: '2026-05-22T00:00:00Z',
    graphHead: 'abc1234',
    inputSha: VALID_SHA,
    files
  };
}

function file(path_, overrides = {}) {
  return {
    path: path_,
    summary: 'A bounded test fixture file.',
    tags: ['test', 'fixture'],
    complexity: 'low',
    nodeType: 'utility',
    entryPoint: false,
    ...overrides
  };
}

function architectureEnvelope({ layers, assignments } = {}) {
  return {
    schema_version: '0.1',
    generatorVersion: 'architecture-layer-assigner/0.1.0',
    generatedAt: '2026-05-22T00:00:00Z',
    graphHead: 'abc1234',
    inputSha: VALID_SHA,
    layers: layers || [
      { id: 'api', name: 'API', description: 'HTTP request handlers.', color: '#58a6ff' },
      { id: 'service', name: 'Service', description: 'Business logic.', color: '#3fb950' },
      { id: 'data', name: 'Data', description: 'Persistence and models.', color: '#d29922' }
    ],
    assignments: assignments || {}
  };
}

function tmpRepoWithFile(relPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-intel-'));
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, '// stub');
  return dir;
}

describe('semantic-files validator', () => {
  it('passes a valid envelope', () => {
    const obj = semanticEnvelope([file('src/foo.js')]);
    const r = validateSemantic(obj);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects wrong schema_version', () => {
    const obj = semanticEnvelope([file('src/foo.js')]);
    obj.schema_version = '0.2';
    const r = validateSemantic(obj);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/schema_version/);
  });

  it('rejects malformed inputSha', () => {
    const obj = semanticEnvelope([file('src/foo.js')]);
    obj.inputSha = 'sha256:nothex';
    const r = validateSemantic(obj);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/inputSha/);
  });

  it('rejects backslash paths', () => {
    const obj = semanticEnvelope([file('src\\foo.js')]);
    const r = validateSemantic(obj);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/forward slashes/);
  });

  it('rejects invalid nodeType (entry-point should not be in enum)', () => {
    const obj = semanticEnvelope([file('src/foo.js', { nodeType: 'entry-point' })]);
    const r = validateSemantic(obj);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/nodeType/);
  });

  it('rejects non-boolean entryPoint', () => {
    const obj = semanticEnvelope([file('src/foo.js', { entryPoint: 'yes' })]);
    const r = validateSemantic(obj);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/entryPoint.*boolean/);
  });

  it('rejects duplicate paths', () => {
    const obj = semanticEnvelope([file('src/foo.js'), file('src/foo.js')]);
    const r = validateSemantic(obj);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/duplicate file path/);
  });

  it('rejects too many tags', () => {
    const obj = semanticEnvelope([file('src/foo.js', { tags: ['a','b','c','d','e','f','g','h','i'] })]);
    const r = validateSemantic(obj);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/tags/);
  });

  it('catches hallucinated paths (file not on disk)', () => {
    const repo = tmpRepoWithFile('src/real.js');
    const obj = semanticEnvelope([file('src/real.js'), file('src/imagined.js')]);
    const r = validateSemantic(obj, { repoRoot: repo });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/hallucinated.*src\/imagined\.js/);
  });

  it('passes when all paths exist on disk', () => {
    const repo = tmpRepoWithFile('src/real.js');
    const obj = semanticEnvelope([file('src/real.js')]);
    const r = validateSemantic(obj, { repoRoot: repo });
    expect(r.ok).toBe(true);
  });
});

describe('architecture validator', () => {
  it('passes a valid envelope with cross-reference', () => {
    const semantic = semanticEnvelope([file('src/api.js'), file('src/store.js')]);
    const arch = architectureEnvelope({
      assignments: {
        'src/api.js': { layerId: 'api', confidence: 'high', reason: 'HTTP handler' },
        'src/store.js': { layerId: 'data', confidence: 'medium', reason: 'persists state' }
      }
    });
    const r = validateArchitecture(arch, { semanticFilesJson: semantic });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects assignment referencing unknown layerId', () => {
    const arch = architectureEnvelope({
      assignments: { 'src/foo.js': { layerId: 'ghost', confidence: 'low' } }
    });
    const r = validateArchitecture(arch);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/unknown layerId.*ghost/);
  });

  it('rejects invalid hex color on layer', () => {
    const arch = architectureEnvelope({
      layers: [
        { id: 'api', name: 'API', description: 'desc', color: 'blue' },
        { id: 'service', name: 'S', description: 'd', color: '#3fb950' },
        { id: 'data', name: 'D', description: 'd', color: '#d29922' }
      ]
    });
    const r = validateArchitecture(arch);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/color/);
  });

  it('rejects layer count below 3', () => {
    const arch = architectureEnvelope({
      layers: [{ id: 'api', name: 'A', description: 'd', color: '#000000' }]
    });
    const r = validateArchitecture(arch);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/3-10/);
  });

  it('catches hallucinated assignment path (not in semantic.files.json)', () => {
    const semantic = semanticEnvelope([file('src/real.js')]);
    const arch = architectureEnvelope({
      assignments: {
        'src/real.js': { layerId: 'api', confidence: 'high' },
        'src/never-existed.js': { layerId: 'api', confidence: 'high' }
      }
    });
    const r = validateArchitecture(arch, { semanticFilesJson: semantic });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/possible hallucination.*never-existed/);
  });

  it('catches orphan files (in semantic.files but not assigned)', () => {
    const semantic = semanticEnvelope([file('src/a.js'), file('src/b.js')]);
    const arch = architectureEnvelope({
      assignments: { 'src/a.js': { layerId: 'api', confidence: 'high' } }
    });
    const r = validateArchitecture(arch, { semanticFilesJson: semantic });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/src\/b\.js.*no architecture assignment|no architecture assignment.*src\/b\.js/);
  });

  it('rejects duplicate layer ids', () => {
    const arch = architectureEnvelope({
      layers: [
        { id: 'api', name: 'A', description: 'd', color: '#111111' },
        { id: 'api', name: 'A2', description: 'd', color: '#222222' },
        { id: 'data', name: 'D', description: 'd', color: '#333333' }
      ]
    });
    const r = validateArchitecture(arch);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/duplicate layer id/);
  });

  it('rejects invalid confidence', () => {
    const arch = architectureEnvelope({
      assignments: { 'src/foo.js': { layerId: 'api', confidence: 'super' } }
    });
    const r = validateArchitecture(arch);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/confidence/);
  });

  it('rejects backslash paths in assignments', () => {
    const arch = architectureEnvelope({
      assignments: { 'src\\foo.js': { layerId: 'api', confidence: 'high' } }
    });
    const r = validateArchitecture(arch);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/backslash/);
  });

  it('warns (not errors) when semantic cross-reference is skipped', () => {
    const arch = architectureEnvelope({
      assignments: { 'src/foo.js': { layerId: 'api', confidence: 'high' } }
    });
    const r = validateArchitecture(arch);
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/cross-reference skipped/);
  });
});
