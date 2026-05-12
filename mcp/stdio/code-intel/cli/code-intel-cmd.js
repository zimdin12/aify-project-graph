import { runCollection } from '../runner.js';
import { runDoctor } from './doctor.js';
import { registerProvider, getProvider } from '../providers/index.js';
import { createCppClangdProvider } from '../providers/cpp-clangd.js';

let providersRegistered = false;
function ensureBuiltinProviders() {
  if (providersRegistered) return;
  if (!getProvider('cpp-clangd')) {
    registerProvider('cpp-clangd', () => createCppClangdProvider());
  }
  providersRegistered = true;
}

function parseFlags(args) {
  const out = { _: [], scope: 'changed', files: [], projectRoot: process.cwd(), operations: undefined, json: false, since: undefined };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--scope') out.scope = args[++i];
    else if (a === '--project-root') out.projectRoot = args[++i];
    else if (a === '--files') {
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) out.files.push(args[++i]);
    }
    else if (a === '--operations') {
      out.operations = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    }
    else if (a === '--since') out.since = args[++i];
    else if (a === '--json') out.json = true;
    else out._.push(a);
  }
  return out;
}

async function cmdCollect(args) {
  ensureBuiltinProviders();
  const flags = parseFlags(args);
  const language = flags._[0];
  if (!language) {
    process.stderr.write('apg code-intel collect: <language> required\n');
    return 2;
  }
  const req = {
    language,
    projectRoot: flags.projectRoot,
    scope: flags.scope,
    files: flags.files.length > 0 ? flags.files : undefined,
    since: flags.since,
    operations: flags.operations || ['definitions', 'references', 'diagnostics']
  };
  const result = await runCollection(req);
  if (flags.json) process.stdout.write(JSON.stringify(result));
  else {
    process.stdout.write(`status=${result.status} provider=${result.provider} records=${result.records.length}\n`);
    if (result.errors) for (const e of result.errors) process.stdout.write(`  error[${e.code}]: ${e.message}\n    hint: ${e.hint || '(none)'}\n`);
  }
  return result.status === 'error' ? 2 : 0;
}

export async function runCodeIntelCmd(args) {
  const sub = args[0];
  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write('Usage: apg code-intel <subcommand>\n');
    process.stdout.write('Subcommands:\n');
    process.stdout.write('  collect <language> [--scope changed|files|all] [--files ...] [--project-root <dir>] [--since <ref>] [--operations a,b,c] [--json]\n');
    process.stdout.write('  doctor [<language>]\n');
    process.stdout.write('  serve-lsp <language>   thin LSP relay — spawns the language server (e.g. clangd) and pipes stdio. For host integrations (Claude .lsp.json, Pi .pi-lsp.json).\n');
    return 0;
  }
  if (sub === 'collect') return cmdCollect(args.slice(1));
  if (sub === 'doctor') return runDoctor(args.slice(1));
  if (sub === 'serve-lsp') {
    const { runServeLsp } = await import('./serve-lsp.js');
    return runServeLsp(args.slice(1));
  }
  process.stderr.write(`apg code-intel: unknown subcommand '${sub}'\n`);
  return 2;
}
