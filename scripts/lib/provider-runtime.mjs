// What both dashboard-provider entry points need from the machine they run on: configuration, the real
// instruments, and the commit being described. One owner, so the sweep and the reconfirm cannot drift apart —
// if they resolved an anchor differently, a baseline set by one would never match a comparison by the other,
// and every sweep after a reconfirm would read as `changed` or `restamp` for a reason nobody could see.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { extractFile } from '../../mcp/stdio/ingest/extractors/generic.js';
import { getLanguageConfig } from '../../mcp/stdio/ingest/languages/index.js';
import { fileStructuralFingerprint } from '../../mcp/stdio/ingest/fingerprint.js';
import { scanDocReferences } from '../../mcp/stdio/analysis/doc-links.js';
import { isDocument } from '../../mcp/stdio/ingest/sweep.js';

/**
 * The real instruments, wired to the resolver's injection points, for one repository.
 *
 * ⚠ EVERY ONE OF THESE IS THE PRODUCTION PATH, not a re-implementation. `isDocument` is imported from
 * `sweep.js` — where the indexer's own copy lives — rather than re-listing document extensions here, because
 * a second list is a defect with a delay on it. (`presentWithExactCase` is the one deliberate exception, and
 * the resolver says why.)
 *
 * The repository is a parameter rather than `process.cwd()` read here, so a caller decides what it points at
 * and a test can point it at a scratch tree.
 */
export function makeInstruments(repoRoot) {
  return {
    languageOf: (relPath) => getLanguageConfig(relPath),
    isDocument: (relPath) => isDocument(relPath),
    readSource: (relPath) => readFileSync(join(repoRoot, relPath), 'utf8'),
    extract: ({ relPath, source, config }) => extractFile({ filePath: relPath, source, config }),
    fileFingerprint: (extracted) => fileStructuralFingerprint(extracted),
    docReferences: (source) => scanDocReferences(source),
  };
}

/**
 * Where to point, and as whom. Every value comes from the environment; nothing here is a deployment constant.
 *
 * ⛔ THE KEY IS READ AND NEVER PRINTED. From `APG_DASHBOARD_KEY`, or matched out of the file named by
 * `APG_DASHBOARD_ENV` — the value does not reach stdout, a log line or an error message.
 */
export function readProviderConfig(env = process.env) {
  let keyFromFile;
  if (env.APG_DASHBOARD_ENV) {
    const match = readFileSync(env.APG_DASHBOARD_ENV, 'utf8').match(/^\s*API_KEY\s*=\s*(.+?)\s*$/mu);
    keyFromFile = match?.[1];
  }
  return {
    baseUrl: env.APG_DASHBOARD_URL ?? 'http://localhost:9700',
    apiKey: env.APG_DASHBOARD_KEY ?? keyFromFile,
    hostKey: env.APG_DASHBOARD_HOST ?? 'host-a',
    projectId: env.APG_DASHBOARD_PROJECT,
    // ⛔ CONFIGURATION, NOT A CONSTANT. The reporter name varies by deployment, and it is also the field that
    // makes the two-reporter experiment in `docs/evidence/dashboard-seam-2026-09-30/` possible at all.
    reporterId: env.APG_DASHBOARD_REPORTER ?? 'aify-project-graph',
  };
}

/** The commit a run describes. ⛔ The COMMIT, because the tree can move under a long run. */
export function headOf(repoRoot) {
  return execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

/** How many paths differ from that commit. Reported, never corrected — the caller decides what it means. */
export function dirtyCountOf(repoRoot) {
  const out = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain'], { encoding: 'utf8' });
  return out.split('\n').filter((l) => l.trim() !== '').length;
}
