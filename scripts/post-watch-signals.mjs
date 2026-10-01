#!/usr/bin/env node
// Sweep this repository against the dashboard's watch set and post one complete batch of signals.
//
//   node scripts/post-watch-signals.mjs --dry-run      # resolve and print, send nothing
//   node scripts/post-watch-signals.mjs                # resolve, print, then post
//   ... --allow-dirty                                  # post even with uncommitted changes (refused by default)
//
// Exit codes: 1 incomplete batch or bad argument, 2 refused by the service, 4 uncommitted changes.
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
import { resolveAnchor, splitBatch } from './lib/anchor-resolver.mjs';
import { DashboardSignalsClient, SignalsRefused } from './lib/dashboard-signals-client.mjs';
import { makeInstruments, readProviderConfig, headOf, dirtyCountOf, dirtyRefusal } from './lib/provider-runtime.mjs';

// The repository is the working directory, so pointing this at a scratch repo is `cd` and nothing else.
const repoRoot = process.cwd();
const instruments = makeInstruments(repoRoot);

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--dry-run' && a !== '--allow-dirty');
  if (unknown.length > 0) {
    console.error(`unknown argument(s): ${unknown.join(' ')}`);
    process.exit(1);
  }
  const dryRun = args.includes('--dry-run');
  const allowDirty = args.includes('--allow-dirty');
  const client = new DashboardSignalsClient(readProviderConfig());
  console.log(`endpoint      ${client.describe()}`);
  console.log(`reporter      ${client.reporterId}`);

  // 0. The commit, BEFORE anything is measured. Read after measuring, a commit landing mid-sweep labelled the
  //    batch with code it never read. Sweep identity reserves against this head, so it has to be known first.
  const commit = headOf(repoRoot);
  const dirty = dirtyCountOf(repoRoot);
  // ⛔ The sweep reads the TREE and the batch names the COMMIT; the service cannot see the difference. Refused
  //    unless --allow-dirty. A dry run sends nothing, so it only warns.
  const refusal = dirtyRefusal({ dirty, allowDirty, act: 'sweep' });
  if (refusal !== null && !dryRun) {
    console.error(`\nNOTHING SENT: ${refusal}`);
    process.exit(4);
  }

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
  console.log('');
  console.log(`head          ${commit}${dirty > 0 ? `  ⚠ ${dirty} uncommitted path(s) — the sweep read the TREE, the batch names the COMMIT` : ''}`);
  if (refusal !== null) console.log(`              ⚠ a real run would refuse: ${refusal}`);
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
