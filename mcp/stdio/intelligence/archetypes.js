// Heuristic archetype classifier — names a code cluster by PURPOSE
// ("Rendering Pipeline", "Physics") instead of a bare community id, by matching
// game-dev keywords against a cluster's member symbol labels + file paths.
//
// Zero-dependency and deterministic: works on the structural graph alone (no
// LLM, no overlay). When the optional intelligence overlay IS present, callers
// can prefer its curated architecture-layer name over this heuristic — this is
// the always-on fallback. Borrowed from graphify's SECTION_ARCHETYPES idea,
// retuned for C++ game engines (sand_castle / echoes).

export const ARCHETYPES = [
  { id: 'rendering',     name: 'Rendering',        keywords: ['render', 'draw', 'graphic', 'gpu', 'mesh', 'sprite', 'texture', 'framebuffer', 'rasteriz', 'pipeline', 'vertex', 'camera', 'viewport'] },
  { id: 'shaders',       name: 'Shaders',          keywords: ['shader', 'glsl', 'spirv', 'uniform', 'binding', 'glsl', 'frag', 'vert', 'compute_shader'] },
  { id: 'physics',       name: 'Physics',          keywords: ['physic', 'gravity', 'collision', 'rigidbody', 'velocity', 'force', 'fluid', 'mass', 'integrator', 'constraint', 'dynamics', 'buoyancy'] },
  // NOTE: avoid over-generic tokens like 'sim'/'field'/'step'/'world' — they
  // swamp domain signal (e.g. sim/fields/Gravity.cpp is Physics, not Simulation).
  { id: 'simulation',    name: 'Simulation',       keywords: ['simulate', 'tick', 'cellular', 'automat', 'voxel', 'chunk', 'terrain', 'worldgen', 'ca_step'] },
  { id: 'audio',         name: 'Audio',            keywords: ['audio', 'sound', 'sfx', 'mixer', 'voice', 'music', 'dsp', 'waveform', 'sample_rate'] },
  { id: 'input',         name: 'Input',            keywords: ['input', 'keyboard', 'mouse', 'gamepad', 'controller', 'keybind', 'action_map', 'event_queue'] },
  { id: 'ai',            name: 'AI',               keywords: ['ai', 'behavior', 'pathfind', 'navmesh', 'astar', 'steering', 'agent', 'fsm', 'state_machine', 'decision'] },
  { id: 'networking',    name: 'Networking',       keywords: ['network', 'socket', 'packet', 'replicat', 'rpc', 'client', 'server', 'netcode', 'protocol', 'serialize_net'] },
  { id: 'assets',        name: 'Assets',           keywords: ['asset', 'resource', 'load', 'import', 'pak', 'bundle', 'manifest', 'streaming', 'cache_asset'] },
  { id: 'ecs',           name: 'ECS / Entities',   keywords: ['entity', 'component', 'system', 'ecs', 'archetype_storage', 'registry', 'pool', 'sparse_set'] },
  { id: 'math',          name: 'Math',             keywords: ['math', 'vec2', 'vec3', 'matrix', 'quaternion', 'transform', 'aabb', 'geometry', 'lerp', 'noise', 'random'] },
  { id: 'ui',            name: 'UI / HUD',         keywords: ['ui', 'hud', 'widget', 'menu', 'button', 'layout', 'imgui', 'panel', 'overlay_ui', 'font', 'text_render'] },
  { id: 'serialization', name: 'Serialization',    keywords: ['serial', 'deserial', 'save', 'load_state', 'snapshot', 'json', 'binary', 'persist', 'savegame'] },
  { id: 'scripting',     name: 'Scripting',        keywords: ['script', 'lua', 'bind', 'vm', 'interpret', 'bytecode', 'hotreload'] },
  { id: 'memory',        name: 'Memory',           keywords: ['alloc', 'arena', 'pool_alloc', 'heap', 'gc', 'memory', 'free_list', 'bump'] },
  { id: 'concurrency',   name: 'Concurrency',      keywords: ['thread', 'mutex', 'atomic', 'async', 'task', 'job_system', 'parallel', 'worker', 'lockfree'] },
  { id: 'core',          name: 'Core / Engine',    keywords: ['engine', 'core', 'app', 'main', 'lifecycle', 'subsystem', 'context', 'config', 'log', 'profiler', 'time'] },
  { id: 'tooling',       name: 'Build / Tooling',  keywords: ['build', 'cmake', 'tool', 'cli', 'generate', 'codegen', 'script_build', 'install'] },
  { id: 'tests',         name: 'Tests',            keywords: ['test', 'spec', 'fixture', 'mock', 'assert', 'bench', 'rapidcheck', 'catch2', 'gtest'] },
];

function pathSegments(filePath) {
  return String(filePath || '').toLowerCase().split(/[/\\]/).filter(Boolean);
}

// samples: [{ label, file_path }] — a cluster's representative members. Returns
// { id, name, score, confidence }. confidence: high (strong + clear winner),
// medium (some signal), low (nothing clears the floor → id 'mixed').
export function classifyArchetype(samples = []) {
  const scores = new Map(ARCHETYPES.map((a) => [a.id, 0]));
  for (const s of samples) {
    const label = String(s?.label || '').toLowerCase();
    const segs = pathSegments(s?.file_path);
    const segBlob = segs.join(' ');
    for (const a of ARCHETYPES) {
      let hit = 0;
      for (const kw of a.keywords) {
        if (segBlob.includes(kw)) hit += 2;       // path hit weighs more
        else if (label.includes(kw)) hit += 1;    // label hit
      }
      if (hit) scores.set(a.id, scores.get(a.id) + hit);
    }
  }
  let top = { id: 'mixed', score: 0 };
  let runner = { id: null, score: 0 };
  for (const [id, score] of scores) {
    if (score > top.score) { runner = top; top = { id, score }; }
    else if (score > runner.score) { runner = { id, score }; }
  }
  const meta = ARCHETYPES.find((a) => a.id === top.id);
  let confidence = 'low';
  if (top.score >= 3 && top.score >= 2 * (runner.score || 0.5)) confidence = 'high';
  else if (top.score >= 2) confidence = 'medium';
  if (confidence === 'low') return { id: 'mixed', name: 'Mixed', score: top.score, confidence: 'low' };
  return { id: top.id, name: meta ? meta.name : top.id, score: top.score, confidence };
}
