#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';

import { AB_REPOS, AB_TASKS, GRAPH_TOOL_NAMES } from '../tests/ab/tasks.mjs';

const DEFAULT_MODEL = 'gpt-5.4';
const DEFAULT_REASONING = 'medium';
const DEFAULT_REPEATS = 3;
const BENCH_SCRIPT = resolve('scripts/bench-rebuild.mjs');
const GRAPH_SERVER = resolve('mcp/stdio/server.js');
const TMP_ROOT = join(os.tmpdir(), 'aify-project-graph-ab-runner');
const CONTAMINATION_COMMAND_PATTERNS = [
  /\.aify-graph\b/i,
  /graph-query\.mjs/i,
  /graph\.sqlite/i,
];

function usage() {
  console.error([
    'usage: node scripts/ab-runner.mjs [options]',
    '',
    'Options:',
    '  --repos <id,id,...>       Limit to selected repo ids',
    '  --tasks <id,id,...>       Limit to selected task ids',
    '  --repeats <n>             Runs per cell (default: 3)',
    '  --model <name>            Codex model (default: gpt-5.4)',
    '  --reasoning <level>       low|medium|high|xhigh (default: medium)',
    '  --toolset <name>          MCP toolset: full|lean (default: full)',
    '  --out-json <path>         Raw results output path',
    '  --out-md <path>           Markdown summary output path',
    '  --skip-warmup             Skip pre-building graphs with bench-rebuild',
    '  --dry-run                 Print selected tasks and exit',
  ].join('\n'));
}

function parseArgs(argv) {
  const options = {
    repos: null,
    tasks: null,
    repeats: DEFAULT_REPEATS,
    model: DEFAULT_MODEL,
    reasoning: DEFAULT_REASONING,
    toolset: 'full',
    skipWarmup: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repos') {
      options.repos = argv[++i]?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
    } else if (arg === '--tasks') {
      options.tasks = argv[++i]?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
    } else if (arg === '--repeats') {
      options.repeats = Number(argv[++i]);
    } else if (arg === '--model') {
      options.model = argv[++i];
    } else if (arg === '--reasoning') {
      options.reasoning = argv[++i];
    } else if (arg === '--toolset') {
      options.toolset = argv[++i];
    } else if (arg === '--out-json') {
      options.outJson = argv[++i];
    } else if (arg === '--out-md') {
      options.outMd = argv[++i];
    } else if (arg === '--skip-warmup') {
      options.skipWarmup = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      usage();
      process.exit(2);
    }
  }

  if (!Number.isFinite(options.repeats) || options.repeats < 1) {
    console.error('--repeats must be a positive integer');
    process.exit(2);
  }

  if (!['full', 'lean'].includes(options.toolset)) {
    console.error('--toolset must be one of: full, lean');
    process.exit(2);
  }

  return options;
}

function ensureRepoSelection(selectedRepoIds) {
  const repoIds = selectedRepoIds ?? Object.keys(AB_REPOS);
  for (const repoId of repoIds) {
    if (!AB_REPOS[repoId]) {
      console.error(`unknown repo id: ${repoId}`);
      process.exit(2);
    }
  }
  return repoIds;
}

function selectTasks(repoIds) {
  const selected = AB_TASKS.filter((task) => repoIds.includes(task.repoId));
  if (selected.length === 0) {
    console.error('no tasks selected');
    process.exit(2);
  }
  return selected;
}

function limitTasks(tasks, selectedTaskIds) {
  if (!selectedTaskIds || selectedTaskIds.length === 0) {
    return tasks;
  }

  const known = new Set(tasks.map((task) => task.id));
  for (const taskId of selectedTaskIds) {
    if (!known.has(taskId)) {
      console.error(`unknown task id in current repo selection: ${taskId}`);
      process.exit(2);
    }
  }

  const selected = tasks.filter((task) => selectedTaskIds.includes(task.id));
  if (selected.length === 0) {
    console.error('no tasks selected after --tasks filter');
    process.exit(2);
  }
  return selected;
}

function isoDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// Linear-interpolated percentile so small samples (n=3) still give a usable
// IQR. The runner's whole reason for existing is to surface spread; without
// p25/p75 we'd be back to single-number deltas. Returns null on empty input.
function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

function spread(values) {
  if (values.length === 0) return null;
  return {
    p25: percentile(values, 25),
    p75: percentile(values, 75),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeText(text) {
  return String(text ?? '')
    .replaceAll('\\', '/')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function relativizeText(text, repoRoot) {
  const normalizedRoot = String(repoRoot).replaceAll('\\', '/');
  return String(text ?? '').replaceAll(normalizedRoot, '').replaceAll('//', '/');
}

function evaluateOrderedContains(answer, repoRoot, rubric) {
  const normalized = normalizeText(relativizeText(answer, repoRoot));
  let cursor = -1;
  const matched = [];
  for (const expected of rubric.expected) {
    const token = normalizeText(expected);
    const nextIndex = normalized.indexOf(token, cursor + 1);
    if (nextIndex === -1) break;
    matched.push(expected);
    cursor = nextIndex;
  }
  const quality = matched.length === rubric.expected.length
    ? 'correct'
    : matched.length >= (rubric.partial_min ?? 1)
      ? 'partial'
      : 'wrong';
  return {
    quality,
    matched,
    missing: rubric.expected.slice(matched.length),
  };
}

function evaluateGroups(answer, repoRoot, rubric) {
  const normalized = normalizeText(relativizeText(answer, repoRoot));
  const groupResults = rubric.groups.map((group) => {
    const matches = group.any_of.filter((candidate) => normalized.includes(normalizeText(candidate)));
    return {
      label: group.label,
      matched: matches,
      minMatches: group.min_matches ?? 1,
      satisfied: matches.length >= (group.min_matches ?? 1),
    };
  });

  const satisfied = groupResults.filter((group) => group.satisfied).length;
  const quality = satisfied === groupResults.length
    ? 'correct'
    : satisfied >= Math.ceil(groupResults.length / 2) || groupResults.some((group) => group.matched.length > 0)
      ? 'partial'
      : 'wrong';

  return {
    quality,
    groups: groupResults,
  };
}

function evaluateAnswer(answer, repoRoot, rubric) {
  if (rubric.type === 'ordered_contains') {
    return evaluateOrderedContains(answer, repoRoot, rubric);
  }
  if (rubric.type === 'groups') {
    return evaluateGroups(answer, repoRoot, rubric);
  }
  throw new Error(`unsupported rubric type: ${rubric.type}`);
}

async function runCommand(command, args, { env = {}, cwd } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`${command} ${args.join(' ')} failed (${code}): ${stderr || stdout}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

async function warmRepoGraphs(repoIds) {
  const results = {};
  for (const repoId of repoIds) {
    const repo = AB_REPOS[repoId];
    process.stderr.write(`[warmup] ${repo.label}\n`);
    const { stdout } = await runCommand('node', [BENCH_SCRIPT, repo.repoRoot], { cwd: resolve('.') });
    results[repoId] = JSON.parse(stdout);
  }
  return results;
}

async function ensureBenchmarkHomes(options) {
  const authPath = join(os.homedir(), '.codex', 'auth.json');
  if (!existsSync(authPath)) {
    throw new Error(`missing Codex auth at ${authPath}; run \`codex login\` first`);
  }

  await mkdir(TMP_ROOT, { recursive: true });
  const baselineHome = await mkdtemp(join(TMP_ROOT, 'baseline-'));
  const graphHome = await mkdtemp(join(TMP_ROOT, 'graph-'));
  await writeCodexHome(baselineHome, { ...options, graphEnabled: false });
  await writeCodexHome(graphHome, { ...options, graphEnabled: true });
  return { baselineHome, graphHome };
}

async function writeCodexHome(homeDir, { model, reasoning, graphEnabled, toolset }) {
  const codexDir = join(homeDir, '.codex');
  await mkdir(codexDir, { recursive: true });
  const authPath = join(os.homedir(), '.codex', 'auth.json');
  await writeFile(join(codexDir, 'auth.json'), await readFile(authPath));

  const lines = [
    graphEnabled ? 'approvals_reviewer = "guardian_subagent"' : 'approvals_reviewer = "user"',
    `model = "${model}"`,
    `model_reasoning_effort = "${reasoning}"`,
  ];

  if (graphEnabled) {
    const graphArgs = ['--max-old-space-size=8192', GRAPH_SERVER.replaceAll('\\', '/')];
    if (toolset && toolset !== 'full') {
      graphArgs.push(`--toolset=${toolset}`);
    }
    lines.push(
      '',
      '[mcp_servers.aify-project-graph]',
      'command = "node"',
      `args = [${graphArgs.map((arg) => `"${arg}"`).join(', ')}]`,
      'startup_timeout_sec = 180',
      'tool_timeout_sec = 180',
    );
    for (const toolName of GRAPH_TOOL_NAMES) {
      lines.push(
        '',
        `[mcp_servers.aify-project-graph.tools.${toolName}]`,
        'approval_mode = "approve"',
      );
    }
  }

  for (const repo of Object.values(AB_REPOS)) {
    lines.push(
      '',
      `[projects."${repo.repoRoot.replaceAll('\\', '/')}"]`,
      'trust_level = "trusted"',
    );
  }

  await writeFile(join(codexDir, 'config.toml'), `${lines.join('\n')}\n`);
}

function createLastMessagePath(repoId, taskId, variant, repeat) {
  return join(TMP_ROOT, `last-${repoId}-${taskId}-${variant}-${repeat}.txt`);
}

function createTranscriptPath(repoId, taskId, variant, repeat) {
  return join(TMP_ROOT, `transcript-${repoId}-${taskId}-${variant}-${repeat}.jsonl`);
}

async function runCodexCell({ homeDir, task, repo, variant, repeat, model, reasoning }) {
  const startedAt = new Date().toISOString();
  const lastMessagePath = createLastMessagePath(repo.id, task.id, variant, repeat);
  const transcriptPath = createTranscriptPath(repo.id, task.id, variant, repeat);
  const args = [
    'exec',
    '--json',
    '--ephemeral',
    '--color',
    'never',
    '-s',
    'read-only',
    '-C',
    repo.repoRoot,
    '-m',
    model,
    '-c',
    `model_reasoning_effort="${reasoning}"`,
    '-o',
    lastMessagePath,
    task.prompt,
  ];

  const startedMs = Date.now();
  const child = spawn('codex', args, {
    cwd: repo.repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdoutLines = [];
  const stderrChunks = [];
  const items = [];
  const rl = readline.createInterface({ input: child.stdout });
  const rlClosed = new Promise((resolvePromise) => rl.once('close', resolvePromise));
  rl.on('line', (line) => {
    stdoutLines.push(line);
    try {
      const event = JSON.parse(line);
      if (event.type === 'item.completed' && event.item) {
        items.push(event.item);
      }
    } catch {
      // ignore non-JSON output lines
    }
  });
  child.stderr.on('data', (chunk) => {
    stderrChunks.push(String(chunk));
  });

  const exitCode = await new Promise((resolvePromise, rejectPromise) => {
    child.on('error', rejectPromise);
    child.on('close', resolvePromise);
  });

  await rlClosed;
  const durationMs = Date.now() - startedMs;
  const transcript = stdoutLines.join('\n');
  await writeFile(transcriptPath, `${transcript}\n`);

  const turnCompletedLine = [...stdoutLines].reverse().find((line) => line.includes('"turn.completed"'));
  let usage = null;
  if (turnCompletedLine) {
    try {
      usage = JSON.parse(turnCompletedLine).usage ?? null;
    } catch {
      usage = null;
    }
  }

  const finalAnswer = existsSync(lastMessagePath)
    ? (await readFile(lastMessagePath, 'utf8')).trim()
    : '';

  const commandItems = items.filter((item) => item.type === 'command_execution');
  const mcpItems = items.filter((item) => item.type === 'mcp_tool_call');
  const contaminationHits = variant === 'baseline'
    ? commandItems.filter((item) => {
        const command = item.command ?? '';
        return CONTAMINATION_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
      }).map((item) => item.command ?? 'unknown')
    : [];

  return {
    repoId: repo.id,
    repoLabel: repo.label,
    repoRoot: repo.repoRoot,
    taskId: task.id,
    category: task.category,
    variant,
    repeat,
    prompt: task.prompt,
    startedAt,
    durationMs,
    exitCode,
    stderr: stderrChunks.join('').trim(),
    usage: usage
      ? {
          input_tokens: usage.input_tokens ?? 0,
          cached_input_tokens: usage.cached_input_tokens ?? 0,
          output_tokens: usage.output_tokens ?? 0,
          uncached_input_tokens: Math.max((usage.input_tokens ?? 0) - (usage.cached_input_tokens ?? 0), 0),
          total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
          effective_tokens: Math.max((usage.input_tokens ?? 0) - (usage.cached_input_tokens ?? 0), 0) + (usage.output_tokens ?? 0),
        }
      : null,
    finalAnswer,
    answerEvaluation: evaluateAnswer(finalAnswer, repo.repoRoot, task.rubric),
    tools: {
      command_execution_count: commandItems.length,
      mcp_tool_call_count: mcpItems.length,
      total_tool_ops: commandItems.length + mcpItems.length,
      command_execution_commands: commandItems.map((item) => item.command),
      mcp_tools: mcpItems.map((item) => `${item.server}.${item.tool}`),
      contamination_hits: contaminationHits,
      contaminated: contaminationHits.length > 0,
    },
    transcriptPath,
  };
}

function cellKey(run) {
  return `${run.repoId}:${run.taskId}:${run.category}:${run.variant}`;
}

function aggregateRuns(runs, selectedTasks) {
  const cells = new Map();
  for (const run of runs) {
    if (run.variant === 'baseline' && run.tools.contaminated) continue;
    const key = cellKey(run);
    if (!cells.has(key)) {
      cells.set(key, []);
    }
    cells.get(key).push(run);
  }

  const cellSummaries = [];
  for (const [key, cellRuns] of cells) {
    const sample = cellRuns[0];
    const usageRuns = cellRuns.filter((run) => run.usage);
    const qualityCounts = { correct: 0, partial: 0, wrong: 0 };
    for (const run of cellRuns) {
      qualityCounts[run.answerEvaluation.quality] += 1;
    }
    cellSummaries.push({
      key,
      repoId: sample.repoId,
      repoLabel: sample.repoLabel,
      taskId: sample.taskId,
      category: sample.category,
      variant: sample.variant,
      repeats: cellRuns.length,
      contaminatedDrops: sample.variant === 'baseline'
        ? runs.filter((run) => cellKey(run) === key && run.tools.contaminated).length
        : 0,
      qualityCounts,
      medianDurationMs: median(usageRuns.map((run) => run.durationMs)),
      medianEffectiveTokens: median(usageRuns.map((run) => run.usage?.effective_tokens ?? 0)),
      medianInputTokens: median(usageRuns.map((run) => run.usage?.input_tokens ?? 0)),
      medianOutputTokens: median(usageRuns.map((run) => run.usage?.output_tokens ?? 0)),
      medianTotalToolOps: median(cellRuns.map((run) => run.tools.total_tool_ops)),
      medianCommandOps: median(cellRuns.map((run) => run.tools.command_execution_count)),
      medianMcpOps: median(cellRuns.map((run) => run.tools.mcp_tool_call_count)),
      // p25/p75/min/max so consumers can see the noise envelope around the
      // medians. Without these the runner's repeats inflate confidence
      // (median looks precise) while masking the actual spread.
      effectiveTokensSpread: spread(usageRuns.map((run) => run.usage?.effective_tokens ?? 0)),
      durationMsSpread: spread(usageRuns.map((run) => run.durationMs)),
      n: usageRuns.length,
      sampleAnswer: cellRuns.find((run) => run.answerEvaluation.quality === 'correct')?.finalAnswer ?? cellRuns[0].finalAnswer,
    });
  }

  const taskPairs = [];
  for (const task of selectedTasks) {
    const baseline = cellSummaries.find((cell) => cell.repoId === task.repoId && cell.taskId === task.id && cell.variant === 'baseline');
    const graph = cellSummaries.find((cell) => cell.repoId === task.repoId && cell.taskId === task.id && cell.variant === 'graph');
    if (!baseline || !graph) continue;
    taskPairs.push({
      repoId: task.repoId,
      repoLabel: AB_REPOS[task.repoId].label,
      taskId: task.id,
      category: task.category,
      baseline,
      graph,
      effectiveTokenDeltaPct: baseline.medianEffectiveTokens
        ? ((graph.medianEffectiveTokens - baseline.medianEffectiveTokens) / baseline.medianEffectiveTokens) * 100
        : null,
      toolOpsDeltaPct: baseline.medianTotalToolOps
        ? ((graph.medianTotalToolOps - baseline.medianTotalToolOps) / baseline.medianTotalToolOps) * 100
        : null,
      durationDeltaPct: baseline.medianDurationMs
        ? ((graph.medianDurationMs - baseline.medianDurationMs) / baseline.medianDurationMs) * 100
        : null,
    });
  }

  const categories = [...new Set(taskPairs.map((pair) => pair.category))];
  const categorySummary = categories.map((category) => {
    const pairs = taskPairs.filter((pair) => pair.category === category);
    return {
      category,
      pairCount: pairs.length,
      avgEffectiveTokenDeltaPct: average(pairs.map((pair) => pair.effectiveTokenDeltaPct).filter((value) => value !== null)),
      avgToolOpsDeltaPct: average(pairs.map((pair) => pair.toolOpsDeltaPct).filter((value) => value !== null)),
      avgDurationDeltaPct: average(pairs.map((pair) => pair.durationDeltaPct).filter((value) => value !== null)),
      avgBaselineEffectiveTokens: average(pairs.map((pair) => pair.baseline.medianEffectiveTokens)),
      avgGraphEffectiveTokens: average(pairs.map((pair) => pair.graph.medianEffectiveTokens)),
      avgBaselineToolOps: average(pairs.map((pair) => pair.baseline.medianTotalToolOps)),
      avgGraphToolOps: average(pairs.map((pair) => pair.graph.medianTotalToolOps)),
      baselineQuality: summarizeQuality(pairs.map((pair) => pair.baseline.qualityCounts)),
      graphQuality: summarizeQuality(pairs.map((pair) => pair.graph.qualityCounts)),
    };
  });

  const overall = {
    pairCount: taskPairs.length,
    avgEffectiveTokenDeltaPct: average(taskPairs.map((pair) => pair.effectiveTokenDeltaPct).filter((value) => value !== null)),
    avgToolOpsDeltaPct: average(taskPairs.map((pair) => pair.toolOpsDeltaPct).filter((value) => value !== null)),
    avgDurationDeltaPct: average(taskPairs.map((pair) => pair.durationDeltaPct).filter((value) => value !== null)),
    contaminationCount: runs.filter((run) => run.tools.contaminated).length,
  };

  return {
    cells: cellSummaries,
    taskPairs,
    categorySummary,
    overall,
  };
}

function summarizeQuality(countSets) {
  return countSets.reduce((acc, counts) => ({
    correct: acc.correct + (counts.correct ?? 0),
    partial: acc.partial + (counts.partial ?? 0),
    wrong: acc.wrong + (counts.wrong ?? 0),
  }), { correct: 0, partial: 0, wrong: 0 });
}

function formatPct(value) {
  return value === null || Number.isNaN(value) ? 'n/a' : `${value.toFixed(1)}%`;
}

function formatNumber(value) {
  return value === null || Number.isNaN(value) ? 'n/a' : `${Math.round(value)}`;
}

function qualityString(counts) {
  return `C${counts.correct}/P${counts.partial}/W${counts.wrong}`;
}

function buildMarkdown({ options, selectedTasks, warmup, aggregates, jsonPath }) {
  const lines = [];
  lines.push(`# Codex A/B Results — ${isoDateStamp()}`);
  lines.push('');
  lines.push('Reproducible Codex benchmark comparing the same prompts on the same repos with and without `aify-project-graph` MCP enabled.');
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push(`- Model: \`${options.model}\``);
  lines.push(`- Reasoning effort: \`${options.reasoning}\``);
  lines.push(`- Repeats per cell: \`${options.repeats}\` (median reported per repo/task/variant)`);
  lines.push('- Prompts are identical between variants; only tool availability changes.');
  lines.push('- Graph variant uses real MCP tools with explicit tool approvals in an isolated trusted Codex home.');
  lines.push('- Baseline variant has no graph MCP configured; contamination is flagged if it touches `.aify-graph`, `graph.sqlite`, or `graph-query.mjs`.');
  lines.push('- Graphs were pre-built with `node scripts/bench-rebuild.mjs <repo>` before the matrix run.');
  lines.push('- Quality is rubric-graded per cell as `correct`, `partial`, or `wrong`.');
  lines.push(`- Raw JSON artifact: [${jsonPath}](${jsonPath})`);
  lines.push('');
  lines.push('## Warmup Rebuilds');
  lines.push('');
  lines.push('| Repo | Nodes | Edges | Index time | Peak RSS | Unresolved |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const repoId of Object.keys(warmup)) {
    const item = warmup[repoId];
    lines.push(`| ${AB_REPOS[repoId].label} | ${item.nodes} | ${item.edges} | ${item.durationSec}s | ${item.peakRssMb} MB | ${item.unresolvedEdges} |`);
  }
  lines.push('');
  lines.push('## Category Summary');
  lines.push('');
  lines.push('| Category | Cells | Graph eff. tokens | Baseline eff. tokens | Token delta | Graph ops | Baseline ops | Tool-op delta | Duration delta | Graph quality | Baseline quality |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|');
  for (const item of aggregates.categorySummary) {
    lines.push(
      `| ${item.category} | ${item.pairCount} | ${formatNumber(item.avgGraphEffectiveTokens)} | ${formatNumber(item.avgBaselineEffectiveTokens)} | ${formatPct(item.avgEffectiveTokenDeltaPct)} | ${formatNumber(item.avgGraphToolOps)} | ${formatNumber(item.avgBaselineToolOps)} | ${formatPct(item.avgToolOpsDeltaPct)} | ${formatPct(item.avgDurationDeltaPct)} | ${qualityString(item.graphQuality)} | ${qualityString(item.baselineQuality)} |`
    );
  }
  lines.push('');
  lines.push('## Task Cells');
  lines.push('');
  lines.push('| Repo | Task | Category | Graph eff. tokens | Baseline eff. tokens | Token delta | Graph ops | Baseline ops | Graph quality | Baseline quality |');
  lines.push('|---|---|---|---:|---:|---:|---:|---:|---|---|');
  for (const pair of aggregates.taskPairs) {
    lines.push(
      `| ${pair.repoLabel} | \`${pair.taskId}\` | ${pair.category} | ${formatNumber(pair.graph.medianEffectiveTokens)} | ${formatNumber(pair.baseline.medianEffectiveTokens)} | ${formatPct(pair.effectiveTokenDeltaPct)} | ${formatNumber(pair.graph.medianTotalToolOps)} | ${formatNumber(pair.baseline.medianTotalToolOps)} | ${qualityString(pair.graph.qualityCounts)} | ${qualityString(pair.baseline.qualityCounts)} |`
    );
  }
  lines.push('');
  lines.push('## Overall');
  lines.push('');
  lines.push(`- Average effective-token delta across all task cells: **${formatPct(aggregates.overall.avgEffectiveTokenDeltaPct)}**`);
  lines.push(`- Average tool-op delta across all task cells: **${formatPct(aggregates.overall.avgToolOpsDeltaPct)}**`);
  lines.push(`- Average duration delta across all task cells: **${formatPct(aggregates.overall.avgDurationDeltaPct)}**`);
  lines.push(`- Baseline contamination hits dropped from summary: **${aggregates.overall.contaminationCount}**`);
  lines.push('');
  lines.push('## Re-run');
  lines.push('');
  lines.push('```bash');
  lines.push(`node scripts/ab-runner.mjs --repeats ${options.repeats} --model ${options.model} --reasoning ${options.reasoning}`);
  if (options.toolset && options.toolset !== 'full') {
    lines[lines.length - 1] += ` --toolset ${options.toolset}`;
  }
  lines.push('```');
  lines.push('');
  lines.push('## Task Spec');
  lines.push('');
  lines.push(`Prompts live in [tests/ab/tasks.mjs](${resolve('tests/ab/tasks.mjs')}).`);

  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoIds = ensureRepoSelection(options.repos);
  const selectedTasks = limitTasks(selectTasks(repoIds), options.tasks);
  process.stderr.write(`[setup] repos=${repoIds.join(',')} tasks=${selectedTasks.length} repeats=${options.repeats}\n`);

  if (options.dryRun) {
    console.log(JSON.stringify(selectedTasks, null, 2));
    return;
  }

  const stamp = isoDateStamp();
  const outJson = resolve(options.outJson ?? `docs/dogfood/ab-results-${stamp}.json`);
  const outMd = resolve(options.outMd ?? `docs/dogfood/ab-results-${stamp}.md`);

  await mkdir(dirname(outJson), { recursive: true });
  await mkdir(dirname(outMd), { recursive: true });

  let homes;
  try {
    homes = await ensureBenchmarkHomes(options);
    const warmup = options.skipWarmup ? {} : await warmRepoGraphs(repoIds);
    const runs = [];

    for (const task of selectedTasks) {
      const repo = AB_REPOS[task.repoId];
      for (const repeat of Array.from({ length: options.repeats }, (_, index) => index + 1)) {
        for (const variant of ['baseline', 'graph']) {
          const homeDir = variant === 'graph' ? homes.graphHome : homes.baselineHome;
          process.stderr.write(`[run] ${repo.label} ${task.category} ${task.id} ${variant} repeat ${repeat}/${options.repeats}\n`);
          const result = await runCodexCell({
            homeDir,
            task,
            repo,
            variant,
            repeat,
            model: options.model,
            reasoning: options.reasoning,
          });
          process.stderr.write(`[done] ${repo.label} ${task.id} ${variant} quality=${result.answerEvaluation.quality} tools=${result.tools.total_tool_ops} tokens=${result.usage?.effective_tokens ?? 'n/a'}\n`);
          runs.push(result);
        }
      }
    }

    const aggregates = aggregateRuns(runs, selectedTasks);
    const payload = {
      metadata: {
        generated_at: new Date().toISOString(),
        model: options.model,
        reasoning: options.reasoning,
        repeats: options.repeats,
        repos: repoIds,
      },
      warmup,
      tasks: selectedTasks,
      runs,
      aggregates,
    };

    await writeFile(outJson, `${JSON.stringify(payload, null, 2)}\n`);
    const markdown = buildMarkdown({
      options,
      selectedTasks,
      warmup,
      aggregates,
      jsonPath: outJson,
    });
    await writeFile(outMd, markdown);

    console.log(JSON.stringify({
      ok: true,
      outJson,
      outMd,
      overall: aggregates.overall,
    }, null, 2));
  } finally {
    if (homes) {
      await rm(homes.baselineHome, { recursive: true, force: true });
      await rm(homes.graphHome, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
