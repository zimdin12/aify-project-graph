// L5 — GLSL binding extraction + C++<->GLSL shader-bindings framework plugin.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractGlslBindings, extractGlslIncludes } from '../../../mcp/stdio/ingest/languages/glsl_bindings.js';
import { shaderBindingsPlugin } from '../../../mcp/stdio/ingest/frameworks/shader_bindings.js';

const APPLY_DELTAS = `#version 450
#extension GL_GOOGLE_include_directive : enable
#include "worldbuf.glsl"

layout(local_size_x = 64) in;

layout(push_constant) uniform PushConstants {
    int chunkSlot;
} pc;

layout(std430, set = 0, binding = 0) buffer VoxelBuffer {
    uint voxels[];
};

layout(std430, set = 0, binding = 1) readonly buffer DeltaHeaders {
    ivec4 deltaHeaders[];
};

layout(std430, set = 0, binding = 2) readonly buffer DeltaData {
    uint deltaData[];
};
`;

describe('extractGlslBindings', () => {
  it('extracts set/binding/access/block from echoes-style std430 buffers', () => {
    const b = extractGlslBindings(APPLY_DELTAS);
    expect(b).toHaveLength(3);
    expect(b[0]).toMatchObject({ set: 0, binding: 0, access: 'readwrite', block_name: 'VoxelBuffer', kind: 'buffer' });
    expect(b[1]).toMatchObject({ set: 0, binding: 1, access: 'readonly', block_name: 'DeltaHeaders' });
    expect(b[2]).toMatchObject({ set: 0, binding: 2, access: 'readonly', block_name: 'DeltaData' });
  });

  it('skips push_constant blocks (no binding=)', () => {
    const b = extractGlslBindings(APPLY_DELTAS);
    expect(b.find((x) => x.block_name === 'PushConstants')).toBeUndefined();
  });

  it('handles sand_castle-style bindings without an explicit set + writeonly', () => {
    const src = `layout(std430, binding = 0) readonly buffer FluidStepCellsIn { float a[]; };
layout(std430, binding = 1) writeonly buffer FluidStepCellsOut { float b[]; };
layout(std430, binding = 3) buffer FluidStepDensitySummaryBuffer { uint c[]; };`;
    const b = extractGlslBindings(src);
    expect(b).toHaveLength(3);
    expect(b[0]).toMatchObject({ set: 0, binding: 0, access: 'readonly', block_name: 'FluidStepCellsIn' });
    expect(b[1]).toMatchObject({ set: 0, binding: 1, access: 'writeonly', block_name: 'FluidStepCellsOut' });
    expect(b[2]).toMatchObject({ set: 0, binding: 3, access: 'readwrite', block_name: 'FluidStepDensitySummaryBuffer' });
  });

  it('handles a multi-line layout(...) qualifier list', () => {
    const src = `layout(
      std430,
      set = 2,
      binding = 5
    ) readonly buffer SplitBlock { uint x[]; };`;
    const b = extractGlslBindings(src);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ set: 2, binding: 5, access: 'readonly', block_name: 'SplitBlock' });
  });

  it('extracts uniform blocks with a binding', () => {
    const src = `layout(set = 0, binding = 7) uniform CameraBlock { mat4 view; };`;
    const b = extractGlslBindings(src);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ binding: 7, block_name: 'CameraBlock', kind: 'uniform' });
  });

  it('extracts opaque image/sampler bindings (uniform <qual> <type> <name>;)', () => {
    // Real echoes cas.comp.glsl shape — storage images, not blocks.
    const src = `layout(set = 0, binding = 0, rgba8) uniform readonly image2D inputImage;
layout(set = 0, binding = 1, rgba8) uniform writeonly image2D outputImage;
layout(set = 0, binding = 2) uniform sampler2D albedoTex;`;
    const b = extractGlslBindings(src);
    expect(b).toHaveLength(3);
    expect(b[0]).toMatchObject({ set: 0, binding: 0, access: 'readonly', block_name: 'inputImage', kind: 'image' });
    expect(b[1]).toMatchObject({ set: 0, binding: 1, access: 'writeonly', block_name: 'outputImage', kind: 'image' });
    expect(b[2]).toMatchObject({ set: 0, binding: 2, access: 'readwrite', block_name: 'albedoTex', kind: 'sampler' });
  });

  it('extractGlslIncludes finds #include targets', () => {
    expect(extractGlslIncludes(APPLY_DELTAS).map((i) => i.target)).toEqual(['worldbuf.glsl']);
  });
});

