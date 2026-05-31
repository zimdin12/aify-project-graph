// L5 integration — the C++<->GLSL shader bridge end-to-end: a real graph_index
// over a tiny repo with GLSL shaders + a C++ loader, then assert ShaderBinding
// nodes, DECLARES_BINDING + LOADS_SHADER edges land, and graph_shader renders
// the binding table + loaders.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphIndex } from '../../mcp/stdio/query/verbs/index.js';
import { graphShader } from '../../mcp/stdio/query/verbs/shader.js';
import { openExistingDb } from '../../mcp/stdio/storage/db.js';

const APPLY_DELTAS = `#version 450
#extension GL_GOOGLE_include_directive : enable
#include "worldbuf.glsl"

layout(local_size_x = 64) in;

layout(push_constant) uniform PushConstants { int slot; } pc;

layout(std430, set = 0, binding = 0) buffer VoxelBuffer { uint voxels[]; };
layout(std430, set = 0, binding = 1) readonly buffer DeltaHeaders { ivec4 h[]; };
layout(std430, set = 0, binding = 2) readonly buffer DeltaData { uint d[]; };
`;

const CAS = `#version 450
layout(std430, set = 0, binding = 0) readonly buffer InImg { uint a[]; };
layout(std430, set = 0, binding = 1) writeonly buffer OutImg { uint b[]; };
void main() {}
`;

const CAS_PIPELINE = `#include "ShaderCompiler.h"
void CASPipeline::build() {
    auto spirv = ShaderCompiler::compile(ShaderCompiler::loadFile("cas.comp.glsl"));
    writes[0].dstBinding = 0;
    writes[1].dstBinding = 1;
    vkUpdateDescriptorSets(dev, 2, writes, 0, nullptr);
}
`;

describe('L5 shader bridge (full ingest pipeline)', () => {
  let repo;
  let db;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'apg-shader-integ-'));
    await mkdir(join(repo, 'engine', 'voxel', 'shaders'), { recursive: true });
    await mkdir(join(repo, 'engine', 'rendering'), { recursive: true });
    await writeFile(join(repo, 'engine', 'voxel', 'shaders', 'apply_deltas.comp.glsl'), APPLY_DELTAS);
    await writeFile(join(repo, 'engine', 'voxel', 'shaders', 'worldbuf.glsl'), '// shared helpers\n');
    await writeFile(join(repo, 'engine', 'voxel', 'shaders', 'cas.comp.glsl'), CAS);
    await writeFile(join(repo, 'engine', 'rendering', 'CASPipeline.cpp'), CAS_PIPELINE);

    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo });
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });

    await graphIndex({ repoRoot: repo, force: true });
    db = openExistingDb(join(repo, '.aify-graph', 'graph.sqlite'));
  });

  afterAll(async () => {
    try { db?.close(); } catch {}
    await rm(repo, { recursive: true, force: true });
  });

  it('lands ShaderBinding nodes during ingest', () => {
    const rows = db.all(
      "SELECT label FROM nodes WHERE type = 'ShaderBinding' AND language = 'glsl' ORDER BY label"
    );
    const labels = rows.map((r) => r.label);
    expect(labels).toContain('binding 0.0 VoxelBuffer');
    expect(labels).toContain('binding 0.1 DeltaHeaders');
    expect(labels).toContain('binding 0.2 DeltaData');
  });

  it('lands DECLARES_BINDING edges from the shader File node', () => {
    const rows = db.all(
      `SELECT e.* FROM edges e
       JOIN nodes f ON f.id = e.from_id
       WHERE e.relation = 'DECLARES_BINDING' AND f.type = 'File'
         AND f.file_path = 'engine/voxel/shaders/apply_deltas.comp.glsl'`
    );
    expect(rows.length).toBe(3);
  });

  it('lands a LOADS_SHADER edge from the C++ file to the shader File node', () => {
    const rows = db.all(
      `SELECT e.source_file AS cpp, t.file_path AS shader
       FROM edges e JOIN nodes t ON t.id = e.to_id
       WHERE e.relation = 'LOADS_SHADER'`
    );
    const link = rows.find((r) => r.shader.endsWith('cas.comp.glsl'));
    expect(link).toBeDefined();
    expect(link.cpp).toBe('engine/rendering/CASPipeline.cpp');
  });

  it('graph_shader renders the binding table + loaders for cas.comp.glsl', async () => {
    const out = await graphShader({ repoRoot: repo, shader: 'cas.comp.glsl' });
    expect(out).toContain('SHADER engine/voxel/shaders/cas.comp.glsl');
    expect(out).toContain('BINDING TABLE');
    expect(out).toMatch(/0\.0\s+readonly/);
    expect(out).toMatch(/0\.1\s+writeonly/);
    expect(out).toContain('InImg');
    expect(out).toContain('OutImg');
    expect(out).toContain('LOADED BY');
    expect(out).toContain('CASPipeline.cpp');
    // Heuristic contract: dstBinding=0/1 writes detected for both bindings.
    expect(out).toContain('BINDING CONTRACT');
    expect(out).toMatch(/binding 0 .*C\+\+ descriptor-write/);
  });

  it('graph_shader flags a declared binding with no writer (apply_deltas, no descriptor writes)', async () => {
    const out = await graphShader({ repoRoot: repo, shader: 'apply_deltas.comp.glsl' });
    expect(out).toContain('VoxelBuffer');
    expect(out).toContain('declared, no C++ writer found — verify');
  });

  it('graph_shader lists shaders with bindings when called with no shader arg', async () => {
    const out = await graphShader({ repoRoot: repo });
    expect(out).toContain('SHADERS WITH BINDINGS');
    expect(out).toContain('cas.comp.glsl');
  });

  it('graph_shader focuses a single binding when given set.binding', async () => {
    const out = await graphShader({ repoRoot: repo, shader: 'cas.comp.glsl', binding: '0.1' });
    expect(out).toContain('OutImg');
    expect(out).not.toContain('InImg');
  });
});
