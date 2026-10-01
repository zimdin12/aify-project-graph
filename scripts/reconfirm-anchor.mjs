#!/usr/bin/env node
// Take a new baseline for NAMED anchors, and settle their marks.
//
//   node scripts/reconfirm-anchor.mjs --watch <watchId> [--watch <watchId> ...] [--dry-run] [--allow-dirty]
//
// Exit codes: 1 bad argument or error, 2 refused by the service, 3 a named anchor cannot be vouched for,
// 4 uncommitted changes (refused unless --allow-dirty).
//
// Configuration is the sweep's, from the environment (see `scripts/lib/provider-runtime.mjs`); the repository
// is the working directory.
//
// ⛔ THIS IS A DELIBERATE ACT AND IT REFUSES TO BE ANYTHING ELSE. Reconfirm is one of only two things the
// service allows to SETTLE a mark, and its design calls it "a deliberate act by something that looked". So:
//   - every anchor must be NAMED with `--watch`; there is no default and no "all";
//   - the sweep (`post-watch-signals.mjs`) never calls this, and this never sweeps;
//   - if ANY named anchor cannot be vouched for, NOTHING is sent. A deliberate act that half-applied would
//     leave the operator believing they had re-baselined what they named, when part of it never happened.
import { resolveAnchor } from './lib/anchor-resolver.mjs';
import { DashboardSignalsClient, SignalsRefused } from './lib/dashboard-signals-client.mjs';
import { makeInstruments, readProviderConfig, headOf, dirtyCountOf, dirtyRefusal } from './lib/provider-runtime.mjs';
import { planReconfirm, parseReconfirmArgs, RECONFIRM_REFUSALS } from './lib/reconfirm-plan.mjs';

const repoRoot = process.cwd();

async function main() {
  // 1. Which anchors. Refuses with no `--watch`, before anything is read or sent.
  const { watchIds, dryRun, allowDirty } = parseReconfirmArgs(process.argv.slice(2));

  const client = new DashboardSignalsClient(readProviderConfig());
  console.log(`endpoint      ${client.describe()}`);
  console.log(`reporter      ${client.reporterId}`);

  // 2. The commit, and whether the tree is it. ⛔ A baseline from uncommitted code persists under a commit that
  //    does not hold it, so that is refused unless --allow-dirty, before the service is even asked anything.
  //    A dry run sends nothing, so it only warns.
  const head = headOf(repoRoot);
  const dirty = dirtyCountOf(repoRoot);
  const refusal = dirtyRefusal({ dirty, allowDirty, act: 'reconfirm' });
  if (refusal !== null && !dryRun) {
    console.error(`\nNOTHING SENT: ${refusal}`);
    process.exit(4);
  }

  // 3. The current set. Its revision is sent back unchanged: a baseline taken against a set that has since
  //    moved is refused with a 409, because the anchor it names may no longer be the one the set holds.
  const set = await client.readWatchSet();
  console.log(`watch set     revision ${set.watchRevision}, ${set.items.length} items`);
  console.log(`head          ${head}${dirty > 0 ? `  ⚠ ${dirty} uncommitted path(s) — the baseline reads the TREE, the stamp names the COMMIT` : ''}`);
  if (refusal !== null) console.log(`              ⚠ a real run would refuse: ${refusal}`);

  // 4. Resolve each NAMED anchor with the same resolver the sweep uses, and decide.
  const byId = new Map(set.items.map((item) => [item.watchId, item]));
  const plans = watchIds.map((watchId) => {
    const item = byId.get(watchId);
    if (item === undefined) {
      return { ok: false, watchId, refusal: 'not_watched', reason: RECONFIRM_REFUSALS.not_watched };
    }
    return planReconfirm(resolveAnchor({ repoRoot, item, deps: makeInstruments(repoRoot) }), { head });
  });

  console.log('');
  for (const plan of plans) {
    if (plan.ok) console.log(`  RECONFIRM  ${plan.watchId}\n             stamp ${plan.stamp.stampVersion} ${plan.stamp.hash.slice(0, 16)}`);
    else console.log(`  REFUSED    ${plan.watchId}  (${plan.refusal})\n             ${plan.reason}`);
  }

  // 5. All or nothing.
  const refused = plans.filter((plan) => !plan.ok);
  if (refused.length > 0) {
    console.error(`\nNOTHING SENT: ${refused.length} of ${plans.length} named anchor(s) cannot be vouched for.`);
    process.exit(3);
  }
  if (dryRun) {
    console.log('\n--dry-run: nothing was sent.');
    return;
  }

  // 6. Send, one anchor per request — each is its own act, and each answers with what it settled.
  for (const plan of plans) {
    try {
      const confirmed = await client.reconfirm({ watchId: plan.watchId, watchRevision: set.watchRevision, stamp: plan.stamp });
      console.log(`\nCONFIRMED     ${plan.watchId}  settled [${(confirmed?.settled ?? []).join(', ')}]`);
    } catch (error) {
      if (error instanceof SignalsRefused) {
        console.error(`\nREFUSED ${error.status} ${error.code}  ${plan.watchId}\n  ${error.body?.message ?? ''}`);
        if (error.shouldReread) console.error('  ⇒ the set moved; re-read and reconfirm against the current revision.');
        process.exit(2);
      }
      throw error;
    }
  }
}

try {
  await main();
} catch (error) {
  // An argument error is the operator's to fix, and says so without a stack.
  console.error(`reconfirm-anchor: ${error.message}`);
  process.exit(1);
}