describe('shaderBindingsPlugin', () => {
  let repo;
  beforeEach(async () => { repo = await mkdtemp(join(tmpdir(), 'apg-shader-')); });
  afterEach(async () => {
    for (let i = 0; i < 5; i += 1) {
      try { await rm(repo, { recursive: true, force: true }); return; } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  it('detects repos that contain shader files', async () => {
    await mkdir(join(repo, 'shaders'), { recursive: true });
    await writeFile(join(repo, 'shaders', 'x.comp'), 'void main(){}');
    expect(await shaderBindingsPlugin.detect({ repoRoot: repo })).toBe(true);
  });

  it('emits ShaderBinding nodes + DECLARES_BINDING refs for a shader', async () => {
    await mkdir(join(repo, 'shaders'), { recursive: true });
    await writeFile(join(repo, 'shaders', 'apply_deltas.comp.glsl'), APPLY_DELTAS);
    await writeFile(join(repo, 'shaders', 'worldbuf.glsl'), '// shared\n');

    const out = await shaderBindingsPlugin.enrich({ repoRoot: repo, result: { nodes: [], edges: [], refs: [] } });
    const bindings = out.nodes.filter((n) => n.type === 'ShaderBinding' && n.language === 'glsl');
    expect(bindings.map((n) => n.label).sort()).toEqual([
      'binding 0.0 VoxelBuffer',
      'binding 0.1 DeltaHeaders',
      'binding 0.2 DeltaData',
    ].sort());

    const decl = out.refs.filter((r) => r.relation === 'DECLARES_BINDING');
    expect(decl).toHaveLength(3);
    expect(decl.every((r) => r.from_id && r.to_id)).toBe(true);

    // GLSL #include emitted as IMPORTS ref
    expect(out.refs.some((r) => r.relation === 'IMPORTS' && r.target === 'worldbuf.glsl')).toBe(true);
  });

  it('emits a LOADS_SHADER ref from a C++ loadFile("...") to the shader basename', async () => {
    await mkdir(join(repo, 'shaders'), { recursive: true });
    await mkdir(join(repo, 'src'), { recursive: true });
    await writeFile(join(repo, 'shaders', 'cas.comp.glsl'),
      'layout(std430, set = 0, binding = 0) buffer Img { uint p[]; };\n');
    await writeFile(join(repo, 'src', 'CASPipeline.cpp'),
`void CASPipeline::build() {
    auto src = ShaderCompiler::loadFile("cas.comp.glsl");
}
`);
    const out = await shaderBindingsPlugin.enrich({ repoRoot: repo, result: { nodes: [], edges: [], refs: [] } });
    const load = out.refs.find((r) => r.relation === 'LOADS_SHADER' && r.target === 'cas.comp.glsl');
    expect(load).toBeDefined();
    expect(load.from_id).toBeTruthy();
    expect(load.loader_symbol).toBe('build');
  });

  it('captures .dstBinding = N descriptor-write sites best-effort', async () => {
    await mkdir(join(repo, 'shaders'), { recursive: true });
    await mkdir(join(repo, 'src'), { recursive: true });
    await writeFile(join(repo, 'shaders', 'cas.comp.glsl'),
      'layout(std430, set = 0, binding = 0) buffer Img { uint p[]; };\n');
    await writeFile(join(repo, 'src', 'CASPipeline.cpp'),
`void CASPipeline::wire() {
    writes[0].dstBinding = 0;
    writes[1].dstBinding = 1;
    auto src = ShaderCompiler::loadFile("cas.comp.glsl");
}
`);
    const out = await shaderBindingsPlugin.enrich({ repoRoot: repo, result: { nodes: [], edges: [], refs: [] } });
    const writeNode = out.nodes.find((n) => n.type === 'ShaderBinding' && n.language === 'cpp');
    expect(writeNode).toBeDefined();
    const dw = writeNode.extra.descriptor_writes;
    expect(dw.map((w) => w.binding).sort()).toEqual([0, 1]);
    expect(dw.every((w) => w.symbol === 'wire')).toBe(true);
  });

  it('does not link C++ strings to shaders that are not indexed', async () => {
    await mkdir(join(repo, 'shaders'), { recursive: true });
    await mkdir(join(repo, 'src'), { recursive: true });
    await writeFile(join(repo, 'shaders', 'present.comp.glsl'), 'void main(){}\n');
    await writeFile(join(repo, 'src', 'X.cpp'),
      'void f(){ auto s = loadFile("ghost.comp.glsl"); }\n');
    const out = await shaderBindingsPlugin.enrich({ repoRoot: repo, result: { nodes: [], edges: [], refs: [] } });
    expect(out.refs.some((r) => r.relation === 'LOADS_SHADER' && r.target === 'ghost.comp.glsl')).toBe(false);
  });
});
