export const AB_REPOS = {
  'aify-project-graph': {
    id: 'aify-project-graph',
    label: 'aify-project-graph',
    repoRoot: '/mnt/c/Docker/aify-project-graph',
    language: 'Node',
  },
  'aify-claude': {
    id: 'aify-claude',
    label: 'aify-claude',
    repoRoot: '/mnt/c/Docker/aify-claude',
    language: 'Python+Node',
  },
  'mem0-fork': {
    id: 'mem0-fork',
    label: 'mem0-fork',
    repoRoot: '/mnt/c/Docker/aify-openmemory/mem0-fork',
    language: 'Python+TypeScript',
  },
  'lc-api': {
    id: 'lc-api',
    label: 'lc-api',
    repoRoot: '/mnt/c/Users/Administrator/lc-api',
    language: 'PHP',
  },
  'echoes': {
    id: 'echoes',
    label: 'echoes_of_the_fallen',
    repoRoot: '/mnt/c/Users/Administrator/echoes_of_the_fallen',
    language: 'C++',
  },
};

function exactPathLine(repoId, id, prompt, expected) {
  return {
    repoId,
    id,
    category: 'search',
    prompt,
    rubric: {
      type: 'ordered_contains',
      expected: [expected],
      partial_min: 1,
    },
  };
}

function orderedFiles(repoId, id, category, prompt, expected) {
  return {
    repoId,
    id,
    category,
    prompt,
    rubric: {
      type: 'ordered_contains',
      expected,
      partial_min: Math.max(1, expected.length - 1),
    },
  };
}

function orient(repoId, id, prompt, entrypoint, subsystems) {
  return {
    repoId,
    id,
    category: 'orient',
    prompt,
    rubric: {
      type: 'groups',
      groups: [
        {
          label: 'entrypoint',
          any_of: [entrypoint],
          min_matches: 1,
        },
        {
          label: 'subsystems',
          any_of: subsystems,
          min_matches: 3,
        },
      ],
    },
  };
}

