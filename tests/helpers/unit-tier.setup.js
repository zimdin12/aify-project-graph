// Setup for every file in the parallel unit tier (vitest.config.js): install the language-server guard and name the
// file it runs for, so a refusal record says which test file to move, including from a child process.
import './unit-tier-forbids-language-servers.js';

process.env.APG_UNIT_TEST_FILE = globalThis.__vitest_worker__?.filepath ?? '(unknown test file)';
