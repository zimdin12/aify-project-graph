#!/usr/bin/env node
// A1/A2 live verification bench: codex-based benchmark for brief-only vs
// lean-MCP on orient and plan tasks.
//
// Usage:
//   node scripts/bench-a1-live.mjs [--repos id,id] [--repeats N]
//
// Env:
//   A1_TASK=orient|plan   (default: orient)
//   A1_BRIEF=agent|onboard|plan
//   A1_ARMS=brief-only,lean-mcp

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const TASK_SHAPE = process.env.A1_TASK || 'orient';

const ORIENT_PROMPTS = {
  default: [
    'You are onboarding to this repo. Identify the MCP entrypoint file and the 3 main subsystems.',
    'Return exactly 4 lines:',
    'ENTRYPOINT: <path>',
    'SUBSYSTEM: <path> - <why>',
    'SUBSYSTEM: <path> - <why>',
    'SUBSYSTEM: <path> - <why>',
  ].join('\n'),
  'lc-api': [
    'You are onboarding to this Laravel API to change request handling safely.',
    'Return exactly 4 lines:',
    'ENTRYPOINT: <path>',
    'SUBSYSTEM: <path> - <why>',
    'SUBSYSTEM: <path> - <why>',
    'SUBSYSTEM: <path> - <why>',
  ].join('\n'),
  'mem0-fork': [
    'You are onboarding to the core memory pipeline in this repo.',
    'Return exactly 4 lines:',
    'ENTRYPOINT: <path>',
    'SUBSYSTEM: <path> - <why>',
    'SUBSYSTEM: <path> - <why>',
    'SUBSYSTEM: <path> - <why>',
  ].join('\n'),
  'echoes': [
    'You are onboarding to this C++ game engine to work on gameplay systems.',
    'Return exactly 4 lines:',
    'ENTRYPOINT: <path>',
    'SUBSYSTEM: <path> - <why>',
    'SUBSYSTEM: <path> - <why>',
    'SUBSYSTEM: <path> - <why>',
  ].join('\n'),
};

const PLAN_PROMPTS = {
  'aify-project-graph': [
    'I need to modify how `graph_lookup` resolves qualified symbols like `Class::method` safely.',
    'Return exactly 5 lines:',
    'TARGET_FILE: <path> (the primary file to edit)',
    'ENTRY_OR_WIRING: <path> (the wiring or callsite file you would inspect next)',
    'REGRESSION_RISK: <path> (one file most at risk of breaking)',
    'TESTS_TO_RUN: <path>',
    'CONFIDENCE: <low|medium|high>',
  ].join('\n'),
  'lc-api': [
    'I need to change the GET `/company-details/{company}` request flow safely.',
    'Return exactly 5 lines:',
    'TARGET_FILE: <path> (the primary file to edit first)',
    'ENTRY_OR_WIRING: <path> (route or provider file that introduces the flow)',
    'REGRESSION_RISK: <path> (one middleware/controller file most at risk)',
    'TESTS_TO_RUN: <path>',
    'CONFIDENCE: <low|medium|high>',
  ].join('\n'),
  'echoes': [
    'I need to change mining and block interaction safely in this repo.',
    'Return exactly 5 lines:',
    'TARGET_FILE: <path> (the main gameplay file to edit first)',
    'ENTRY_OR_WIRING: <path> (the file that wires this gameplay loop into runtime)',
    'REGRESSION_RISK: <path> (one adjacent file most likely to break)',
    'TESTS_TO_RUN: <path>',
    'CONFIDENCE: <low|medium|high>',
  ].join('\n'),
  'mem0-fork': [
    'I need to change the sync `Memory.add` creation pipeline safely.',
    'Return exactly 5 lines:',
    'TARGET_FILE: <path> (the primary implementation file to edit first)',
    'ENTRY_OR_WIRING: <path> (one API/client/callsite file to inspect next)',
    'REGRESSION_RISK: <path> (one helper/storage file most likely to break)',
    'TESTS_TO_RUN: <path>',
    'CONFIDENCE: <low|medium|high>',
  ].join('\n'),
};

