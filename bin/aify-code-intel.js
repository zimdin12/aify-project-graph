#!/usr/bin/env node
// Thin PATH shim: forwards to `apg code-intel <args>` so hosts that require
// a top-level binary (Claude `.lsp.json`, Pi `.pi-lsp.json`) can resolve it.
import { runCodeIntelCmd } from '../mcp/stdio/code-intel/cli/code-intel-cmd.js';

runCodeIntelCmd(process.argv.slice(2))
  .then(code => process.exit(code ?? 0))
  .catch(err => { console.error(err.stack || err.message || err); process.exit(1); });
