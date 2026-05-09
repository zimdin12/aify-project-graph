#!/usr/bin/env node
import { runCodeIntelCmd } from '../mcp/stdio/code-intel/cli/code-intel-cmd.js';

const argv = process.argv.slice(2);

async function main() {
  const sub = argv[0];
  switch (sub) {
    case 'code-intel':
      return runCodeIntelCmd(argv.slice(1));
    case '--version':
    case '-v': {
      const { readFileSync } = await import('node:fs');
      const { fileURLToPath } = await import('node:url');
      const path = await import('node:path');
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
      console.log(pkg.version);
      return 0;
    }
    case undefined:
    case '--help':
    case '-h':
      console.log('Usage: apg <subcommand>');
      console.log('Subcommands:');
      console.log('  code-intel <op>     Code-intel provider commands (collect, doctor)');
      console.log('  --version           Print version');
      return 0;
    default:
      console.error(`apg: unknown subcommand '${sub}'`);
      return 2;
  }
}

main()
  .then(code => process.exit(code ?? 0))
  .catch(err => { console.error(err.stack || err.message || err); process.exit(1); });
