#!/usr/bin/env node
// A1 live verification: small codex-based benchmark to validate A1 hypothesis.
// Narrow scope — brief-only vs lean-MCP on orientation prompts. 2 repos × 2
// arms × N=2 = 8 runs. Time-box 30-45 min.
//
// Usage: node scripts/bench-a1-live.mjs [--repos id,id] [--repeats N]

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPOS = {
  'aify-project-graph': {
    root: resolve('.').replaceAll('\\', '/'),
    prompt: [
      'You are onboarding to this repo. Identify the MCP entrypoint file and the 3 main subsystems.',
      'Return exactly 4 lines:',
      'ENTRYPOINT: <path>',
      'SUBSYSTEM: <path> - <why>',
      'SUBSYSTEM: <path> - <why>',
      'SUBSYSTEM: <path> - <why>',
    ].join('\n'),
    rubric: {
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
    prompt: [
      'You are onboarding to this Laravel API to change request handling safely.',
      'Return exactly 4 lines:',
      'ENTRYPOINT: <path>',
      'SUBSYSTEM: <path> - <why>',
      'SUBSYSTEM: <path> - <why>',
      'SUBSYSTEM: <path> - <why>',
    ].join('\n'),
    rubric: {
      entrypoint: [/public\/index\.php/i, /\bartisan\b/i, /routes\//i],
      subsystemRoots: [
        'app/Http/Controllers',
        'app/Http/Middleware',
        'app/Components',
        'app/Services',
        'app/Jobs',
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
    for (const toolName of ['graph_impact','graph_callers','graph_path','graph_report','graph_change_plan']) {
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
    // Pipe prompt via stdin to avoid shell quoting hell on Windows.
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
      try {
        finalAnswer = await readFile(answerPath, 'utf8');
      } catch {}
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

function scoreAnswer(answer, rubric) {
  const entryOK = rubric.entrypoint.some(re => re.test(answer));
  const subsystemPaths = extractSubsystemPaths(answer);
  const matched = subsystemPaths.filter(path => rubric.subsystemRoots.some(root => path.startsWith(normalizePath(root))));
  const distinctMatches = [...new Set(matched)];
  return {
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

// ---------- main ----------

console.log(`A1 live bench — repos=${selectedRepoIds.join(',')} repeats=${repeats}`);
const startedAt = Date.now();
const results = [];

for (const repoId of selectedRepoIds) {
  const repo = REPOS[repoId];
  if (!repo) { console.log(`SKIP unknown repo ${repoId}`); continue; }

  // Brief variant picker: A1_BRIEF=agent (default) | onboard | plan
  const briefVariant = process.env.A1_BRIEF || 'agent';
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
      const start = Date.now();
      const { code, stdout, stderr, dur, finalAnswer } = await runCell({ home, repo, prompt });
      if (code !== 0 || stdout.length < 100) {
        console.log(`(stderr: ${stderr.slice(0, 300)}) (stdout len=${stdout.length})`);
      }
      const { usage, commands, mcpCalls } = parseUsage(stdout);
      const score = scoreAnswer(finalAnswer, repo.rubric);
      const effTok = usage ? (usage.input_tokens - (usage.cached_input_tokens || 0) + (usage.output_tokens || 0)) : null;
      console.log(`${code === 0 ? 'OK' : 'ERR'} dur=${(dur/1000).toFixed(0)}s eff_tok=${effTok ?? '?'} pass=${score.pass} cmds=${commands.length} mcp=${mcpCalls.length}`);
      results.push({ repoId, arm, rep, code, dur, effTok, score, mcpCalls, commands: commands.length, finalAnswer, stderr: code !== 0 ? stderr.slice(0, 400) : '' });
    }
    await rm(home, { recursive: true, force: true, maxRetries: 3 }).catch(() => {
      // Windows sometimes locks temp subdirs (PowerShell profile data etc.);
      // leaking a temp dir is cheaper than killing the benchmark mid-run.
    });
  }
}

// Aggregate
console.log('\n=== A1 live bench summary ===');
const byCell = {};
for (const r of results) {
  const key = `${r.repoId}/${r.arm}`;
  if (!byCell[key]) byCell[key] = [];
  byCell[key].push(r);
}
for (const [key, runs] of Object.entries(byCell)) {
  const ok = runs.filter(r => r.code === 0);
  if (ok.length === 0) { console.log(`${key.padEnd(40)} all failed`); continue; }
  const medTok = median(ok.map(r => r.effTok ?? Infinity));
  const passRate = ok.filter(r => r.score.pass).length / ok.length;
  const medCmds = median(ok.map(r => r.commands));
  const medMcp = median(ok.map(r => r.mcpCalls.length));
  console.log(`${key.padEnd(40)} med_tok=${medTok} pass=${(passRate*100).toFixed(0)}% cmds=${medCmds} mcp_calls=${medMcp}`);
}
const elapsed = ((Date.now() - startedAt) / 1000 / 60).toFixed(1);
console.log(`\nelapsed=${elapsed}min  total_runs=${results.length}`);

await writeFile(`bench-a1-live-${Date.now()}.json`, JSON.stringify({ results, byCell }, null, 2));
