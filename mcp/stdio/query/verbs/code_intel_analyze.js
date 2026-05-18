import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { toRepoRelative } from '../../ingest/code-intel/paths.js';

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const CPP_EXT_RE = /\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$/i;

const HINTS = {
  files_required: 'pass an explicit bounded files[] list; analyzer evidence never scans the whole repo by default',
  compile_db_missing: 'compile_commands.json not found; configure CMake with -DCMAKE_EXPORT_COMPILE_COMMANDS=ON or pass explicit compile DB setup first',
  compile_entry_missing: 'file is not present in compile_commands.json; pass a file built by the project or regenerate compile_commands.json',
  analyzer_missing: 'install clang-tidy or ensure it is on PATH',
  unsupported_mode: 'supported modes: clang-tidy, compile',
  timeout: 'increase timeoutMs or reduce files[]',
  internal_error: 'see message'
};

function errorResponse(code, message, extra = {}) {
  return { status: 'error', errors: [{ code, message, hint: HINTS[code] || '', ...extra }] };
}

function findCompileDb(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'compile_commands.json'),
    path.join(projectRoot, 'build', 'compile_commands.json'),
    path.join(projectRoot, 'build-linux', 'compile_commands.json'),
    path.join(projectRoot, 'cmake-build-debug', 'compile_commands.json')
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

function normalizeFiles(files = []) {
  return Array.from(new Set(files.filter(Boolean)));
}

function absoluteFile(projectRoot, file) {
  return path.isAbsolute(file) ? file : path.join(projectRoot, file);
}

