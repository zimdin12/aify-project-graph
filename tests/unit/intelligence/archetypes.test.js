import { describe, it, expect } from 'vitest';
import { classifyArchetype, ARCHETYPES } from '../../../mcp/stdio/intelligence/archetypes.js';

describe('classifyArchetype', () => {
  it('names a physics cluster', () => {
    const r = classifyArchetype([
      { label: 'GravityBody', file_path: 'sim/fields/Gravity.cpp' },
      { label: 'apply_gravity', file_path: 'sim/fields/Gravity.cpp' },
      { label: 'FluidCell', file_path: 'sim/fields/Fluid.cpp' },
    ]);
    expect(r.id).toBe('physics');
    expect(r.confidence).not.toBe('low');
  });
  it('names a rendering cluster', () => {
    const r = classifyArchetype([
      { label: 'Renderer', file_path: 'engine/render/Render.cpp' },
      { label: 'draw_quads', file_path: 'engine/render/Render.cpp' },
      { label: 'ShaderProgram', file_path: 'engine/render/Shader.cpp' },
    ]);
    expect(r.id).toBe('rendering');
  });
  it('returns low-confidence mixed when nothing matches', () => {
    const r = classifyArchetype([{ label: 'Xyzzy', file_path: 'foo/bar.cpp' }]);
    expect(r.confidence).toBe('low');
    expect(r.id).toBe('mixed');
  });
  it('handles empty input without throwing', () => {
    const r = classifyArchetype([]);
    expect(r.confidence).toBe('low');
  });
  it('does not over-match generic substrings (bug-hunt round 1 regressions)', () => {
    // 'log' must NOT match 'dialog'/'catalog'; 'time' must NOT match 'runtime';
    // 'test' must NOT match 'latest'; 'core' must NOT match 'scoreboard'; 'main'
    // must NOT match 'domain' — these wrongly classified as Core/Engine or Tests.
    expect(classifyArchetype([{ label: 'mapDialog', file_path: 'src/dialog/dialog_mapper.cpp' }]).id).not.toBe('core');
    expect(classifyArchetype([{ label: 'getLatestState', file_path: 'src/contest/latest.cpp' }]).id).not.toBe('tests');
    expect(classifyArchetype([{ label: 'tickRuntime', file_path: 'src/runtime/scoreboard.cpp' }]).id).not.toBe('core');
    expect(classifyArchetype([{ label: 'resolveDomain', file_path: 'src/domain/remaining.cpp' }]).id).not.toBe('core');
  });
  it('still matches real word-boundary signals (render→rendering)', () => {
    expect(classifyArchetype([{ label: 'rendering', file_path: 'engine/renderer/pipeline.cpp' }]).id).toBe('rendering');
  });

  it('exposes a non-empty archetype table', () => {
    expect(ARCHETYPES.length).toBeGreaterThan(10);
    for (const a of ARCHETYPES) { expect(a.id).toBeTruthy(); expect(a.name).toBeTruthy(); expect(Array.isArray(a.keywords)).toBe(true); }
  });
});
