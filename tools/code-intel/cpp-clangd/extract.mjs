#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function usage() {
  console.error('Usage: node tools/code-intel/cpp-clangd/extract.mjs <repoRoot> [--out <records.jsonl>]');
}

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function findCompileCommands(repoRoot) {
  for (const c of [
    join(repoRoot, 'compile_commands.json'),
    join(repoRoot, 'build', 'compile_commands.json'),
    join(repoRoot, 'cmake-build-debug', 'compile_commands.json'),
  ]) {
    if (await exists(c)) return c;
  }
  return null;
}

function clangdInfo() {
  const out = spawnSync('clangd', ['--version'], { encoding: 'utf8' });
  return {
    available: out.status === 0,
    version: out.status === 0 ? String(out.stdout || out.stderr).split(/\r?\n/u)[0] : '',
  };
}

function parseSymbolLines(text, file) {
  const records = [];
  const lines = text.split(/\r?\n/u);
  const classRe = /^\s*(class|struct)\s+([A-Za-z_][A-Za-z0-9_]*)\b/u;
  const functionRe = /^\s*(?:[A-Za-z_][A-Za-z0-9_:<>,~*&\s]+)\s+([A-Za-z_~][A-Za-z0-9_:~]*)\s*\([^;]*\)\s*(?:const\s*)?(?:\{|$)/u;
  for (let i = 0; i < lines.length; i += 1) {
    const classMatch = lines[i].match(classRe);
    if (classMatch) {
      const name = classMatch[2];
      records.push({ kind: 'symbol', symbol_kind: classMatch[1], qname: name, name, file, start_line: i + 1, end_line: i + 1, language: 'cpp', confidence: 0.72, source: 'cpp-clangd-source-scan' });
      continue;
    }
    const functionMatch = lines[i].match(functionRe);
    if (functionMatch) {
      const qname = functionMatch[1];
      const name = qname.split('::').at(-1);
      records.push({ kind: 'symbol', symbol_kind: qname.includes('::') ? 'method' : 'function', qname, name, file, start_line: i + 1, end_line: i + 1, language: 'cpp', confidence: 0.68, source: 'cpp-clangd-source-scan' });
    }
  }
  return records;
}

function parseIncludes(text, file) {
  const records = [];
  const lines = text.split(/\r?\n/u);
  const includeRe = /^\s*#\s*include\s+[<"]([^>"]+)[>"]/u;
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(includeRe);
    if (!match) continue;
    records.push({ kind: 'include', source_file: file, target_file: match[1], start_line: i + 1, end_line: i + 1, language: 'cpp', confidence: match[0].includes('"') ? 0.9 : 0.55, source_name: 'cpp-clangd-source-scan' });
  }
  return records;
}

async function sourceFilesFromCompileCommands(repoRoot, compileCommandsPath) {
  if (!compileCommandsPath) return [];
  const data = JSON.parse(await readFile(compileCommandsPath, 'utf8'));
  const files = [];
  for (const row of data) {
    if (!row?.file) continue;
    const abs = resolve(row.directory || dirname(compileCommandsPath), row.file);
    const rel = toPosix(relative(repoRoot, abs));
    if (!rel.startsWith('..')) files.push(rel);
  }
  return [...new Set(files)].sort();
}

const args = process.argv.slice(2);
const repoArg = args[0];
if (!repoArg) {
  usage();
  process.exit(2);
}
const outIndex = args.indexOf('--out');
const repoRoot = resolve(repoArg);
const outPath = outIndex >= 0 ? resolve(args[outIndex + 1]) : join(repoRoot, '.aify-graph', 'code-intel', 'cpp-clangd.jsonl');
const manifestPath = join(dirname(outPath), 'code-intel.manifest.json');
const compileCommands = await findCompileCommands(repoRoot);
const clangd = clangdInfo();
const files = await sourceFilesFromCompileCommands(repoRoot, compileCommands);
await mkdir(dirname(outPath), { recursive: true });

const stream = createWriteStream(outPath, { encoding: 'utf8' });
let count = 0;
for (const rel of files) {
  let text;
  try { text = await readFile(join(repoRoot, rel), 'utf8'); } catch { continue; }
  for (const record of [...parseIncludes(text, rel), ...parseSymbolLines(text, rel)]) {
    stream.write(`${JSON.stringify(record)}\n`);
    count += 1;
  }
}
await new Promise((resolveStream, reject) => {
  stream.end(resolveStream);
  stream.on('error', reject);
});

await writeFile(manifestPath, JSON.stringify({
  backend: 'cpp-clangd',
  version: '0.1',
  repoRoot,
  compile_commands: compileCommands ? toPosix(relative(repoRoot, compileCommands)) : null,
  clangd,
  files: files.length,
  records: count,
  output: toPosix(relative(repoRoot, outPath)),
  note: clangd.available
    ? 'v1 emits neutral facts from compile_commands source files; LSP definition/reference expansion is the next backend slice.'
    : 'clangd not found; emitted source-scan facts only. Install clangd for future precision backend expansion.',
}, null, 2));

console.log(JSON.stringify({ ok: true, backend: 'cpp-clangd', records: count, files: files.length, output: outPath, manifest: manifestPath, clangd_available: clangd.available }, null, 2));
