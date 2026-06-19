import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmakePlugin } from '../../../../mcp/stdio/ingest/frameworks/cmake.js';

// CMake build-graph extractor (Sand Castle report P1 #3): so "what target builds
// X / what test registers Y / what does target Z link" resolves on a C++ repo.
describe('cmake framework plugin', () => {
  let repoRoot;
  beforeEach(async () => { repoRoot = await mkdtemp(join(tmpdir(), 'apg-cmake-')); });
  afterEach(async () => { await rm(repoRoot, { recursive: true, force: true }); });

  const empty = () => ({ nodes: [], edges: [], refs: [] });

  it('detects a repo with a root CMakeLists.txt', async () => {
    await writeFile(join(repoRoot, 'CMakeLists.txt'), 'project(x)\n');
    expect(await cmakePlugin.detect({ repoRoot })).toBe(true);
  });

  it('does not detect a repo without any cmake files', async () => {
    await writeFile(join(repoRoot, 'README.md'), '# x\n');
    expect(await cmakePlugin.detect({ repoRoot })).toBe(false);
  });

  it('extracts targets, tests, link deps, and registration edges', async () => {
    await writeFile(join(repoRoot, 'CMakeLists.txt'), `
project(sand_castle)

add_library(sim STATIC sim/fields/UnifiedFluidRelaxation.cpp sim/fields/UnifiedFluidScatter.cpp)
add_executable(game game/main.cpp game/UnifiedFluidRuntime.cpp)
target_link_libraries(game PRIVATE sim)

add_executable(test_fluid tests/fields/test_unified_fluid.cpp)
target_link_libraries(test_fluid PRIVATE sim)
add_test(NAME unified_fluid COMMAND test_fluid)
`);
    const out = await cmakePlugin.enrich({ repoRoot, result: empty() });

    const byType = (t) => out.nodes.filter((n) => n.type === t);
    const targets = byType('BuildTarget');
    const tests = byType('BuildTest');
    expect(targets.map((n) => n.label).sort()).toEqual(['game', 'sim', 'test_fluid']);
    expect(tests.map((n) => n.label)).toEqual(['unified_fluid']);

    // executable vs library kind + captured sources
    const sim = targets.find((n) => n.label === 'sim');
    expect(sim.extra.kind).toBe('library');
    expect(sim.extra.sources).toContain('sim/fields/UnifiedFluidRelaxation.cpp');
    const game = targets.find((n) => n.label === 'game');
    expect(game.extra.kind).toBe('executable');

    // LINKS edges: game→sim, test_fluid→sim (both endpoints are known targets)
    const links = out.edges.filter((e) => e.relation === 'LINKS');
    const linkPairs = links.map((e) => `${nodeLabel(out, e.from_id)}->${nodeLabel(out, e.to_id)}`).sort();
    expect(linkPairs).toEqual(['game->sim', 'test_fluid->sim']);

    // RUNS edge: the test runs the test_fluid target
    const runs = out.edges.filter((e) => e.relation === 'RUNS');
    expect(runs).toHaveLength(1);
    expect(nodeLabel(out, runs[0].from_id)).toBe('unified_fluid');
    expect(nodeLabel(out, runs[0].to_id)).toBe('test_fluid');
  });

  it('ignores comments and unknown link deps (external libs)', async () => {
    await writeFile(join(repoRoot, 'CMakeLists.txt'), `
add_executable(app main.cpp)  # the app
# add_executable(ghost ghost.cpp)
target_link_libraries(app PRIVATE fmt::fmt SDL3::SDL3)
`);
    const out = await cmakePlugin.enrich({ repoRoot, result: empty() });
    expect(out.nodes.filter((n) => n.type === 'BuildTarget').map((n) => n.label)).toEqual(['app']);
    // fmt/SDL3 aren't declared targets in this file → no dangling LINKS edges
    expect(out.edges.filter((e) => e.relation === 'LINKS')).toHaveLength(0);
  });
});

function nodeLabel(out, id) {
  return out.nodes.find((n) => n.id === id)?.label;
}
