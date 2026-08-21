#!/usr/bin/env node
// EMIT A GATE RECEIPT. The numbers in a commit message must come from here, not from me.
//
//   node scripts/gate-receipt.mjs            # run the gates, print the receipt
//   node scripts/gate-receipt.mjs --out FILE # ...and write it, for pasting verbatim
//
// ⛔ EXITS NON-ZERO IF ANY GATE FAILED, so a green receipt cannot be obtained from a red run. That
// is the whole mechanism: `cba6c24` published "EXIT 0" over an observed exit 1 because the number
// and the run were connected only by my attention.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoIdentity, identityMovement, runGate, gatePassed, renderReceipt } from './lib/gate-receipt.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// ⛔ THE RUNNER IS SPAWNED DIRECTLY, NOT THROUGH `npx`. The first execution of this tool reported
//
//     command  npx.cmd vitest run
//     exit     null (spawn error: spawnSync npx.cmd EINVAL)
//     VERDICT  1 GATE(S) FAILED: vitest
//
// — a Windows shim that cannot be spawned with `shell: false`. The tool caught a failure in ITSELF
// and refused to render green, which is the entire behaviour it exists for. Resolving the runner's
// own entry point removes the shim from the path between the gate and its verdict.
const VITEST = join(REPO, 'node_modules', 'vitest', 'vitest.mjs');

// The gates every slice must satisfy. Declared here so a receipt cannot quietly omit one.
const GATES = [
  { label: 'vitest', command: process.execPath, args: [VITEST, 'run'], countPattern: /^\s*(Test Files|Tests)\s/ },
  { label: 'authority-ledger', command: process.execPath, args: ['scripts/authority-ledger.mjs', '--check'],
    countPattern: /ALL FILES COMPLETE/ },
];

function main() {
  const before = repoIdentity(REPO);
  const gates = GATES.map((g) => runGate({ ...g, cwd: REPO }));
  const after = repoIdentity(REPO);
  const moved = identityMovement(before, after);

  const receipt = renderReceipt({ before, after, gates, moved });
  console.log(receipt);

  const outIdx = process.argv.indexOf('--out');
  if (outIdx !== -1 && process.argv[outIdx + 1]) {
    writeFileSync(process.argv[outIdx + 1], `${receipt}\n`);
  }

  // ⛔ A receipt whose identity moved binds nothing, even if every gate passed.
  if (moved.length) process.exit(2);
  process.exit(gates.every(gatePassed) ? 0 : 1);
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === join(process.argv[1]);
if (invokedDirectly || process.argv[1]?.endsWith('gate-receipt.mjs')) main();