const REPOS = {
  'aify-project-graph': {
    root: resolve('.').replaceAll('\\', '/'),
    prompt: TASK_SHAPE === 'plan' ? PLAN_PROMPTS['aify-project-graph'] : ORIENT_PROMPTS.default,
    rubric: TASK_SHAPE === 'plan'
      ? {
          type: 'plan_lines',
          lines: {
            TARGET_FILE: [/mcp\/stdio\/query\/verbs\/lookup\.js/i],
            ENTRY_OR_WIRING: [/mcp\/stdio\/server\.js/i, /tests\/integration\/verbs\.test\.js/i],
            REGRESSION_RISK: [/mcp\/stdio\/query\/verbs\/(whereis|search|callers)\.js/i, /tests\/integration\/verbs\.test\.js/i],
            TESTS_TO_RUN: [/tests\/integration\/verbs\.test\.js/i, /tests\/.*lookup/i],
            CONFIDENCE: [/\b(low|medium|high)\b/i],
          },
        }
      : {
          type: 'orient',
          entrypoint: [/mcp\/stdio\/server\.js/i],
          subsystemRoots: [
            'mcp/stdio/query',
            'mcp/stdio/ingest',
            'mcp/stdio/freshness',
            'mcp/stdio/storage',
            'mcp/stdio/brief',
          ],
        },
  },
  'lc-api': {
    root: 'C:/Users/Administrator/lc-api',
    prompt: TASK_SHAPE === 'plan' ? PLAN_PROMPTS['lc-api'] : ORIENT_PROMPTS['lc-api'],
    rubric: TASK_SHAPE === 'plan'
      ? {
          type: 'plan_lines',
          lines: {
            TARGET_FILE: [/app\/Http\/Controllers\/Api\/Company\/CompanyDetailsController\.php/i],
            ENTRY_OR_WIRING: [/routes\/api_v1\.php/i, /app\/Providers\/RouteServiceProvider\.php/i],
            REGRESSION_RISK: [/app\/Http\/Middleware\/RequireToken\.php/i, /app\/Http\/Middleware\/NonIntrusiveThrottle\.php/i, /app\/Http\/Controllers\/Api\/Company\/CompanyDetailsController\.php/i],
            TESTS_TO_RUN: [/tests\/Feature\/Http\/Controllers\/Api\/Company\/V[23]\/CompanyControllerTest\.php/i, /tests\/Feature\/(BrexTest|CompanyAddressTest|SearchBotHandlingTest|IndiaTest)\.php/i],
            CONFIDENCE: [/\b(low|medium|high)\b/i],
          },
        }
      : {
          type: 'orient',
          entrypoint: [/public\/index\.php/i, /\bartisan\b/i, /routes\//i],
          subsystemRoots: [
            'app/Http/Controllers',
            'app/Http/Middleware',
            'app/Http/Kernel',
            'app/Http/Requests',
            'app/Providers/RouteServiceProvider',
            'app/Components',
            'app/Services',
            'app/Jobs',
          ],
        },
  },
  'mem0-fork': {
    root: 'C:/Docker/aify-openmemory/mem0-fork',
    prompt: TASK_SHAPE === 'plan' ? PLAN_PROMPTS['mem0-fork'] : ORIENT_PROMPTS['mem0-fork'],
    rubric: TASK_SHAPE === 'plan'
      ? {
          type: 'plan_lines',
          lines: {
            TARGET_FILE: [/mem0\/memory\/main\.py/i],
            ENTRY_OR_WIRING: [/openmemory\/api\/app\/routers\/memories\.py/i, /mem0\/client\/main\.py/i, /tests\/test_main\.py/i],
            REGRESSION_RISK: [/mem0\/memory\/(storage|utils)\.py/i, /openmemory\/api\/app\/utils\/enhanced_memory\.py/i, /mem0\/memory\/main\.py/i],
            TESTS_TO_RUN: [/tests\/(test_main|test_memory)\.py/i, /tests\/memory\/test_main\.py/i],
            CONFIDENCE: [/\b(low|medium|high)\b/i],
          },
        }
      : {
          type: 'orient',
          entrypoint: [/mem0\/memory\/main\.py/i, /mem0\/memory\//i, /mem0\/__init__\.py/i, /openmemory\/api\/(main|app)/i, /openmemory\/api\/app\/routers/i],
          // Broadened 2026-04-19: mem0-fork is a split-package repo. Real
          // answers live under both mem0/ (the library) and openmemory/ (the
          // API wrapper). Strict mem0-only rubric produced 0/3 artifacts;
          // semantic-valid answers (openmemory/api/app/utils/enhanced_memory.py
          // as orchestrator etc.) are correct for "core memory pipeline."
          subsystemRoots: [
            'mem0/memory',
            'mem0/vector_stores',
            'mem0/graphs',
            'mem0/llms',
            'mem0/embeddings',
            'mem0/utils',
            'openmemory/api/app/utils',
            'openmemory/api/app/routers',
            'openmemory/api/app',
          ],
        },
  },
  'echoes': {
    root: 'C:/Users/Administrator/echoes_of_the_fallen',
    prompt: TASK_SHAPE === 'plan' ? PLAN_PROMPTS['echoes'] : ORIENT_PROMPTS['echoes'],
    rubric: TASK_SHAPE === 'plan'
      ? {
          type: 'plan_lines',
          lines: {
            TARGET_FILE: [/game\/systems\/VoxelInteractionSystem\.cpp/i],
            ENTRY_OR_WIRING: [/game\/main\.cpp/i, /engine\/core\/Engine_gameplay\.cpp/i],
            REGRESSION_RISK: [/game\/ecs\/GameComponents\.h/i, /game\/systems\/(PlayerMovementSystem|InventorySystem|DeathSystem)\.cpp/i],
            TESTS_TO_RUN: [/tests\/test_main\.cpp/i],
            CONFIDENCE: [/\b(low|medium|high)\b/i],
          },
        }
      : {
          type: 'orient',
          entrypoint: [/game\/main\.cpp/i, /\bEngine\.(cpp|h)\b/i],
          subsystemRoots: [
            'engine/core',
            'engine/rendering',
            'engine/voxel',
            'engine/ecs',
            'engine/input',
            'engine/physics',
            'engine/debug',
            'game/systems',
            'game/ecs',
          ],
        },
  },
};

const args = process.argv.slice(2);
const repeats = Number(args[args.indexOf('--repeats') + 1]) || 2;
const selectedRepoIds = (() => {
  const i = args.indexOf('--repos');
  if (i >= 0) return args[i + 1].split(',');
  return ['aify-project-graph'];
})();

const MCP_SERVER = resolve('mcp/stdio/server.js').replaceAll('\\', '/');
const LEAN_TOOL_NAMES = ['graph_impact', 'graph_path', 'graph_change_plan'];

async function makeHome({ withMCP }) {
  const home = await mkdtemp(join(tmpdir(), 'a1-bench-'));
  const codexDir = join(home, '.codex');
  await mkdir(codexDir, { recursive: true });
  const authSrc = join(process.env.USERPROFILE || process.env.HOME, '.codex', 'auth.json');
  if (existsSync(authSrc)) {
    await writeFile(join(codexDir, 'auth.json'), readFileSync(authSrc));
  }
  const lines = [
    'approvals_reviewer = "user"',
    'model = "gpt-5.4"',
    'model_reasoning_effort = "medium"',
  ];
  if (withMCP) {
    lines.push(
      '',
      '[mcp_servers.aify-project-graph]',
      'command = "node"',
      `args = ["--max-old-space-size=8192", "${MCP_SERVER}", "--toolset=lean"]`,
      'startup_timeout_sec = 180',
      'tool_timeout_sec = 180',
    );
    for (const toolName of LEAN_TOOL_NAMES) {
      lines.push(
        '',
        `[mcp_servers.aify-project-graph.tools.${toolName}]`,
        'approval_mode = "approve"',
      );
    }
  }
  for (const repo of Object.values(REPOS)) {
    lines.push(
      '',
      `[projects."${repo.root.replaceAll('\\', '/')}"]`,
      'trust_level = "trusted"',
    );
  }
  await writeFile(join(codexDir, 'config.toml'), lines.join('\n') + '\n');
  return home;
}

async function runCell({ home, repo, prompt }) {
  return new Promise((res) => {
    const started = Date.now();
    const answerPath = join(home, `${basename(repo.root)}-last-answer.txt`);
    const child = spawn('codex', [
      'exec', '--json', '--ephemeral', '--color', 'never',
      '-s', 'read-only', '-C', repo.root,
      '-m', 'gpt-5.4',
      '-o', answerPath,
      '-',
    ], { env: { ...process.env, HOME: home, USERPROFILE: home }, shell: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('exit', async code => {
      const dur = Date.now() - started;
      let finalAnswer = '';
      try { finalAnswer = await readFile(answerPath, 'utf8'); } catch {}
      res({ code, stdout, stderr, dur, finalAnswer: finalAnswer.trim() });
    });
    child.stdin.end(prompt);
  });
}

function parseUsage(stdout) {
  let fallbackUsage = null;
  let turnUsage = null;
  let commands = [];
  let mcpCalls = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.type === 'item.completed' && j.item) {
        if (j.item.type === 'command_execution') commands.push(j.item.command || j.item);
        if (j.item.type === 'mcp_tool_call') mcpCalls.push(`${j.item.server}.${j.item.tool}`);
      }
      if (j.type === 'turn.completed' && j.usage) turnUsage = j.usage;
      if (!turnUsage && j.type === 'token_count' && j.info && j.info.total_token_usage) {
        fallbackUsage = j.info.total_token_usage;
      }
    } catch {}
  }
  return { usage: turnUsage || fallbackUsage, commands, mcpCalls };
}

function normalizePath(text) {
  return String(text || '').replaceAll('\\', '/').trim().toLowerCase();
}

function extractSubsystemPaths(answer) {
  const out = [];
  for (const rawLine of String(answer || '').split('\n')) {
    const line = rawLine.trim();
    if (!/^SUBSYSTEM:/i.test(line)) continue;
    const body = line.replace(/^SUBSYSTEM:\s*/i, '');
    const [pathPart] = body.split(/\s+-\s+/, 1);
    out.push(normalizePath(pathPart));
  }
  return [...new Set(out)];
}

function extractLabeledLines(answer) {
  const map = {};
  for (const rawLine of String(answer || '').split('\n')) {
    const line = rawLine.trim();
    const m = /^([A-Z_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    map[m[1]] = m[2];
  }
  return map;
}

function scoreAnswer(answer, rubric) {
  if (rubric.type === 'plan_lines') {
    const lines = extractLabeledLines(answer);
    const checks = {};
    let pass = true;
    for (const [label, patterns] of Object.entries(rubric.lines)) {
      const value = lines[label] || '';
      const ok = patterns.some(re => re.test(value));
      checks[label] = { ok, value };
      if (!ok) pass = false;
    }
    return { type: 'plan_lines', checks, pass };
  }
  const entryOK = rubric.entrypoint.some(re => re.test(answer));
  const subsystemPaths = extractSubsystemPaths(answer);
  const matched = subsystemPaths.filter(path => rubric.subsystemRoots.some(root => path.startsWith(normalizePath(root))));
  const distinctMatches = [...new Set(matched)];
  return {
    type: 'orient',
    entry_ok: entryOK,
    subsystem_matches: distinctMatches.length,
    subsystems: distinctMatches,
    pass: entryOK && distinctMatches.length >= 3,
  };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

console.log(`A1 live bench — task=${TASK_SHAPE} repos=${selectedRepoIds.join(',')} repeats=${repeats}`);
const startedAt = Date.now();
const results = [];

for (const repoId of selectedRepoIds) {
  const repo = REPOS[repoId];
  if (!repo) { console.log(`SKIP unknown repo ${repoId}`); continue; }

  const briefVariant = process.env.A1_BRIEF || (TASK_SHAPE === 'plan' ? 'plan' : 'agent');
  const briefFile = briefVariant === 'agent' ? 'brief.agent.md'
    : briefVariant === 'onboard' ? 'brief.onboard.md'
    : briefVariant === 'plan' ? 'brief.plan.md'
    : 'brief.agent.md';
  const briefPath = join(repo.root, '.aify-graph', briefFile);
  if (!existsSync(briefPath)) {
    console.log(`SKIP ${repoId} — ${briefFile} missing; run graph-brief.mjs first`);
    continue;
  }
  const briefText = readFileSync(briefPath, 'utf8');
  console.log(`  (using ${briefFile}, ${briefText.length}B ~${Math.ceil(briefText.length / 4)}tok)`);

  const armFilter = process.env.A1_ARMS ? process.env.A1_ARMS.split(',') : ['brief-only', 'lean-mcp'];
  for (const arm of armFilter) {
    const withMCP = arm === 'lean-mcp';
    const home = await makeHome({ withMCP });
    for (let rep = 1; rep <= repeats; rep++) {
      const prompt = arm === 'brief-only'
        ? `REPO BRIEF (pre-computed project map — use this to answer):\n\`\`\`\n${briefText}\n\`\`\`\n\n${repo.prompt}`
        : repo.prompt;

      process.stdout.write(`  ${repoId} ${arm} #${rep}... `);
      const { code, stdout, stderr, dur, finalAnswer } = await runCell({ home, repo, prompt });
      if (code !== 0 || stdout.length < 100) {
        console.log(`(stderr: ${stderr.slice(0, 300)}) (stdout len=${stdout.length})`);
      }
      const { usage, commands, mcpCalls } = parseUsage(stdout);
      const score = scoreAnswer(finalAnswer, repo.rubric);
      const effTok = usage ? (usage.input_tokens - (usage.cached_input_tokens || 0) + (usage.output_tokens || 0)) : null;
      console.log(`${code === 0 ? 'OK' : 'ERR'} dur=${(dur/1000).toFixed(0)}s eff_tok=${effTok ?? '?'} pass=${score.pass} cmds=${commands.length} mcp=${mcpCalls.length}`);
      results.push({
        repoId,
        taskShape: TASK_SHAPE,
        briefFile,
        arm,
        rep,
        code,
        dur,
        effTok,
        score,
        mcpCalls,
        commands: commands.length,
        finalAnswer,
        stderr: code !== 0 ? stderr.slice(0, 400) : '',
      });
    }
    await rm(home, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}

console.log('\n=== A1 live bench summary ===');
const byCell = {};
for (const r of results) {
  const key = `${r.repoId}/${r.taskShape}/${r.arm}`;
  if (!byCell[key]) byCell[key] = [];
  byCell[key].push(r);
}
for (const [key, runs] of Object.entries(byCell)) {
  const ok = runs.filter(r => r.code === 0);
  if (ok.length === 0) { console.log(`${key.padEnd(48)} all failed`); continue; }
  const medTok = median(ok.map(r => r.effTok ?? Infinity));
  const passRate = ok.filter(r => r.score.pass).length / ok.length;
  const medCmds = median(ok.map(r => r.commands));
  const medMcp = median(ok.map(r => r.mcpCalls.length));
  const medDur = median(ok.map(r => r.dur));
  console.log(`${key.padEnd(48)} med_tok=${medTok} pass=${(passRate*100).toFixed(0)}% dur=${(medDur/1000).toFixed(0)}s cmds=${medCmds} mcp_calls=${medMcp}`);
}
const elapsed = ((Date.now() - startedAt) / 1000 / 60).toFixed(1);
console.log(`\nelapsed=${elapsed}min  total_runs=${results.length}`);

await writeFile(`bench-a1-live-${Date.now()}.json`, JSON.stringify({
  taskShape: TASK_SHAPE,
  results,
  byCell,
}, null, 2));
