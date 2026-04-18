// A1 mini-benchmark task spec. Three cells, each measuring a specific
// architectural claim under the user's two stated goals:
//   (1) reduce token cost
//   (2) improve agent performance on real tasks
//
// Not a showcase matrix. Grade PASS/FAIL only on the two goals.
//
// Cell 1: passive-tax isolation
//   - rg-shaped exact-symbol lookup
//   - arm A: no MCP loaded  |  arm B: lean MCP loaded (agent won't use it)
//   - measures cost of carrying the manifest on rg-shaped tasks
//
// Cell 2: static brief vs live MCP
//   - orientation prompt (entrypoint + 3 subsystems)
//   - arm A: agent gets .aify-graph/brief.agent.md injected, no MCP
//   - arm B: agent gets lean MCP, no brief
//   - proves static artifact can match/beat live MCP on orient questions
//
// Cell 3: compact vs verbose output
//   - graph-native impact/path prompt on aify-project-graph self
//   - arm A: AIFY_GRAPH_OUTPUT=verbose  |  arm B: compact
//   - proves compression earns its keep without losing quality
//
// Cell 3 can be run purely locally (no LLM) via scripts/_bench-compact.mjs.
// Cells 1 and 2 require codex exec + writable sandbox.

export const A1_CELLS = {
  'passive-tax-self': {
    category: 'passive-tax',
    repoId: 'aify-project-graph',
    prompt: [
      'In this repo, find the exact definition of `graphPath`.',
      'Reply with only `<path>:<line>`.',
    ].join('\n'),
    rubric: {
      type: 'exact_line',
      expected: 'mcp/stdio/query/verbs/path.js:39',
    },
    pass_criteria: {
      quality_equal_or_better: true,
      token_delta_max_pct: 5, // lean MCP should cost no more than +5% on rg-shaped tasks
    },
  },

  'passive-tax-echoes': {
    category: 'passive-tax',
    repoId: 'echoes',
    prompt: [
      'In this repo, find the exact definition of `Engine::Engine`.',
      'Reply with only `<path>:<line>`.',
    ].join('\n'),
    rubric: {
      type: 'exact_line',
      expected: 'engine/core/Engine.cpp:101',
    },
    // Historically this cell was a 10x regression for graph arm (see freeze
    // validation). Target: post-qualified-lookup-fix + lean profile + no
    // unwanted routing, we should see graph arm within ±10% of baseline.
    pass_criteria: {
      quality_equal_or_better: true,
      token_delta_max_pct: 10,
    },
  },

  'brief-vs-mcp-self': {
    category: 'brief-vs-mcp',
    repoId: 'aify-project-graph',
    prompt: [
      'You are onboarding to this repo. Return exactly 4 lines:',
      'ENTRYPOINT: <path>',
      'SUBSYSTEM: <path> - <why>',
      'SUBSYSTEM: <path> - <why>',
      'SUBSYSTEM: <path> - <why>',
    ].join('\n'),
    rubric: {
      type: 'groups',
      groups: [
        {
          label: 'entrypoint',
          any_of: ['mcp/stdio/server.js', 'mcp/stdio/ingest/', 'mcp/stdio/query/'],
          min_matches: 1,
        },
        {
          label: 'subsystems',
          any_of: ['mcp/stdio/query', 'mcp/stdio/ingest', 'mcp/stdio/freshness', 'mcp/stdio/storage', 'mcp/stdio/brief'],
          min_matches: 3,
        },
      ],
    },
    pass_criteria: {
      quality_equal_or_better: true,
      token_delta_max_pct: -20, // brief arm should be at least 20% cheaper
    },
  },

  'brief-vs-mcp-lcapi': {
    category: 'brief-vs-mcp',
    repoId: 'lc-api',
    prompt: [
      'You are onboarding to this Laravel API. Return exactly 4 lines:',
      'ENTRYPOINT: <path>',
      'SUBSYSTEM: <path> - <why>',
      'SUBSYSTEM: <path> - <why>',
      'SUBSYSTEM: <path> - <why>',
    ].join('\n'),
    rubric: {
      type: 'groups',
      groups: [
        { label: 'entrypoint', any_of: ['public/index.php', 'artisan', 'routes/'], min_matches: 1 },
        {
          label: 'subsystems',
          any_of: ['app/Http/Controllers', 'app/Http/Middleware', 'app/Components', 'app/Services', 'app/Jobs'],
          min_matches: 3,
        },
      ],
    },
    pass_criteria: {
      quality_equal_or_better: true,
      token_delta_max_pct: -20,
    },
  },

  'compact-vs-verbose-impact': {
    category: 'output-format',
    repoId: 'aify-project-graph',
    mode: 'local', // doesn't need an LLM — direct token measurement
    verb: 'graph_impact',
    symbol: 'ensureFresh',
    args: { depth: 2 },
    pass_criteria: {
      token_delta_max_pct: -15, // compact must be ≥15% smaller
      information_preserved: true, // no symbols/paths/lines lost vs verbose
    },
  },

  'compact-vs-verbose-path': {
    category: 'output-format',
    repoId: 'aify-project-graph',
    mode: 'local',
    verb: 'graph_path',
    symbol: 'graphPath',
    args: {},
    pass_criteria: {
      token_delta_max_pct: -15,
      information_preserved: true,
    },
  },
};

export const A1_GOAL_GATES = {
  // Benchmark passes if ALL cells individually meet their pass_criteria
  // AND the median cross-cell token delta for graph-enabled arms is ≤ 0
  // (i.e., on average, loading the graph tooling does not cost tokens
  // compared to baseline + rg).
  median_token_delta_max_pct: 0,
  all_cells_must_pass: true,
};
