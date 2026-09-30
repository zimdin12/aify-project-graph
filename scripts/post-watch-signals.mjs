#!/usr/bin/env node
// Sweep this repository against the dashboard's watch set and post one complete batch of signals.
//
//   node scripts/post-watch-signals.mjs --dry-run      # resolve and print, send nothing
//   node scripts/post-watch-signals.mjs                # resolve, print, then post
//
// Configuration comes from the environment, never from a constant in here:
//   APG_DASHBOARD_URL      default http://localhost:9700
//   APG_DASHBOARD_KEY      required; or APG_DASHBOARD_ENV pointing at a .env holding API_KEY=
//   APG_DASHBOARD_HOST     default host-a
//   APG_DASHBOARD_PROJECT  required
//   APG_DASHBOARD_REPORTER default aify-project-graph; the name this sweep reports under
//
// ⛔ THE SWEEP DOES NOT RECONFIRM, AND THAT IS DELIBERATE. `reconfirm` is one of only two acts allowed to
// SETTLE a mark, and their own design calls it "a deliberate act by something that looked". A sweeper that
// reconfirmed every anchor it had just reported would clear the marks it raised in the same breath, which is
// the "page full of real signals becomes clean in one click" failure the per-anchor rule exists to prevent.
// ⇒ The consequence is stated rather than hidden: with no baseline, an honest provider reports `restamp`
// every sweep, so `unchanged` is unreachable here. That is raised as a question, not worked around.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { extractFile } from '../mcp/stdio/ingest/extractors/generic.js';
import { getLanguageConfig } from '../mcp/stdio/ingest/languages/index.js';
import { fileStructuralFingerprint } from '../mcp/stdio/ingest/fingerprint.js';
import { scanDocReferences } from '../mcp/stdio/analysis/doc-links.js';
import { isDocument } from '../mcp/stdio/ingest/sweep.js';
import { resolveAnchor, splitBatch } from './lib/anchor-resolver.mjs';
import { DashboardSignalsClient, SignalsRefused } from './lib/dashboard-signals-client.mjs';

const repoRoot = process.cwd();

/**
 * The real instruments, wired to the resolver's injection points.
 *
 * ⚠ EVERY ONE OF THESE IS THE PRODUCTION PATH, not a re-implementation. `isDocument` is imported from
 * `sweep.js` — where the indexer's own copy lives — rather than re-listing document extensions here, because
 * a second list is a defect with a delay on it. (`presentWithExactCase` is the one deliberate exception, and
 * the resolver says why.)
 */
const instruments = {
  languageOf: (relPath) => getLanguageConfig(relPath),
  isDocument: (relPath) => isDocument(relPath),
  readSource: (relPath) => readFileSync(join(repoRoot, relPath), 'utf8'),
  extract: ({ relPath, source, config }) => extractFile({ filePath: relPath, source, config }),
  fileFingerprint: (extracted) => fileStructuralFingerprint(extracted),
  docReferences: (source) => scanDocReferences(source),
};

function config() {
  const envFile = process.env.APG_DASHBOARD_ENV;
  let keyFromFile;
  if (envFile) {
    // Read, matched, and never printed. The value does not reach stdout, a log line or an error message.
    const match = readFileSync(envFile, 'utf8').match(/^\s*API_KEY\s*=\s*(.+?)\s*$/mu);
    keyFromFile = match?.[1];
  }
  return {
    baseUrl: process.env.APG_DASHBOARD_URL ?? 'http://localhost:9700',
    apiKey: process.env.APG_DASHBOARD_KEY ?? keyFromFile,
    hostKey: process.env.APG_DASHBOARD_HOST ?? 'host-a',
    projectId: process.env.APG_DASHBOARD_PROJECT,
    // ⛔ CONFIGURATION, NOT A CONSTANT. The reporter name varies by deployment, and it is also the field that
    // makes the two-reporter experiment in `docs/evidence/dashboard-seam-2026-09-30/` possible at all.
    reporterId: process.env.APG_DASHBOARD_REPORTER ?? 'aify-project-graph',
  };
}

/** The commit this sweep describes. ⛔ The COMMIT, because the tree can move under a long sweep. */
function head() {
  return execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

/** Whether the tree matches that commit. Reported, never corrected — the caller decides what it means. */
function dirtyFiles() {
  const out = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain'], { encoding: 'utf8' });
  return out.split('\n').filter((l) => l.trim() !== '').length;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const client = new DashboardSignalsClient(config());
  console.log(`endpoint      ${client.describe()}`);
  console.log(`reporter      ${client.reporterId}`);

  // 1. Read the set. The revision read here is the one posted back, unchanged.
  const set = await client.readWatchSet();
  console.log(`watch set     revision ${set.watchRevision}, ${set.items.length} items`);

  // 2. Resolve every anchor, independently.
  const resolved = set.items.map((item) => resolveAnchor({ repoRoot, item, deps: instruments }));

  // 3. Prove the batch covers the set BEFORE sending it. Their `incomplete_batch` refusal is the backstop;
  //    relying on a backstop to find your own gaps is how a partial sweep ships.
  const batch = splitBatch(resolved, set.items.map((i) => i.watchId));
  if (!batch.complete) {
    console.error(`INCOMPLETE — missing [${batch.missing}] duplicated [${batch.duplicated}]`);
    process.exit(1);
  }

  // 4. Show the whole verdict, per anchor, before anything leaves the machine.
  const byId = new Map(set.items.map((i) => [i.watchId, i]));
  console.log('');
  for (const row of batch.results) {
    const a = byId.get(row.watchId)?.anchor ?? {};
    console.log(`  ${String(row.status).padEnd(10)} ${a.kind}:${a.name}  ${a.path}`);
    console.log(`             stamp ${row.stamp?.stampVersion ?? '(none)'} ${(row.stamp?.hash ?? '').slice(0, 16)}`);
  }
  for (const row of batch.unwatched) {
    const a = byId.get(row.watchId)?.anchor ?? {};
    console.log(`  ${'UNWATCHED'.padEnd(10)} ${a.kind}:${a.name}  ${a.path}`);
    console.log(`             ${row.reason.slice(0, 96)}`);
  }
  const commit = head();
  const dirty = dirtyFiles();
  console.log('');
  console.log(`head          ${commit}${dirty > 0 ? `  ⚠ ${dirty} uncommitted path(s) — the sweep read the TREE, the batch names the COMMIT` : ''}`);
  console.log(`batch         ${batch.results.length} results, ${batch.unwatched.length} unwatched, ${set.items.length} watched`);

  if (dryRun) {
    console.log('\n--dry-run: nothing was sent.');
    return;
  }

  // 5. Post.
  try {
    const applied = await client.postSignals({
      head: commit,
      watchRevision: set.watchRevision,
      results: batch.results,
      unwatched: batch.unwatched,
    });
    console.log(`\nACCEPTED      ${JSON.stringify(applied)}`);
  } catch (error) {
    if (error instanceof SignalsRefused) {
      console.error(`\nREFUSED ${error.status} ${error.code}\n  ${error.body?.message ?? ''}`);
      if (error.shouldReread) console.error('  ⇒ the set moved; re-read and recompute rather than retrying this batch.');
      process.exit(2);
    }
    throw error;
  }
}

await main();
