// Setup for every test file in both tiers (vitest.config.js): record each read of product source text made by test
// code, for the ratchet in tests/helpers/temp-root.global.js. What counts is defined in ./source-text-reads.js.
//
// Installed once per process. The test file is looked up at call time, so a worker that runs several files names the
// right one, and setup running again for the next file does not wrap the wrapper.
import fs from 'node:fs';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { SOURCE_READS_FILE, productSourceRead } from './source-text-reads.js';

const INSTALLED = Symbol.for('apg.productSourceReads');

if (!fs[INSTALLED]) {
  const root = process.env.APG_TEST_TMP_ROOT;
  if (!root) throw new Error('APG_TEST_TMP_ROOT is not set, so product-source reads have nowhere to be recorded (vitest.config.js sets it)');
  const record = join(root, SOURCE_READS_FILE);
  const note = (path) => {
    const line = productSourceRead(path, () => new Error().stack, globalThis.__vitest_worker__?.filepath);
    if (line) fs.appendFileSync(record, `${line}\n`);
  };
  const { readFileSync } = fs;
  const { readFile } = fs.promises;
  fs.readFileSync = function recordedReadFileSync(path, ...rest) { note(path); return readFileSync.call(this, path, ...rest); };
  fs.promises.readFile = function recordedReadFile(path, ...rest) { note(path); return readFile.call(this, path, ...rest); };
  fs[INSTALLED] = true;
  // Named imports (`import { readFileSync } from 'node:fs'`) see the wrappers only after this.
  syncBuiltinESMExports();
}