export const AB_TASKS = [
  exactPathLine(
    'aify-project-graph',
    'graphpath-definition',
    [
      'In this repo, find the exact definition of `graphPath`.',
      'Reply with only `<path>:<line>`.',
    ].join('\n'),
    'mcp/stdio/query/verbs/path.js:39'
  ),
  orderedFiles(
    'aify-project-graph',
    'graphpath-exposure-trace',
    'trace',
    [
      'In this repo, trace how the `graph_path` MCP verb gets exposed and rendered.',
      'Return exactly 3 lines in this order:',
      '1. MCP registration file',
      '2. Verb implementation file',
      '3. Path renderer file',
      'Format each line as `<path> - <symbol or reason>`.',
    ].join('\n'),
    [
      'mcp/stdio/server.js',
      'mcp/stdio/query/verbs/path.js',
      'mcp/stdio/query/renderer.js',
    ]
  ),
  orient(
    'aify-project-graph',
    'onboard-index-query-stack',
    [
      'You are onboarding to this repo to change indexing and query behavior.',
      'Return exactly 4 lines:',
      'ENTRYPOINT: <path>',
      'SUBSYSTEM: <path> - <why>',
      'SUBSYSTEM: <path> - <why>',
      'SUBSYSTEM: <path> - <why>',
    ].join('\n'),
    'mcp/stdio/server.js',
    [
      'mcp/stdio/query',
      'mcp/stdio/ingest',
      'mcp/stdio/freshness',
      'mcp/stdio/storage',
    ]
  ),

  exactPathLine(
    'aify-claude',
    'get-db-definition',
    [
      'In this repo, find the exact definition of `get_db`.',
      'Reply with only `<path>:<line>`.',
    ].join('\n'),
    'service/db.py:217'
  ),
  orderedFiles(
    'aify-claude',
    'dispatch-request-trace',
    'trace',
    [
      'In this repo, trace what matters most when `POST /dispatch` queues work and notifies listeners.',
      'Return exactly 3 lines in this order:',
      '1. HTTP handler file',
      '2. Persistence layer file',
      '3. WebSocket or broadcast layer file',
      'Format each line as `<path> - <reason>`.',
    ].join('\n'),
    [
      'service/routers/api_v2.py',
      'service/db.py',
      'service/ws.py',
    ]
  ),
  orient(
    'aify-claude',
    'onboard-dispatch-stack',
    [
      'You are onboarding to this repo to work on dispatching and live updates.',
      'Return exactly 4 lines:',
      'ENTRYPOINT: <path>',
      'SUBSYSTEM: <path> - <why>',
      'SUBSYSTEM: <path> - <why>',
      'SUBSYSTEM: <path> - <why>',
    ].join('\n'),
    'service/main.py',
    [
      'service/routers',
      'service/db.py',
      'service/ws.py',
      'mcp/stdio',
    ]
  ),

  exactPathLine(
    'mem0-fork',
    'memory-add-definition',
    [
      'In this repo, find the exact sync definition of `Memory.add`.',
      'Reply with only `<path>:<line>`.',
    ].join('\n'),
    'mem0/memory/main.py:281'
  ),
  orderedFiles(
    'mem0-fork',
    'memory-add-trace',
    'trace',
    [
      'In this repo, trace the sync `Memory.add` flow until a memory record is created.',
      'Return exactly 3 lines in this order:',
      '1. Public entrypoint',
      '2. Vector-store add helper',
      '3. Record creation helper',
      'Format each line as `<symbol> @ <path>`.',
    ].join('\n'),
    [
      'memory.add @ mem0/memory/main.py',
      '_add_to_vector_store @ mem0/memory/main.py',
      '_create_memory @ mem0/memory/main.py',
    ]
  ),
  orient(
    'mem0-fork',
    'onboard-memory-core',
    [
      'You are onboarding to the core memory pipeline in this repo.',
      'Return exactly 4 lines:',
      'ENTRYPOINT: <path>',
      'SUBSYSTEM: <path> - <why>',
      'SUBSYSTEM: <path> - <why>',
      'SUBSYSTEM: <path> - <why>',
    ].join('\n'),
    'mem0/memory/main.py',
    [
      'mem0/vector_stores',
      'mem0/graphs',
      'mem0/llms',
      'mem0/embeddings',
      'mem0/utils/factory.py',
    ]
  ),

  exactPathLine(
    'lc-api',
    'companydetails-definition',
    [
      'In this repo, find the exact definition of `companyDetails`.',
      'Reply with only `<path>:<line>`.',
    ].join('\n'),
    'app/Http/Controllers/Api/Company/CompanyDetailsController.php:129'
  ),
  orderedFiles(
    'lc-api',
    'company-details-route-trace',
    'trace',
    [
      'In this repo, expand the route-declared `allow-end-user` middleware group for `GET /company-details/{company}`.',
      'Ignore Laravel framework-level `api` middleware, global middleware, and middleware-priority reordering.',
      'Report the route file, the first concrete middleware from that expanded group, the second concrete middleware from that expanded group, and the controller action file.',
      'Return exactly 4 lines in this order:',
      '1. Route file',
      '2. First middleware',
      '3. Second middleware',
      '4. Controller action file',
      'Format each line as `<path> - <symbol or reason>`.',
    ].join('\n'),
    [
      'routes/api_v1.php',
      'app/Http/Middleware/RequireToken.php',
      'app/Http/Middleware/NonIntrusiveThrottle.php',
      'app/Http/Controllers/Api/Company/CompanyDetailsController.php',
    ]
  ),
  orient(
    'lc-api',
    'onboard-api-stack',
    [
      'You are onboarding to this Laravel API repo to change request handling safely.',
      'Return exactly 4 lines:',
      'ENTRYPOINT: <path>',
      'SUBSYSTEM: <path> - <why>',
      'SUBSYSTEM: <path> - <why>',
      'SUBSYSTEM: <path> - <why>',
    ].join('\n'),
    'routes/api_v1.php',
    [
      'app/Http/Controllers',
      'app/Http/Middleware',
      'app/Components',
      'app/Services',
      'app/Jobs',
    ]
  ),

  exactPathLine(
    'echoes',
    'engine-constructor-definition',
    [
      'In this repo, find the exact definition of `Engine::Engine`.',
      'Reply with only `<path>:<line>`.',
    ].join('\n'),
    'engine/core/Engine.cpp:101'
  ),
  orderedFiles(
    'echoes',
    'boot-into-engine-trace',
    'trace',
    [
      'In this repo, trace the boot path from the executable entrypoint into Engine construction.',
      'Return exactly 3 lines in this order:',
      '1. Executable main file',
      '2. Engine declaration file',
      '3. Engine constructor implementation file',
      'Format each line as `<path> - <symbol or reason>`.',
    ].join('\n'),
    [
      'game/main.cpp',
      'engine/core/Engine.h',
      'engine/core/Engine.cpp',
    ]
  ),
  orient(
    'echoes',
    'onboard-engine-stack',
    [
      'You are onboarding to this C++ game repo to work on gameplay systems.',
      'Return exactly 4 lines:',
      'ENTRYPOINT: <path>',
      'SUBSYSTEM: <path> - <why>',
      'SUBSYSTEM: <path> - <why>',
      'SUBSYSTEM: <path> - <why>',
    ].join('\n'),
    'game/main.cpp',
    [
      'engine/core',
      'engine/rendering',
      'engine/voxel',
      'engine/ecs',
      'engine/input',
    ]
  ),
];

export const GRAPH_TOOL_NAMES = [
  'graph_status',
  'graph_index',
  'graph_report',
  'graph_search',
  'graph_whereis',
  'graph_module_tree',
  'graph_callers',
  'graph_callees',
  'graph_path',
  'graph_impact',
  'graph_preflight',
  'graph_file',
  'graph_summary',
  'graph_target_rollup',
  'graph_dashboard',
  'graph_neighbors',
  'graph_change_plan',
  'graph_onboard',
];
