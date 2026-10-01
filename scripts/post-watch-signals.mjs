#!/usr/bin/env node
// Sweep this repository against the dashboard's watch set and post one complete batch of signals.
//
//   node scripts/post-watch-signals.mjs --dry-run      # read the set, resolve and print; reserve and send nothing
//   node scripts/post-watch-signals.mjs                # reserve a sweep, resolve against it, print, then post
//   ... --allow-dirty                                  # post even with uncommitted changes (refused by default)
//
// A real run is a SWEEP (the dashboard's step 3): it reserves before measuring, measures the set the reservation
// returns, and posts with the sweep's id, so the service can order this reporter's reports. The first
// reservation for a project adopts sweeps for this reporter there, and after that an unswept post is refused.
//
// Exit codes: 1 incomplete batch, bad argument or unrecognised answer; 2 refused by the service (for a stale
// baseline or revision, running again reserves afresh); 3 stale sweep: a later sweep of this reporter was applied
// first, this one was kept as history and changed nothing; 4 uncommitted changes.
//
// Configuration comes from the environment, never from a constant in here:
//   APG_DASHBOARD_URL      default http://localhost:9700
//   APG_DASHBOARD_KEY      required; or APG_DASHBOARD_ENV pointing at a .env holding API_KEY=
//   APG_DASHBOARD_HOST     default host-a
//   APG_DASHBOARD_PROJECT  required
//   APG_DASHBOARD_REPORTER default derived per install (provider-runtime.mjs deriveReporterId); the name this
//                          sweep reports under, and the name its sweep cursor is kept under
//
// ⛔ THE SWEEP DOES NOT RECONFIRM, AND THAT IS DELIBERATE. `reconfirm` is one of only two acts allowed to
// SETTLE a mark, and their own design calls it "a deliberate act by something that looked". A sweeper that
// reconfirmed every anchor it had just reported would clear the marks it raised in the same breath, which is
// the "page full of real signals becomes clean in one click" failure the per-anchor rule exists to prevent.
// ⇒ So an anchor with no baseline reports `restamp` on every sweep. A baseline comes only from a person naming the
// anchor to `scripts/reconfirm-anchor.mjs`; after that, `unchanged` and `changed` are reachable.
import { resolveAnchor, splitBatch } from './lib/anchor-resolver.mjs';
import { DashboardSignalsClient, SignalsRefused } from './lib/dashboard-signals-client.mjs';
import { outcomeOfPost } from './lib/sweep-outcome.mjs';
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

  // 1. Reserve a sweep, and measure the set it returns. The revision and predecessor it returns are posted back
  //    unchanged, or the post is refused as inconsistent. A dry run reads the set instead: a reservation adopts
  //    sweeps for this reporter, and a run that sends nothing must not change what the service expects next.
  let set;
  let sweep;
  try {
    if (dryRun) {
      set = await client.readWatchSet();
    } else {
      const reserved = await client.reserveSweep({ head: commit });
      set = { watchRevision: reserved.watchRevision, items: reserved.items };
      sweep = { id: reserved.sweepId, predecessor: reserved.predecessor };
      console.log(`sweep         #${reserved.sweepId}, after ${reserved.predecessor === null ? 'none applied yet' : `#${reserved.predecessor}`}`);
    }
  } catch (error) {
    if (error instanceof SignalsRefused) {
      console.error(`\nREFUSED ${error.status} ${error.code}\n  ${error.detail ?? ''}`);
      process.exit(2);
    }
    throw error;
  }
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

  // 5. Post, with the sweep, and decide what the answer means (sweep-outcome.mjs).
  let outcome;
  try {
    const reply = await client.postSignals({
      head: commit,
      watchRevision: set.watchRevision,
      results: batch.results,
      unwatched: batch.unwatched,
      sweep,
    });
    outcome = outcomeOfPost({ reply });
  } catch (error) {
    if (!(error instanceof SignalsRefused)) throw error;
    outcome = outcomeOfPost({ refusal: error });
  }
  (outcome.exit === 0 ? console.log : console.error)(`\n${outcome.line}`);
  if (outcome.exit !== 0) process.exit(outcome.exit);
}

await main();