function shellSplit(command) {
  const out = [];
  let current = '';
  let quote = null;
  let escaped = false;
  for (const ch of command) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/u.test(ch)) {
      if (current) {
        out.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

function readCompileDb(compileDbPath) {
  return JSON.parse(fs.readFileSync(compileDbPath, 'utf8'));
}

function entryArgs(entry) {
  if (Array.isArray(entry.arguments)) return entry.arguments.slice();
  if (typeof entry.command === 'string') return shellSplit(entry.command);
  return [];
}

function findCompileEntry(entries, projectRoot, file) {
  const abs = absoluteFile(projectRoot, file);
  return entries.find(entry => {
    const entryFile = path.isAbsolute(entry.file)
      ? entry.file
      : path.resolve(entry.directory || projectRoot, entry.file);
    return path.normalize(entryFile) === path.normalize(abs);
  }) || null;
}

function compileSyntaxCommand(entry) {
  const args = entryArgs(entry);
  const command = args.shift();
  const cleaned = [];
  const skipNext = new Set(['-o', '-MF', '-MT', '-MQ']);
  const dropSingle = new Set(['-c', '-MD', '-MMD', '-MP']);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (skipNext.has(arg)) {
      i += 1;
      continue;
    }
    if (dropSingle.has(arg)) continue;
    if (arg.startsWith('-o') && arg.length > 2) continue;
    cleaned.push(arg);
  }
  if (!cleaned.includes('-fsyntax-only')) cleaned.unshift('-fsyntax-only');
  return { command, args: cleaned, cwd: entry.directory };
}

function parseDiagnostics(text, projectRoot, provenance) {
  const diagnostics = [];
  const seen = new Set();
  const lineRe = /^(.*?):(\d+):(\d+):\s+(fatal error|error|warning|note):\s+(.+)$/u;
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trimEnd();
    const match = line.match(lineRe);
    if (!match) continue;
    const [, fileRaw, lineNo, colNo, severityRaw, messageRaw] = match;
    let file = fileRaw;
    try { file = toRepoRelative(projectRoot, fileRaw); } catch { /* keep raw */ }
    const message = messageRaw.replace(/\s+\[[^\]]+\]$/u, '');
    const sourceMatch = messageRaw.match(/\[([^\]]+)\]\s*$/u);
    const key = `${file}:${lineNo}:${colNo}:${severityRaw}:${messageRaw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnostics.push({
      file,
      line: Number(lineNo),
      col: Number(colNo),
      severity: severityRaw === 'fatal error' ? 'error' : severityRaw,
      message,
      source: sourceMatch?.[1] || (provenance === 'CLANG_TIDY' ? 'clang-tidy' : 'compiler'),
      provenance
    });
  }
  return diagnostics;
}

function summarize(diagnostics) {
  return {
    diagnostics: diagnostics.length,
    errors: diagnostics.filter(d => d.severity === 'error').length,
    warnings: diagnostics.filter(d => d.severity === 'warning').length,
    notes: diagnostics.filter(d => d.severity === 'note').length
  };
}

function runProcess(command, args, { cwd, timeoutMs, spawn }) {
  return new Promise(resolve => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stdout, stderr, latencyMs: Math.max(0, Date.now() - startedAt) });
    };

    const timer = setTimeout(() => {
      try { child.kill?.('SIGTERM'); } catch { /* ignore */ }
      finish({ timedOut: true, exitCode: null });
    }, timeoutMs);

    child.stdout?.on?.('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr?.on?.('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on?.('error', error => finish({ error, exitCode: null }));
    child.on?.('close', code => finish({ exitCode: code ?? 0 }));
  });
}

function boundedTimeout(timeoutMs) {
  if (!Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(1, Number(timeoutMs)), MAX_TIMEOUT_MS);
}

export async function codeIntelAnalyze({
  repoRoot,
  language = 'cpp',
  mode = 'clang-tidy',
  files = [],
  timeoutMs,
  spawn = nodeSpawn
}) {
  const startedAt = Date.now();
  if (!repoRoot) return errorResponse('internal_error', 'repoRoot required');
  if (language !== 'cpp') return errorResponse('unsupported_mode', `language ${language} is not supported by code_intel_analyze`);
  if (!['clang-tidy', 'compile'].includes(mode)) return errorResponse('unsupported_mode', `mode ${mode} is not supported`);
  const requestedFiles = normalizeFiles(files).filter(f => CPP_EXT_RE.test(f));
  if (requestedFiles.length === 0) return errorResponse('files_required', 'code_intel_analyze requires explicit C/C++ files');

  const compileDbPath = findCompileDb(repoRoot);
  if (!compileDbPath) return errorResponse('compile_db_missing', `compile_commands.json not found under ${repoRoot}`);
  const compileDbDir = path.dirname(compileDbPath);
  const entries = readCompileDb(compileDbPath);
  const waitMs = boundedTimeout(timeoutMs);
  const diagnostics = [];
  const fileResults = [];

  for (const file of requestedFiles) {
    const entry = findCompileEntry(entries, repoRoot, file);
    if (!entry && mode === 'compile') {
      fileResults.push({ file, status: 'not_collected', reason: 'compile_entry_missing', diagnostics: 0 });
      continue;
    }

    const abs = absoluteFile(repoRoot, file);
    const invocation = mode === 'clang-tidy'
      ? { command: 'clang-tidy', args: [abs, '-p', compileDbDir, '--quiet'], cwd: repoRoot, provenance: 'CLANG_TIDY' }
      : { ...compileSyntaxCommand(entry), provenance: 'BUILD' };

    if (!invocation.command) {
      fileResults.push({ file, status: 'not_collected', reason: 'compile_entry_missing', diagnostics: 0 });
      continue;
    }

    const proc = await runProcess(invocation.command, invocation.args, { cwd: invocation.cwd || repoRoot, timeoutMs: waitMs, spawn });
    if (proc.timedOut) {
      fileResults.push({ file, status: 'timeout', diagnostics: 0, latencyMs: proc.latencyMs });
      continue;
    }
    if (proc.error) {
      const code = proc.error.code === 'ENOENT' && mode === 'clang-tidy' ? 'analyzer_missing' : 'internal_error';
      return errorResponse(code, proc.error.message);
    }
    const parsed = parseDiagnostics(`${proc.stdout}\n${proc.stderr}`, repoRoot, invocation.provenance);
    diagnostics.push(...parsed);
    fileResults.push({
      file,
      status: 'ok',
      exitCode: proc.exitCode,
      diagnostics: parsed.length,
      latencyMs: proc.latencyMs,
      provenance: invocation.provenance
    });
  }

  const notCollected = fileResults.filter(f => f.status !== 'ok').length;
  return {
    status: notCollected > 0 ? 'partial' : 'ok',
    language,
    mode,
    files: fileResults,
    diagnostics,
    summary: { files: requestedFiles.length, ...summarize(diagnostics), notCollected },
    telemetry: {
      operation: 'analyze',
      mode,
      files: requestedFiles.length,
      latencyMs: Math.max(0, Date.now() - startedAt),
      timeoutMs: waitMs,
      compileDb: toRepoRelative(repoRoot, compileDbPath)
    }
  };
}
