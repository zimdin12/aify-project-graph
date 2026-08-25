import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { toRepoRelative } from '../../ingest/code-intel/paths.js';
import { inferLanguage, normalizeLanguage } from '../../code-intel/backends.js';
import { codeIntelDiagnostics } from './code_intel_live.js';
import { prepareCompileDb } from '../../code-intel/compile-db.js';

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

// ⛔ THIS WAS A SECOND, INDEPENDENT COMPILE-DB DISCOVERY — a four-entry hardcoded list
// (root, build/, build-linux/, cmake-build-debug/) that had drifted away from the real one.
// Found by sc-manager on sand_castle, where it reported compile_db_missing while TWO compile
// DBs sat in the repo, because neither `build-clangd-native` nor `build-win-clangd` was on its
// list. It also ignored APG_COMPILE_DB — our own documented escape hatch — and ignored the
// normalized DB that `doctor` had itself written at .aify-graph/code-intel/compile_commands.json.
//
// ⇒ Deleted rather than extended. Extending it would have left two lists to keep in sync, which
// is how it drifted in the first place. prepareCompileDb is now the single discovery path, so
// this verb inherits derived candidates, toolchain-mismatch detection and the external-root
// check for free — and can never again disagree with `doctor` about which DB exists.
//
// ⚠ AND THE CONSEQUENCE THAT MATTERED MORE THAN THE MISS: on compile_db_missing this verb
// returned BYTE-IDENTICAL output for a real source and a fabricated `ZzzNotARealSource.cpp`.
// A probe that cannot return ABSENT cannot return PRESENT, so every answer it gave in that
// repo carried zero information.
function findCompileDb(projectRoot) {
  let db = null;
  try {
    db = prepareCompileDb({ projectRoot });
  } catch {
    return null; // fail closed — the caller reports compile_db_missing
  }
  if (!db?.found) return null;
  // Prefer the NORMALIZED copy: host-path-translated and unity-expanded, which is what clangd
  // and clang-tidy are given everywhere else. Fall back to the raw DB if it was not written.
  const normalized = db.normalizedPath;
  if (normalized && fs.existsSync(normalized)) return normalized;
  return db.sourcePath ?? null;
}

// The DB this verb is about to analyze against may be one clangd cannot compile. Surface that
// with the result instead of returning diagnostics that look authoritative — a clean analyze
// over a DB whose TUs fail is the green null this project keeps re-finding.
function compileDbWarnings(projectRoot) {
  let db = null;
  try {
    db = prepareCompileDb({ projectRoot });
  } catch {
    return [];
  }
  if (!db?.found) return [];
  return (db.diagnostics || []).filter((d) => (
    d.code === 'toolchain_mismatch' || d.code === 'compile_db_external_root' || d.code === 'foreign_toolchain'
  ));
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
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

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

// TS/JS/Python analyze: drive the language server's diagnostics (the live
// backend already collects them) and reshape into the analyze contract.
async function analyzeViaLsp({ repoRoot, language, files, timeoutMs, spawn }) {
  const startedAt = Date.now();
  const reqFiles = normalizeFiles(files);
  if (reqFiles.length === 0) return errorResponse('files_required', 'code_intel_analyze requires an explicit files[] list');
  // analyze's `spawn` is a process-spawn FUNCTION (for the C++ path); the live
  // diagnostics path wants a spawn CONFIG {command,args} (or undefined → real
  // backend). Only forward an actual config so production uses the real LSP.
  const lspSpawn = (spawn && typeof spawn === 'object' && spawn.command) ? spawn : undefined;
  const diag = await codeIntelDiagnostics({ repoRoot, language, files: reqFiles, diagnosticsWaitMs: boundedTimeout(timeoutMs), spawn: lspSpawn });
  if (diag.status === 'error') return diag;
  const provenance = language === 'python' ? 'PYRIGHT' : 'TS_LANGSERVER';
  const diagnostics = (diag.diagnostics || []).map((d) => ({
    file: d.file,
    line: (d.range?.start?.line ?? 0) + 1,
    col: (d.range?.start?.character ?? 0) + 1,
    severity: (d.severity === 'info' || d.severity === 'hint') ? 'note' : d.severity,
    message: d.message || '',
    source: provenance.toLowerCase(),
    provenance,
  }));
  const fileResults = (diag.files || []).map((f) => ({ file: f.file, status: 'ok', diagnostics: f.diagnostics, provenance }));
  return {
    status: 'ok',
    language,
    mode: 'lsp',
    files: fileResults,
    diagnostics,
    summary: { files: reqFiles.length, ...summarize(diagnostics), notCollected: 0 },
    telemetry: { operation: 'analyze', mode: 'lsp', files: reqFiles.length, latencyMs: Math.max(0, Date.now() - startedAt) },
  };
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
  if (!repoRoot) return errorResponse('invalid_request', 'repoRoot is required');
  // Multi-language analyze (borrow: agent-code-intel's per-language analyzer
  // dispatch — reimplemented). C++ keeps clang-tidy/compile; TS/JS/Python route
  // through the language server's own diagnostics (already collected by the live
  // backends) instead of erroring. Pick the backend from explicit language or by
  // inferring from the first file.
  const rawFiles = normalizeFiles(files);
  const inferred = rawFiles.length ? inferLanguage(rawFiles[0]) : null;
  const effLang = (language && language !== 'cpp') ? normalizeLanguage(language) : (inferred || 'cpp');
  if (effLang === 'typescript' || effLang === 'javascript' || effLang === 'python') {
    return analyzeViaLsp({ repoRoot, language: effLang, files: rawFiles, timeoutMs, spawn });
  }
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
  // A DB clangd cannot compile produces a clean-looking analyze whose diagnostics mean nothing.
  // Carry the selection warnings out with the result so the caller cannot mistake quiet for OK.
  const dbWarnings = compileDbWarnings(repoRoot);
  return {
    status: notCollected > 0 ? 'partial' : 'ok',
    language,
    mode,
    files: fileResults,
    diagnostics,
    ...(dbWarnings.length ? { compileDbWarnings: dbWarnings } : {}),
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
